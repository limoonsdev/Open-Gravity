// Client compatibility: every URL style tools use (Azure, Gemini OpenAI-compat,
// LM Studio, DeepSeek beta, POST / auto-detection), autocomplete (FIM) with
// native and emulated routes, and the generic proxy (images, audio, rerank).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'og-clients-'));
process.env.OPEN_GRAVITY_HOME = home;
process.env.OG_OFFLINE = '1';

import { startMockUpstream, MockUpstream, parseSSE } from './mock-upstream';
import { ConfigStore, AppConfig } from '../src/core/config';
import { UsageStore } from '../src/core/usage';
import { startApp, RunningApp } from '../src/app';
import { logger } from '../src/core/logger';
import { sniffFormat, multipartField, replaceMultipartField, normalizeApiPath } from '../src/server/api';
import { FimCleaner } from '../src/translate/fim';

logger.quiet = true;

let mock: MockUpstream;
let app: RunningApp;
let base: string;

const prov = (id: string, type: string, models: string[], extra: any = {}) => ({
  id, type, name: id, format: 'openai', baseUrl: `${mock.url}/v1`, auth: 'bearer', models, enabled: true, rotation: 'round-robin', createdAt: 0,
  keys: [{ id: `${id}-k`, key: `${id}-secret`, enabled: true }], ...extra,
});

before(async () => {
  mock = await startMockUpstream();
  const config = new ConfigStore(path.join(home, 'config.json'));
  const cfg: AppConfig = {
    ...config.get(),
    providers: [
      prov('oa', 'openai-compatible', ['mock-text', 'fimchat', 'whisper-1', 'gpt-image-1', 'tts-1', 'rerank-v3']),
      prov('mis', 'mistral', ['codestral-latest']),
      prov('dsk', 'deepseek', ['deepseek-chat']),
      prov('oll', 'ollama', ['qwen2.5-coder:7b', 'nofim'], { keys: [] }),
      prov('lcpp', 'llamacpp', ['local'], { keys: [] }),
    ] as any,
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
const lastTo = (suffix: string) => [...mock.received].reverse().find((r) => r.path.split('?')[0].endsWith(suffix));

describe('URL styles', () => {
  test('path normalisation', () => {
    assert.equal(normalizeApiPath('/api/v0/chat/completions'), '/v1/chat/completions');
    assert.equal(normalizeApiPath('/v1beta/openai/chat/completions'), '/v1/chat/completions');
    assert.equal(normalizeApiPath('/openai/v1/responses'), '/v1/responses');
    assert.equal(normalizeApiPath('/beta/completions'), '/v1/completions');
    assert.equal(normalizeApiPath('/api/chat'), '/api/chat');
  });
  test('Azure OpenAI deployment path with api-key header', async () => {
    const r = await post('/openai/deployments/mock-text/chat/completions?api-version=2024-10-21', { messages: [{ role: 'user', content: 'hi' }] }, { 'api-key': 'anything' });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.choices[0].message.content, 'Hello world');
  });
  test("Gemini's OpenAI-compatible path", async () => {
    const r = await post('/v1beta/openai/chat/completions', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.object, 'chat.completion');
  });
  test('LM Studio v0 API', async () => {
    const models = await (await fetch(`${base}/api/v0/models`)).json() as any;
    assert.ok(models.data.some((m: any) => m.id === 'oa/mock-text'));
    const r = await post('/api/v0/chat/completions', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.res.status, 200);
  });
});

describe('Protocol auto-detection (POST /)', () => {
  test('sniffing rules', () => {
    assert.equal(sniffFormat({ contents: [] }, {}), 'gemini');
    assert.equal(sniffFormat({ input: 'hi', model: 'x' }, {}), 'responses');
    assert.equal(sniffFormat({ messages: [], system: 'x', max_tokens: 5 }, {}), 'anthropic');
    assert.equal(sniffFormat({ messages: [] }, { 'anthropic-version': '2023-06-01' }), 'anthropic');
    assert.equal(sniffFormat({ messages: [{ role: 'system', content: 's' }] }, {}), 'openai');
    assert.equal(sniffFormat({ prompt: 'x' }, {}), 'completions');
    assert.equal(sniffFormat([1], {}), undefined);
  });
  test('OpenAI, Anthropic and Gemini bodies answered in their own format', async () => {
    const o = await post('/', { model: 'oa/mock-text', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(o.json.object, 'chat.completion');
    const a = await post('/', { model: 'oa/mock-text', max_tokens: 50, system: 'be nice', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(a.json.type, 'message');
    assert.equal(a.json.content[0].text, 'Hello world');
    const g = await post('/', { model: 'oa/mock-text', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    assert.ok(g.json.candidates[0].content.parts[0].text.includes('Hello'));
    const bad = await post('/', { hello: 1 });
    assert.equal(bad.res.status, 400);
  });
  test('GET / is still the dashboard', async () => {
    const res = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/ui/');
  });
});

describe('Autocomplete (FIM)', () => {
  const PREFIX = 'def add(a, b):\n    ';
  const SUFFIX = '\n\nprint(add(1, 2))';

  test('Mistral FIM API → Codestral native /fim/completions', async () => {
    const r = await post('/v1/fim/completions', { model: 'mis/codestral-latest', prompt: PREFIX, suffix: SUFFIX, max_tokens: 64 });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.choices[0].message.content, 'return a + b');
    const sent = lastTo('/fim/completions')!;
    assert.equal(sent.body.prompt, PREFIX);
    assert.equal(sent.body.suffix, SUFFIX);
  });
  test('/v1/completions with suffix → DeepSeek native /beta/completions (streaming)', async () => {
    const r = await post('/v1/completions', { model: 'dsk/deepseek-chat', prompt: PREFIX, suffix: SUFFIX, stream: true });
    const text = parseSSE(r.text).filter((e) => e.data?.choices?.[0]?.text).map((e) => e.data.choices[0].text).join('');
    assert.equal(text, 'return a + b');
    assert.ok(lastTo('/beta/completions'));
  });
  test('Ollama /api/generate with suffix → Ollama native /v1/completions', async () => {
    const r = await post('/api/generate', { model: 'oll/qwen2.5-coder:7b', prompt: PREFIX, suffix: SUFFIX, stream: false });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.response, 'return a + b');
    const sent = lastTo('/v1/completions')!;
    assert.equal(sent.body.suffix, SUFFIX);
  });
  test('llama.cpp → /infill', async () => {
    const r = await post('/v1/completions', { model: 'lcpp/local', prompt: PREFIX, suffix: SUFFIX });
    assert.equal(r.json.choices[0].text, 'return a + b');
    const sent = lastTo('/infill')!;
    assert.equal(sent.body.input_prefix, PREFIX);
    assert.equal(sent.body.input_suffix, SUFFIX);
    assert.equal(r.json.usage.completion_tokens, 5);
  });
  test('chat-only provider: emulated, fences and echoed lines removed', async () => {
    const r = await post('/v1/completions', { model: 'oa/fimchat', prompt: PREFIX, suffix: SUFFIX, stream: true });
    const text = parseSSE(r.text).filter((e) => e.data?.choices?.[0]?.text).map((e) => e.data.choices[0].text).join('');
    assert.equal(text, 'return a + b');
    const sent = lastTo('/chat/completions')!;
    assert.match(sent.body.messages[0].content, /code completion engine/);
    assert.match(sent.body.messages[1].content, /<CURSOR>/);
  });
  test('native endpoint missing → learned, served through chat', async () => {
    const r = await post('/v1/completions', { model: 'oll/nofim', prompt: PREFIX, suffix: SUFFIX });
    assert.equal(r.res.status, 200);
    assert.equal(app.config.get().compat['oll::nofim'].noNativeFim, true);
  });
  test('cleaner unit', () => {
    const c = new FimCleaner('x = 1\nif x:\n    ');
    const out = [...c.push({ type: 'text', text: '```py\nif x:\n    print(x)\n' }), ...c.push({ type: 'text', text: '```' }), ...c.push({ type: 'stop', reason: 'end_turn' })];
    // The newline before the closing fence belongs to the fence.
    assert.equal(out.filter((e: any) => e.type === 'text').map((e: any) => e.text).join(''), 'print(x)');
  });
});

describe('Generic proxy', () => {
  test('images: JSON body, model rewritten to the upstream name', async () => {
    const r = await post('/v1/images/generations', { model: 'oa/gpt-image-1', prompt: 'a cat' });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.data[0].url, 'https://img.example/gpt-image-1.png');
    assert.equal(r.res.headers.get('x-og-provider'), 'oa');
  });
  test('audio speech: binary response streamed back', async () => {
    const res = await fetch(`${base}/v1/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'oa/tts-1', input: 'hi', voice: 'alloy' }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0x49, 0x44, 0x33, 0x04, 0x00, 0xff]);
  });
  test('audio transcription: multipart with the model field rewritten', async () => {
    const form = new FormData();
    form.append('model', 'oa/whisper-1');
    form.append('file', new Blob([new Uint8Array([1, 2, 3, 250, 251])], { type: 'audio/wav' }), 'clip.wav');
    const res = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', body: form });
    const json = await res.json() as any;
    assert.equal(res.status, 200);
    assert.equal(json.text, 'transcribed by whisper-1 file=true');
  });
  test('rerank and Azure embeddings path', async () => {
    const rr = await post('/v1/rerank', { model: 'oa/rerank-v3', query: 'q', documents: ['a', 'b'] });
    assert.equal(rr.json.results[0].index, 1);
    const em = await post('/openai/deployments/mock-text/embeddings?api-version=2024-10-21', { input: 'hello' });
    assert.equal(em.res.status, 200);
    assert.equal(em.json.data[0].embedding.length, 2);
  });
  test('unknown model → 404 in OpenAI format (when unknown names do not fall back)', async () => {
    app.config.update((c) => { c.settings.unknownModelFallback = false; });
    const r = await post('/v1/images/generations', { model: 'nope/nothing', prompt: 'x' });
    app.config.update((c) => { c.settings.unknownModelFallback = true; });
    assert.equal(r.res.status, 404);
    assert.ok(r.json.error.message);
  });
  test('multipart helpers are binary safe', () => {
    const ctype = 'multipart/form-data; boundary=XyZ';
    const bin = Buffer.concat([
      Buffer.from('--XyZ\r\nContent-Disposition: form-data; name="model"\r\n\r\nold-model\r\n--XyZ\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'),
      Buffer.from([0, 255, 128, 13, 10, 45]),
      Buffer.from('\r\n--XyZ--\r\n'),
    ]);
    assert.equal(multipartField(bin, ctype, 'model'), 'old-model');
    const out = replaceMultipartField(bin, ctype, 'model', 'new');
    assert.equal(multipartField(out, ctype, 'model'), 'new');
    assert.ok(out.includes(Buffer.from([0, 255, 128, 13, 10, 45])));
  });
});
