// Executes an inference request.
//
//   resolve model -> candidates (provider, model) in strategy order
//   for each candidate x key:           (or race the first two, strategy "race")
//     open    build the upstream request (passthrough, or translated from the IR
//             with learned compatibility fixes and tool emulation) and send it
//     prime   read the upstream stream until the first token: errors up to this
//             point can still fall back to the next key / candidate
//     pump    commit to the client and stream the rest (or aggregate it)
//   4xx incompatibility errors are analysed, fixed and retried (self-healing).
import type { IncomingMessage, ServerResponse } from 'http';
import type { ConfigStore, ProviderConfig, ProviderKey } from '../core/config';
import type { UsageStore, Attempt, CapturedBodies, UsageRecord } from '../core/usage';
import { logger, c } from '../core/logger';
import { estimateCost } from '../core/pricing';
import { modelDb } from '../core/modeldb';
import { randomId, clampStr } from '../core/util';
import {
  ApiFormat, IRRequest, IREvent, IRUsage, IRResponse, ClientContext, Aggregator,
  parseClientRequest, createEncoder, createDecoder, buildClientResponse, errorBody, estimateRequestTokens, mergeUsage, isNdjson,
} from '../translate';
import { SSEParser, sseData } from '../translate/sse';
import { usageFromOpenAI } from '../translate/openai';
import { usageFromAnthropic, sanitizeAnthropicPassthrough } from '../translate/anthropic';
import { usageFromGemini } from '../translate/gemini';
import { usageFromResponses } from '../translate/responses';
import { emulateToolsRequest, ToolCallStreamParser } from '../translate/toolemu';
import { ThinkTagExtractor, ToolArgsNormalizer, StreamTransform, runTransforms } from '../translate/transforms';
import { buildPassthrough, buildTranslated, upstreamFetch, extractErrorMessage, UpstreamRequest } from '../providers/upstream';
import { antigravityGenerate } from '../providers/antigravity';
import { resolveModel, pickKeys, Candidate } from './resolve';
import { health } from './health';
import { CompatFix, compatKey, detectCompatFix, mergeFix, applyIrCompat, applyBodyCompat, needsTranslation, irHasImages } from './compat';
import { responseCache, cacheKey, replayEvents } from './cache';

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
  /** Raw provider error body, used to detect compatibility fixes. */
  raw?: string;
  retryAfterMs?: number;
  /** 'key' = try next key, 'candidate' = skip to next model, 'abort' = stop. */
  next: 'key' | 'candidate' | 'abort';
}

class AttemptFailed extends Error {
  constructor(public failure: Failure) {
    super(failure.message);
  }
}

const STREAM_HEADERS = {
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};
const PRIME_COMMIT_MS = 20_000;

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

function usageFromJson(format: ApiFormat, j: any): Partial<IRUsage> | undefined {
  switch (format) {
    case 'openai': return usageFromOpenAI(j?.usage);
    case 'anthropic': return usageFromAnthropic(j?.usage);
    case 'gemini': return usageFromGemini(j?.usageMetadata);
    case 'responses': return usageFromResponses(j?.usage);
    default: return undefined;
  }
}

// ---------------------------------------------------------------- streams

interface Item {
  raw?: { event?: string; data: string };
  evs: IREvent[];
}

/** Async iterator wrapper whose next() can be awaited with a timeout without losing the value. */
class ItemStream {
  private pending?: Promise<IteratorResult<Item>>;
  constructor(private it: AsyncIterator<Item>) {}

  next(): Promise<IteratorResult<Item>> {
    const p = this.pending ?? this.it.next();
    this.pending = undefined;
    return p;
  }

  async nextWithin(ms: number): Promise<IteratorResult<Item> | 'timeout'> {
    if (!this.pending) {
      this.pending = this.it.next();
      this.pending.catch(() => undefined);
    }
    let timer: NodeJS.Timeout | undefined;
    const t = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), ms); });
    const r = await Promise.race([this.pending, t]);
    clearTimeout(timer);
    if (r === 'timeout') return r;
    this.pending = undefined;
    return r;
  }
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

// ------------------------------------------------------------------ plans

interface Plan {
  cand: Candidate;
  key: ProviderKey;
  compat: CompatFix;
  emulate: boolean;
  passthrough: boolean;
}

interface Primed {
  plan: Plan;
  stream?: ItemStream;
  buffered: Item[];
  ended: boolean;
  ttftMs?: number;
  t0: number;
  abort: AbortController;
  nonStream?: { text: string; usage: IRUsage; estimated: boolean };
  upstreamBody?: any;
}

interface AttemptResult {
  status: number;
  usage: IRUsage;
  ttftMs?: number;
  estimated?: boolean;
  error?: string;
  response?: IRResponse;
}

/** Whether tools must be emulated for this provider/model. */
function shouldEmulate(p: ProviderConfig, model: string, ir: IRRequest, compat: CompatFix): boolean {
  if (!ir.tools?.length || ir.toolChoice === 'none') return false;
  if (p.format === 'antigravity') return true;
  const mode = p.toolMode || 'auto';
  if (mode === 'emulate') return true;
  if (mode === 'native') return false;
  if (compat.emulateTools) return true;
  return modelDb.lookup(p.type, model)?.tools === false;
}

class Runner {
  readonly t0 = Date.now();
  readonly requestId = randomId(12);
  readonly attempts: Attempt[] = [];
  readonly adapted: string[] = [];
  readonly abort = new AbortController();
  emulated = false;
  captured?: CapturedBodies;

  constructor(
    public input: InferenceInput,
    public ir: IRRequest,
    public ctx: ClientContext,
    public res: ServerResponse,
    public deps: Deps,
  ) {
    if (deps.config.settings.captureBodies) this.captured = { request: input.body };
    res.on('close', () => {
      if (!res.writableFinished) this.abort.abort();
    });
  }

  get settings() {
    return this.deps.config.settings;
  }

  learnedCompat(cand: Candidate): CompatFix {
    return { ...(this.deps.config.get().compat[compatKey(cand.provider.id, cand.model)] || {}) };
  }

  persistCompat(cand: Candidate, fix: CompatFix) {
    this.deps.config.update((cfg) => {
      cfg.compat[compatKey(cand.provider.id, cand.model)] = fix;
    });
  }

  plan(cand: Candidate, key: ProviderKey, compat: CompatFix): Plan {
    const emulate = shouldEmulate(cand.provider, cand.model, this.ir, compat);
    // Non-streaming passthrough returns raw JSON we can't cache: stream + aggregate instead when caching.
    const cacheable = (this.settings.cacheTtlSeconds || 0) > 0 && !this.input.stream;
    const passthrough = this.settings.passthrough && cand.provider.format === this.input.format && !emulate && !needsTranslation(compat) && !cacheable;
    return { cand, key, compat, emulate, passthrough };
  }

  /** The IR as sent upstream: model limits, compatibility fixes, tool emulation. */
  upstreamIr(plan: Plan): IRRequest {
    let ir = this.ir;
    const info = modelDb.lookup(plan.cand.provider.type, plan.cand.model);
    if (info?.maxOutput && ir.maxTokens && ir.maxTokens > info.maxOutput) ir = { ...ir, maxTokens: info.maxOutput };
    ir = applyIrCompat(ir, plan.compat);
    if (plan.emulate) ir = emulateToolsRequest(ir);
    else if (ir.toolChoice === 'none' && ir.tools?.length && info?.tools === false) ir = { ...ir, tools: undefined, toolChoice: undefined };
    return ir;
  }

  transforms(plan: Plan): StreamTransform[] {
    if (plan.passthrough) return [];
    const list: StreamTransform[] = [];
    const f = plan.cand.provider.format;
    if (f === 'openai' || f === 'responses' || f === 'antigravity' || plan.emulate) list.push(new ThinkTagExtractor());
    const tools = this.ir.tools || [];
    if (plan.emulate) list.push(new ToolCallStreamParser(tools, this.input.format === 'anthropic' ? 'toolu_' : 'call_'));
    if (tools.length) list.push(new ToolArgsNormalizer(tools));
    return list;
  }

  // --------------------------------------------------------------- open
  async open(plan: Plan, abort: AbortController): Promise<Primed> {
    const p = plan.cand.provider;
    const t0 = Date.now();
    const transforms = this.transforms(plan);
    const upIr = this.upstreamIr(plan);
    let source: AsyncGenerator<Item>;
    let upstreamBody: any;

    if (p.format === 'antigravity') {
      const gen = antigravityGenerate(upIr, plan.cand.model, abort.signal);
      source = (async function* () {
        try {
          for await (const ev of gen) yield { evs: runTransforms(transforms, [ev]) };
        } catch (e: any) {
          throw new AttemptFailed({ status: e.status || 502, message: e.message, next: 'key' });
        }
      })();
    } else {
      const stream = plan.passthrough ? this.input.stream : true;
      let up: UpstreamRequest;
      if (plan.passthrough) {
        const body = this.input.format === 'anthropic' ? sanitizeAnthropicPassthrough(structuredClone(this.input.body)) : this.input.body;
        up = buildPassthrough(p, plan.key, plan.cand.model, this.input.format, body, this.input.headers, stream);
      } else up = buildTranslated(p, plan.key, plan.cand.model, upIr);
      up = { ...up, body: applyBodyCompat(up.body, p.format as any, plan.compat) };
      upstreamBody = up.body;

      const dispatcher = { proxy: p.proxy || this.settings.upstreamProxy, headersTimeout: p.timeoutMs || this.settings.headersTimeoutMs, bodyTimeout: this.settings.idleTimeoutMs };
      const send = (body: any) => upstreamFetch(up.url, { method: 'POST', headers: up.headers, body: JSON.stringify(body), signal: abort.signal }, dispatcher);
      let resp;
      try {
        resp = await send(up.body);
        if ((resp.status === 400 || resp.status === 422) && up.body?.stream_options) {
          const text = await resp.text();
          if (!/stream_options/i.test(text)) throw new AttemptFailed({ status: resp.status, message: `${p.name}: ${extractErrorMessage(text)}`, raw: text, next: classify(resp.status) });
          const { stream_options: _drop, ...rest } = up.body;
          upstreamBody = rest;
          resp = await send(rest);
        }
      } catch (e: any) {
        if (e instanceof AttemptFailed || abort.signal.aborted) throw e;
        const timeout = /timeout/i.test(e?.code || '') || /timeout/i.test(e?.message || '');
        const cause = e?.cause?.code || e?.cause?.message || '';
        throw new AttemptFailed({ status: timeout ? 504 : 502, message: `Cannot reach ${p.name}: ${e.message}${cause ? ` (${cause})` : ''}`, next: 'key' });
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new AttemptFailed({
          status: resp.status, message: `${p.name}: ${extractErrorMessage(text)}`, raw: text,
          retryAfterMs: parseRetryAfter(resp.headers as any, text), next: classify(resp.status),
        });
      }

      if (!stream) {
        const text = await resp.text();
        let usage: IRUsage = { input: 0, output: 0 };
        let estimated = false;
        try {
          const u = usageFromJson(this.input.format, JSON.parse(text));
          if (u) mergeUsage(usage, u);
        } catch { /* not JSON */ }
        if (!usage.input && !usage.output) {
          usage = { input: this.ctx.estimatedInput, output: Math.ceil(text.length / 8) };
          estimated = true;
        }
        return { plan, buffered: [], ended: true, t0, abort, nonStream: { text, usage, estimated }, upstreamBody, ttftMs: Date.now() - t0 };
      }
      if (!resp.body) throw new AttemptFailed({ status: 502, message: 'Upstream returned an empty body', next: 'key' });

      const decoder = createDecoder(p.format as any);
      const body = resp.body as AsyncIterable<Uint8Array>;
      const passthrough = plan.passthrough;
      source = (async function* () {
        try {
          for await (const m of sseEvents(body, abort.signal)) {
            if (m.data === '[DONE]') {
              yield { raw: m, evs: [] };
              continue;
            }
            let data: any;
            try { data = JSON.parse(m.data); } catch { continue; }
            const evs = decoder.push(m.event, data);
            yield { raw: passthrough ? m : undefined, evs: runTransforms(transforms, evs) };
          }
          yield { evs: runTransforms(transforms, decoder.end()) };
        } catch (e: any) {
          if (e instanceof AttemptFailed || abort.signal.aborted) throw e;
          throw new AttemptFailed({ status: 502, message: `Stream from ${p.name} broke: ${e.message}`, next: 'key' });
        }
      })();
    }
    return { plan, stream: new ItemStream(source), buffered: [], ended: false, t0, abort, upstreamBody };
  }

  /** Read until the first content event. Throws AttemptFailed on an early upstream error. */
  async prime(primed: Primed, commitAfterMs: number): Promise<Primed> {
    if (!primed.stream) return primed;
    const deadline = Date.now() + commitAfterMs;
    for (;;) {
      const r = await primed.stream.nextWithin(Math.max(1, deadline - Date.now()));
      if (r === 'timeout') return primed;
      if (r.done) {
        primed.ended = true;
        return primed;
      }
      const item = r.value;
      for (const ev of item.evs) {
        if (ev.type === 'error') {
          throw new AttemptFailed({ status: ev.status && ev.status >= 400 ? ev.status : 502, message: `${primed.plan.cand.provider.name}: ${ev.message}`, raw: ev.message, next: 'key' });
        }
      }
      primed.buffered.push(item);
      if (item.evs.some(isContent)) {
        primed.ttftMs = Date.now() - primed.t0;
        return primed;
      }
    }
  }

  routeHeaders(plan: Plan): Record<string, string> {
    return {
      'x-og-provider': plan.cand.provider.id,
      'x-og-model': plan.cand.model,
      'x-og-request-id': this.requestId,
      'x-og-attempt': String(this.attempts.length + 1),
      ...(plan.emulate ? { 'x-og-emulated-tools': '1' } : {}),
    };
  }

  // --------------------------------------------------------------- pump
  async pump(primed: Primed): Promise<AttemptResult> {
    const { plan } = primed;
    const res = this.res;
    const input = this.input;
    const headers = this.routeHeaders(plan);
    if (this.captured) this.captured.upstreamRequest = { provider: plan.cand.provider.id, model: plan.cand.model, body: primed.upstreamBody };

    if (primed.nonStream) {
      if (this.captured) this.captured.response = clampStr(primed.nonStream.text, 200_000);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(primed.nonStream.text);
      return { status: 200, usage: primed.nonStream.usage, estimated: primed.nonStream.estimated, ttftMs: primed.ttftMs };
    }

    const clientStream = input.stream;
    const encoder = !plan.passthrough && clientStream ? createEncoder(this.ctx) : null;
    const agg = new Aggregator();
    const usage: IRUsage = { input: 0, output: 0 };
    let outChars = 0;
    let ttftMs = primed.ttftMs;
    let committed = false;
    let lastWrite = Date.now();
    let midStreamError: string | undefined;
    const clientWantsUsage = input.format !== 'openai' || !!input.body?.stream_options?.include_usage;
    const ndjson = isNdjson(input.format);

    const commit = () => {
      if (committed || !clientStream) return;
      committed = true;
      res.writeHead(200, { 'content-type': ndjson ? 'application/x-ndjson' : 'text/event-stream; charset=utf-8', ...STREAM_HEADERS, ...headers });
      lastWrite = Date.now();
    };
    const write = (s: string) => {
      if (!s || !clientStream) return;
      commit();
      res.write(s);
      lastWrite = Date.now();
    };
    const serialize = (raw: { event?: string; data: string }) => (input.format === 'openai' && raw.data === '[DONE]' ? 'data: [DONE]\n\n' : sseData(raw.data, raw.event));

    const handle = (item: Item) => {
      let out = '';
      for (const ev of item.evs) {
        if (ev.type === 'usage') mergeUsage(usage, ev.usage);
        if (ev.type === 'text' || ev.type === 'thinking') outChars += ev.text.length;
        if (ev.type === 'tool_args') outChars += ev.delta.length;
        if (isContent(ev) && ttftMs === undefined) ttftMs = Date.now() - primed.t0;
        if (ev.type === 'error') midStreamError = ev.message;
        agg.push(ev);
        if (encoder) out += encoder.push(ev);
      }
      if (plan.passthrough && item.raw && clientStream) {
        let drop = false;
        if (input.format === 'openai' && !clientWantsUsage && item.raw.data !== '[DONE]') {
          try {
            const d = JSON.parse(item.raw.data);
            drop = Array.isArray(d.choices) && d.choices.length === 0 && !!d.usage;
          } catch { /* keep */ }
        }
        if (!drop) out += serialize(item.raw);
      }
      // One write per upstream event batch keeps syscalls low.
      write(out);
    };

    // Keep-alive while the model is silent (long reasoning phases).
    const timer = setInterval(() => {
      if (!clientStream || primed.abort.signal.aborted || ndjson) return;
      if (Date.now() - lastWrite > 10_000 && !res.writableEnded) {
        commit();
        res.write(input.format === 'anthropic' ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': ping\n\n');
        lastWrite = Date.now();
      }
    }, 5_000);

    try {
      commit();
      for (const item of primed.buffered) handle(item);
      if (!primed.ended && primed.stream) {
        for (;;) {
          const r = await primed.stream.next();
          if (r.done) break;
          handle(r.value);
        }
      }
    } catch (e: any) {
      if (!clientStream && !primed.abort.signal.aborted) {
        // Nothing reached the client yet: let the caller fall back.
        throw e instanceof AttemptFailed ? e : new AttemptFailed({ status: 502, message: e?.message || String(e), next: 'key' });
      }
      if (primed.abort.signal.aborted) throw e;
      const message = e?.message || String(e);
      write(createEncoder(this.ctx).push({ type: 'error', message }));
      res.end();
      return { status: 502, usage: { ...usage, input: usage.input || this.ctx.estimatedInput }, ttftMs, estimated: true, error: message };
    } finally {
      clearInterval(timer);
    }

    let estimated = false;
    if (!usage.input) {
      usage.input = this.ctx.estimatedInput;
      estimated = true;
    }
    if (!usage.output && outChars) {
      usage.output = Math.ceil(outChars / 4);
      estimated = true;
    }
    const response = agg.result(this.ctx.model);
    response.usage = usage;
    if (this.captured) this.captured.response = clampStr(JSON.stringify(response.parts), 200_000);

    if (clientStream) {
      if (encoder) write(encoder.end());
      res.end();
    } else {
      if (agg.error && !agg.parts.length) throw new AttemptFailed({ status: agg.error.status || 502, message: agg.error.message, raw: agg.error.message, next: 'key' });
      const data = JSON.stringify(buildClientResponse(this.ctx, response));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
      res.end(data);
    }
    return { status: 200, usage, ttftMs, estimated, error: midStreamError, response: midStreamError ? undefined : response };
  }

  // ---------------------------------------------------------- bookkeeping
  failureOf(e: any): Failure {
    return e instanceof AttemptFailed ? e.failure : { status: 502, message: e?.message || String(e), next: 'key' };
  }

  /** Try to derive a compatibility fix from a failure. Returns the new fix or undefined. */
  adapt(plan: Plan, f: Failure): CompatFix | undefined {
    if (!this.settings.adaptiveCompat || f.raw === undefined) return undefined;
    const det = detectCompatFix({
      status: f.status, error: f.raw, format: plan.cand.provider.format === 'antigravity' ? 'openai' : (plan.cand.provider.format as any), current: plan.compat,
      hasTools: !!this.ir.tools?.length, hasImages: irHasImages(this.ir), hasSystem: !!this.ir.system, hasReasoning: !!this.ir.reasoning,
      hasResponseFormat: !!this.ir.responseFormat, requestedMaxTokens: plan.passthrough ? this.input.body?.max_tokens ?? this.input.body?.max_completion_tokens ?? this.ir.maxTokens : this.upstreamIr(plan).maxTokens || 32000,
    });
    if (!det) return undefined;
    const next = mergeFix(plan.compat, det.fix, det.reason);
    this.persistCompat(plan.cand, next);
    this.adapted.push(`${plan.cand.target}: ${det.reason}`);
    logger.info(`${c.cyan(plan.cand.target)} adapted: ${det.reason}`);
    return next;
  }

  applyCooldown(p: ProviderConfig, key: ProviderKey, model: string, f: Failure) {
    const s = this.settings;
    const status = f.status;
    if (status === 401 || status === 402 || status === 403) health.fail(p.id, key.id, { status, error: f.message, cooldownMs: s.cooldownAuthMs });
    else if (status === 429) health.fail(p.id, key.id, { status, error: f.message, cooldownMs: Math.min(f.retryAfterMs ?? s.cooldownRateLimitMs, 3600_000), model });
    else if (status === 408 || status >= 500) health.fail(p.id, key.id, { status, error: f.message, cooldownMs: s.cooldownServerMs, model });
    else health.fail(p.id, key.id, { status, error: f.message, cooldownMs: 0 });
  }

  record(extra: Partial<UsageRecord> & { status: number; ok: boolean }, resolutionCombo?: string) {
    const r: UsageRecord = {
      id: this.requestId, ts: this.t0, endpoint: this.input.endpoint, requestedModel: this.input.model, apiKeyId: this.input.apiKeyId,
      combo: resolutionCombo, latencyMs: Date.now() - this.t0, stream: this.input.stream, input: 0, output: 0, cost: 0, attempts: this.attempts,
      client: clampStr(String(this.input.headers['user-agent'] || ''), 80),
      ...(this.emulated ? { emulatedTools: true } : {}), ...(this.adapted.length ? { adapted: this.adapted } : {}),
      ...extra,
    };
    this.deps.usage.add(r, this.captured);
    const tag = r.ok ? c.green(String(r.status)) : c.red(String(r.status));
    const route = r.provider ? c.cyan(`${r.provider}/${r.model}`) : c.gray('(unrouted)');
    const tokens = r.ok ? c.gray(` ${r.input}→${r.output} tok`) : '';
    const notes = [this.attempts.length > 1 ? `${this.attempts.length} attempts` : '', r.cached ? 'cache' : '', this.emulated ? 'emulated tools' : ''].filter(Boolean).join(', ');
    const msg = `${tag} ${this.input.endpoint} ${c.bold(this.input.model || '(default)')} → ${route} ${c.gray(`${r.latencyMs}ms`)}${tokens}${notes ? c.yellow(` (${notes})`) : ''}`;
    if (r.ok) logger.info(msg);
    else logger.warn(`${msg} ${c.gray(clampStr(r.error || '', 160))}`);
  }

  success(plan: Plan, result: AttemptResult, ms: number, combo?: string) {
    const p = plan.cand.provider;
    this.attempts.push({ provider: p.id, model: plan.cand.model, keyId: plan.key.id, status: result.status, ms });
    health.ok(p.id, plan.key.id, plan.cand.model);
    if (result.ttftMs !== undefined) health.recordLatency(plan.cand.target, result.ttftMs);
    if (plan.emulate) this.emulated = true;
    const local = p.format === 'antigravity' || /127\.0\.0\.1|localhost/.test(p.baseUrl);
    const cost = estimateCost(plan.cand.model, result.usage, local, p.type);
    this.record({
      status: result.status, ok: result.status < 400, provider: p.id, model: plan.cand.model, keyId: plan.key.id,
      ttftMs: result.ttftMs, input: result.usage.input, output: result.usage.output, cacheRead: result.usage.cacheRead,
      cacheWrite: result.usage.cacheWrite, reasoning: result.usage.reasoning, cost, estimated: result.estimated, error: result.error,
    }, combo);
  }
}

// ------------------------------------------------------------------- main

export async function handleInference(input: InferenceInput, _req: IncomingMessage, res: ServerResponse, deps: Deps) {
  const cfg = deps.config.get();
  const settings = cfg.settings;

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
  const run = new Runner(input, ir, ctx, res, deps);
  const combo = resolution.combo;

  if (!resolution.candidates.length) {
    const msg = resolution.error || 'Model not found';
    sendJson(res, 404, errorBody(input.format, 404, msg));
    run.record({ status: 404, ok: false, error: msg }, combo);
    return;
  }

  // ---- response cache
  const ttlMs = (settings.cacheTtlSeconds || 0) * 1000;
  const ckey = ttlMs > 0 ? cacheKey(input.model, ir) : '';
  if (ttlMs > 0) {
    const hit = responseCache.get(ckey, ttlMs);
    if (hit) {
      const headers = { 'x-og-cache': 'hit', 'x-og-request-id': run.requestId };
      if (input.stream) {
        const enc = createEncoder(ctx);
        res.writeHead(200, { 'content-type': isNdjson(input.format) ? 'application/x-ndjson' : 'text/event-stream; charset=utf-8', ...STREAM_HEADERS, ...headers });
        res.end(replayEvents(hit.res).map((ev) => enc.push(ev)).join('') + enc.end());
      } else {
        const data = JSON.stringify(buildClientResponse(ctx, { ...hit.res, model: ctx.model }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
        res.end(data);
      }
      const [prov, ...rest] = hit.target.split('/');
      run.record({ status: 200, ok: true, provider: prov, model: rest.join('/'), cached: true, input: hit.res.usage.input, output: hit.res.usage.output, cost: 0 }, combo);
      return;
    }
  }
  const remember = (result: AttemptResult, plan: Plan) => {
    if (ttlMs > 0 && result.response && result.status < 400) responseCache.set(ckey, result.response, plan.cand.target);
  };

  let lastFailure: Failure = { status: 502, message: 'All providers failed', next: 'abort' };
  const maxAttempts = settings.maxAttempts;

  // ---- race: first token wins between the first two candidates
  if (resolution.strategy === 'race' && resolution.candidates.length > 1) {
    const racers = resolution.candidates
      .map((cand) => ({ cand, key: pickKeys(cand.provider, cand.model)[0] }))
      .filter((r) => r.key)
      .slice(0, 2);
    if (racers.length === 2) {
      const entries = racers.map((r) => {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        run.abort.signal.addEventListener('abort', onAbort, { once: true });
        const plan = run.plan(r.cand, r.key!, run.learnedCompat(r.cand));
        const start = Date.now();
        const promise = run.open(plan, abort).then((p) => run.prime(p, settings.headersTimeoutMs));
        promise.catch(() => undefined);
        return { plan, abort, start, promise };
      });
      let winner: { primed: Primed; entry: (typeof entries)[number] } | undefined;
      try {
        winner = await Promise.any(entries.map((e) => e.promise.then((primed) => ({ primed, entry: e }))));
      } catch { /* all failed */ }
      for (const e of entries) {
        if (winner && e === winner.entry) continue;
        if (winner) e.abort.abort();
        const err = await e.promise.then(() => undefined, (x) => x);
        // A loser we cancelled is not a provider failure.
        const cancelled = !err || (e.abort.signal.aborted && !(err instanceof AttemptFailed));
        const f = cancelled ? { status: 499, message: 'lost the race (cancelled)', next: 'key' as const } : run.failureOf(err);
        run.attempts.push({ provider: e.plan.cand.provider.id, model: e.plan.cand.model, keyId: e.plan.key.id, status: f.status, error: clampStr(f.message, 300), ms: Date.now() - e.start });
        if (!cancelled && !run.abort.signal.aborted) {
          lastFailure = f;
          if (!run.adapt(e.plan, f)) run.applyCooldown(e.plan.cand.provider, e.plan.key, e.plan.cand.model, f);
        }
      }
      if (winner) {
        try {
          const result = await run.pump(winner.primed);
          run.success(winner.primed.plan, result, Date.now() - winner.entry.start, combo);
          remember(result, winner.primed.plan);
          return;
        } catch (e: any) {
          if (run.abort.signal.aborted || res.headersSent) {
            if (!res.writableEnded) res.end();
            run.record({ status: 499, ok: false, error: 'Client closed request' }, combo);
            return;
          }
          lastFailure = run.failureOf(e);
        }
      }
    }
  }

  // ---- sequential fallback over candidates and keys
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
        let compat = run.learnedCompat(cand);
        for (let round = 0; round < 5; round++) {
          if (run.attempts.length >= maxAttempts + run.adapted.length) break outer;
          if (run.abort.signal.aborted) {
            run.record({ status: 499, ok: false, error: 'Client closed request' }, combo);
            return;
          }
          const plan = run.plan(cand, key, compat);
          const start = Date.now();
          const abort = new AbortController();
          const onAbort = () => abort.abort();
          run.abort.signal.addEventListener('abort', onAbort, { once: true });
          try {
            const primed = await run.prime(await run.open(plan, abort), PRIME_COMMIT_MS);
            const result = await run.pump(primed);
            run.success(plan, result, Date.now() - start, combo);
            remember(result, plan);
            return;
          } catch (e: any) {
            if (run.abort.signal.aborted) {
              run.attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: 499, error: 'client closed', ms: Date.now() - start });
              run.record({ status: 499, ok: false, provider: cand.provider.id, model: cand.model, error: 'Client closed request' }, combo);
              return;
            }
            const f = run.failureOf(e);
            const fixed = res.headersSent ? undefined : run.adapt(plan, f);
            run.attempts.push({
              provider: cand.provider.id, model: cand.model, keyId: key.id, status: f.status,
              error: clampStr(fixed ? `${f.message} → retrying with fix: ${fixed.reasons?.[fixed.reasons.length - 1]}` : f.message, 400), ms: Date.now() - start,
            });
            if (fixed) {
              compat = fixed;
              continue;
            }
            lastFailure = f;
            run.applyCooldown(cand.provider, key, cand.model, f);
            logger.debug(`attempt ${cand.target} key=${key.id} failed ${f.status}: ${f.message}`);
            if (f.next === 'abort' || res.headersSent) {
              if (!res.headersSent) sendJson(res, f.status, errorBody(input.format, f.status, f.message));
              else if (!res.writableEnded) res.end();
              run.record({ status: f.status, ok: false, provider: cand.provider.id, model: cand.model, error: f.message }, combo);
              return;
            }
            if (f.next === 'candidate') continue outer;
            break;
          } finally {
            run.abort.signal.removeEventListener('abort', onAbort);
          }
        }
      }
    }
    // Only retry cooling keys when nothing could be attempted at all.
    if (run.attempts.length || !skippedForCooldown) break;
  }

  if (!run.attempts.length && lastFailure.message === 'All providers failed') {
    lastFailure = { status: 429, message: 'All matching provider keys are cooling down after errors. Retry shortly.', next: 'abort' };
  }
  const status = lastFailure.status >= 400 ? lastFailure.status : 502;
  const tried = [...new Set(run.attempts.map((a) => `${a.provider}/${a.model}`))];
  const detail = tried.length > 1 ? ` (tried ${tried.join(' → ')})` : '';
  sendJson(res, status, errorBody(input.format, status, `${lastFailure.message}${detail}`), { 'x-og-request-id': run.requestId });
  run.record({ status, ok: false, error: lastFailure.message }, combo);
}
