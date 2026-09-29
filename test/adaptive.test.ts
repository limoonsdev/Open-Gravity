// End-to-end tests for v2.1 features: tool-calling emulation, self-healing
// compatibility, stream transforms, race/fastest strategies, response cache,
// Ollama and legacy completions APIs, provider presets.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'og-adapt-'));
process.env.OPEN_GRAVITY_HOME = home;

import { startMockUpstream, parseSSE, MockUpstream } from './mock-upstream';
import { ConfigStore, AppConfig } from '../src/core/config';
import { UsageStore } from '../src/core/usage';
import { startApp, RunningApp } from '../src/app';
import { logger } from '../src/core/logger';
import { health } from '../src/router/health';
import { responseCache } from '../src/router/cache';
import { CATALOG } from '../src/providers/catalog';
import { modelDb } from '../src/core/modeldb';

logger.quiet = true;

let mock: MockUpstream;
let app: RunningApp;
let base: string;

const provider = (id: string, format: string, baseUrl: string, models: string[], extra: any = {}) => ({
  id, type: `${format}-compatible`, name: id, format, baseUrl, auth: format === 'anthropic' ? 'anthropic' : format === 'gemini' ? 'goog' : 'bearer',
  models, enabled: true, rotation: 'round-robin', createdAt: 0, keys: [{ id: `${id}-k`, key: `${id}-secret`, enabled: true }], ...extra,
});

before(async () => {
  mock = await startMockUpstream();
  const config = new ConfigStore(path.join(home, 'config.json'));
  const cfg: AppConfig = {
    ...config.get(),
    providers: [
      provider('oa', 'openai', `${mock.url}/v1`, ['mock-text', 'notools-a', 'notools-b', 'notools-xml', 'maxtok', 'nosystem', 'strict', 'tagreason', 'badargs', 'slow-text']),
      provider('an', 'anthropic', mock.url, ['claude-text']),
      provider('emu', 'openai', `${mock.url}/v1`, ['emu-model'], { toolMode: 'emulate' }),
      provider('local', 'openai', `${mock.url}/v1`, ['codegeex4'], { type: 'ollama', keys: [] }),
    ] as any,
    combos: [
      { id: 'racing', targets: ['oa/slow-text', 'an/claude-text'], strategy: 'race', enabled: true },
      { id: 'quick', targets: ['oa/slow-text', 'an/claude-text'], strategy: 'fastest', enabled: true },
    ],
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
  try { json = JSON.parse(text); } catch { /* stream */ }
  return { res, text, json };
}

const calls = (model: string) => mock.received.filter((r) => r.body?.model === model);
const TOOLS_OAI = [{ type: 'function', function: { name: 'get_weather', description: 'Weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' }, days: { type: 'integer' } }, required: ['city'] } } }];
const TOOLS_ANT = [{ name: 'get_weather', description: 'Weather for a city', input_schema: { type: 'object', properties: { city: { type: 'string' }, days: { type: 'integer' } }, required: ['city'] } }];

describe('Tool-calling emulation', () => {
  test('provider rejecting tools is detected, adapted and emulated (then remembered)', async () => {
    const { res, json } = await post('/v1/chat/completions', { model: 'oa/notools-a', tools: TOOLS_OAI, messages: [{ role: 'user', content: 'Weather in Paris?' }] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-og-emulated-tools'), '1');
    const msg = json.choices[0].message;
    assert.equal(json.choices[0].finish_reason, 'tool_calls');
    assert.equal(msg.tool_calls[0].function.name, 'get_weather');
    assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { city: 'Paris' });
    assert.equal(msg.content, 'Checking the weather.\n');
    const sent = calls('notools-a');
    assert.equal(sent.length, 2, 'first native attempt, then emulated retry');
    assert.ok(sent[0].body.tools);
    assert.equal(sent[1].body.tools, undefined);
    assert.match(sent[1].body.messages[0].content, /<tools>[\s\S]*get_weather/);
    const rec = app.usage.recent(1)[0];
    assert.equal(rec.emulatedTools, true);
    assert.match(rec.adapted![0], /tool calling not supported/);
    assert.equal(app.config.get().compat['oa::notools-a'].emulateTools, true);

    await post('/v1/chat/completions', { model: 'oa/notools-a', tools: TOOLS_OAI, messages: [{ role: 'user', content: 'Again?' }] });
    assert.equal(calls('notools-a').length, 3, 'learned fix: no failed native attempt the second time');
  });

  test('Claude Code style loop: tool_use then tool_result history rendered as text', async () => {
    const first = await post('/v1/messages', { model: 'emu/emu-model', max_tokens: 500, stream: true, tools: TOOLS_ANT, messages: [{ role: 'user', content: 'Weather?' }] });
    const evs = parseSSE(first.text);
    const toolStart = evs.find((e) => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use')!;
    assert.equal(toolStart.data.content_block.name, 'get_weather');
    assert.match(toolStart.data.content_block.id, /^toolu_/);
    const input = evs.filter((e) => e.data?.delta?.type === 'input_json_delta').map((e) => e.data.delta.partial_json).join('');
    assert.deepEqual(JSON.parse(input), { city: 'Paris' });
    assert.equal(evs.find((e) => e.event === 'message_delta')!.data.delta.stop_reason, 'tool_use');

    const id = toolStart.data.content_block.id;
    const second = await post('/v1/messages', {
      model: 'emu/emu-model', max_tokens: 500, tools: TOOLS_ANT,
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: [{ type: 'tool_use', id, name: 'get_weather', input: { city: 'Paris' } }] },
        // Claude Code may send an extra user message after the tool results.
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'sunny, 24C' }] },
        { role: 'user', content: [{ type: 'text', text: '<system-reminder>context</system-reminder>' }] },
      ],
    });
    assert.equal(second.json.content[0].text, 'It is sunny in Paris.');
    assert.equal(second.json.stop_reason, 'end_turn');
    const up = calls('emu-model').pop()!.body.messages;
    // Roles strictly alternate (local chat templates reject user, user).
    assert.deepEqual(up.map((m: any) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.match(up[2].content, /<tool_call>\n\{"name":"get_weather","arguments":\{"city":"Paris"\}\}\n<\/tool_call>/);
    assert.match(up[3].content, /<tool_response name="get_weather" id="toolu_[^"]+">\nsunny, 24C\n<\/tool_response>\n\n<system-reminder>context<\/system-reminder>$/);
  });

  test('Qwen3-Coder XML tool calls are parsed', async () => {
    app.config.update((c) => { c.compat['oa::notools-xml'] = { emulateTools: true }; });
    const { json } = await post('/v1/chat/completions', { model: 'oa/notools-xml', tools: TOOLS_OAI, messages: [{ role: 'user', content: 'Weather?' }] });
    assert.deepEqual(JSON.parse(json.choices[0].message.tool_calls[0].function.arguments), { city: 'Paris' });
  });

  test('model database marks a model without tools: emulated from the first attempt', async () => {
    assert.equal(modelDb.lookup('ollama', 'codegeex4')?.tools, false);
    const before = calls('codegeex4').length;
    const { json } = await post('/v1/chat/completions', { model: 'local/codegeex4', tools: TOOLS_OAI, messages: [{ role: 'user', content: 'Weather?' }] });
    assert.equal(json.choices[0].message.tool_calls[0].function.name, 'get_weather');
    assert.equal(calls('codegeex4').length - before, 1);
  });

  test('Responses API (Codex) with emulated tools returns function_call items', async () => {
    const { text } = await post('/v1/responses', {
      model: 'emu/emu-model', stream: true, input: 'Weather?',
      tools: [{ type: 'function', name: 'get_weather', parameters: TOOLS_OAI[0].function.parameters }],
    });
    const done = parseSSE(text).filter((e) => e.event === 'response.output_item.done').map((e) => e.data.item);
    const fc = done.find((i) => i.type === 'function_call');
    assert.ok(fc);
    assert.deepEqual(JSON.parse(fc.arguments), { city: 'Paris' });
  });
});

describe('Self-healing compatibility', () => {
  test('max_tokens too large is capped and retried', async () => {
    const { res, json } = await post('/v1/messages', { model: 'oa/maxtok', max_tokens: 8000, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 200);
    assert.equal(json.content[0].text, 'Hello world');
    const sent = calls('maxtok');
    assert.equal(sent[sent.length - 1].body.max_tokens, 1000);
    assert.equal(app.config.get().compat['oa::maxtok'].maxTokensCap, 1000);
  });

  test('unsupported system role is merged into the first user message', async () => {
    const { json } = await post('/v1/messages', { model: 'oa/nosystem', max_tokens: 100, system: 'Be nice', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(json.content[0].text, 'Hello world');
    const last = calls('nosystem').pop()!.body.messages;
    assert.equal(last[0].role, 'user');
    assert.match(last[0].content, /^Be nice\n\n/);
  });

  test('rejected parameter (pydantic extra_forbidden) is dropped', async () => {
    const { res } = await post('/v1/messages', { model: 'oa/strict', max_tokens: 100, temperature: 0.5, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 200);
    assert.equal('temperature' in calls('strict').pop()!.body, false);
    const rec = app.usage.recent(1)[0];
    assert.equal(rec.attempts.length, 2);
    assert.match(rec.attempts[0].error!, /retrying with fix/);
  });
});

describe('Stream transforms', () => {
  test('<think> tags become thinking blocks for Anthropic clients', async () => {
    const { json } = await post('/v1/messages', { model: 'oa/tagreason', max_tokens: 100, messages: [{ role: 'user', content: 'q' }] });
    assert.deepEqual(json.content.map((b: any) => b.type), ['thinking', 'text']);
    assert.equal(json.content[0].thinking, 'Reasoning here.');
    assert.equal(json.content[1].text, 'The answer is 42.');
  });

  test('malformed native tool arguments are repaired and coerced to the schema (translated path)', async () => {
    const { json } = await post('/v1/messages', { model: 'oa/badargs', max_tokens: 100, tools: TOOLS_ANT, messages: [{ role: 'user', content: 'q' }] });
    const call = json.content.find((b: any) => b.type === 'tool_use');
    assert.deepEqual(call.input, { city: 'Paris', days: 3 });
  });
});

describe('Performance features', () => {
  test('race strategy: the first provider to answer wins', async () => {
    const t0 = Date.now();
    const { res } = await post('/v1/chat/completions', { model: 'racing', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.headers.get('x-og-provider'), 'an');
    assert.ok(Date.now() - t0 < 550, 'did not wait for the slow provider');
    const rec = app.usage.recent(1)[0];
    assert.equal(rec.provider, 'an');
    assert.ok(rec.attempts.some((a) => a.provider === 'oa' && a.status === 499));
  });

  test('fastest strategy orders targets by measured latency', async () => {
    health.recordLatency('oa/slow-text', 900);
    health.recordLatency('an/claude-text', 20);
    const { res } = await post('/v1/chat/completions', { model: 'quick', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.headers.get('x-og-provider'), 'an');
  });

  test('response cache serves identical requests without calling the provider', async () => {
    app.config.update((c) => { c.settings.cacheTtlSeconds = 60; });
    responseCache.clear();
    try {
      const body = { model: 'an/claude-text', max_tokens: 50, messages: [{ role: 'user', content: 'cache me' }] };
      const n = mock.received.length;
      const a = await post('/v1/messages', body);
      const b = await post('/v1/messages', body);
      const s = await post('/v1/messages', { ...body, stream: true });
      assert.equal(mock.received.length - n, 1);
      assert.equal(b.res.headers.get('x-og-cache'), 'hit');
      assert.equal(b.json.content[0].text, a.json.content[0].text);
      assert.ok(parseSSE(s.text).some((e) => e.event === 'message_stop'));
      assert.equal(app.usage.recent(1)[0].cached, true);
    } finally {
      app.config.update((c) => { c.settings.cacheTtlSeconds = 0; });
    }
  });
});

describe('Ollama and legacy completions APIs', () => {
  test('/api/chat streams NDJSON (default) with tool calls', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'emu/emu-model', messages: [{ role: 'user', content: 'Weather?' }], tools: TOOLS_OAI }),
    });
    assert.match(res.headers.get('content-type') || '', /ndjson/);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const call = lines.find((l) => l.message?.tool_calls)!.message.tool_calls[0];
    assert.deepEqual(call.function, { name: 'get_weather', arguments: { city: 'Paris' } });
    assert.equal(lines[lines.length - 1].done, true);
  });

  test('/api/generate non-stream, /api/tags, /api/show, /api/version', async () => {
    const gen = await post('/api/generate', { model: 'oa/mock-text', prompt: 'hi', stream: false });
    assert.equal(gen.json.response, 'Hello world');
    assert.equal(gen.json.done, true);
    const tags: any = await (await fetch(`${base}/api/tags`)).json();
    assert.ok(tags.models.some((m: any) => m.name === 'oa/mock-text'));
    const show = await post('/api/show', { model: 'oa/mock-text' });
    assert.ok(show.json.capabilities.includes('tools'));
    const ver: any = await (await fetch(`${base}/api/version`)).json();
    assert.ok(ver.version);
  });

  test('/v1/completions (non-stream and stream)', async () => {
    const r = await post('/v1/completions', { model: 'an/claude-text', prompt: 'Say hi', max_tokens: 20 });
    assert.equal(r.json.object, 'text_completion');
    assert.equal(r.json.choices[0].text, 'Hello world');
    const s = await post('/v1/completions', { model: 'an/claude-text', prompt: 'Say hi', stream: true });
    const evs = parseSSE(s.text);
    assert.equal(evs.filter((e) => typeof e.data === 'object').map((e) => e.data.choices[0]?.text || '').join(''), 'Hello world');
    assert.equal(evs[evs.length - 1].data, '[DONE]');
  });
});

describe('Provider presets', () => {
  test('catalog has 100+ presets with unique types', () => {
    assert.ok(CATALOG.length >= 100, `only ${CATALOG.length}`);
    assert.equal(new Set(CATALOG.map((t) => t.type)).size, CATALOG.length);
    for (const t of CATALOG) assert.ok(t.baseUrl && t.name && t.color, t.type);
  });

  test('URL variables and api-key auth (Azure style)', async () => {
    const h = { 'x-og-admin': '1', 'content-type': 'application/json' };
    let res = await fetch(`${base}/admin/api/providers`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'azure-openai', key: 'az-key', vars: { resource: 'contoso' } }) });
    const { id } = (await res.json()) as any;
    assert.equal(app.config.get().providers.find((p) => p.id === id)!.baseUrl, 'https://contoso.openai.azure.com/openai/v1');
    // Point it at the mock and check the header style.
    await fetch(`${base}/admin/api/providers/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ baseUrl: `${mock.url}/v1`, models: ['mock-text'] }) });
    await post('/v1/chat/completions', { model: `${id}/mock-text`, messages: [{ role: 'user', content: 'hi' }] });
    const last = mock.received[mock.received.length - 1];
    assert.equal(last.headers['api-key'], 'az-key');
    assert.equal(last.headers.authorization, undefined);
    res = await fetch(`${base}/admin/api/providers/${id}`, { method: 'DELETE', headers: h });
    assert.equal(res.status, 200);
  });

  test('/v1/models reports context windows from the model database', async () => {
    app.config.update((c) => { c.providers.push(provider('dsk', 'openai', `${mock.url}/v1`, ['deepseek-chat'], { type: 'deepseek' }) as any); });
    const json: any = await (await fetch(`${base}/v1/models`)).json();
    const m = json.data.find((x: any) => x.id === 'dsk/deepseek-chat');
    assert.ok(m.context_length >= 64000);
    assert.ok(m.max_output_tokens > 0);
  });
});
