// Token saver: stage-1 trimming, compaction, context-window learning,
// LLM summaries through the router, savings accounting, calculator.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'og-saver-'));
process.env.OPEN_GRAVITY_HOME = home;
process.env.OG_OFFLINE = '1';

import { startMockUpstream, MockUpstream } from './mock-upstream';
import { ConfigStore, AppConfig, TOKEN_SAVER_PRESETS } from '../src/core/config';
import { UsageStore } from '../src/core/usage';
import { startApp, RunningApp } from '../src/app';
import { logger } from '../src/core/logger';
import type { IRRequest, IRMessage } from '../src/translate';
import {
  applyTokenSaver, compactConversation, trimMiddle, minifyJson, compactWhitespace, requestTokens, countTokens, digest, planCompaction,
} from '../src/router/tokensaver';
import { contextWindowFrom } from '../src/router/compat';

logger.quiet = true;

// An agent loop: user task, then N rounds of tool call + large tool output.
function agentConversation(rounds: number, outputChars = 6000): IRRequest {
  const messages: IRMessage[] = [{ role: 'user', parts: [{ type: 'text', text: 'Fix the failing tests in the repo.' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] }];
  for (let i = 0; i < rounds; i++) {
    messages.push({ role: 'assistant', parts: [{ type: 'thinking', text: `thinking ${i}` }, { type: 'tool_call', id: `call_${i}`, name: 'read_file', args: JSON.stringify({ file_path: `src/file${i}.ts` }) }] });
    const body = Array.from({ length: Math.ceil(outputChars / 40) }, (_, l) => `line ${l} of file ${i}: const value = ${l};   `).join('\n');
    messages.push({ role: 'user', parts: [{ type: 'tool_result', id: `call_${i}`, name: 'read_file', content: [{ type: 'text', text: body }] }] });
  }
  messages.push({ role: 'assistant', parts: [{ type: 'text', text: 'Looking at the last file.' }] });
  messages.push({ role: 'user', parts: [{ type: 'text', text: 'Continue.' }] });
  return { model: 'm', system: 'You are a coding agent.', messages, stream: false, maxTokens: 1000 };
}

describe('Stage 1', () => {
  test('helpers', () => {
    const long = Array.from({ length: 400 }, (_, i) => `row ${i}`).join('\n');
    const t = trimMiddle(long, 100)!;
    assert.ok(t.startsWith('row 0'));
    assert.ok(t.endsWith('row 399'));
    assert.match(t, /lines \(~\d+ tokens\) omitted by Open Gravity/);
    assert.equal(trimMiddle('short', 100), undefined);
    assert.equal(minifyJson(JSON.stringify({ a: [1, 2, 3], b: 'x'.repeat(200) }, null, 4)), JSON.stringify({ a: [1, 2, 3], b: 'x'.repeat(200) }));
    assert.equal(minifyJson('not json'), undefined);
    assert.equal(compactWhitespace('a  \r\nb\n\n\n\nc\t'), 'a\nb\n\nc');
    assert.equal(countTokens('你好世界'), 4);
  });

  test('old tool outputs are trimmed, recent turns and the task stay intact', () => {
    const ir = agentConversation(12, 30000);
    const r = applyTokenSaver(ir, TOKEN_SAVER_PRESETS.balanced);
    assert.ok(r.saved > 5000, `saved ${r.saved}`);
    assert.ok(r.actions.includes('trim-tool-output'));
    assert.ok(r.actions.includes('drop-old-reasoning'));
    // First message keeps its image (the task statement).
    assert.equal(r.ir.messages[0].parts[1].type, 'image');
    // The last 8 messages are untouched (keepRecentTurns 4 -> 8 messages).
    assert.deepEqual(r.ir.messages.slice(-8), ir.messages.slice(-8));
    // Tool call/result pairs are preserved.
    const calls = r.ir.messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool_call').map((p: any) => p.id));
    const results = r.ir.messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool_result').map((p: any) => p.id));
    assert.deepEqual(calls, results);
    assert.equal(r.after, requestTokens(r.ir));
  });

  test('off and short conversations are unchanged', () => {
    const ir = agentConversation(12);
    assert.equal(applyTokenSaver(ir, TOKEN_SAVER_PRESETS.off).ir, ir);
    const small = agentConversation(1);
    assert.equal(applyTokenSaver(small, TOKEN_SAVER_PRESETS.balanced).saved, 0);
  });

  test('identical outputs are deduplicated (latest kept)', () => {
    const ir = agentConversation(12, 2000);
    const same = ir.messages[2].parts[0] as any;
    (ir.messages[4].parts[0] as any).content = same.content;
    const r = applyTokenSaver(ir, { ...TOKEN_SAVER_PRESETS.safe, keepRecentTurns: 1 });
    assert.match((r.ir.messages[2].parts[0] as any).content[0].text, /Same output as a later read_file call/);
    assert.ok(r.actions.includes('dedupe-tool-output'));
  });

  test('the protected boundary moves in steps of 8 messages (prompt-cache friendly)', () => {
    const a = applyTokenSaver(agentConversation(12), TOKEN_SAVER_PRESETS.balanced).ir.messages;
    const bIr = agentConversation(12);
    bIr.messages.push({ role: 'assistant', parts: [{ type: 'text', text: 'more' }] }, { role: 'user', parts: [{ type: 'text', text: 'go on' }] });
    const b = applyTokenSaver(bIr, TOKEN_SAVER_PRESETS.balanced).ir.messages;
    // Same prefix after one more turn: the provider cache still hits.
    assert.deepEqual(b.slice(0, 16), a.slice(0, 16));
  });
});

describe('Compaction', () => {
  test('context window is read from provider errors', () => {
    assert.equal(contextWindowFrom("this model's maximum context length is 32768 tokens. however, you requested 40000 tokens"), 32768);
    assert.equal(contextWindowFrom('prompt is too long: 210012 tokens > 200000 maximum'), 200000);
    assert.equal(contextWindowFrom('the request exceeds the available context size (8192 tokens), try increasing it'), 8192);
    assert.equal(contextWindowFrom('the input token count (1100000) exceeds the maximum number of tokens allowed (1048576).'), 1048576);
  });

  test('fits the target, keeps the task, the digest and the last turns', async () => {
    const ir = agentConversation(30);
    const r = await compactConversation(ir, 8192, TOKEN_SAVER_PRESETS.safe);
    assert.ok(r.after <= 8192 * 0.7, `after ${r.after}`);
    assert.ok(r.actions.includes('compact-digest'));
    const first = r.ir.messages[0];
    assert.equal(first.role, 'user');
    assert.match((first.parts[0] as any).text, /Fix the failing tests/);
    assert.ok(first.parts.some((p: any) => p.type === 'text' && /compacted by Open Gravity/.test(p.text) && /read_file\(src\/file0\.ts\)/.test(p.text)));
    assert.deepEqual(r.ir.messages.at(-1), ir.messages.at(-1));
    // Roles alternate and every tool result has its call.
    for (let i = 1; i < r.ir.messages.length; i++) assert.notEqual(r.ir.messages[i].role, r.ir.messages[i - 1].role);
    const calls = new Set(r.ir.messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool_call').map((p: any) => p.id)));
    for (const m of r.ir.messages) for (const p of m.parts) if (p.type === 'tool_result') assert.ok(calls.has(p.id));
  });

  test('uses an LLM summary when provided, and the cut is stable across turns', async () => {
    const ir = agentConversation(30);
    const r = await compactConversation(ir, 8192, TOKEN_SAVER_PRESETS.safe, async (removed) => `summary of ${removed.length}`);
    assert.ok(r.actions.includes('compact-summary'));
    assert.ok(JSON.stringify(r.ir.messages[0]).includes('summary of'));
    // With moderate outputs the cut snaps to steps of 8 and stays put for a turn.
    const small = agentConversation(30, 2000);
    const p1 = planCompaction(small, 8192, TOKEN_SAVER_PRESETS.safe)!;
    const next = agentConversation(30, 2000);
    next.messages.push({ role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }, { role: 'user', parts: [{ type: 'text', text: 'next' }] });
    const p2 = planCompaction(next, 8192, TOKEN_SAVER_PRESETS.safe)!;
    assert.equal((p1.cut - 1) % 8, 0, `cut ${p1.cut}`);
    assert.equal(p2.cut, p1.cut);
  });

  test('digest lists requests and tool calls', () => {
    const d = digest(agentConversation(3).messages.slice(1, 6));
    assert.match(d, /Tool calls made \(3\)/);
  });
});

// ------------------------------------------------------------ end to end

let mock: MockUpstream;
let app: RunningApp;
let base: string;

before(async () => {
  mock = await startMockUpstream();
  const config = new ConfigStore(path.join(home, 'config.json'));
  const cfg: AppConfig = {
    ...config.get(),
    providers: [{
      id: 'small', type: 'openai-compatible', name: 'small', format: 'openai', baseUrl: `${mock.url}/v1`, auth: 'bearer',
      models: ['ctx4k', 'mock-text'], enabled: true, rotation: 'round-robin', createdAt: 0, keys: [{ id: 'k', key: 'secret-key', enabled: true }],
    }] as any,
  };
  cfg.settings.captureBodies = true;
  config.replace(cfg);
  app = await startApp({ config, usage: new UsageStore(30, path.join(home, 'usage')), port: 0, host: '127.0.0.1', strictPort: true });
  base = app.baseUrl;
});

after(async () => {
  await app.stop();
  await mock.close();
  fs.rmSync(home, { recursive: true, force: true });
});

function openaiAgentBody(rounds: number) {
  const messages: any[] = [{ role: 'system', content: 'You are a coding agent.' }, { role: 'user', content: 'Fix the failing tests.' }];
  for (let i = 0; i < rounds; i++) {
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `call_${i}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `f${i}.ts` }) } }] });
    messages.push({ role: 'tool', tool_call_id: `call_${i}`, content: Array.from({ length: 150 }, (_, l) => `line ${l} in f${i}`).join('\n') });
  }
  messages.push({ role: 'user', content: 'Continue.' });
  return {
    model: 'small/ctx4k', max_tokens: 1000, messages,
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
  };
}

const ADMIN = { 'content-type': 'application/json', 'x-og-admin': '1' };

describe('End to end', () => {
  test('context overflow: window learned, conversation compacted, savings recorded', async () => {
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openaiAgentBody(20)) });
    assert.equal(res.status, 200);
    const id = res.headers.get('x-og-request-id')!;
    const detail = await (await fetch(`${base}/admin/api/usage/${id}`)).json() as any;
    assert.ok(detail.record.adapted.some((a: string) => /context window is 4096 tokens/.test(a)));
    assert.ok(detail.record.saved > 1000);
    assert.ok(detail.record.saverActions.some((a: string) => a.startsWith('compact')));
    assert.equal(app.config.get().compat['small::ctx4k'].contextWindow, 4096);
    // Next time it compacts before sending: a single attempt.
    const again = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openaiAgentBody(22)) });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('x-og-attempt'), '1');
  });

  test('LLM summaries go through the router with the internal token', async () => {
    app.config.update((c) => { c.settings.tokenSaver = { ...TOKEN_SAVER_PRESETS.safe, mode: 'custom', summarizer: 'small/mock-text' }; });
    const before = mock.received.length;
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openaiAgentBody(24)) });
    assert.equal(res.status, 200);
    const sent = mock.received.slice(before);
    const summaryCall = sent.find((r) => r.body?.model === 'mock-text');
    assert.ok(summaryCall, 'summary requested through the router');
    const final = sent.filter((r) => r.body?.model === 'ctx4k').at(-1)!;
    assert.ok(JSON.stringify(final.body.messages).includes('Summary of the earlier conversation'));
    // The internal request is logged as its own request, without token saver.
    const recent = await (await fetch(`${base}/admin/api/usage/recent?limit=5`)).json() as any[];
    assert.ok(recent.some((r) => r.requestedModel === 'small/mock-text' && r.clientId === 'open-gravity'));
    // Summaries are cached: the same history does not trigger a new summary call.
    const before2 = mock.received.length;
    await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openaiAgentBody(24)) });
    assert.equal(mock.received.slice(before2).filter((r) => r.body?.model === 'mock-text').length, 0);
  });

  test('the internal token is rejected from the network and unknown values are ignored', async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-og-internal': 'nope' },
      body: JSON.stringify({ model: 'small/mock-text', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200); // local, no key required: treated as a normal client
  });

  test('calculator: simulate presets on a captured request and on a pasted body', async () => {
    const r = await (await fetch(`${base}/admin/api/tokensaver/simulate`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ body: openaiAgentBody(20), format: 'openai', contextWindow: 4096 }) })).json() as any;
    assert.equal(r.results.length, 3);
    const [safe, balanced, aggressive] = r.results;
    assert.ok(aggressive.saved >= balanced.saved && balanced.saved >= safe.saved);
    assert.ok(aggressive.after <= 4096);
    const recent = await (await fetch(`${base}/admin/api/usage/recent?limit=1`)).json() as any[];
    const cap = await fetch(`${base}/admin/api/tokensaver/simulate`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ requestId: recent[0].id }) });
    assert.equal(cap.status, 200);
  });

  test('settings: presets are normalised, custom values clamped', async () => {
    const put = await fetch(`${base}/admin/api/settings`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ tokenSaver: { mode: 'custom', keepRecentTurns: 9999, compactAt: 5, summarizer: '  x/y ' } }) });
    assert.equal(put.status, 200);
    const s = app.config.get().settings.tokenSaver;
    assert.equal(s.keepRecentTurns, 100);
    assert.equal(s.compactAt, 1);
    assert.equal(s.summarizer, 'x/y');
    await fetch(`${base}/admin/api/settings`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ tokenSaver: { mode: 'aggressive' } }) });
    assert.deepEqual(app.config.get().settings.tokenSaver, TOKEN_SAVER_PRESETS.aggressive);
  });
});
