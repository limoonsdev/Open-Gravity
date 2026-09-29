// Free AI APIs: what each preset offers for free (official free tiers, free
// models, free credits, public endpoints that need no key, local engines),
// discovery of OpenRouter's current free models, and a one-click "free" combo.
//
// Only official, documented offers are listed. Limits change often, so every
// entry links to the provider's own page instead of hard-coding numbers that
// would go stale.
import type { AppConfig, ComboConfig, ProviderConfig } from '../core/config';
import { CATALOG } from './catalog';
import { upstreamFetch } from './upstream';

export type FreeKind = 'free-tier' | 'free-models' | 'free-credits' | 'no-key' | 'local';

export interface FreeInfo {
  kind: FreeKind;
  /** What is free, in one sentence (approximate: providers change their offers). */
  summary: string;
  /** Official page with the current limits. */
  limitsUrl?: string;
  /** Models known to be free on this provider. */
  models?: string[];
  /** Priority in the automatic free combo (higher is tried first). */
  rank: number;
  /** Needs a payment card or a one-time top-up to unlock the free usage. */
  card?: boolean;
}

export const FREE_INFO: Record<string, FreeInfo> = {
  gemini: {
    kind: 'free-tier', rank: 95,
    summary: 'Free tier for Gemini Flash and Flash-Lite (and limited Pro) with per-minute and daily request limits.',
    limitsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
  },
  openrouter: {
    kind: 'free-models', rank: 90,
    summary: 'Dozens of ":free" models. A small daily request allowance, raised after a one-time credit purchase.',
    limitsUrl: 'https://openrouter.ai/docs/api-reference/limits',
  },
  groq: {
    kind: 'free-tier', rank: 88,
    summary: 'Free tier with per-model request and token limits, very fast inference.',
    limitsUrl: 'https://console.groq.com/docs/rate-limits',
    models: ['openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct-0905', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  },
  cerebras: {
    kind: 'free-tier', rank: 87,
    summary: 'Free tier with daily token limits, very fast inference.',
    limitsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    models: ['qwen-3-coder-480b', 'gpt-oss-120b', 'llama-3.3-70b'],
  },
  github: {
    kind: 'free-tier', rank: 84,
    summary: 'Free, rate-limited access with a GitHub token that has the models:read permission.',
    limitsUrl: 'https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models#rate-limits',
    models: ['openai/gpt-4.1', 'openai/gpt-4o', 'openai/gpt-4.1-mini'],
  },
  nvidia: {
    kind: 'free-credits', rank: 82,
    summary: 'Free API access for prototyping on build.nvidia.com, rate-limited.',
    limitsUrl: 'https://build.nvidia.com',
    models: ['qwen/qwen3-coder-480b-a35b-instruct', 'moonshotai/kimi-k2-instruct-0905', 'deepseek-ai/deepseek-v3.1'],
  },
  mistral: {
    kind: 'free-tier', rank: 80,
    summary: 'Free "Experiment" plan (phone verification) with rate limits on every model.',
    limitsUrl: 'https://docs.mistral.ai/deployment/laplateforme/tier/',
    models: ['devstral-medium-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  },
  'ollama-cloud': {
    kind: 'free-tier', rank: 75,
    summary: 'Free usage of Ollama cloud models with hourly and daily limits.',
    limitsUrl: 'https://ollama.com/pricing',
  },
  zai: {
    kind: 'free-models', rank: 72,
    summary: 'GLM-4.5-Flash is free.',
    limitsUrl: 'https://docs.z.ai/guides/overview/pricing',
    models: ['glm-4.5-flash'],
  },
  'zai-china': {
    kind: 'free-models', rank: 70,
    summary: 'GLM-4.5-Flash and GLM-4-Flash are free.',
    limitsUrl: 'https://open.bigmodel.cn/pricing',
    models: ['glm-4.5-flash', 'glm-4-flash'],
  },
  sambanova: {
    kind: 'free-credits', rank: 70,
    summary: 'Free developer credits and rate-limited free usage.',
    limitsUrl: 'https://cloud.sambanova.ai/plans',
  },
  modelscope: {
    kind: 'free-tier', rank: 68,
    summary: 'A free daily quota of API calls (Alibaba Cloud account binding required).',
    limitsUrl: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
  },
  vercel: {
    kind: 'free-credits', rank: 65,
    summary: 'Free monthly credits on the AI Gateway.',
    limitsUrl: 'https://vercel.com/docs/ai-gateway/pricing',
  },
  cloudflare: {
    kind: 'free-tier', rank: 60,
    summary: 'A free daily allocation of Neurons on Workers AI.',
    limitsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
  },
  huggingface: {
    kind: 'free-credits', rank: 55,
    summary: 'A small monthly credit for Inference Providers on free accounts (more with PRO).',
    limitsUrl: 'https://huggingface.co/docs/inference-providers/pricing',
  },
  cohere: {
    kind: 'free-tier', rank: 50,
    summary: 'Free trial key with monthly call limits (non-commercial use).',
    limitsUrl: 'https://docs.cohere.com/docs/rate-limits',
  },
  'opencode-zen': {
    kind: 'free-models', rank: 50,
    summary: 'Some coding models are free for limited periods (the list changes).',
    limitsUrl: 'https://opencode.ai/docs/zen/',
  },
  siliconflow: {
    kind: 'free-models', rank: 45,
    summary: 'Several smaller open models are free.',
    limitsUrl: 'https://siliconflow.com/pricing',
  },
  'siliconflow-china': {
    kind: 'free-models', rank: 44,
    summary: 'Several smaller open models are free.',
    limitsUrl: 'https://siliconflow.cn/pricing',
  },
  scaleway: {
    kind: 'free-credits', rank: 40,
    summary: 'The first million tokens are free.',
    limitsUrl: 'https://www.scaleway.com/en/pricing/model-as-a-service/',
  },
  ovhcloud: {
    kind: 'no-key', rank: 38,
    summary: 'Usable without a key at a low rate limit; create a token for more.',
    limitsUrl: 'https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-getting-started',
  },
  pollinations: {
    kind: 'no-key', rank: 35,
    summary: 'Public API with no sign-up. Shared and rate-limited, best for light use.',
    limitsUrl: 'https://github.com/pollinations/pollinations/blob/master/APIDOCS.md',
  },
  llm7: {
    kind: 'no-key', rank: 34,
    summary: 'Public API that works without a key; a free token raises the limits.',
    limitsUrl: 'https://llm7.io',
  },
  hunyuan: {
    kind: 'free-models', rank: 30,
    summary: 'hunyuan-lite is free.',
    limitsUrl: 'https://cloud.tencent.com/document/product/1729/97731',
    models: ['hunyuan-lite'],
  },
  qianfan: {
    kind: 'free-models', rank: 30,
    summary: 'ERNIE Speed and ERNIE Lite are free.',
    limitsUrl: 'https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya',
    models: ['ernie-speed-128k', 'ernie-lite-8k'],
  },
  spark: {
    kind: 'free-models', rank: 25,
    summary: 'Spark Lite is free.',
    limitsUrl: 'https://xinghuo.xfyun.cn/sparkapi',
    models: ['lite'],
  },
};

const LOCAL_FREE: FreeInfo = { kind: 'local', rank: 20, summary: 'Runs on your own computer: free, private, unlimited (needs a capable GPU or CPU).' };

export function freeInfoFor(type: string): FreeInfo | undefined {
  if (FREE_INFO[type]) return FREE_INFO[type];
  const tpl = CATALOG.find((t) => t.type === type);
  return tpl?.category === 'local' && type !== 'antigravity' ? LOCAL_FREE : undefined;
}

// ------------------------------------------------------ OpenRouter discovery

export interface FreeModel {
  id: string;
  name: string;
  context: number;
  tools: boolean;
  reasoning: boolean;
}

const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
let discovered: { at: number; models: FreeModel[]; error?: string } | undefined;

/** Parse OpenRouter's public model list and keep the free models. */
export function parseOpenRouterFree(body: any): FreeModel[] {
  const data: any[] = Array.isArray(body?.data) ? body.data : [];
  return data
    .filter((m) => typeof m?.id === 'string' && (m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 && m.id !== 'openrouter/auto')))
    .map((m) => {
      const params: string[] = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      return {
        id: m.id,
        name: String(m.name || m.id),
        context: Number(m.context_length) || 0,
        tools: params.includes('tools'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      };
    })
    .sort((a, b) => Number(b.tools) - Number(a.tools) || b.context - a.context);
}

/** Current free models on OpenRouter (public endpoint, cached for 6 hours). */
export async function openRouterFreeModels(force = false, proxy?: string): Promise<{ models: FreeModel[]; updatedAt?: number; error?: string }> {
  if (!force && discovered && Date.now() - discovered.at < 6 * 3600e3) return { models: discovered.models, updatedAt: discovered.at, error: discovered.error };
  if (process.env.OG_OFFLINE) return { models: discovered?.models || [], error: 'offline mode' };
  try {
    const res = await upstreamFetch(OPENROUTER_MODELS, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }, { proxy: proxy || undefined, headersTimeout: 15_000, bodyTimeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = parseOpenRouterFree(await res.json());
    discovered = { at: Date.now(), models };
  } catch (e: any) {
    discovered = { at: Date.now(), models: discovered?.models || [], error: e?.message || String(e) };
  }
  return { models: discovered.models, updatedAt: discovered.at, error: discovered.error };
}

// --------------------------------------------------------------- free combo

/** Free models a configured provider can serve. */
function freeModelsOf(p: ProviderConfig, info: FreeInfo, orFree: FreeModel[]): string[] {
  if (info.kind === 'local' || info.kind === 'no-key' || info.kind === 'free-tier') {
    // Everything this provider lists is free (within its limits); prefer the known good ones first.
    const preferred = (info.models || []).filter((m) => p.models.includes(m));
    return [...preferred, ...p.models.filter((m) => !preferred.includes(m))];
  }
  if (p.type === 'openrouter') {
    const listed = p.models.filter((m) => m.endsWith(':free'));
    const found = orFree.filter((m) => m.tools).map((m) => m.id);
    return [...new Set([...listed, ...found])];
  }
  return (info.models || []).filter((m) => p.models.includes(m) || !p.models.length);
}

/**
 * Build a fallback combo that only uses free options among the configured
 * providers: best free tiers first, local engines last.
 */
export function buildFreeCombo(cfg: AppConfig, orFree: FreeModel[], maxTargets = 16): ComboConfig | undefined {
  const ranked = cfg.providers
    .filter((p) => p.enabled)
    .map((p) => ({ p, info: freeInfoFor(p.type) }))
    .filter((x): x is { p: ProviderConfig; info: FreeInfo } => !!x.info)
    .sort((a, b) => b.info.rank - a.info.rank);
  const targets: string[] = [];
  const listOf = ({ p, info }: { p: ProviderConfig; info: FreeInfo }) => freeModelsOf(p, info, orFree).slice(0, 4).map((m) => `${p.id}/${m}`);
  // Cloud free tiers first, round-robin across providers so one exhausted
  // free tier doesn't block the rest; local engines (unlimited but usually
  // slower) close the chain.
  const cloud = ranked.filter((x) => x.info.kind !== 'local').map(listOf);
  const localTargets = ranked.filter((x) => x.info.kind === 'local').flatMap(listOf);
  for (let i = 0; targets.length < maxTargets && cloud.some((l) => l[i]); i++) {
    for (const l of cloud) if (l[i] && targets.length < maxTargets) targets.push(l[i]);
  }
  for (const t of localTargets) if (targets.length < maxTargets) targets.push(t);
  if (!targets.length) return undefined;
  return {
    id: 'free',
    description: 'Automatic: free tiers and free models only, best first',
    targets,
    strategy: 'fallback',
    enabled: true,
  };
}
