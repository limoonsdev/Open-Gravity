// Builds and sends HTTP requests to upstream providers.
import { fetch, Agent, ProxyAgent, Dispatcher } from 'undici';
import type { ProviderConfig, ProviderKey } from '../core/config';
import { getTemplate, REASONING_MODEL_RE } from './catalog';
import type { ApiFormat, IRRequest } from '../translate';
import { buildOpenAIRequest } from '../translate/openai';
import { buildAnthropicRequest } from '../translate/anthropic';
import { buildGeminiRequest } from '../translate/gemini';
import { buildResponsesRequest } from '../translate/responses';
import { VERSION } from '../core/util';

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
  stream: boolean;
}

const dispatchers = new Map<string, Dispatcher>();
export function getDispatcher(proxy: string | undefined, headersTimeout: number, bodyTimeout: number): Dispatcher {
  const key = `${proxy || ''}|${headersTimeout}|${bodyTimeout}`;
  let d = dispatchers.get(key);
  if (!d) {
    d = proxy
      ? new ProxyAgent({ uri: proxy, headersTimeout, bodyTimeout })
      : new Agent({ headersTimeout, bodyTimeout, keepAliveTimeout: 30_000, connections: 64 });
    dispatchers.set(key, d);
  }
  return d;
}

function trimSlash(s: string) {
  return s.replace(/\/+$/, '');
}

export function endpointUrl(p: ProviderConfig, model: string, stream: boolean): string {
  const base = trimSlash(p.baseUrl);
  switch (p.format) {
    case 'openai': return `${base}/chat/completions`;
    case 'responses': return `${base}/responses`;
    case 'anthropic': return /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    case 'gemini': {
      const root = /\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`;
      const m = encodeURIComponent(model).replace(/%2F/g, '/');
      return stream ? `${root}/models/${m}:streamGenerateContent?alt=sse` : `${root}/models/${m}:generateContent`;
    }
    default: return base;
  }
}

export function authHeaders(p: ProviderConfig, key: ProviderKey | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  const k = key?.key;
  switch (p.auth) {
    case 'anthropic':
      if (k) h['x-api-key'] = k;
      h['anthropic-version'] = '2023-06-01';
      break;
    case 'anthropic-compat':
      if (k) {
        h['x-api-key'] = k;
        h.authorization = `Bearer ${k}`;
      }
      h['anthropic-version'] = '2023-06-01';
      break;
    case 'goog':
      if (k) h['x-goog-api-key'] = k;
      break;
    default:
      if (k) h.authorization = `Bearer ${k}`;
  }
  return h;
}

function flagsFor(p: ProviderConfig) {
  return { ...(getTemplate(p.type)?.flags || {}), ...(p.flags || {}) };
}

/** Build a translated upstream request from the IR. */
export function buildTranslated(p: ProviderConfig, key: ProviderKey | undefined, model: string, ir: IRRequest): UpstreamRequest {
  const flags = flagsFor(p);
  const isReasoningModel = REASONING_MODEL_RE.test(model);
  let body: any;
  switch (p.format) {
    case 'openai':
      body = buildOpenAIRequest(ir, {
        model,
        maxTokensField: flags.maxTokensField,
        reasoningEffort: flags.reasoningEffort === 'always' || (flags.reasoningEffort === 'models' && isReasoningModel),
        openrouterReasoning: flags.openrouterReasoning,
        stripSampling: flags.stripSamplingForReasoning && isReasoningModel,
        echoReasoning: flags.echoReasoning,
        streamOptions: flags.streamOptions,
        toolIdStyle: flags.toolIdStyle,
      });
      break;
    case 'responses':
      body = buildResponsesRequest(ir, { model, stripSampling: flags.stripSamplingForReasoning && isReasoningModel });
      break;
    case 'anthropic':
      body = buildAnthropicRequest(ir, { model, autoCache: flags.autoCache });
      break;
    case 'gemini':
      body = buildGeminiRequest(ir, { model });
      break;
  }
  return {
    url: endpointUrl(p, model, true),
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...baseHeaders(p), ...authHeaders(p, key) },
    body,
    stream: true,
  };
}

function baseHeaders(p: ProviderConfig): Record<string, string> {
  return { 'user-agent': `open-gravity/${VERSION}`, ...(getTemplate(p.type)?.headers || {}), ...(p.headers || {}) };
}

/** Headers from the client that are safe and useful to forward in passthrough mode. */
const FORWARD_HEADERS = ['anthropic-beta', 'openai-beta', 'x-stainless-helper-method'];

/** Build a same-format passthrough request (body forwarded with the model swapped). */
export function buildPassthrough(
  p: ProviderConfig, key: ProviderKey | undefined, model: string, clientFormat: ApiFormat, body: any, clientHeaders: Record<string, any>, stream: boolean,
): UpstreamRequest {
  const out = { ...body };
  if (clientFormat !== 'gemini') out.model = model;
  const headers: Record<string, string> = {
    'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...baseHeaders(p), ...authHeaders(p, key),
  };
  for (const h of FORWARD_HEADERS) {
    const v = clientHeaders[h];
    if (typeof v === 'string' && v) headers[h] = v;
  }
  if (clientFormat === 'openai' && stream) {
    const flags = flagsFor(p);
    if (flags.streamOptions !== false) out.stream_options = { ...(out.stream_options || {}), include_usage: true };
  }
  return { url: endpointUrl(p, model, stream), headers, body: out, stream };
}

// Models that can't serve chat requests (embeddings, audio, images, moderation...).
const NON_CHAT_RE = /(embed|whisper|tts|dall-e|moderation|rerank|davinci|babbage|transcribe|audio|realtime|image|imagen|veo|aqa|guard)/i;

export interface FetchModelsResult { models: string[]; error?: string }

/** List models from the provider's API (when supported). */
export async function fetchProviderModels(p: ProviderConfig, proxy?: string): Promise<FetchModelsResult> {
  const tpl = getTemplate(p.type);
  const api = tpl?.modelsApi || (p.format === 'openai' || p.format === 'responses' ? 'openai' : p.format);
  if (api === 'none' || p.format === 'antigravity') return { models: [], error: 'This provider does not expose a model list; add models manually.' };
  const key = p.keys.find((k) => k.enabled && k.key) || p.keys[0];
  const base = trimSlash(p.baseUrl);
  let url: string;
  if (api === 'anthropic') url = `${/\/v1$/.test(base) ? base : `${base}/v1`}/models?limit=1000`;
  else if (api === 'gemini') url = `${/\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`}/models?pageSize=1000`;
  else url = `${base}/models`;

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', ...baseHeaders(p), ...authHeaders(p, key) },
      dispatcher: getDispatcher(p.proxy || proxy, 20_000, 20_000),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) return { models: [], error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    const json: any = JSON.parse(text);
    let models: string[] = [];
    if (api === 'gemini') {
      models = (json.models || [])
        .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => String(m.name || '').replace(/^models\//, ''));
    } else {
      const list = Array.isArray(json) ? json : json.data || json.models || [];
      models = list.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    }
    models = models.filter((m) => !NON_CHAT_RE.test(m));
    return { models: [...new Set(models)].sort() };
  } catch (e: any) {
    return { models: [], error: e.message };
  }
}

/** Parse a provider error body into a readable message. */
export function extractErrorMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error ?? j;
    if (typeof e === 'string') return e;
    if (e?.message) return String(e.message);
    if (j.message) return String(j.message);
    if (j.detail) return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
  } catch { /* not JSON */ }
  return text.slice(0, 500) || 'Upstream error';
}
