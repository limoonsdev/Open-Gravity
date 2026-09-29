// Public inference endpoints (OpenAI, Anthropic, Responses, Gemini dialects).
import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiFormat } from '../translate';
import { errorBody, parseClientRequest, estimateRequestTokens } from '../translate';
import { handleInference, Deps } from '../router/executor';
import { resolveModel, listRoutableModels, pickKeys } from '../router/resolve';
import { upstreamFetch, authHeaders, extractErrorMessage } from '../providers/upstream';
import { json, readJson, readBody, HttpError } from './http';
import type { UsageRecord } from '../core/usage';
import { randomId } from '../core/util';
import { detectClient } from '../core/clients';
import { VERSION } from '../core/util';
import { modelDb, ModelInfo } from '../core/modeldb';

export interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  apiKeyId?: string;
}

/**
 * Strip optional prefixes so every common base URL works:
 * /v1/x, /x, /openai/v1/x, /anthropic/v1/x, /api/v1/x, LM Studio /api/v0/x,
 * Gemini's OpenAI-compatible /v1beta/openai/x, DeepSeek /beta/completions.
 */
export function normalizeApiPath(p: string): string {
  return p
    .replace(/^\/(openai|anthropic|api)(?=\/v1(\/|$))/, '')
    .replace(/^\/api\/v0(?=\/|$)/, '/v1')
    .replace(/^\/v1(beta|alpha)?\/openai(?=\/|$)/, '/v1')
    .replace(/^\/beta\/completions$/, '/v1/completions')
    .replace(/\/+$/, '') || '/';
}

/** Azure OpenAI style: /openai/deployments/{deployment}/chat/completions?api-version=... */
const AZURE_RE = /^\/openai\/deployments\/([^/]+)\/(.+?)\/*$/;

/** Guess the protocol of a request sent to an unknown path (e.g. POST /). */
export function sniffFormat(body: any, headers: IncomingMessage['headers']): ApiFormat | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  if (Array.isArray(body.contents)) return 'gemini';
  if (body.input !== undefined && !Array.isArray(body.messages)) return 'responses';
  if (Array.isArray(body.messages)) {
    if (headers['anthropic-version'] || (headers['x-api-key'] && !headers.authorization)) return 'anthropic';
    const blocks = body.messages.flatMap((m: any) => (Array.isArray(m?.content) ? m.content : []));
    if (blocks.some((c: any) => c?.type === 'tool_use' || c?.type === 'tool_result' || (c?.type === 'image' && c?.source))) return 'anthropic';
    if (body.system !== undefined && !body.messages.some((m: any) => m?.role === 'system')) return 'anthropic';
    return 'openai';
  }
  if (typeof body.prompt === 'string' || Array.isArray(body.prompt)) return 'completions';
  return undefined;
}

const ENDPOINT_OF: Record<ApiFormat, string> = {
  openai: 'openai', anthropic: 'anthropic', gemini: 'gemini', responses: 'responses', ollama: 'ollama', 'ollama-generate': 'ollama', completions: 'completions', fim: 'fim',
};

async function sniffed(r: ApiRequest, deps: Deps): Promise<boolean> {
  let body: any;
  try {
    body = await readJson(r.req);
  } catch (e: any) {
    json(r.res, e.status || 400, errorBody('openai', e.status || 400, e.message));
    return true;
  }
  const format = sniffFormat(body, r.req.headers);
  if (!format) {
    json(r.res, 400, errorBody('openai', 400, 'Unrecognised request: send an OpenAI, Anthropic, Gemini or Responses request body.'));
    return true;
  }
  await handleInference({
    format, body, model: String(body.model || ''), stream: !!body.stream, headers: r.req.headers, apiKeyId: r.apiKeyId, endpoint: ENDPOINT_OF[format],
  }, r.req, r.res, deps);
  return true;
}

async function inference(format: ApiFormat, endpoint: string, r: ApiRequest, deps: Deps, override?: { model: string; stream: boolean }) {
  let body: any;
  try {
    body = await readJson(r.req);
  } catch (e: any) {
    json(r.res, e.status || 400, errorBody(format, e.status || 400, e.message));
    return;
  }
  const model = override?.model ?? String(body?.model || '');
  const stream = override?.stream ?? !!body?.stream;
  await handleInference({ format, body, model, stream, headers: r.req.headers, apiKeyId: r.apiKeyId, endpoint }, r.req, r.res, deps);
}

/** Capability metadata for a routable id (combos report their first target). */
function infoFor(cfg: ReturnType<Deps['config']['get']>, id: string): ModelInfo | undefined {
  const cand = resolveModel(cfg, id).candidates[0];
  return cand ? modelDb.lookup(cand.provider.type, cand.model) : undefined;
}

function modelsList(r: ApiRequest, deps: Deps) {
  const cfg = deps.config.get();
  const models = listRoutableModels(cfg);
  const created = Math.floor(Date.now() / 1000);
  if (r.req.headers['anthropic-version']) {
    const data = models.map((m) => ({ type: 'model', id: m.id, display_name: m.id, created_at: new Date().toISOString() }));
    json(r.res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
    return;
  }
  json(r.res, 200, {
    object: 'list',
    data: models.map((m) => {
      const info = infoFor(cfg, m.id);
      return {
        id: m.id, object: 'model', created, owned_by: m.owned_by,
        ...(info?.maxInput ? { context_length: info.maxInput, context_window: info.maxInput } : {}),
        ...(info?.maxOutput ? { max_output_tokens: info.maxOutput } : {}),
      };
    }),
  });
}

// ---- Ollama-compatible metadata endpoints

const OLLAMA_VERSION = '0.12.6';

function ollamaTags(deps: Deps) {
  const models = listRoutableModels(deps.config.get());
  const now = new Date().toISOString();
  return {
    models: models.map((m) => ({
      name: m.id, model: m.id, modified_at: now, size: 0, digest: '',
      details: { parent_model: '', format: 'gguf', family: m.owned_by, families: [m.owned_by], parameter_size: '', quantization_level: '' },
    })),
  };
}

function ollamaShow(deps: Deps, name: string) {
  const cfg = deps.config.get();
  if (!resolveModel(cfg, name).candidates.length) throw new HttpError(404, `model "${name}" not found`);
  const info = infoFor(cfg, name);
  // Tools are always available: models without native tool calling get emulated tools.
  const capabilities = ['completion', 'tools', ...(info?.vision ? ['vision'] : []), ...(info?.reasoning ? ['thinking'] : [])];
  const ctxLen = info?.maxInput || 131072;
  return {
    license: '', modelfile: `FROM ${name}`, parameters: '', template: '{{ .Prompt }}',
    details: { parent_model: '', format: 'gguf', family: 'open-gravity', families: ['open-gravity'], parameter_size: '', quantization_level: '' },
    model_info: { 'general.architecture': 'open-gravity', 'general.basename': name, 'open-gravity.context_length': ctxLen },
    capabilities,
    modified_at: new Date().toISOString(),
  };
}

// ---- generic OpenAI-style endpoints (embeddings, images, audio, moderations, rerank...)

function boundaryOf(ctype: string): string | undefined {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ctype);
  return m?.[1] || m?.[2];
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function multipartFieldRe(boundary: string, name: string) {
  return new RegExp(`(--${reEscape(boundary)}\r\ncontent-disposition: form-data; name="${reEscape(name)}"\r\n(?:[^\r\n]+\r\n)*\r\n)([^\r\n]*)(\r\n--${reEscape(boundary)})`, 'i');
}

/** Value of a small text field in a multipart body (binary safe). */
export function multipartField(buf: Buffer, ctype: string, name: string): string | undefined {
  const b = boundaryOf(ctype);
  if (!b) return undefined;
  return multipartFieldRe(b, name).exec(buf.toString('latin1'))?.[2];
}

export function replaceMultipartField(buf: Buffer, ctype: string, name: string, value: string): Buffer {
  const b = boundaryOf(ctype);
  if (!b) return buf;
  const s = buf.toString('latin1');
  const re = multipartFieldRe(b, name);
  return re.test(s) ? Buffer.from(s.replace(re, (_m, a, _v, c) => `${a}${value}${c}`), 'latin1') : buf;
}

const PROXY_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'x-request-id'];

/** Forward a request to the provider serving `model`, with fallback and key rotation. */
async function proxyRaw(sub: string, r: ApiRequest, deps: Deps, modelOverride?: string) {
  const t0 = Date.now();
  const raw = await readBody(r.req);
  const ctype = String(r.req.headers['content-type'] || 'application/json');
  let body: any;
  let model = modelOverride || '';
  if (/json/i.test(ctype) && raw.length) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      json(r.res, 400, errorBody('openai', 400, 'Request body is not valid JSON'));
      return;
    }
    model ||= String(body?.model || '');
  } else if (/multipart\/form-data/i.test(ctype)) model ||= multipartField(raw, ctype, 'model') || '';
  const cfg = deps.config.get();
  const cands = resolveModel(cfg, model).candidates.filter((c) => c.provider.format === 'openai' || c.provider.format === 'responses');
  const client = detectClient(r.req.headers);
  const record = (extra: Partial<UsageRecord> & { status: number; ok: boolean }) => deps.usage.add({
    id: randomId(12), ts: t0, endpoint: `openai${sub}`, requestedModel: model, latencyMs: Date.now() - t0, stream: false, input: 0, output: 0, cost: 0,
    attempts, apiKeyId: r.apiKeyId, client: client.name, clientId: client.id, ...extra,
  });
  const attempts: UsageRecord['attempts'] = [];
  if (!cands.length) {
    const msg = `No OpenAI-compatible provider serves "${model}" for ${sub}. Use "provider/model".`;
    json(r.res, 404, errorBody('openai', 404, msg));
    record({ status: 404, ok: false, error: msg });
    return;
  }
  let last = { status: 502, message: `Request to ${sub} failed` };
  for (const cand of cands) {
    for (const key of pickKeys(cand.provider, cand.model).slice(0, 2)) {
      const start = Date.now();
      try {
        const payload = body ? JSON.stringify({ ...body, model: cand.model }) : /multipart/i.test(ctype) ? replaceMultipartField(raw, ctype, 'model', cand.model) : raw;
        const up = await upstreamFetch(`${cand.provider.baseUrl.replace(/\/+$/, '')}${sub}`, {
          method: 'POST',
          headers: { 'content-type': ctype, ...(cand.provider.headers || {}), ...authHeaders(cand.provider, key) },
          body: payload,
        }, { proxy: cand.provider.proxy || cfg.settings.upstreamProxy, headersTimeout: 300_000, bodyTimeout: 300_000 });
        if (up.ok && up.body) {
          const headers: Record<string, string> = { 'x-og-provider': cand.provider.id, 'x-og-model': cand.model };
          for (const h of PROXY_HEADERS) {
            const v = up.headers.get(h);
            if (v && h !== 'content-length') headers[h] = v;
          }
          r.res.writeHead(up.status, headers);
          let size = 0;
          let head = '';
          for await (const chunk of up.body as any as AsyncIterable<Uint8Array>) {
            size += chunk.length;
            if (head.length < 4096) head += Buffer.from(chunk).toString('utf8');
            r.res.write(chunk);
          }
          r.res.end();
          attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: up.status, ms: Date.now() - start });
          let input = 0;
          try { input = JSON.parse(head)?.usage?.prompt_tokens || JSON.parse(head)?.usage?.total_tokens || 0; } catch { /* binary or partial */ }
          record({ status: up.status, ok: true, provider: cand.provider.id, model: cand.model, keyId: key.id, input, output: 0 });
          void size;
          return;
        }
        const text = await up.text();
        last = { status: up.status, message: extractErrorMessage(text) };
        attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: up.status, error: last.message.slice(0, 300), ms: Date.now() - start });
        if (up.status < 500 && up.status !== 429 && up.status !== 401 && up.status !== 403) break;
      } catch (e: any) {
        last = { status: 502, message: e.message };
        attempts.push({ provider: cand.provider.id, model: cand.model, keyId: key.id, status: 502, error: e.message, ms: Date.now() - start });
      }
    }
  }
  json(r.res, last.status, errorBody('openai', last.status, last.message));
  record({ status: last.status, ok: false, error: last.message });
}

/** OpenAI-style sub-endpoints forwarded as-is to the provider of the requested model. */
const PROXY_SUBPATHS = /^\/(embeddings|images\/(generations|edits|variations)|audio\/(speech|transcriptions|translations)|moderations|rerank|videos(\/.*)?)$/;

async function countTokens(format: 'anthropic' | 'gemini', r: ApiRequest, model = '') {
  const body = await readJson(r.req);
  const ir = parseClientRequest(format, format === 'gemini' && body.generateContentRequest ? body.generateContentRequest : body, { model });
  const tokens = estimateRequestTokens(ir);
  if (format === 'anthropic') json(r.res, 200, { input_tokens: tokens });
  else json(r.res, 200, { totalTokens: tokens });
}

const OLLAMA_PATHS = new Set(['/api/chat', '/api/generate', '/api/tags', '/api/show', '/api/version', '/api/ps']);

const GEMINI_RE = /^\/v1(?:beta|alpha)?\/models\/(.+):(generateContent|streamGenerateContent|countTokens)$/;

/** Returns true when the path was handled. */
export async function routeApi(r: ApiRequest, deps: Deps): Promise<boolean> {
  const method = r.req.method || 'GET';
  const p = normalizeApiPath(r.path);

  if (method === 'POST') {
    switch (p) {
      case '/v1/chat/completions':
      case '/chat/completions':
        await inference('openai', 'openai', r, deps);
        return true;
      case '/v1/completions':
      case '/completions':
        await inference('completions', 'completions', r, deps);
        return true;
      case '/api/chat':
      case '/api/generate': {
        const format = p === '/api/chat' ? 'ollama' : 'ollama-generate';
        let body: any;
        try {
          body = await readJson(r.req);
        } catch (e: any) {
          json(r.res, e.status || 400, { error: e.message });
          return true;
        }
        await handleInference({
          format, body, model: String(body?.model || ''), stream: body?.stream !== false, headers: r.req.headers, apiKeyId: r.apiKeyId, endpoint: 'ollama',
        }, r.req, r.res, deps);
        return true;
      }
      case '/api/show': {
        const body = await readJson(r.req);
        json(r.res, 200, ollamaShow(deps, String(body.model || body.name || '')));
        return true;
      }
      case '/v1/messages':
      case '/messages':
        await inference('anthropic', 'anthropic', r, deps);
        return true;
      case '/v1/messages/count_tokens':
      case '/messages/count_tokens':
        await countTokens('anthropic', r);
        return true;
      case '/v1/responses':
      case '/responses':
        await inference('responses', 'responses', r, deps);
        return true;
      case '/v1/fim/completions':
      case '/fim/completions':
        await inference('fim', 'fim', r, deps);
        return true;
      case '/':
      case '/v1':
      case '/v1/chat':
      case '/chat':
        return sniffed(r, deps);
    }
    // Azure OpenAI deployment paths: the deployment name is the model.
    const az = AZURE_RE.exec(r.path);
    if (az) {
      const dep = decodeURIComponent(az[1]);
      const rest = `/${az[2]}`;
      if (rest === '/chat/completions') {
        const body = await readJson(r.req).catch(() => ({}));
        await handleInference({ format: 'openai', body, model: dep, stream: !!body.stream, headers: r.req.headers, apiKeyId: r.apiKeyId, endpoint: 'openai' }, r.req, r.res, deps);
        return true;
      }
      if (rest === '/completions') {
        const body = await readJson(r.req).catch(() => ({}));
        await handleInference({ format: 'completions', body, model: dep, stream: !!body.stream, headers: r.req.headers, apiKeyId: r.apiKeyId, endpoint: 'completions' }, r.req, r.res, deps);
        return true;
      }
      if (PROXY_SUBPATHS.test(rest)) {
        await proxyRaw(rest, r, deps, dep);
        return true;
      }
    }
    const sub = p.startsWith('/v1/') ? p.slice(3) : p;
    if (PROXY_SUBPATHS.test(sub)) {
      await proxyRaw(sub, r, deps);
      return true;
    }
    const g = GEMINI_RE.exec(p);
    if (g) {
      const model = decodeURIComponent(g[1]).replace(/^models\//, '');
      if (g[2] === 'countTokens') await countTokens('gemini', r, model);
      else await inference('gemini', 'gemini', r, deps, { model, stream: g[2] === 'streamGenerateContent' });
      return true;
    }
    return false;
  }

  if (method === 'GET') {
    if (p === '/api/version') {
      json(r.res, 200, { version: OLLAMA_VERSION });
      return true;
    }
    if (p === '/api/tags') {
      json(r.res, 200, ollamaTags(deps));
      return true;
    }
    if (p === '/api/ps') {
      json(r.res, 200, { models: [] });
      return true;
    }
    if (p === '/v1/models' || p === '/models') {
      modelsList(r, deps);
      return true;
    }
    if (p === '/v1beta/models' || p === '/v1alpha/models') {
      const models = listRoutableModels(deps.config.get());
      json(r.res, 200, {
        models: models.map((m) => ({
          name: `models/${m.id}`, displayName: m.id, supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
          inputTokenLimit: 1048576, outputTokenLimit: 65536,
        })),
      });
      return true;
    }
    const single = /^\/v1(?:beta)?\/models\/(.+)$/.exec(p);
    if (single) {
      const id = decodeURIComponent(single[1]);
      const known = listRoutableModels(deps.config.get()).find((m) => m.id === id);
      if (!known && !resolveModel(deps.config.get(), id).candidates.length) throw new HttpError(404, `Model ${id} not found`);
      json(r.res, 200, { id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: known?.owned_by || 'open-gravity' });
      return true;
    }
    if (p === '/health' || p === '/healthz' || p === '/v1/health') {
      json(r.res, 200, { status: 'ok', service: 'open-gravity', version: VERSION });
      return true;
    }
  }
  return false;
}

export function isApiPath(path: string): boolean {
  const p = normalizeApiPath(path);
  return /^\/(v1|v1beta|v1alpha)(\/|$)/.test(p) || OLLAMA_PATHS.has(p) || AZURE_RE.test(path) || PROXY_SUBPATHS.test(p)
    || ['/chat/completions', '/completions', '/messages', '/messages/count_tokens', '/responses', '/models', '/health', '/healthz', '/fim/completions', '/chat'].includes(p);
}
