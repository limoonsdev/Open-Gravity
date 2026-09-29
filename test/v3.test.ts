// Tests for v3 features: quotas (rate-limit headers, limit rules), analytics,
// client detection, free API hub, provider balances.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'og-v3-'));
process.env.OPEN_GRAVITY_HOME = home;
process.env.OG_OFFLINE = '1';

import { startMockUpstream, MockUpstream } from './mock-upstream';
import { ConfigStore, AppConfig } from '../src/core/config';
import { UsageStore, UsageRecord } from '../src/core/usage';
import { startApp, RunningApp } from '../src/app';
import { logger } from '../src/core/logger';
import { parseRateLimitHeaders, parseReset, QuotaTracker, periodStart } from '../src/router/quota';
import { detectClient } from '../src/core/clients';
import { analyze, project, toCsv, percentile } from '../src/core/analytics';
import { parseOpenRouterFree, buildFreeCombo, freeInfoFor } from '../src/providers/free';

logger.quiet = true;

let mock: MockUpstream;
let app: RunningApp;
let base: string;

const provider = (id: string, baseUrl: string, models: string[], extra: any = {}) => ({
  id, type: 'openai-compatible', name: id, format: 'openai', baseUrl, auth: 'bearer',
  models, enabled: true, rotation: 'round-robin', createdAt: 0, keys: [{ id: `${id}-k`, key: `${id}-secret`, enabled: true }], ...extra,
});

before(async () => {
  mock = await startMockUpstream();
  const config = new ConfigStore(path.join(home, 'config.json'));
  const cfg: AppConfig = {
    ...config.get(),
    providers: [
      provider('a', `${mock.url}/v1`, ['mock-text']),
      provider('b', `${mock.url}/v1`, ['mock-text']),
      provider('rl', `${mock.url}/v1`, ['ratelimited'], {
        rotation: 'fill-first',
        keys: [{ id: 'k1', key: 'exhaust-me', enabled: true }, { id: 'k2', key: 'fine', enabled: true }],
      }),
      provider('orouter', `${mock.url}/v1`, ['some/model:free'], { type: 'openrouter' }),
      provider('ds', `${mock.url}/v1`, ['deepseek-chat'], { type: 'deepseek' }),
      provider('gem', `${mock.url}/v1`, ['gemini-2.5-flash'], { type: 'gemini' }),
      provider('llama', `${mock.url}/v1`, ['qwen3:8b'], { type: 'ollama', keys: [] }),
    ] as any,
    combos: [{ id: 'ab', targets: ['a/mock-text', 'b/mock-text'], strategy: 'fallback', enabled: true }],
    apiKeys: [],
  };
  cfg.settings.defaultModel = 'a/mock-text';
  config.replace(cfg);
  app = await startApp({ config, usage: new UsageStore(30, path.join(home, 'usage')), port: 0, host: '127.0.0.1', strictPort: true });
  base = app.baseUrl;
});

after(async () => {
  await app.stop();
  await mock.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const ADMIN = { 'content-type': 'application/json', 'x-og-admin': '1' };
async function admin(method: string, p: string, body?: any) {
  const res = await fetch(`${base}/admin/api${p}`, { method, headers: ADMIN, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { res, json, text };
}
async function chat(model: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
  });
  return { res, json: await res.json() as any };
}

describe('Rate-limit headers', () => {
  test('OpenAI / Groq style', () => {
    const now = 1_000_000;
    const b = parseRateLimitHeaders({
      'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-limit-tokens': '18000', 'x-ratelimit-remaining-tokens': '17997', 'x-ratelimit-reset-tokens': '7.66ms',
    }, now);
    assert.equal(b.requests.limit, 14400);
    assert.equal(b.requests.remaining, 14370);
    assert.equal(b.requests.resetAt, now + 179_560);
    assert.equal(b.tokens.resetAt, now + 7.66);
  });
  test('Anthropic, Cerebras and generic styles', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const b = parseRateLimitHeaders({
      'anthropic-ratelimit-input-tokens-remaining': '39000', 'anthropic-ratelimit-input-tokens-reset': '2026-01-01T00:01:00Z',
      'x-ratelimit-remaining-requests-day': '14399', 'x-ratelimit-reset-tokens-minute': '30',
      'X-RateLimit-Remaining': '3', 'X-RateLimit-Reset': String(now + 5000),
    }, now);
    assert.equal(b['input-tokens'].remaining, 39000);
    assert.equal(b['input-tokens'].resetAt, now + 60_000);
    assert.equal(b['requests-day'].remaining, 14399);
    assert.equal(b['tokens-minute'].resetAt, now + 30_000);
    assert.equal(b.requests.remaining, 3);
    assert.equal(b.requests.resetAt, now + 5000);
  });
  test('reset formats', () => {
    assert.equal(parseReset('1h2m3s', 0), 3_723_000);
    assert.equal(parseReset('1700000000', 0), 1_700_000_000_000);
    assert.equal(parseReset('', 0), undefined);
  });
  test('a key the provider reports as exhausted is skipped without a failed call', async () => {
    const tracker = new QuotaTracker();
    tracker.observe('p', 'k', 'm', { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '20s' }, 1000);
    assert.equal(tracker.exhaustedUntil('p', 'k', 'm', 1000), 21_000);
    assert.equal(tracker.exhaustedUntil('p', 'k', 'm', 30_000), undefined);

    const first = await chat('rl/ratelimited');
    assert.equal(first.res.status, 200);
    assert.equal(first.res.headers.get('x-og-attempt'), '1');
    const before = mock.received.filter((r) => r.body?.model === 'ratelimited').length;
    const second = await chat('rl/ratelimited');
    assert.equal(second.res.status, 200);
    const sent = mock.received.filter((r) => r.body?.model === 'ratelimited').slice(before);
    assert.equal(sent.length, 1, 'no wasted call on the exhausted key');
    assert.equal(sent[0].headers.authorization, 'Bearer fine');
    const q = await admin('GET', '/quota');
    const snap = q.json.snapshots.find((s: any) => s.provider === 'rl' && s.keyId === 'k1');
    assert.equal(snap.buckets.requests.remaining, 0);
    assert.equal(snap.buckets.tokens.remaining, 9000);
  });
});

describe('Limit rules', () => {
  test('invalid rules are rejected', async () => {
    const r = await admin('PUT', '/limits', { limits: [{ scope: 'provider', target: '', period: 'day', maxRequests: 1 }] });
    assert.equal(r.res.status, 400);
  });
  test('a provider over its daily limit is skipped and the combo falls back', async () => {
    const put = await admin('PUT', '/limits', { limits: [{ id: 'lim-a', scope: 'provider', target: 'a', period: 'day', maxRequests: 1, action: 'block' }] });
    assert.equal(put.res.status, 200);
    const one = await chat('ab');
    assert.equal(one.res.headers.get('x-og-provider'), 'a');
    const two = await chat('ab');
    assert.equal(two.res.status, 200);
    assert.equal(two.res.headers.get('x-og-provider'), 'b');
    const detail = await admin('GET', `/usage/${two.res.headers.get('x-og-request-id')}`);
    assert.match(detail.json.record.attempts[0].error, /limit reached/);
    const q = await admin('GET', '/quota');
    const st = q.json.limits.find((l: any) => l.rule.id === 'lim-a');
    assert.equal(st.requests, 1);
    assert.equal(st.exceeded, true);
    assert.ok(q.json.alerts.some((a: any) => a.ruleId === 'lim-a' && a.level === 'exceeded'));
  });
  test('a client budget returns 429 with Retry-After', async () => {
    await admin('PUT', '/limits', { limits: [{ id: 'cc', scope: 'client', target: 'claude-code', period: 'hour', maxRequests: 1, action: 'block' }] });
    const ua = { 'user-agent': 'claude-cli/2.0.14 (external, cli)' };
    const ok = await chat('b/mock-text', ua);
    assert.equal(ok.res.status, 200);
    const blocked = await chat('b/mock-text', ua);
    assert.equal(blocked.res.status, 429);
    assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
    assert.match(blocked.json.error.message, /limit reached/);
    // Other clients are not affected.
    const other = await chat('b/mock-text', { 'user-agent': 'OpenAI/Python 1.99.0' });
    assert.equal(other.res.status, 200);
    await admin('PUT', '/limits', { limits: [] });
  });
  test('periods start on local calendar boundaries', () => {
    const ts = new Date(2026, 4, 14, 15, 30, 12).getTime(); // Thursday
    assert.equal(periodStart('day', ts), new Date(2026, 4, 14).getTime());
    assert.equal(periodStart('month', ts), new Date(2026, 4, 1).getTime());
    assert.equal(periodStart('week', ts), new Date(2026, 4, 11).getTime());
  });
});

describe('Client detection', () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ 'user-agent': 'claude-cli/2.0.14 (external, cli)' }, 'claude-code'],
    [{ 'user-agent': 'codex_cli_rs/0.46.0 (Ubuntu 24.4.0; x86_64)' }, 'codex'],
    [{ 'user-agent': 'OpenAI/JS 5.1.0', 'x-title': 'Kilo Code' }, 'kilo-code'],
    [{ 'user-agent': 'OpenAI/JS 5.1.0', 'http-referer': 'https://github.com/RooVetGit/Roo-Cline' }, 'roo-code'],
    [{ 'user-agent': 'GeminiCLI/0.9.0 (linux; x64)' }, 'gemini-cli'],
    [{ 'user-agent': 'OpenAI/Python 1.99.0' }, 'openai-python'],
    [{ 'user-agent': 'curl/8.5.0' }, 'curl'],
    [{ 'user-agent': 'MyTool/3.1' }, 'ua:mytool'],
    [{}, 'unknown'],
  ];
  for (const [h, id] of cases) test(`${JSON.stringify(h)} -> ${id}`, () => assert.equal(detectClient(h).id, id));
});

describe('Analytics', () => {
  const rec = (i: number, extra: Partial<UsageRecord> = {}): UsageRecord => ({
    id: `r${i}`, ts: Date.now() - i * 60_000, endpoint: 'openai', requestedModel: 'm', provider: 'p', model: 'm', keyId: 'k', status: 200, ok: true,
    latencyMs: 100 * (i + 1), ttftMs: 50, stream: true, input: 100, output: 50, cost: 0.01, attempts: [{ provider: 'p', model: 'm', status: 200, ms: 10 }], ...extra,
  });
  test('totals, percentiles, breakdowns, heatmap', () => {
    const records = [rec(3), rec(2, { ok: false, status: 429, error: 'rate limited 123' }), rec(1, { clientId: 'cursor', client: 'Cursor', saved: 400, savedCost: 0.002, saverActions: ['trim-tool-output'] }), rec(0)].reverse().reverse();
    const r = analyze(records.sort((a, b) => a.ts - b.ts), '1h');
    assert.equal(r.totals.requests, 4);
    assert.equal(r.totals.errors, 1);
    assert.equal(r.totals.p50LatencyMs, 200);
    assert.equal(r.totals.p95LatencyMs, 400);
    assert.equal(r.totals.saved, 400);
    assert.equal(r.savings.byAction[0].action, 'trim-tool-output');
    assert.ok(r.byClient.some((g) => g.key === 'cursor' && g.label === 'Cursor'));
    assert.equal(r.statuses.find((s) => s.status === 429)?.count, 1);
    assert.equal(r.topErrors[0].count, 1);
    assert.equal(r.heatmap.flat().reduce((a, b) => a + b, 0), 4);
    assert.equal(r.series.reduce((a, p) => a + p.requests, 0), 4);
  });
  test('percentile', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
    assert.equal(percentile([], 95), 0);
  });
  test('projection', () => {
    const p = project([rec(0, { cost: 1 })]);
    assert.equal(p.todayCost, 1);
    assert.ok(p.projectedMonthCost >= 1);
  });
  test('CSV neutralises formulas and quotes', () => {
    const csv = toCsv([rec(0, { error: '=HYPERLINK("x")', requestedModel: 'a,b' })]);
    const line = csv.split('\r\n')[1];
    assert.match(line, /"a,b"/);
    assert.match(line, /"'=HYPERLINK\(""x""\)"/);
  });
  test('admin endpoint: /analytics labels keys and clients, /usage/export.csv downloads', async () => {
    await chat('b/mock-text', { 'user-agent': 'claude-cli/2.0.14 (external, cli)' });
    const r = await admin('GET', '/analytics?range=24h');
    assert.equal(r.res.status, 200);
    assert.ok(r.json.totals.requests > 0);
    assert.ok(r.json.byClient.some((g: any) => g.key === 'claude-code'));
    assert.ok(r.json.byKey.some((g: any) => /b · key 1|b-k/.test(g.label)));
    assert.ok(!JSON.stringify(r.json).includes('b-secret'), 'no provider secret in analytics');
    assert.ok('projectedMonthCost' in r.json.projection);
    const csv = await admin('GET', '/usage/export.csv?range=24h');
    assert.equal(csv.res.status, 200);
    assert.match(csv.res.headers.get('content-disposition') || '', /attachment/);
    assert.match(csv.text, /^time,id,endpoint/);
  });
});

describe('Free API hub', () => {
  test('free info for presets and local engines', () => {
    assert.equal(freeInfoFor('gemini')?.kind, 'free-tier');
    assert.equal(freeInfoFor('lmstudio')?.kind, 'local');
    assert.equal(freeInfoFor('anthropic'), undefined);
  });
  test('OpenRouter free models are parsed, tools first', () => {
    const list = parseOpenRouterFree({
      data: [
        { id: 'a/big:free', name: 'Big', context_length: 131072, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'reasoning'] },
        { id: 'b/paid', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'c/small:free', context_length: 8192, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
        { id: 'openrouter/auto', pricing: { prompt: '0', completion: '0' } },
      ],
    });
    assert.deepEqual(list.map((m) => m.id), ['a/big:free', 'c/small:free']);
    assert.equal(list[0].tools, true);
    assert.equal(list[0].reasoning, true);
  });
  test('free combo interleaves providers by rank, local last', () => {
    const cfg = app.config.get();
    const combo = buildFreeCombo(cfg, [{ id: 'x/tooly:free', name: 'x', context: 1000, tools: true, reasoning: false }])!;
    assert.equal(combo.targets[0], 'gem/gemini-2.5-flash');
    assert.ok(combo.targets.includes('orouter/some/model:free'));
    assert.ok(combo.targets.includes('orouter/x/tooly:free'));
    assert.equal(combo.targets[combo.targets.length - 1], 'llama/qwen3:8b');
    assert.ok(!combo.targets.some((t) => t.startsWith('ds/')), 'paid providers are not used');
  });
  test('admin: /free lists offers and /free/combo creates the combo', async () => {
    const list = await admin('GET', '/free');
    assert.equal(list.res.status, 200);
    assert.ok(list.json.offers.length >= 20);
    assert.equal(list.json.offers[0].type, 'gemini');
    assert.deepEqual(list.json.offers[0].configured.map((c: any) => c.id), ['gem']);
    const made = await admin('POST', '/free/combo', { makeDefault: true });
    assert.equal(made.res.status, 200);
    assert.equal(made.json.id, 'free');
    assert.equal(app.config.get().settings.defaultModel, 'free');
    const r = await chat('free');
    assert.equal(r.res.status, 200);
  });
});

describe('Balances', () => {
  test('OpenRouter credits and DeepSeek balance', async () => {
    const or = await admin('POST', '/providers/orouter/balance', {});
    assert.equal(or.res.status, 200);
    assert.equal(or.json[0].ok, true);
    assert.equal(or.json[0].remaining, 7.5);
    assert.equal(or.json[0].currency, 'USD');
    const ds = await admin('POST', '/providers/ds/balance', {});
    assert.equal(ds.json[0].remaining, 7.25);
    const none = await admin('POST', '/providers/a/balance', {});
    assert.equal(none.json[0].ok, false);
  });
});
