// Executes an inference request: resolve -> try candidates/keys in order with
// fallback -> translate the upstream stream into the client's protocol.
import type { IncomingMessage, ServerResponse } from 'http';
import { fetch } from 'undici';
import type { ConfigStore, ProviderConfig, ProviderKey } from '../core/config';
import type { UsageStore, Attempt, CapturedBodies } from '../core/usage';
import { logger, c } from '../core/logger';
import { estimateCost } from '../core/pricing';
import { randomId, clampStr } from '../core/util';
import {
  ApiFormat, IRRequest, IREvent, IRUsage, ClientContext, Aggregator,
  parseClientRequest, createEncoder, createDecoder, buildClientResponse, errorBody, estimateRequestTokens, mergeUsage,
} from '../translate';
import { SSEParser, sseData } from '../translate/sse';
import { usageFromOpenAI } from '../translate/openai';
import { usageFromAnthropic, sanitizeAnthropicPassthrough } from '../translate/anthropic';
import { usageFromGemini } from '../translate/gemini';
import { usageFromResponses } from '../translate/responses';
import { buildPassthrough, buildTranslated, getDispatcher, extractErrorMessage, UpstreamRequest } from '../providers/upstream';
import { antigravityGenerate } from '../providers/antigravity';
import { resolveModel, pickKeys, Candidate } from './resolve';
import { health } from './health';

export interface InferenceInput {
  format: ApiFormat;
  body: any;
  /** Requested model (for Gemini it comes from the URL). */
  model: string;
  stream: boolean;
  headers: IncomingMessage['headers'];
  apiKeyId?: string;
  endpoint: string;
}

export interface Deps {
  config: ConfigStore;
  usage: UsageStore;
}

interface Failure {
  status: number;
  message: string;
  retryAfterMs?: number;
  /** 'key' = try next key, 'candidate' = skip to next model, 'abort' = stop. */
  next: 'key' | 'candidate' | 'abort';
}

class AttemptFailed extends Error {
  constructor(public failure: Failure) {
    super(failure.message);
  }
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

function sendJson(res: ServerResponse, status: number, body: any, headers: Record<string, string> = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

function parseRetryAfter(headers: Headers, body: string): number | undefined {
  const ra = headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (!Number.isNaN(secs)) return secs * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return undefined;
}

function classify(status: number): Failure['next'] {
  if (status === 401 || status === 402 || status === 403 || status === 429 || status === 408 || status >= 500) return 'key';
  return 'candidate';
}

function isContent(ev: IREvent) {
  return ev.type === 'text' || ev.type === 'thinking' || ev.type === 'tool_start';
}

function usageExtractor(format: ApiFormat): (json: any) => Partial<IRUsage> | undefined {
  switch (format) {
    case 'openai': return (j) => usageFromOpenAI(j?.usage);
    case 'anthropic': return (j) => usageFromAnthropic(j?.usage);
    case 'gemini': return (j) => usageFromGemini(j?.usageMetadata);
    case 'responses': return (j) => usageFromResponses(j?.usage);
  }
}

export async function handleInference(input: InferenceInput, req: IncomingMessage, res: ServerResponse, deps: Deps) {
  const t0 = Date.now();
  const cfg = deps.config.get();
  const settings = cfg.settings;
  const requestId = randomId(12);

  let ir: IRRequest;
  try {
    ir = parseClientRequest(input.format, input.body, { model: input.model, stream: input.stream });
  } catch (e: any) {
    sendJson(res, 400, errorBody(input.format, 400, `Invalid request: ${e.message}`));
    return;
  }
  ir.stream = input.stream;

  const resolution = resolveModel(cfg, input.model);
  const clientModel = input.model || resolution.candidates[0]?.target || 'open-gravity';
  const ctx: ClientContext = { format: input.format, model: clientModel, ir, estimatedInput: estimateRequestTokens(ir) };
  const attempts: Attempt[] = [];
  const captured: CapturedBodies | undefined = settings.captureBodies ? { request: input.body } : undefined;

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  const record = (extra: Partial<Parameters<UsageStore['add']>[0]> & { status: number; ok: boolean }) => {
    const r = {
      id: requestId,
      ts: t0,
      endpoint: input.endpoint,
      requestedModel: input.model,
      apiKeyId: input.apiKeyId,
      combo: resolution.combo,
      latencyMs: Date.now() - t0,
      stream: input.stream,
      input: 0,
      output: 0,
      cost: 0,
      attempts,
      client: clampStr(String(input.headers['user-agent'] || ''), 80),
      ...extra,
    };
    deps.usage.add(r, captured);
    const tag = r.ok ? c.green(String(r.status)) : c.red(String(r.status));
    const route = r.provider ? `${c.cyan(`${r.provider}/${r.model}`)}` : c.gray('(unrouted)');
    const tokens = r.ok ? c.gray(` ${r.input}→${r.output} tok`) : '';
    const msg = `${tag} ${input.endpoint} ${c.bold(input.model || '(default)')} → ${route} ${c.gray(`${r.latencyMs}ms`)}${tokens}${attempts.length > 1 ? c.yellow(` (${attempts.length} attempts)`) : ''}`;
    if (r.ok) logger.info(msg);
    else logger.warn(`${msg} ${c.gray(clampStr(r.error || '', 160))}`);
  };

  if (!resolution.candidates.length) {
    const msg = resolution.error || 'Model not found';
    sendJson(res, 404, errorBody(input.format, 404, msg));
    record({ status: 404, ok: false, error: msg });
    return;
  }

  let lastFailure: Failure = { status: 502, message: 'All providers failed', next: 'abort' };

  for (const ignoreCooldown of [false, true]) {
    let skippedForCooldown = false;
    outer: for (const cand of resolution.candidates) {
      const keys = pickKeys(cand.provider, cand.model, ignoreCooldown);
      if (!keys.length) {
        if (cand.provider.keys.length && cand.provider.keys.every((k) => !k.enabled)) {
          lastFailure = { status: 401, message: `Provider "${cand.provider.id}" has no enabled API key`, next: 'candidate' };
        } else skippedForCooldown = true;
        continue;
      }
      for (const key of keys.slice(0, 3)) {
        if (attempts.length >= settings.maxAttempts) break outer;
        if (abort.signal.aborted) {
          record({ status: 499, ok: false, error: 'Client closed request' });
          return;
        }
        const aStart = Date.now();
        try {
          const result = await runAttempt(cand, key, input, ir, ctx, res, abort.signal, deps, captured, requestId, attempts.length + 1);
          attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: 200, ms: Date.now() - aStart });
          health.ok(cand.provider.id, key.id, cand.model);
          const cost = estimateCost(cand.model, result.usage, cand.provider.format === 'antigravity' || /127\.0\.0\.1|localhost/.test(cand.provider.baseUrl));
          record({
            status: result.status, ok: result.status < 400, provider: cand.provider.id, model: cand.model, keyId: key.id,
            ttftMs: result.ttftMs, input: result.usage.input, output: result.usage.output, cacheRead: result.usage.cacheRead,
            cacheWrite: result.usage.cacheWrite, reasoning: result.usage.reasoning, cost, estimated: result.estimated,
            error: result.error,
          });
          return;
        } catch (e: any) {
          if (abort.signal.aborted) {
            attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: 499, error: 'client closed', ms: Date.now() - aStart });
            record({ status: 499, ok: false, provider: cand.provider.id, model: cand.model, error: 'Client closed request' });
            return;
          }
          const f: Failure = e instanceof AttemptFailed ? e.failure : { status: 502, message: e?.message || String(e), next: 'key' };
          attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: f.status, error: clampStr(f.message, 300), ms: Date.now() - aStart });
          lastFailure = f;
          applyCooldown(cand.provider, key, cand.model, f, settings);
          logger.debug(`attempt ${cand.target} key=${key.id} failed ${f.status}: ${f.message}`);
          if (f.next === 'abort' || res.headersSent) {
            if (!res.headersSent) sendJson(res, f.status, errorBody(input.format, f.status, f.message));
            else res.end();
            record({ status: f.status, ok: false, provider: cand.provider.id, model: cand.model, error: f.message });
            return;
          }
          if (f.next === 'candidate') continue outer;
        }
      }
    }
    // Only retry cooling keys when nothing could be attempted at all.
    if (attempts.length || !skippedForCooldown) break;
  }

  if (!attempts.length && lastFailure.message === 'All providers failed') {
    lastFailure = { status: 429, message: 'All matching provider keys are cooling down after errors. Retry shortly.', next: 'abort' };
  }
  const status = lastFailure.status >= 400 ? lastFailure.status : 502;
  const detail = attempts.length > 1 ? ` (tried ${attempts.map((a) => `${a.provider}/${a.model}`).join(' → ')})` : '';
  sendJson(res, status, errorBody(input.format, status, `${lastFailure.message}${detail}`), { 'x-og-request-id': requestId });
  record({ status, ok: false, error: lastFailure.message });
}

function applyCooldown(p: ProviderConfig, key: ProviderKey, model: string, f: Failure, s: ConfigStore['settings']) {
  const status = f.status;
  if (status === 401 || status === 402 || status === 403) {
    health.fail(p.id, key.id, { status, error: f.message, cooldownMs: s.cooldownAuthMs });
  } else if (status === 429) {
    health.fail(p.id, key.id, { status, error: f.message, cooldownMs: Math.min(f.retryAfterMs ?? s.cooldownRateLimitMs, 3600_000), model });
  } else if (status === 408 || status >= 500) {
    health.fail(p.id, key.id, { status, error: f.message, cooldownMs: s.cooldownServerMs, model });
  } else {
    health.fail(p.id, key.id, { status, error: f.message, cooldownMs: 0 });
  }
}

interface AttemptResult {
  status: number;
  usage: IRUsage;
  ttftMs?: number;
  estimated?: boolean;
  error?: string;
}

async function* sseEvents(body: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<{ event?: string; data: string }> {
  const parser = new SSEParser();
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    if (signal.aborted) return;
    for (const m of parser.push(decoder.decode(chunk, { stream: true }))) yield m;
  }
  for (const m of parser.push(decoder.decode())) yield m;
  for (const m of parser.end()) yield m;
}

async function runAttempt(
  cand: Candidate, key: ProviderKey, input: InferenceInput, ir: IRRequest, ctx: ClientContext, res: ServerResponse,
  signal: AbortSignal, deps: Deps, captured: CapturedBodies | undefined, requestId: string, attemptNo: number,
): Promise<AttemptResult> {
  const settings = deps.config.settings;
  const p = cand.provider;
  const t0 = Date.now();
  const passthrough = settings.passthrough && p.format === input.format;
  const routeHeaders = {
    'x-og-provider': p.id,
    'x-og-model': cand.model,
    'x-og-request-id': requestId,
    'x-og-attempt': String(attemptNo),
  };

  // ---- 1. obtain an IR event stream (or finish directly for non-stream passthrough)
  let events: AsyncGenerator<IREvent[] | { raw: { event?: string; data: string }; evs: IREvent[] }>;
  let clientWantsUsage = true;

  if (p.format === 'antigravity') {
    const gen = antigravityGenerate(ir, cand.model, signal);
    events = (async function* () {
      try {
        for await (const ev of gen) yield [ev];
      } catch (e: any) {
        throw new AttemptFailed({ status: e.status || 502, message: e.message, next: 'key' });
      }
    })();
  } else {
    const stream = passthrough ? input.stream : true;
    let up: UpstreamRequest = passthrough
      ? buildPassthrough(p, key, cand.model, input.format, input.format === 'anthropic' ? sanitizeAnthropicPassthrough(structuredClone(input.body)) : input.body, input.headers, stream)
      : buildTranslated(p, key, cand.model, ir);
    if (passthrough && input.format === 'openai') clientWantsUsage = !!input.body?.stream_options?.include_usage;
    if (captured) captured.upstreamRequest = { url: up.url, body: up.body };

    const dispatcher = getDispatcher(p.proxy || settings.upstreamProxy, p.timeoutMs || settings.headersTimeoutMs, settings.idleTimeoutMs);
    const send = () => fetch(up.url, { method: 'POST', headers: up.headers, body: JSON.stringify(up.body), dispatcher, signal });
    let resp;
    try {
      resp = await send();
      if ((resp.status === 400 || resp.status === 422) && up.body?.stream_options) {
        const text = await resp.text();
        if (/stream_options/i.test(text)) {
          up = { ...up, body: { ...up.body } };
          delete up.body.stream_options;
          resp = await send();
        } else {
          throw new AttemptFailed({ status: resp.status, message: extractErrorMessage(text), next: classify(resp.status) });
        }
      }
    } catch (e: any) {
      if (e instanceof AttemptFailed) throw e;
      if (signal.aborted) throw e;
      const timeout = /timeout/i.test(e?.code || '') || /timeout/i.test(e?.message || '');
      const cause = e?.cause?.code || e?.cause?.message || '';
      throw new AttemptFailed({ status: timeout ? 504 : 502, message: `Cannot reach ${p.name}: ${e.message}${cause ? ` (${cause})` : ''}`, next: 'key' });
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AttemptFailed({
        status: resp.status,
        message: `${p.name}: ${extractErrorMessage(text)}`,
        retryAfterMs: parseRetryAfter(resp.headers as any, text),
        next: classify(resp.status),
      });
    }

    // Non-streaming passthrough: relay the JSON body untouched.
    if (!stream) {
      const text = await resp.text();
      let usage: IRUsage = { input: 0, output: 0 };
      let estimated = false;
      try {
        const u = usageExtractor(input.format)(JSON.parse(text));
        if (u) mergeUsage(usage, u);
      } catch { /* not JSON */ }
      if (!usage.input && !usage.output) {
        usage = { input: ctx.estimatedInput, output: Math.ceil(text.length / 8) };
        estimated = true;
      }
      if (captured) captured.response = clampStr(text, 200_000);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...routeHeaders });
      res.end(text);
      return { status: 200, usage, estimated, ttftMs: Date.now() - t0 };
    }

    if (!resp.body) throw new AttemptFailed({ status: 502, message: 'Upstream returned an empty body', next: 'key' });
    const decoder = createDecoder(p.format);
    const body = resp.body as AsyncIterable<Uint8Array>;
    events = (async function* () {
      try {
        for await (const m of sseEvents(body, signal)) {
          if (m.data === '[DONE]') {
            yield { raw: m, evs: [] };
            continue;
          }
          let data: any;
          try { data = JSON.parse(m.data); } catch { continue; }
          yield { raw: m, evs: decoder.push(m.event, data) };
        }
        yield decoder.end();
      } catch (e: any) {
        if (e instanceof AttemptFailed || signal.aborted) throw e;
        throw new AttemptFailed({ status: 502, message: `Stream from ${p.name} broke: ${e.message}`, next: 'key' });
      }
    })();
  }

  // ---- 2. pump events to the client
  const clientStream = input.stream;
  const encoder = !passthrough && clientStream ? createEncoder(ctx) : null;
  const agg = new Aggregator();
  const usage: IRUsage = { input: 0, output: 0 };
  let outChars = 0;
  let ttftMs: number | undefined;
  let committed = false;
  let pending: string[] = [];
  let lastWrite = Date.now();
  let midStreamError: string | undefined;

  const write = (s: string) => {
    if (!s) return;
    if (committed) {
      res.write(s);
      lastWrite = Date.now();
    } else pending.push(s);
  };
  const commit = () => {
    if (committed || !clientStream) return;
    committed = true;
    res.writeHead(200, { ...SSE_HEADERS, ...routeHeaders });
    for (const s of pending) res.write(s);
    pending = [];
    lastWrite = Date.now();
  };

  // Commit after a while even without content (long reasoning), then keep the
  // connection alive with SSE pings so clients don't time out.
  const timer = setInterval(() => {
    if (!clientStream || signal.aborted) return;
    if (!committed && Date.now() - t0 > 20_000) commit();
    if (committed && Date.now() - lastWrite > 10_000 && !res.writableEnded) {
      res.write(input.format === 'anthropic' ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': ping\n\n');
      lastWrite = Date.now();
    }
  }, 5_000);

  const serialize = (raw: { event?: string; data: string }) => (input.format === 'openai' && raw.data === '[DONE]' ? 'data: [DONE]\n\n' : sseData(raw.data, raw.event));

  try {
    for await (const item of events) {
      const evs = Array.isArray(item) ? item : item.evs;
      let dropRaw = false;
      for (const ev of evs) {
        if (ev.type === 'usage') mergeUsage(usage, ev.usage);
        if (ev.type === 'text' || ev.type === 'thinking') outChars += ev.text.length;
        if (ev.type === 'tool_args') outChars += ev.delta.length;
        if (isContent(ev) && ttftMs === undefined) ttftMs = Date.now() - t0;
        if (ev.type === 'error') {
          const hasContent = agg.parts.length > 0;
          if (!committed && !hasContent) {
            throw new AttemptFailed({ status: ev.status && ev.status >= 400 ? ev.status : 502, message: `${p.name}: ${ev.message}`, next: 'key' });
          }
          midStreamError = ev.message;
        }
        agg.push(ev);
        if (encoder) write(encoder.push(ev));
        if (isContent(ev)) commit();
      }
      if (passthrough && !Array.isArray(item)) {
        // Hide the usage-only chunk we requested for accounting if the client didn't ask for it.
        if (input.format === 'openai' && !clientWantsUsage) {
          try {
            const d = item.raw.data !== '[DONE]' ? JSON.parse(item.raw.data) : null;
            if (d && Array.isArray(d.choices) && d.choices.length === 0 && d.usage) dropRaw = true;
          } catch { /* keep */ }
        }
        if (!dropRaw && clientStream) write(serialize(item.raw));
      }
    }
  } catch (e: any) {
    // Once bytes reached the client we can't fall back: report the error in-stream.
    if (!committed || signal.aborted) throw e;
    const message = e?.message || String(e);
    write(createEncoder(ctx).push({ type: 'error', message }));
    res.end();
    return { status: 502, usage: { ...usage, input: usage.input || ctx.estimatedInput }, ttftMs, estimated: true, error: message };
  } finally {
    clearInterval(timer);
  }

  if (!usage.input && !usage.output && !agg.parts.length && agg.error) {
    throw new AttemptFailed({ status: agg.error.status || 502, message: agg.error.message, next: 'key' });
  }

  let estimated = false;
  if (!usage.input) {
    usage.input = ctx.estimatedInput;
    estimated = true;
  }
  if (!usage.output && outChars) {
    usage.output = Math.ceil(outChars / 4);
    estimated = true;
  }

  if (captured) {
    const r = agg.result(cand.model);
    captured.response = clampStr(JSON.stringify(r.parts), 200_000);
  }

  if (clientStream) {
    commit();
    if (encoder) write(encoder.end());
    res.end();
  } else {
    // Translated non-stream response (always built from the aggregated stream).
    const result = agg.result(ctx.model);
    result.usage = usage;
    const body = buildClientResponse(ctx, result);
    const data = JSON.stringify(body);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...routeHeaders });
    res.end(data);
  }
  return { status: 200, usage, ttftMs, estimated, error: midStreamError };
}
