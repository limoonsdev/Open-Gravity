// End-to-end tests: real HTTP server + mock upstreams for every protocol pair.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'og-test-'));
process.env.OPEN_GRAVITY_HOME = home;

import { startMockUpstream, parseSSE, MockUpstream } from './mock-upstream';
import { ConfigStore, AppConfig } from '../src/core/config';
import { UsageStore } from '../src/core/usage';
import { startApp, RunningApp } from '../src/app';
import { logger } from '../src/core/logger';
import { health } from '../src/router/health';

logger.quiet = true;

let mock: MockUpstream;
let app: RunningApp;
let base: string;

function provider(id: string, format: string, baseUrl: string, models: string[], extra: any = {}) {
  const auth = format === 'anthropic' ? 'anthropic' : format === 'gemini' ? 'goog' : 'bearer';
  return {
    id, type: `${format}-test`, name: id, format, baseUrl, auth, models, enabled: true, rotation: 'round-robin', createdAt: 0,
    keys: [{ id: `${id}-k1`, key: `${id}-secret-1`, enabled: true }],
    ...extra,
  };
}

before(async () => {
  mock = await startMockUpstream();
  const config = new ConfigStore(path.join(home, 'config.json'));
  const cfg: AppConfig = {
    ...config.get(),
    providers: [
      provider('oa', 'openai', `${mock.url}/v1`, ['mock-text', 'mock-tool', 'mock-think', 'fail-429', 'fail-500', 'err-stream']),
      provider('an', 'anthropic', mock.url, ['claude-text', 'claude-tool', 'claude-think', 'err-stream']),
      provider('ge', 'gemini', mock.url, ['gemini-text', 'gemini-tool', 'gemini-3-tool']),
      provider('rs', 'responses', `${mock.url}/v1`, ['resp-text', 'resp-tool']),
      provider('multi', 'openai', `${mock.url}/v1`, ['mock-text'], {
        keys: [
          { id: 'mk1', key: 'multi-1', enabled: true },
          { id: 'mk2', key: 'multi-2', enabled: true },
          { id: 'mk3', key: 'multi-3', enabled: false },
        ],
      }),
    ] as any,
    combos: [
      { id: 'smart', targets: ['oa/fail-429', 'an/claude-text'], strategy: 'fallback', enabled: true },
      { id: 'badstream', targets: ['oa/err-stream', 'ge/gemini-text'], strategy: 'fallback', enabled: true },
      { id: 'allfail', targets: ['oa/fail-500'], strategy: 'fallback', enabled: true },
    ],
    aliases: { 'claude-*haiku*': 'ge/gemini-text', 'gpt-4o': 'smart' },
  };
  cfg.settings.defaultModel = 'oa/mock-text';
  config.replace(cfg);
  app = await startApp({ config, usage: new UsageStore(30, path.join(home, 'usage')), port: 0, host: '127.0.0.1', strictPort: true });
  base = app.baseUrl;
});

after(async () => {
  await app.stop();
  await mock.close();
  fs.rmSync(home, { recursive: true, force: true });
});

async function post(p: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { /* sse */ }
  return { res, text, json };
}

function lastReceived() {
  return mock.received[mock.received.length - 1];
}

const WEATHER_TOOL_OAI = [{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false, $schema: 'http://json-schema.org/draft-07/schema#' } } }];
const WEATHER_TOOL_ANT = [{ name: 'get_weather', description: 'Weather', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }];

describe('OpenAI clients', () => {
  test('non-stream OpenAI -> Anthropic upstream', async () => {
    const { res, json } = await post('/v1/chat/completions', { model: 'an/claude-text', messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }] });
    assert.equal(res.status, 200);
    assert.equal(json.object, 'chat.completion');
    assert.equal(json.choices[0].message.content, 'Hello world');
    assert.equal(json.choices[0].finish_reason, 'stop');
    assert.equal(res.headers.get('x-og-provider'), 'an');
    const up = lastReceived();
    assert.equal(up.path, '/v1/messages');
    assert.equal(up.headers['x-api-key'], 'an-secret-1');
    assert.equal(up.body.system, 'Be brief');
    assert.equal(up.body.model, 'claude-text');
    assert.deepEqual(up.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]);
  });

  test('stream OpenAI -> Anthropic upstream with tool call', async () => {
    const { res, text } = await post('/v1/chat/completions', { model: 'an/claude-tool', stream: true, stream_options: { include_usage: true }, tools: WEATHER_TOOL_OAI, messages: [{ role: 'user', content: 'Weather?' }] });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /event-stream/);
    const events = parseSSE(text);
    assert.equal(events[events.length - 1].data, '[DONE]');
    const chunks = events.filter((e) => typeof e.data === 'object');
    const toolDeltas = chunks.flatMap((c) => c.data.choices?.[0]?.delta?.tool_calls || []);
    assert.equal(toolDeltas[0].function.name, 'get_weather');
    assert.equal(toolDeltas.map((t: any) => t.function.arguments || '').join(''), '{"city":"Paris"}');
    assert.ok(chunks.some((c) => c.data.choices?.[0]?.finish_reason === 'tool_calls'));
    const usage = chunks.find((c) => c.data.usage)?.data.usage;
    assert.equal(usage.completion_tokens, 9);
    assert.equal(usage.prompt_tokens, 26, 'input + cached tokens');
    assert.equal(lastReceived().body.tools[0].input_schema.type, 'object');
  });

  test('OpenAI -> Gemini upstream sanitizes JSON schema and sends key header', async () => {
    const { json } = await post('/v1/chat/completions', { model: 'ge/gemini-tool', tools: WEATHER_TOOL_OAI, messages: [{ role: 'user', content: 'Weather?' }] });
    assert.equal(json.choices[0].finish_reason, 'tool_calls');
    assert.equal(json.choices[0].message.tool_calls[0].function.arguments, '{"city":"Paris"}');
    const up = lastReceived();
    assert.match(up.path, /\/v1beta\/models\/gemini-tool:streamGenerateContent\?alt=sse/);
    assert.equal(up.headers['x-goog-api-key'], 'ge-secret-1');
    const params = up.body.tools[0].functionDeclarations[0].parameters;
    assert.equal(params.additionalProperties, undefined);
    assert.equal(params.$schema, undefined);
    assert.deepEqual(params.required, ['city']);
  });

  test('Gemini 3 thought signatures round-trip through tool history', async () => {
    const first = await post('/v1/chat/completions', { model: 'ge/gemini-3-tool', tools: WEATHER_TOOL_OAI, messages: [{ role: 'user', content: 'Weather?' }] });
    const call = first.json.choices[0].message.tool_calls[0];
    await post('/v1/chat/completions', {
      model: 'ge/gemini-3-tool', tools: WEATHER_TOOL_OAI,
      messages: [{ role: 'user', content: 'Weather?' }, { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: '{"temp":21}' }],
    });
    const contents = lastReceived().body.contents;
    assert.equal(contents[1].parts[0].thoughtSignature, 'gem-sig-123');
    assert.equal(contents[2].parts[0].functionResponse.name, 'get_weather');
    assert.deepEqual(contents[2].parts[0].functionResponse.response, { temp: 21 });
  });

  test('passthrough OpenAI -> OpenAI hides usage chunk when not requested', async () => {
    const { text } = await post('/v1/chat/completions', { model: 'oa/mock-text', stream: true, messages: [{ role: 'user', content: 'Hi' }] });
    const events = parseSSE(text);
    assert.ok(!events.some((e) => typeof e.data === 'object' && Array.isArray(e.data.choices) && e.data.choices.length === 0));
    assert.equal(lastReceived().body.stream_options.include_usage, true);
    const rec = app.usage.recent(1)[0];
    assert.equal(rec.output, 7, 'usage recorded from hidden chunk');
  });

  test('reasoning content is exposed as reasoning_content', async () => {
    const { json } = await post('/v1/chat/completions', { model: 'an/claude-think', messages: [{ role: 'user', content: 'Hi' }], reasoning_effort: 'high' });
    assert.equal(json.choices[0].message.reasoning_content, 'Let me think.');
    assert.equal(lastReceived().body.thinking.type, 'enabled');
  });
});

describe('Anthropic clients (Claude Code)', () => {
  test('stream Anthropic -> OpenAI upstream with tool call: valid event sequence', async () => {
    const { res, text } = await post('/v1/messages', { model: 'oa/mock-tool', max_tokens: 1000, stream: true, tools: WEATHER_TOOL_ANT, messages: [{ role: 'user', content: 'Weather?' }] }, { 'anthropic-version': '2023-06-01' });
    assert.equal(res.status, 200);
    const evs = parseSSE(text);
    const types = evs.map((e) => e.event);
    // Tool arguments are buffered, repaired and sent as one validated delta.
    assert.deepEqual(types, ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    assert.equal(evs[1].data.content_block.type, 'tool_use');
    assert.equal(evs[1].data.content_block.name, 'get_weather');
    assert.equal(evs[2].data.delta.partial_json, '{"city":"Paris"}');
    assert.equal(evs[4].data.delta.stop_reason, 'tool_use');
    assert.equal(evs[4].data.usage.output_tokens, 7);
    // Tool definitions translated to OpenAI format
    assert.equal(lastReceived().body.tools[0].function.name, 'get_weather');
  });

  test('Anthropic tool_result history -> OpenAI tool messages', async () => {
    await post('/v1/messages', {
      model: 'oa/mock-text', max_tokens: 100,
      system: [{ type: 'text', text: 'sys A' }, { type: 'text', text: 'sys B' }],
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'toolu_9', name: 'get_weather', input: { city: 'Paris' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: [{ type: 'text', text: 'Sunny' }] }, { type: 'text', text: 'thanks' }] },
      ],
    });
    const msgs = lastReceived().body.messages;
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[0].content, 'sys A\n\nsys B');
    assert.equal(msgs[2].tool_calls[0].id, 'toolu_9');
    assert.equal(msgs[2].tool_calls[0].function.arguments, '{"city":"Paris"}');
    assert.deepEqual(msgs[3], { role: 'tool', tool_call_id: 'toolu_9', content: 'Sunny' });
    assert.deepEqual(msgs[4], { role: 'user', content: 'thanks' });
  });

  test('passthrough Anthropic -> Anthropic keeps beta header and drops unsigned thinking', async () => {
    const { res, text } = await post('/v1/messages', {
      model: 'an/claude-text', max_tokens: 100, stream: true,
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: '' }, { type: 'text', text: 'b' }] },
        { role: 'user', content: 'c' },
      ],
    }, { 'anthropic-beta': 'interleaved-thinking-2025-05-14' });
    assert.equal(res.status, 200);
    const up = lastReceived();
    assert.equal(up.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14');
    assert.deepEqual(up.body.messages[1].content, [{ type: 'text', text: 'b' }]);
    assert.ok(parseSSE(text).some((e) => e.event === 'message_stop'));
  });

  test('glob alias routes claude haiku to Gemini; model echoed back', async () => {
    const { json, res } = await post('/v1/messages', { model: 'claude-3-5-haiku-20241022', max_tokens: 50, messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(res.headers.get('x-og-provider'), 'ge');
    assert.equal(json.model, 'claude-3-5-haiku-20241022');
    assert.equal(json.content[0].text, 'Hello world');
    assert.equal(json.usage.input_tokens, 30);
  });

  test('count_tokens estimate', async () => {
    const { json } = await post('/v1/messages/count_tokens', { model: 'x', messages: [{ role: 'user', content: 'a'.repeat(400) }] });
    assert.equal(json.input_tokens, 100);
  });
});

describe('Responses clients (Codex)', () => {
  test('stream Responses -> Gemini upstream', async () => {
    const { text } = await post('/v1/responses', { model: 'ge/gemini-text', stream: true, instructions: 'You are Codex', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] });
    const evs = parseSSE(text);
    const types = evs.map((e) => e.event);
    assert.equal(types[0], 'response.created');
    assert.ok(types.includes('response.output_text.delta'));
    assert.equal(types[types.length - 1], 'response.completed');
    const done = evs.find((e) => e.event === 'response.output_item.done')!.data.item;
    assert.equal(done.content[0].text, 'Hello world');
    const completed = evs[evs.length - 1].data.response;
    assert.equal(completed.usage.input_tokens, 30);
    assert.equal(completed.output[0].type, 'message');
    const seqs = evs.map((e) => e.data.sequence_number);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(lastReceived().body.systemInstruction.parts[0].text, 'You are Codex');
  });

  test('Responses function call round trip -> OpenAI upstream', async () => {
    const { text } = await post('/v1/responses', {
      model: 'oa/mock-tool', stream: true,
      tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
      input: [
        { role: 'user', content: 'weather' },
        { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: 'rainy' },
      ],
    });
    const evs = parseSSE(text);
    const item = evs.find((e) => e.event === 'response.output_item.done')!.data.item;
    assert.equal(item.type, 'function_call');
    assert.equal(item.arguments, '{"city":"Paris"}');
    assert.equal(item.call_id, 'call_abc');
    const msgs = lastReceived().body.messages;
    assert.equal(msgs[1].tool_calls[0].id, 'c1');
    assert.deepEqual(msgs[2], { role: 'tool', tool_call_id: 'c1', content: 'rainy' });
  });

  test('custom (freeform) tools map to custom_tool_call', async () => {
    const { json } = await post('/v1/responses', {
      model: 'oa/mock-tool',
      tools: [{ type: 'custom', name: 'get_weather', description: 'raw' }],
      input: 'weather',
    });
    // The upstream sees a function tool with a single "input" string param
    const up = lastReceived().body;
    assert.equal(up.tools[0].type, 'function');
    assert.equal(up.tools[0].function.parameters.properties.input.type, 'string');
    assert.equal(json.output[0].type, 'custom_tool_call');
  });

  test('passthrough Responses -> Responses provider', async () => {
    const { text } = await post('/v1/responses', { model: 'rs/resp-text', stream: true, input: 'hi' });
    assert.ok(text.includes('response.completed'));
    assert.equal(lastReceived().body.model, 'resp-text');
  });
});

describe('Gemini clients (Gemini CLI)', () => {
  test('streamGenerateContent -> OpenAI upstream', async () => {
    const res = await fetch(`${base}/v1beta/models/oa%2Fmock-text:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': 'whatever' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], systemInstruction: { parts: [{ text: 'sys' }] } }),
    });
    const evs = parseSSE(await res.text());
    const text = evs.map((e) => e.data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '').join('');
    assert.equal(text, 'Hello world');
    assert.equal(evs[evs.length - 1].data.candidates[0].finishReason, 'STOP');
    assert.equal(lastReceived().body.messages[0].content, 'sys');
  });

  test('generateContent non-stream with function call from Anthropic upstream', async () => {
    const res = await fetch(`${base}/v1beta/models/an/claude-tool:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'weather' }] }], tools: [{ functionDeclarations: [{ name: 'get_weather', parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } } } }] }] }),
    });
    const json: any = await res.json();
    assert.deepEqual(json.candidates[0].content.parts[0].functionCall, { name: 'get_weather', args: { city: 'Paris' } });
    assert.equal(lastReceived().body.tools[0].input_schema.properties.city.type, 'string');
  });
});

describe('Routing, fallback and health', () => {
  test('combo falls back after 429 and cools the key down', async () => {
    const { res, json } = await post('/v1/chat/completions', { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-og-provider'), 'an');
    assert.equal(json.model, 'smart');
    const rec = app.usage.recent(1)[0];
    assert.equal(rec.attempts.length, 2);
    assert.equal(rec.attempts[0].status, 429);
    assert.ok(health.isCooling('oa', 'oa-k1', 'fail-429'));
    assert.ok(!health.isCooling('oa', 'oa-k1', 'mock-text'), '429 cools only that model');
  });

  test('in-stream error before content triggers fallback', async () => {
    const { res, text } = await post('/v1/chat/completions', { model: 'badstream', stream: true, messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-og-provider'), 'ge');
    assert.ok(text.includes('Hello'));
  });

  test('all candidates failing returns the error in client format', async () => {
    const { res, json } = await post('/v1/messages', { model: 'allfail', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(res.status, 500);
    assert.equal(json.type, 'error');
    assert.match(json.error.message, /mock failure 500/);
  });

  test('round-robin across enabled keys only', async () => {
    const before = mock.received.length;
    for (let i = 0; i < 4; i++) await post('/v1/chat/completions', { model: 'multi/mock-text', messages: [{ role: 'user', content: 'Hi' }] });
    const auths = mock.received.slice(before).map((r) => r.headers.authorization);
    assert.deepEqual(new Set(auths), new Set(['Bearer multi-1', 'Bearer multi-2']));
  });

  test('unknown model falls back to default; alias to combo works', async () => {
    let r = await post('/v1/chat/completions', { model: 'totally-unknown', messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(r.res.headers.get('x-og-provider'), 'oa');
    r = await post('/v1/chat/completions', { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(r.res.status, 200);
  });

  test('health endpoint identifies the router (used for single-instance detection)', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).service, 'open-gravity');
    const { probeExisting } = await import('../src/app');
    assert.equal(await probeExisting('127.0.0.1', app.info.port), true);
  });

  test('/v1/models lists combos and provider models', async () => {
    const res = await fetch(`${base}/v1/models`);
    const json: any = await res.json();
    const ids = json.data.map((m: any) => m.id);
    assert.ok(ids.includes('smart'));
    assert.ok(ids.includes('oa/mock-text'));
  });

  test('embeddings pass through to OpenAI-compatible provider', async () => {
    const { json, res } = await post('/v1/embeddings', { model: 'oa/text-embedding-3-small', input: 'hello' });
    assert.equal(res.status, 200);
    assert.deepEqual(json.data[0].embedding, [0.1, 0.2]);
  });
});

describe('Security', () => {
  test('cross-origin browser request without key is rejected', async () => {
    const { res } = await post('/v1/chat/completions', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'Hi' }] }, { origin: 'https://evil.example' });
    assert.equal(res.status, 401);
  });

  test('DNS rebinding host header is rejected', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      const req = http.request({ hostname: u.hostname, port: u.port, path: '/v1/models', headers: { host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  test('admin API requires CSRF header and masks secrets', async () => {
    let res = await fetch(`${base}/admin/api/keys`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 403);
    res = await fetch(`${base}/admin/api/state`);
    const state: any = await res.json();
    assert.equal(state.providers[0].keys[0].masked.includes('secret'), false);
    assert.ok(!JSON.stringify(state).includes('oa-secret-1'));
    assert.ok(!JSON.stringify(state).includes('sessionSecret'));
  });

  test('requireApiKey enforces router keys', async () => {
    const created = await fetch(`${base}/admin/api/keys`, { method: 'POST', headers: { 'x-og-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 't' }) });
    const key: any = await created.json();
    app.config.update((c) => { c.settings.requireApiKey = true; });
    try {
      let r = await post('/v1/chat/completions', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'Hi' }] });
      assert.equal(r.res.status, 401);
      r = await post('/v1/chat/completions', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'Hi' }] }, { authorization: `Bearer ${key.key}` });
      assert.equal(r.res.status, 200);
      r = await post('/v1/messages', { model: 'oa/mock-text', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }, { 'x-api-key': key.key });
      assert.equal(r.res.status, 200);
      assert.equal(app.usage.recent(1)[0].apiKeyId, key.id);
    } finally {
      app.config.update((c) => { c.settings.requireApiKey = false; });
    }
  });

  test('dashboard password protects admin API', async () => {
    const h = { 'x-og-admin': '1', 'content-type': 'application/json' };
    let res = await fetch(`${base}/admin/api/password`, { method: 'POST', headers: h, body: JSON.stringify({ password: 'hunter22' }) });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/admin/api/state`);
    assert.equal(res.status, 401);
    res = await fetch(`${base}/admin/api/login`, { method: 'POST', headers: h, body: JSON.stringify({ password: 'nope-nope' }) });
    assert.equal(res.status, 401);
    res = await fetch(`${base}/admin/api/login`, { method: 'POST', headers: h, body: JSON.stringify({ password: 'hunter22' }) });
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    res = await fetch(`${base}/admin/api/state`, { headers: { cookie } });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/admin/api/password`, { method: 'POST', headers: { ...h, cookie }, body: JSON.stringify({ password: '' }) });
    assert.equal(res.status, 200);
  });
});

describe('Admin API', () => {
  const h = { 'x-og-admin': '1', 'content-type': 'application/json' };

  test('create provider from template, fetch models, test, rename, delete', async () => {
    let res = await fetch(`${base}/admin/api/providers`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'openai-compatible', name: 'My Local', baseUrl: `${mock.url}/v1`, key: 'abc', models: ['mock-text'] }) });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as any;
    assert.equal(id, 'my-local');
    res = await fetch(`${base}/admin/api/providers/${id}/models/fetch`, { method: 'POST', headers: h, body: '{}' });
    const fetched: any = await res.json();
    assert.deepEqual(fetched.models, ['mock-text', 'mock-tool']);
    res = await fetch(`${base}/admin/api/providers/${id}/test`, { method: 'POST', headers: h, body: JSON.stringify({ model: 'mock-text' }) });
    const probe: any = await res.json();
    assert.equal(probe.ok, true);
    assert.equal(probe.text, 'Hello world');
    await fetch(`${base}/admin/api/combos`, { method: 'POST', headers: h, body: JSON.stringify({ id: 'local-combo', targets: [`${id}/mock-text`] }) });
    res = await fetch(`${base}/admin/api/providers/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ id: 'renamed' }) });
    assert.equal(res.status, 200);
    assert.deepEqual(app.config.get().combos.find((c) => c.id === 'local-combo')!.targets, ['renamed/mock-text']);
    res = await fetch(`${base}/admin/api/providers/renamed`, { method: 'DELETE', headers: h });
    assert.equal(res.status, 200);
  });

  test('usage summary aggregates recorded requests', async () => {
    const res = await fetch(`${base}/admin/api/usage/summary?range=24h`);
    const s: any = await res.json();
    assert.ok(s.totals.requests > 5);
    assert.ok(s.byProvider.length > 0);
    assert.equal(s.series.length >= 24, true);
  });

  test('playground uses the router', async () => {
    const res = await fetch(`${base}/admin/api/playground`, { method: 'POST', headers: h, body: JSON.stringify({ model: 'an/claude-text', messages: [{ role: 'user', content: 'hi' }] }) });
    const json: any = await res.json();
    assert.equal(json.choices[0].message.content, 'Hello world');
  });

  test('dashboard HTML is served', async (t) => {
    const res = await fetch(`${base}/`);
    if (res.status === 503) return t.skip('dashboard not built (npm run build:ui)');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
  });
});
