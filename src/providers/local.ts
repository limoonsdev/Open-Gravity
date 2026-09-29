// Detection of local inference engines running on this computer (Ollama,
// LM Studio, llama.cpp, vLLM, Jan…), used by the Get started guide to offer
// them in one click. Each distinct base URL of the local presets is probed with
// a short timeout on its OpenAI-compatible /models endpoint.
import { request } from 'undici';
import { CATALOG } from './catalog';

export interface LocalEngine {
  type: string;
  name: string;
  baseUrl: string;
  models: string[];
}

export interface LocalCandidate {
  type: string;
  name: string;
  baseUrl: string;
}

export function localCandidates(): LocalCandidate[] {
  const seen = new Set<string>();
  const out: LocalCandidate[] = [];
  for (const t of CATALOG) {
    if (t.category !== 'local' || !/^http:\/\/127\.0\.0\.1:\d+/.test(t.baseUrl)) continue;
    if (seen.has(t.baseUrl)) continue;
    seen.add(t.baseUrl);
    out.push({ type: t.type, name: t.name, baseUrl: t.baseUrl });
  }
  return out;
}

/** Engines sharing a port are told apart by the owner the server reports. */
const OWNER_HINTS: Array<[RegExp, string]> = [
  [/llama\.?cpp|llamacpp/i, 'llamacpp'],
  [/localai/i, 'localai'],
  [/llamafile/i, 'llamafile'],
  [/mlx/i, 'mlx'],
  [/vllm/i, 'vllm'],
  [/lemonade/i, 'lemonade'],
  [/tgi|huggingface|text-generation-inference/i, 'tgi'],
];

function portOf(url: string): number {
  try {
    return Number(new URL(url).port) || 80;
  } catch {
    return 0;
  }
}

async function probe(c: LocalCandidate, timeoutMs: number): Promise<LocalEngine | null> {
  try {
    const res = await request(`${c.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs + 200),
    });
    const text = await res.body.text();
    // Another Open Gravity instance on a local port is not an engine.
    if (res.statusCode >= 400 || res.headers['x-og-router']) return null;
    const json = JSON.parse(text);
    if (!Array.isArray(json?.data) && !Array.isArray(json?.models)) return null;
    const list: any[] = Array.isArray(json.data) ? json.data : json.models;
    const models = list.map((m) => String(m?.id || m?.name || m?.model || '')).filter(Boolean).slice(0, 200);
    let type = c.type;
    const owners = list.map((m) => String(m?.owned_by || '')).join(' ');
    for (const [re, t] of OWNER_HINTS) {
      if (re.test(owners)) {
        type = t;
        break;
      }
    }
    const tpl = CATALOG.find((t) => t.type === type);
    return { type, name: tpl?.name || c.name, baseUrl: tpl && portOf(tpl.baseUrl) === portOf(c.baseUrl) ? tpl.baseUrl : c.baseUrl, models };
  } catch {
    return null;
  }
}

/** Probe local engines in parallel. `excludePort` skips the router's own port. */
export async function detectLocalEngines(opts: { excludePort?: number; timeoutMs?: number; candidates?: LocalCandidate[] } = {}): Promise<LocalEngine[]> {
  const candidates = (opts.candidates || localCandidates()).filter((c) => !opts.excludePort || portOf(c.baseUrl) !== opts.excludePort);
  const found = await Promise.all(candidates.map((c) => probe(c, opts.timeoutMs ?? 700)));
  return found.filter((x): x is LocalEngine => !!x);
}
