// Public inference endpoints (OpenAI, Anthropic, Responses, Gemini dialects).
import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiFormat } from '../translate';
import { errorBody, parseClientRequest, estimateRequestTokens } from '../translate';
import { handleInference, Deps } from '../router/executor';
import { resolveModel, listRoutableModels, pickKeys } from '../router/resolve';
import { upstreamFetch, authHeaders, extractErrorMessage } from '../providers/upstream';
import { json, readJson, HttpError } from './http';
import { VERSION } from '../core/util';

export interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  apiKeyId?: string;
}

/** Strip optional prefixes so /v1/x, /x, /openai/v1/x, /anthropic/v1/x all work. */
export function normalizeApiPath(p: string): string {
  return p.replace(/^\/(openai|anthropic|api)(?=\/v1)/, '').replace(/\/+$/, '') || '/';
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

function modelsList(r: ApiRequest, deps: Deps) {
  const cfg = deps.config.get();
  const models = listRoutableModels(cfg);
  const created = Math.floor(Date.now() / 1000);
  if (r.req.headers['anthropic-version']) {
    const data = models.map((m) => ({ type: 'model', id: m.id, display_name: m.id, created_at: new Date().toISOString() }));
    json(r.res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
    return;
  }
  json(r.res, 200, { object: 'list', data: models.map((m) => ({ id: m.id, object: 'model', created, owned_by: m.owned_by })) });
}

async function embeddings(r: ApiRequest, deps: Deps) {
  const body = await readJson(r.req);
  const cfg = deps.config.get();
  const resolution = resolveModel(cfg, String(body.model || ''));
  const cands = resolution.candidates.filter((c) => c.provider.format === 'openai' || c.provider.format === 'responses');
  if (!cands.length) {
    json(r.res, 404, errorBody('openai', 404, `No OpenAI-compatible provider can serve embeddings for "${body.model}". Use "provider/model".`));
    return;
  }
  let last = { status: 502, message: 'Embedding request failed' };
  for (const cand of cands) {
    for (const key of pickKeys(cand.provider, cand.model).slice(0, 2)) {
      try {
        const up = await upstreamFetch(`${cand.provider.baseUrl.replace(/\/+$/, '')}/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(cand.provider.headers || {}), ...authHeaders(cand.provider, key) },
          body: JSON.stringify({ ...body, model: cand.model }),
        }, { proxy: cand.provider.proxy || cfg.settings.upstreamProxy, headersTimeout: 60_000, bodyTimeout: 60_000 });
        const text = await up.text();
        if (up.ok) {
          r.res.writeHead(200, { 'content-type': 'application/json', 'x-og-provider': cand.provider.id });
          r.res.end(text);
          return;
        }
        last = { status: up.status, message: extractErrorMessage(text) };
      } catch (e: any) {
        last = { status: 502, message: e.message };
      }
    }
  }
  json(r.res, last.status, errorBody('openai', last.status, last.message));
}

async function countTokens(format: 'anthropic' | 'gemini', r: ApiRequest, model = '') {
  const body = await readJson(r.req);
  const ir = parseClientRequest(format, format === 'gemini' && body.generateContentRequest ? body.generateContentRequest : body, { model });
  const tokens = estimateRequestTokens(ir);
  if (format === 'anthropic') json(r.res, 200, { input_tokens: tokens });
  else json(r.res, 200, { totalTokens: tokens });
}

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
      case '/v1/embeddings':
      case '/embeddings':
        await embeddings(r, deps);
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
  return /^\/(v1|v1beta|v1alpha)\//.test(p) || ['/chat/completions', '/messages', '/messages/count_tokens', '/responses', '/embeddings', '/models', '/health', '/healthz'].includes(p);
}
