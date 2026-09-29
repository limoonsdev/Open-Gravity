import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser } from '../src/translate/sse';
import { cleanSchemaForGemini } from '../src/translate/gemini';
import { buildOpenAIRequest, OpenAIStreamDecoder } from '../src/translate/openai';
import { buildAnthropicRequest, AnthropicStreamEncoder } from '../src/translate/anthropic';
import { parseResponsesRequest } from '../src/translate/responses';
import { updateCodexToml } from '../src/integrations/tools';
import type { IRRequest } from '../src/translate';

test('SSE parser handles arbitrary chunk boundaries and CRLF', () => {
  const raw = 'event: a\r\ndata: {"x":1}\r\n\r\ndata: line1\ndata: line2\n\n: comment\n\ndata: [DONE]\n\n';
  for (let size = 1; size < raw.length; size += 3) {
    const p = new SSEParser();
    const out: any[] = [];
    for (let i = 0; i < raw.length; i += size) out.push(...p.push(raw.slice(i, i + size)));
    out.push(...p.end());
    assert.deepEqual(out, [{ event: 'a', data: '{"x":1}' }, { event: undefined, data: 'line1\nline2' }, { event: undefined, data: '[DONE]' }]);
  }
});

test('Gemini schema cleaner resolves refs, nullable unions and strips unsupported keys', () => {
  const schema = {
    $schema: 'x', type: 'object', additionalProperties: false,
    $defs: { Loc: { type: 'object', properties: { city: { type: 'string', default: 'Paris' } } } },
    properties: {
      loc: { $ref: '#/$defs/Loc' },
      unit: { type: ['string', 'null'], enum: ['c', 'f', null] },
      n: { anyOf: [{ type: 'integer', exclusiveMinimum: 0 }, { type: 'null' }] },
      tag: { const: 'fixed' },
    },
    required: ['loc', 'missing'],
  };
  const out = cleanSchemaForGemini(schema);
  assert.deepEqual(out, {
    type: 'object',
    properties: {
      loc: { type: 'object', properties: { city: { type: 'string' } } },
      unit: { type: 'string', nullable: true, enum: ['c', 'f'] },
      n: { type: 'integer', nullable: true },
      tag: { enum: ['fixed'], type: 'string' },
    },
    required: ['loc'],
  });
});

const baseIR = (extra: Partial<IRRequest> = {}): IRRequest => ({ model: 'm', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], stream: true, ...extra });

test('OpenAI builder: max_completion_tokens, reasoning effort, mistral tool ids', () => {
  const ir = baseIR({
    maxTokens: 100, temperature: 0.2, reasoning: { budget: 30000 },
    messages: [
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'toolu_01ABCdef', name: 'f', args: '{}' }] },
      { role: 'user', parts: [{ type: 'tool_result', id: 'toolu_01ABCdef', content: [{ type: 'text', text: 'ok' }] }] },
    ],
  });
  const body = buildOpenAIRequest(ir, { model: 'o3', maxTokensField: 'max_completion_tokens', reasoningEffort: true, stripSampling: true, toolIdStyle: 'mistral' });
  assert.equal(body.max_completion_tokens, 100);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.temperature, undefined);
  const id = body.messages[0].tool_calls[0].id;
  assert.match(id, /^[a-zA-Z0-9]{9}$/);
  assert.equal(body.messages[1].tool_call_id, id);
});

test('Anthropic builder disables thinking mid tool-loop without signed thinking', () => {
  const ir = baseIR({
    reasoning: { effort: 'high' }, temperature: 0.5,
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'call:1', name: 'f', args: '{"a":1}' }] },
      { role: 'user', parts: [{ type: 'tool_result', id: 'call:1', content: [{ type: 'text', text: 'r' }] }] },
    ],
  });
  const body = buildAnthropicRequest(ir, { model: 'claude-sonnet-4-5' });
  assert.equal(body.thinking, undefined);
  assert.equal(body.temperature, 0.5);
  assert.equal(body.messages[1].content[0].id, 'call_1', 'tool ids sanitised');
  assert.equal(body.messages[2].content[0].tool_use_id, 'call_1');

  const fresh = buildAnthropicRequest(baseIR({ reasoning: { budget: 5000 }, maxTokens: 2000 }), { model: 'claude-sonnet-4-5' });
  assert.deepEqual(fresh.thinking, { type: 'enabled', budget_tokens: 5000 });
  assert.ok(fresh.max_tokens > 5000);
});

test('OpenAI decoder handles providers that omit tool index and say "stop"', () => {
  const d = new OpenAIStreamDecoder();
  const evs = [
    ...d.push(undefined, { id: 'x', choices: [{ delta: { tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{"a":1}' } }] } }] }),
    ...d.push(undefined, { choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ...d.end(),
  ];
  assert.deepEqual(evs.map((e) => e.type), ['start', 'tool_start', 'tool_args', 'tool_end', 'stop']);
  assert.deepEqual(evs[evs.length - 1], { type: 'stop', reason: 'tool_use' });
});

test('Anthropic encoder switches blocks thinking -> text -> tool', () => {
  const e = new AnthropicStreamEncoder('m', 10);
  let out = '';
  out += e.push({ type: 'thinking', text: 'hmm' });
  out += e.push({ type: 'text', text: 'hi' });
  out += e.push({ type: 'tool_start', index: 0, id: 'a.b', name: 'f' });
  out += e.push({ type: 'tool_args', index: 0, delta: '{}' });
  out += e.push({ type: 'tool_end', index: 0 });
  out += e.push({ type: 'stop', reason: 'tool_use' });
  const events = [...out.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(events, [
    'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
  ]);
  assert.ok(out.includes('"id":"a_b"'));
});

test('Responses parser merges developer messages into system and keeps call ids', () => {
  const ir = parseResponsesRequest({
    model: 'x', instructions: 'I',
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'D' }] },
      { role: 'user', content: 'u' },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thought' }] },
      { type: 'function_call', call_id: 'c', name: 'shell', arguments: '{"cmd":"ls"}' },
      { type: 'function_call_output', call_id: 'c', output: 'files' },
    ],
    reasoning: { effort: 'low' },
  });
  assert.equal(ir.system, 'I\n\nD');
  assert.equal(ir.messages.length, 3);
  assert.equal(ir.messages[1].parts[1].type, 'tool_call');
  assert.equal(ir.reasoning?.effort, 'low');
});

test('Codex TOML update keeps user settings and replaces our table', () => {
  const src = 'model = "gpt-5"\napproval_policy = "never"\n\n[model_providers.open-gravity]\nname = "old"\n\n[profiles.x]\nmodel = "y"\n';
  const out = updateCodexToml(src, { baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'combo', smallModel: 'combo', models: [] });
  assert.ok(out.startsWith('model = "combo"\nmodel_provider = "open-gravity"'));
  assert.ok(out.includes('approval_policy = "never"'));
  assert.ok(out.includes('[profiles.x]\nmodel = "y"'));
  assert.equal(out.match(/\[model_providers\.open-gravity\]/g)?.length, 1);
  assert.ok(!out.includes('name = "old"'));
  const firstTable = out.indexOf('[');
  assert.ok(out.indexOf('approval_policy') < firstTable, 'top-level keys stay before tables');
});

test('OpenAI passthrough adapts max_tokens / sampling for OpenAI reasoning models', async () => {
  const { buildPassthrough } = await import('../src/providers/upstream');
  const p: any = { id: 'openai', type: 'openai', format: 'openai', auth: 'bearer', baseUrl: 'https://api.openai.com/v1', keys: [], models: [] };
  const up = buildPassthrough(p, { id: 'k', key: 'sk', enabled: true }, 'o3', 'openai', { model: 'coding', max_tokens: 50, temperature: 0.3, messages: [] }, {}, true);
  assert.equal(up.body.model, 'o3');
  assert.equal(up.body.max_completion_tokens, 50);
  assert.equal(up.body.max_tokens, undefined);
  assert.equal(up.body.temperature, undefined);
  assert.equal(up.headers.authorization, 'Bearer sk');
  assert.equal(up.url, 'https://api.openai.com/v1/chat/completions');
});
