// Model capability & pricing database (context window, output limit, tool
// calling, vision, reasoning, prices). Compiled from LiteLLM's MIT-licensed
// model catalog (github.com/BerriAI/litellm) into a compact bundled index
// (src/data/models.json), refreshable at runtime into the data directory.
import fs from 'fs';
import path from 'path';
import { dataDir } from './util';

export const MODELDB_SOURCE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// Flag bits in the compact format.
const F_TOOLS = 1;
const F_NO_TOOLS = 2;
const F_VISION = 4;
const F_REASONING = 8;
const F_CACHING = 16;
const F_SCHEMA = 32;
const F_NO_SYSTEM = 64;
const F_TOOL_CHOICE = 128;
const F_PDF = 256;
const F_PARALLEL = 512;

export interface CompactDb {
  source: string;
  updated: string;
  providers: string[];
  /** [key, providerIndex, in$/M, out$/M, cacheRead$/M, cacheWrite$/M, maxIn, maxOut, flags] */
  models: Array<[string, number, number, number, number, number, number, number, number]>;
}

export interface ModelInfo {
  key: string;
  provider: string;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  maxInput: number;
  maxOutput: number;
  /** true = native tool calling, false = known unsupported, undefined = unknown */
  tools?: boolean;
  toolChoice: boolean;
  vision: boolean;
  reasoning: boolean;
  promptCaching: boolean;
  responseSchema: boolean;
  systemMessages: boolean;
  pdf: boolean;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Turn LiteLLM's raw catalog into the compact bundled format. */
export function compileLiteLLM(raw: Record<string, any>): CompactDb {
  const providers: string[] = [];
  const pIndex = new Map<string, number>();
  const models: CompactDb['models'] = [];
  for (const [key, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object' || key === 'sample_spec') continue;
    if (!['chat', 'responses', 'completion'].includes(v.mode)) continue;
    const prov = String(v.litellm_provider || '').trim();
    if (!prov || prov.includes(' ')) continue;
    if (!pIndex.has(prov)) {
      pIndex.set(prov, providers.length);
      providers.push(prov);
    }
    let flags = 0;
    if (v.supports_function_calling === true) flags |= F_TOOLS;
    if (v.supports_function_calling === false) flags |= F_NO_TOOLS;
    if (v.supports_vision || v.supports_image_input) flags |= F_VISION;
    if (v.supports_reasoning) flags |= F_REASONING;
    if (v.supports_prompt_caching) flags |= F_CACHING;
    if (v.supports_response_schema) flags |= F_SCHEMA;
    if (v.supports_system_messages === false) flags |= F_NO_SYSTEM;
    if (v.supports_tool_choice) flags |= F_TOOL_CHOICE;
    if (v.supports_pdf_input) flags |= F_PDF;
    if (v.supports_parallel_function_calling) flags |= F_PARALLEL;
    const per = (x: any) => (typeof x === 'number' && isFinite(x) ? round(x * 1e6) : 0);
    const maxIn = Number(v.max_input_tokens) || 0;
    const maxOut = Number(v.max_output_tokens) || (typeof v.max_tokens === 'number' && v.max_tokens !== maxIn ? v.max_tokens : 0) || 0;
    models.push([key, pIndex.get(prov)!, per(v.input_cost_per_token), per(v.output_cost_per_token), per(v.cache_read_input_token_cost), per(v.cache_creation_input_token_cost), maxIn, maxOut, flags]);
  }
  models.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { source: 'litellm', updated: new Date().toISOString().slice(0, 10), providers, models };
}

/** Our provider types -> LiteLLM provider ids (for exact "provider/model" lookups). */
const PROVIDER_MAP: Record<string, string[]> = {
  openai: ['openai'], 'openai-responses': ['openai'], anthropic: ['anthropic'], gemini: ['gemini'], 'vertex-express': ['vertex_ai-language-models', 'gemini'],
  openrouter: ['openrouter'], groq: ['groq'], deepseek: ['deepseek'], 'deepseek-anthropic': ['deepseek'], xai: ['xai'], mistral: ['mistral'], codestral: ['codestral', 'mistral'],
  zai: ['zai'], 'zai-coding': ['zai'], 'zai-china': ['zai'], moonshot: ['moonshot'], 'moonshot-anthropic': ['moonshot'], 'moonshot-china': ['moonshot'],
  minimax: ['minimax'], 'minimax-openai': ['minimax'], qwen: ['dashscope', 'qwen_ai_platform'], 'qwen-china': ['dashscope'], cerebras: ['cerebras'],
  together: ['together_ai'], fireworks: ['fireworks_ai'], nvidia: ['nvidia_nim'], vercel: ['vercel_ai_gateway'], deepinfra: ['deepinfra'],
  perplexity: ['perplexity'], ollama: ['ollama'], 'azure-openai': ['azure'], cohere: ['cohere_chat', 'cohere'], ai21: ['ai21'], sambanova: ['sambanova'],
  nebius: ['nebius'], novita: ['novita'], hyperbolic: ['hyperbolic'], featherless: ['featherless_ai'], baseten: ['baseten'], friendli: ['friendliai'],
  nscale: ['nscale'], scaleway: ['scaleway'], ovhcloud: ['ovhcloud'], cloudflare: ['cloudflare'], databricks: ['databricks'], volcengine: ['volcengine'],
  aihubmix: ['aihubmix'], aimlapi: ['aiml'], gmi: ['gmi'], inception: ['inception'], morph: ['morph'], wandb: ['wandb'], github: ['github'],
  huggingface: ['huggingface'], 'bedrock-openai': ['bedrock', 'bedrock_converse'], gigachat: ['gigachat'], sarvam: ['sarvam'], xiaomi: ['xiaomi_mimo'],
};

function normalizeName(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/:(free|beta|thinking|extended|nitro|floor|online|latest)$/, '');
  const parts = n.split('/');
  n = parts[parts.length - 1];
  n = n.replace(/@.*$/, '');
  for (let prev = ''; prev !== n;) {
    prev = n;
    n = n.replace(/[-_](\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, '').replace(/-(latest|preview|exp|instruct)$/, '');
  }
  return n.replace(/[._]/g, '-');
}

// Native vendor namespaces win ties when several providers list the same model.
const VENDOR_PRIORITY = ['anthropic', 'openai', 'gemini', 'deepseek', 'xai', 'mistral', 'zai', 'moonshot', 'minimax', 'dashscope', 'cohere_chat', 'groq', 'cerebras', 'together_ai', 'fireworks_ai', 'openrouter'];

export class ModelDb {
  private db: CompactDb = { source: 'none', updated: '', providers: [], models: [] };
  private exact = new Map<string, number>();
  private normalized = new Map<string, number>();
  private byProvider = new Map<string, number[]>();

  load(db: CompactDb) {
    this.db = db;
    this.exact.clear();
    this.normalized.clear();
    this.byProvider.clear();
    const rank = (i: number) => {
      const p = db.providers[db.models[i][1]];
      const r = VENDOR_PRIORITY.indexOf(p);
      return r < 0 ? 100 : r;
    };
    db.models.forEach((m, i) => {
      const key = m[0].toLowerCase();
      this.exact.set(key, i);
      const prov = db.providers[m[1]];
      const list = this.byProvider.get(prov) || [];
      list.push(i);
      this.byProvider.set(prov, list);
      const norm = normalizeName(m[0]);
      const cur = this.normalized.get(norm);
      if (cur === undefined || rank(i) < rank(cur)) this.normalized.set(norm, i);
    });
  }

  get info() {
    return { source: this.db.source, updated: this.db.updated, models: this.db.models.length, providers: this.db.providers.length };
  }

  private toInfo(i: number): ModelInfo {
    const [key, p, inC, outC, cr, cw, maxIn, maxOut, f] = this.db.models[i];
    return {
      key, provider: this.db.providers[p], inputCost: inC, outputCost: outC, cacheReadCost: cr, cacheWriteCost: cw, maxInput: maxIn, maxOutput: maxOut,
      tools: f & F_TOOLS ? true : f & F_NO_TOOLS ? false : undefined,
      toolChoice: !!(f & F_TOOL_CHOICE), vision: !!(f & F_VISION), reasoning: !!(f & F_REASONING), promptCaching: !!(f & F_CACHING),
      responseSchema: !!(f & F_SCHEMA), systemMessages: !(f & F_NO_SYSTEM), pdf: !!(f & F_PDF),
    };
  }

  /** Find metadata for a model as served by one of our provider types. */
  lookup(providerType: string | undefined, model: string): ModelInfo | undefined {
    if (!model) return undefined;
    const m = model.toLowerCase();
    for (const lp of PROVIDER_MAP[providerType || ''] || []) {
      const i = this.exact.get(`${lp}/${m}`);
      if (i !== undefined) return this.toInfo(i);
    }
    const bare = this.exact.get(m);
    if (bare !== undefined) return this.toInfo(bare);
    // "vendor/model" ids (OpenRouter style) -> try the model part.
    if (m.includes('/')) {
      const last = m.slice(m.lastIndexOf('/') + 1);
      const i = this.exact.get(last);
      if (i !== undefined) return this.toInfo(i);
    }
    const n = this.normalized.get(normalizeName(m));
    return n !== undefined ? this.toInfo(n) : undefined;
  }

  /** Known chat models for a provider type (without the LiteLLM prefix). */
  modelsFor(providerType: string): string[] {
    const out: string[] = [];
    for (const lp of PROVIDER_MAP[providerType] || []) {
      for (const i of this.byProvider.get(lp) || []) {
        const key = this.db.models[i][0];
        out.push(key.startsWith(`${lp}/`) ? key.slice(lp.length + 1) : key);
      }
      if (out.length) break;
    }
    return [...new Set(out)];
  }
}

export const modelDb = new ModelDb();

function runtimeFile() {
  return path.join(dataDir(), 'cache', 'modeldb.json');
}

/** Load the bundled DB, or a newer runtime-downloaded copy if present. */
export function initModelDb() {
  let bundled: CompactDb | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bundled = require('../data/models.json');
  } catch { /* not bundled */ }
  let runtime: CompactDb | undefined;
  try {
    runtime = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'));
  } catch { /* none yet */ }
  const pick = runtime && (!bundled || runtime.updated >= bundled.updated) ? runtime : bundled;
  if (pick) modelDb.load(pick);
}

/** Download the latest catalog and switch to it. */
export async function updateModelDb(fetchImpl: typeof fetch = fetch): Promise<ModelDb['info']> {
  const res = await fetchImpl(MODELDB_SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Model database download failed: HTTP ${res.status}`);
  const compiled = compileLiteLLM((await res.json()) as Record<string, any>);
  if (compiled.models.length < 500) throw new Error('Downloaded model database looks incomplete');
  fs.mkdirSync(path.dirname(runtimeFile()), { recursive: true });
  fs.writeFileSync(runtimeFile(), JSON.stringify(compiled));
  modelDb.load(compiled);
  return modelDb.info;
}

export function modelDbAge(): number {
  const updated = Date.parse(modelDb.info.updated || '1970-01-01');
  return Date.now() - updated;
}

initModelDb();
