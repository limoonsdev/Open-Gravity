// Built-in provider presets. A configured provider is created from one of
// these and can then be customised (base URL, keys, models, headers...).
// Any endpoint speaking the OpenAI, Anthropic, Gemini or Responses protocol
// works through the "custom" presets even if it is not listed here.
import type { UpstreamFormat } from '../translate';

export type ProviderFormat = UpstreamFormat | 'antigravity';
/** How the API key is sent. 'custom' uses ProviderConfig.authHeader / authPrefix. */
export type AuthStyle = 'bearer' | 'anthropic' | 'anthropic-compat' | 'goog' | 'api-key' | 'custom' | 'none';
export type ToolMode = 'auto' | 'native' | 'emulate';
export type Category = 'popular' | 'cloud' | 'gateway' | 'china' | 'local' | 'custom';

export interface ProviderFlags {
  /** Body field used for the output token limit (OpenAI format). */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Send reasoning_effort: 'models' = only for models that look like reasoning models. */
  reasoningEffort?: 'models' | 'always' | 'never';
  openrouterReasoning?: boolean;
  echoReasoning?: boolean;
  streamOptions?: boolean;
  toolIdStyle?: 'mistral';
  autoCache?: boolean;
  /** Drop temperature/top_p for reasoning models (OpenAI o-series / gpt-5). */
  stripSamplingForReasoning?: boolean;
  /** Gemini: use "{base}/models/..." as-is (Vertex) instead of adding /v1beta. */
  geminiRawPath?: boolean;
  /** Native autocomplete endpoint for FIM requests ('none' = always use chat). */
  fim?: 'mistral' | 'deepseek' | 'completions' | 'completions-suffix' | 'infill' | 'none';
}

export interface UrlVar {
  name: string;
  label: string;
  placeholder?: string;
}

export interface ProviderTemplate {
  type: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  auth: AuthStyle;
  category: Category;
  description: string;
  keyUrl?: string;
  keyOptional?: boolean;
  freeTier?: boolean;
  models: string[];
  headers?: Record<string, string>;
  flags?: ProviderFlags;
  /** How to list models: 'openai' (GET /models), 'anthropic', 'gemini', or none. */
  modelsApi?: 'openai' | 'anthropic' | 'gemini' | 'none';
  color: string;
  /** Placeholders like {resource} in baseUrl that the user fills in. */
  vars?: UrlVar[];
  toolMode?: ToolMode;
  authHeader?: string;
  authPrefix?: string;
}

export const REASONING_MODEL_RE = /(^|\/)(o[1-9](-mini|-pro)?|gpt-5|codex)/i;

type Extra = Partial<ProviderTemplate>;

function p(type: string, name: string, format: ProviderFormat, baseUrl: string, category: Category, description: string, color: string, extra: Extra = {}): ProviderTemplate {
  const auth: AuthStyle = format === 'anthropic' ? 'anthropic-compat' : format === 'gemini' ? 'goog' : 'bearer';
  const modelsApi = format === 'anthropic' ? 'anthropic' : format === 'gemini' ? 'gemini' : 'openai';
  return { type, name, format, baseUrl, auth, category, description, color, models: [], modelsApi, ...extra };
}
const oai = (type: string, name: string, baseUrl: string, category: Category, description: string, color: string, extra: Extra = {}) =>
  p(type, name, 'openai', baseUrl, category, description, color, extra);
const local = (type: string, name: string, baseUrl: string, description: string, color = '#475569', extra: Extra = {}) =>
  oai(type, name, baseUrl, 'local', description, color, { keyOptional: true, ...extra });

export const CATALOG: ProviderTemplate[] = [
  // ------------------------------------------------------------- popular
  oai('openai', 'OpenAI', 'https://api.openai.com/v1', 'popular', 'GPT-5, GPT-4.1 and o-series via Chat Completions.', '#10a37f', {
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    flags: { maxTokensField: 'max_completion_tokens', reasoningEffort: 'models', stripSamplingForReasoning: true },
  }),
  p('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com', 'popular', 'Claude via the native Messages API (prompt caching, thinking).', '#d97757', {
    auth: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5', 'claude-opus-4-1'],
    flags: { autoCache: true },
  }),
  p('gemini', 'Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com', 'popular', 'Gemini via Google AI Studio. Generous free tier.', '#4285f4', {
    freeTier: true, keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview', 'gemini-3-flash-preview'],
  }),
  oai('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'popular', '400+ models behind one key, including free models.', '#6467f2', {
    freeTier: true, keyUrl: 'https://openrouter.ai/keys',
    headers: { 'HTTP-Referer': 'https://github.com/limoonsdev/Open-Gravity', 'X-Title': 'Open Gravity' },
    models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat-v3.1', 'z-ai/glm-4.6', 'moonshotai/kimi-k2', 'qwen/qwen3-coder'],
    flags: { openrouterReasoning: true },
  }),
  oai('groq', 'Groq', 'https://api.groq.com/openai/v1', 'popular', 'Ultra-fast inference (LPU). Free tier.', '#f55036', {
    freeTier: true, keyUrl: 'https://console.groq.com/keys',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'],
  }),
  oai('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'popular', 'DeepSeek V3 chat and reasoner at very low prices.', '#4d6bfe', {
    keyUrl: 'https://platform.deepseek.com/api_keys', models: ['deepseek-chat', 'deepseek-reasoner'], flags: { echoReasoning: true },
  }),
  oai('xai', 'xAI Grok', 'https://api.x.ai/v1', 'popular', 'Grok 4 and grok-code-fast.', '#111111', {
    keyUrl: 'https://console.x.ai', models: ['grok-4', 'grok-code-fast-1', 'grok-3-mini'],
  }),
  oai('mistral', 'Mistral AI', 'https://api.mistral.ai/v1', 'popular', 'Mistral Large, Medium, Devstral.', '#fa520f', {
    freeTier: true, keyUrl: 'https://console.mistral.ai/api-keys',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'devstral-medium-latest', 'mistral-small-latest', 'magistral-medium-latest'],
    flags: { toolIdStyle: 'mistral', streamOptions: false },
  }),

  // --------------------------------------------------------------- cloud
  oai('azure-openai', 'Azure OpenAI / AI Foundry', 'https://{resource}.openai.azure.com/openai/v1', 'cloud', 'Your Azure deployments (v1 API). Use the deployment name as the model.', '#0078d4', {
    auth: 'api-key', vars: [{ name: 'resource', label: 'Azure resource name', placeholder: 'my-openai-resource' }],
    keyUrl: 'https://portal.azure.com', flags: { maxTokensField: 'max_completion_tokens', reasoningEffort: 'models', stripSamplingForReasoning: true },
  }),
  oai('bedrock-openai', 'Amazon Bedrock (OpenAI-compatible)', 'https://bedrock-runtime.{region}.amazonaws.com/openai/v1', 'cloud', 'Bedrock models through the OpenAI-compatible endpoint with a Bedrock API key.', '#ff9900', {
    vars: [{ name: 'region', label: 'AWS region', placeholder: 'us-west-2' }], keyUrl: 'https://console.aws.amazon.com/bedrock', models: ['openai.gpt-oss-120b-1:0', 'openai.gpt-oss-20b-1:0'], modelsApi: 'none',
  }),
  p('vertex-express', 'Google Vertex AI (express mode)', 'gemini', 'https://aiplatform.googleapis.com/v1/publishers/google', 'cloud', 'Gemini on Vertex AI with an express-mode API key.', '#34a853', {
    keyUrl: 'https://console.cloud.google.com/vertex-ai', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], modelsApi: 'none', flags: { geminiRawPath: true },
  }),
  oai('cloudflare', 'Cloudflare Workers AI', 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', 'cloud', 'Open models at the edge. Free daily allocation.', '#f38020', {
    freeTier: true, vars: [{ name: 'account_id', label: 'Cloudflare account ID', placeholder: '0123456789abcdef...' }], keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    models: ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'], modelsApi: 'none',
  }),
  oai('databricks', 'Databricks', 'https://{workspace}/serving-endpoints', 'cloud', 'Databricks Foundation Model APIs and serving endpoints.', '#ff3621', {
    vars: [{ name: 'workspace', label: 'Workspace host', placeholder: 'adb-123456.7.azuredatabricks.net' }], models: ['databricks-claude-sonnet-4-5', 'databricks-meta-llama-3-3-70b-instruct', 'databricks-gpt-oss-120b'], modelsApi: 'none',
  }),
  oai('cohere', 'Cohere', 'https://api.cohere.ai/compatibility/v1', 'cloud', 'Command A and Command R (compatibility API).', '#39594d', {
    keyUrl: 'https://dashboard.cohere.com/api-keys', freeTier: true, models: ['command-a-03-2025', 'command-a-reasoning-08-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024'], modelsApi: 'none', flags: { streamOptions: false },
  }),
  oai('ai21', 'AI21 Labs', 'https://api.ai21.com/studio/v1', 'cloud', 'Jamba long-context models.', '#6f42c1', { keyUrl: 'https://studio.ai21.com/account/api-key', models: ['jamba-large', 'jamba-mini'], modelsApi: 'none' }),
  oai('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', 'cloud', 'Wafer-scale fast inference. Free tier.', '#f15a29', {
    freeTier: true, keyUrl: 'https://cloud.cerebras.ai', models: ['gpt-oss-120b', 'qwen-3-coder-480b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507'],
  }),
  oai('sambanova', 'SambaNova', 'https://api.sambanova.ai/v1', 'cloud', 'Fast inference on RDUs. Free tier.', '#ee7624', {
    freeTier: true, keyUrl: 'https://cloud.sambanova.ai/apis', models: ['DeepSeek-V3.1', 'Meta-Llama-3.3-70B-Instruct', 'Qwen3-32B', 'gpt-oss-120b'],
  }),
  oai('together', 'Together AI', 'https://api.together.xyz/v1', 'cloud', 'Open models at scale.', '#0f6fff', {
    keyUrl: 'https://api.together.ai/settings/api-keys', models: ['moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', 'deepseek-ai/DeepSeek-V3.1', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  }),
  oai('fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1', 'cloud', 'Fast open-model inference.', '#6720ff', {
    keyUrl: 'https://fireworks.ai/account/api-keys', models: ['accounts/fireworks/models/kimi-k2-instruct-0905', 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct', 'accounts/fireworks/models/deepseek-v3p1', 'accounts/fireworks/models/glm-4p6'],
  }),
  oai('deepinfra', 'DeepInfra', 'https://api.deepinfra.com/v1/openai', 'cloud', 'Cheap open-model hosting.', '#3b82f6', {
    keyUrl: 'https://deepinfra.com/dash/api_keys', models: ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'moonshotai/Kimi-K2-Instruct-0905', 'deepseek-ai/DeepSeek-V3.1', 'zai-org/GLM-4.6'],
  }),
  oai('nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'cloud', 'Hosted NIM endpoints. Free credits.', '#76b900', {
    freeTier: true, keyUrl: 'https://build.nvidia.com', models: ['moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-coder-480b-a35b-instruct', 'deepseek-ai/deepseek-v3.1', 'meta/llama-3.3-70b-instruct'],
  }),
  oai('huggingface', 'Hugging Face', 'https://router.huggingface.co/v1', 'cloud', 'Inference Providers router.', '#ffae00', {
    freeTier: true, keyUrl: 'https://huggingface.co/settings/tokens', models: ['openai/gpt-oss-120b', 'moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.1'],
  }),
  oai('github', 'GitHub Models', 'https://models.github.ai/inference', 'cloud', 'Free rate-limited models with a GitHub token (models:read).', '#24292f', {
    freeTier: true, keyUrl: 'https://github.com/settings/personal-access-tokens', modelsApi: 'none',
    models: ['openai/gpt-4.1', 'openai/gpt-4o', 'openai/gpt-4.1-mini', 'meta/Llama-3.3-70B-Instruct', 'deepseek/DeepSeek-V3-0324'],
  }),
  oai('perplexity', 'Perplexity', 'https://api.perplexity.ai', 'cloud', 'Sonar models with live web search.', '#20808d', {
    keyUrl: 'https://www.perplexity.ai/settings/api', models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'], modelsApi: 'none', flags: { streamOptions: false },
  }),
  oai('nebius', 'Nebius AI Studio', 'https://api.studio.nebius.com/v1', 'cloud', 'Open models hosted in the EU.', '#052b42', { keyUrl: 'https://studio.nebius.com', models: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'openai/gpt-oss-120b'] }),
  oai('novita', 'Novita AI', 'https://api.novita.ai/openai', 'cloud', 'Low-cost serverless open models.', '#23d57c', { keyUrl: 'https://novita.ai/settings/key-management', models: ['deepseek/deepseek-v3.1', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-coder-480b-a35b-instruct'] }),
  oai('hyperbolic', 'Hyperbolic', 'https://api.hyperbolic.xyz/v1', 'cloud', 'Affordable GPU inference.', '#5b21b6', { keyUrl: 'https://app.hyperbolic.xyz/settings', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'] }),
  oai('featherless', 'Featherless', 'https://api.featherless.ai/v1', 'cloud', 'Thousands of Hugging Face models, flat price.', '#e11d48', { keyUrl: 'https://featherless.ai/account/api-keys', models: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/Meta-Llama-3.1-8B-Instruct'] }),
  oai('baseten', 'Baseten', 'https://inference.baseten.co/v1', 'cloud', 'Baseten Model APIs.', '#1f2937', { keyUrl: 'https://app.baseten.co/settings/api_keys', models: ['moonshotai/Kimi-K2-Instruct-0905', 'deepseek-ai/DeepSeek-V3.1', 'openai/gpt-oss-120b'] }),
  oai('friendli', 'FriendliAI', 'https://api.friendli.ai/serverless/v1', 'cloud', 'Friendli serverless endpoints.', '#2563eb', { keyUrl: 'https://friendli.ai/suite', models: ['meta-llama-3.3-70b-instruct', 'deepseek-r1'] }),
  oai('parasail', 'Parasail', 'https://api.parasail.io/v1', 'cloud', 'Serverless open-model inference.', '#0ea5e9', { models: ['parasail-deepseek-r1', 'parasail-llama-33-70b-fp8'] }),
  oai('nscale', 'Nscale', 'https://inference.api.nscale.com/v1', 'cloud', 'European serverless inference.', '#111827', { models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-235B-A22B'] }),
  oai('scaleway', 'Scaleway Generative APIs', 'https://api.scaleway.ai/v1', 'cloud', 'EU-hosted open models. First million tokens free.', '#4f0599', { freeTier: true, keyUrl: 'https://console.scaleway.com/iam/api-keys', models: ['gpt-oss-120b', 'qwen3-coder-30b-a3b-instruct', 'llama-3.3-70b-instruct', 'mistral-small-3.2-24b-instruct-2506'] }),
  oai('ovhcloud', 'OVHcloud AI Endpoints', 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', 'cloud', 'EU sovereign AI endpoints. Works without a key at a low rate limit.', '#000e9c', { freeTier: true, keyOptional: true, keyUrl: 'https://endpoints.ai.cloud.ovh.net', models: ['gpt-oss-120b', 'Meta-Llama-3_3-70B-Instruct', 'Qwen3-32B'] }),
  oai('ionos', 'IONOS AI Model Hub', 'https://openai.inference.de-txl.ionos.com/v1', 'cloud', 'German-hosted open models.', '#003d8f', { models: ['meta-llama/Llama-3.3-70B-Instruct', 'mistralai/Mistral-Small-24B-Instruct'] }),
  oai('upstage', 'Upstage', 'https://api.upstage.ai/v1', 'cloud', 'Solar models.', '#8b5cf6', { keyUrl: 'https://console.upstage.ai/api-keys', models: ['solar-pro2', 'solar-mini'] }),
  oai('reka', 'Reka', 'https://api.reka.ai/v1', 'cloud', 'Reka Core and Flash.', '#ef4444', { models: ['reka-core', 'reka-flash'], modelsApi: 'none' }),
  oai('inception', 'Inception Labs', 'https://api.inceptionlabs.ai/v1', 'cloud', 'Mercury diffusion LLMs (very fast).', '#0f766e', { models: ['mercury-coder', 'mercury'] }),
  oai('nous', 'Nous Research', 'https://inference-api.nousresearch.com/v1', 'cloud', 'Hermes models.', '#b91c1c', { models: ['Hermes-4-405B', 'Hermes-4-70B'] }),
  oai('morph', 'Morph', 'https://api.morphllm.com/v1', 'cloud', 'Fast apply / code editing models.', '#7c3aed', { models: ['morph-v3-large', 'morph-v3-fast'], modelsApi: 'none' }),
  oai('kluster', 'kluster.ai', 'https://api.kluster.ai/v1', 'cloud', 'Scalable open-model inference.', '#16a34a', { models: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-235B-A22B-FP8'] }),
  oai('inference-net', 'Inference.net', 'https://api.inference.net/v1', 'cloud', 'Low-cost open-model inference.', '#0284c7', { models: ['meta-llama/llama-3.3-70b-instruct/fp-8', 'deepseek/deepseek-r1/fp-8'] }),
  oai('chutes', 'Chutes', 'https://llm.chutes.ai/v1', 'cloud', 'Decentralised inference (Bittensor).', '#111827', { models: ['deepseek-ai/DeepSeek-V3.1', 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', 'moonshotai/Kimi-K2-Instruct-0905'] }),
  oai('venice', 'Venice AI', 'https://api.venice.ai/api/v1', 'cloud', 'Private, uncensored inference.', '#b45309', { keyUrl: 'https://venice.ai/settings/api', models: ['venice-uncensored', 'qwen3-235b', 'llama-3.3-70b'] }),
  oai('openai-eu', 'OpenAI (EU data residency)', 'https://eu.api.openai.com/v1', 'cloud', 'OpenAI with European data residency.', '#10a37f', {
    keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], flags: { maxTokensField: 'max_completion_tokens', reasoningEffort: 'models', stripSamplingForReasoning: true },
  }),
  oai('wandb', 'W&B Inference', 'https://api.inference.wandb.ai/v1', 'cloud', 'Weights & Biases hosted open models.', '#ffbe00', { models: ['deepseek-ai/DeepSeek-V3.1', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'moonshotai/Kimi-K2-Instruct'] }),
  oai('gmi', 'GMI Cloud', 'https://api.gmi-serving.com/v1', 'cloud', 'GPU cloud inference.', '#0f172a', { models: ['deepseek-ai/DeepSeek-V3.1', 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8'] }),
  oai('ollama-cloud', 'Ollama Cloud', 'https://ollama.com/v1', 'cloud', 'Ollama cloud models with an ollama.com API key. Free usage tier.', '#444444', { freeTier: true, keyUrl: 'https://ollama.com/settings/keys', models: ['gpt-oss:120b', 'qwen3-coder:480b', 'deepseek-v3.1:671b'] }),
  oai('sarvam', 'Sarvam AI', 'https://api.sarvam.ai/v1', 'cloud', 'Indic-language models.', '#f97316', { auth: 'custom', authHeader: 'api-subscription-key', authPrefix: '', modelsApi: 'none', models: ['sarvam-m'] }),
  oai('codestral', 'Mistral Codestral', 'https://codestral.mistral.ai/v1', 'cloud', 'Codestral endpoint (separate key).', '#fa520f', { models: ['codestral-latest'], flags: { toolIdStyle: 'mistral', streamOptions: false } }),
  oai('zai', 'Z.ai GLM', 'https://api.z.ai/api/paas/v4', 'cloud', 'GLM models (OpenAI-compatible endpoint).', '#2d5bff', {
    freeTier: true, keyUrl: 'https://z.ai/manage-apikey/apikey-list', modelsApi: 'none', models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'],
  }),
  p('zai-coding', 'Z.ai GLM Coding Plan', 'anthropic', 'https://api.z.ai/api/anthropic', 'cloud', 'GLM Coding Plan subscription (Anthropic-compatible endpoint).', '#2d5bff', {
    keyUrl: 'https://z.ai/manage-apikey/apikey-list', modelsApi: 'none', models: ['glm-4.6', 'glm-4.5-air'],
  }),
  oai('zai-coding-openai', 'Z.ai GLM Coding Plan (OpenAI API)', 'https://api.z.ai/api/coding/paas/v4', 'cloud', 'GLM Coding Plan through the OpenAI-compatible endpoint.', '#2d5bff', { modelsApi: 'none', models: ['glm-4.6', 'glm-4.5-air'] }),
  oai('moonshot', 'Moonshot Kimi', 'https://api.moonshot.ai/v1', 'cloud', 'Kimi K2 models.', '#000000', {
    keyUrl: 'https://platform.moonshot.ai/console/api-keys', models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking'],
  }),
  p('moonshot-anthropic', 'Moonshot Kimi (Anthropic API)', 'anthropic', 'https://api.moonshot.ai/anthropic', 'cloud', 'Kimi K2 through its Anthropic-compatible endpoint (for Claude Code).', '#000000', {
    keyUrl: 'https://platform.moonshot.ai/console/api-keys', modelsApi: 'none', models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
  }),
  p('deepseek-anthropic', 'DeepSeek (Anthropic API)', 'anthropic', 'https://api.deepseek.com/anthropic', 'cloud', 'DeepSeek through its Anthropic-compatible endpoint.', '#4d6bfe', {
    keyUrl: 'https://platform.deepseek.com/api_keys', modelsApi: 'none', models: ['deepseek-chat', 'deepseek-reasoner'],
  }),
  p('minimax', 'MiniMax', 'anthropic', 'https://api.minimax.io/anthropic', 'cloud', 'MiniMax M2 agentic coding model (Anthropic-compatible).', '#e2167e', {
    keyUrl: 'https://www.minimax.io/platform', modelsApi: 'none', models: ['MiniMax-M2'],
  }),
  oai('minimax-openai', 'MiniMax (OpenAI API)', 'https://api.minimax.io/v1', 'cloud', 'MiniMax through its OpenAI-compatible endpoint.', '#e2167e', { modelsApi: 'none', models: ['MiniMax-M2'] }),
  oai('qwen', 'Alibaba Qwen (DashScope)', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'cloud', 'Qwen3 Coder, Qwen Max/Plus (international).', '#615ced', {
    keyUrl: 'https://modelstudio.console.alibabacloud.com', models: ['qwen3-coder-plus', 'qwen3-max', 'qwen-plus', 'qwen-flash'],
  }),
  oai('openai-responses', 'OpenAI (Responses API)', 'https://api.openai.com/v1', 'cloud', 'Responses-only models like gpt-5-codex and o3-pro.', '#10a37f', {
    format: 'responses', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-5-codex', 'gpt-5', 'o3-pro', 'gpt-5-mini'], flags: { stripSamplingForReasoning: true },
  }),

  // ------------------------------------------------------------ gateways
  oai('vercel', 'Vercel AI Gateway', 'https://ai-gateway.vercel.sh/v1', 'gateway', 'Hundreds of models behind one key. Free monthly credits.', '#000000', {
    freeTier: true, keyUrl: 'https://vercel.com/dashboard', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'xai/grok-code-fast-1'],
  }),
  oai('requesty', 'Requesty', 'https://router.requesty.ai/v1', 'gateway', 'LLM router with caching and fallbacks.', '#2563eb', { models: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5', 'google/gemini-2.5-pro'] }),
  oai('aihubmix', 'AIHubMix', 'https://aihubmix.com/v1', 'gateway', 'Multi-vendor model hub.', '#0891b2', { models: ['gpt-5', 'claude-sonnet-4-5', 'gemini-2.5-pro'] }),
  oai('aimlapi', 'AI/ML API', 'https://api.aimlapi.com/v1', 'gateway', '300+ models behind one key.', '#7c3aed', { models: ['gpt-4o', 'claude-3-5-sonnet-20241022', 'deepseek-chat'] }),
  oai('poe', 'Poe', 'https://api.poe.com/v1', 'gateway', 'Poe bots and models via an OpenAI-compatible API.', '#5d5cde', { keyUrl: 'https://poe.com/api_key', models: ['Claude-Sonnet-4.5', 'GPT-5', 'Gemini-2.5-Pro'] }),
  oai('opencode-zen', 'OpenCode Zen', 'https://opencode.ai/zen/v1', 'gateway', 'Curated coding models from the OpenCode team.', '#18181b', { models: ['qwen3-coder', 'kimi-k2', 'gpt-5', 'claude-sonnet-4-5'] }),
  oai('portkey', 'Portkey', 'https://api.portkey.ai/v1', 'gateway', 'Portkey AI gateway (add your x-portkey-provider / virtual key header).', '#111827', { auth: 'custom', authHeader: 'x-portkey-api-key', authPrefix: '' }),
  oai('pollinations', 'Pollinations', 'https://text.pollinations.ai/openai', 'gateway', 'Free public API, no sign-up (shared and rate-limited).', '#0a0a0a', {
    freeTier: true, keyOptional: true, keyUrl: 'https://auth.pollinations.ai', modelsApi: 'none', models: ['openai', 'openai-fast', 'mistral', 'qwen-coder'], flags: { streamOptions: false },
  }),
  oai('llm7', 'LLM7.io', 'https://api.llm7.io/v1', 'gateway', 'Free public API; works without a key, a free token raises the limits.', '#0ea5e9', {
    freeTier: true, keyOptional: true, keyUrl: 'https://token.llm7.io',
  }),
  oai('litellm', 'LiteLLM proxy', 'http://127.0.0.1:4000/v1', 'gateway', 'A LiteLLM proxy you run (100+ providers behind it).', '#0f172a', { keyOptional: true }),

  // --------------------------------------------------------------- china
  oai('qwen-china', 'Alibaba Bailian (China)', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'china', 'Qwen models, mainland China endpoint.', '#615ced', { models: ['qwen3-coder-plus', 'qwen3-max', 'qwen-plus'] }),
  oai('zai-china', 'Zhipu BigModel (China)', 'https://open.bigmodel.cn/api/paas/v4', 'china', 'GLM models, mainland China endpoint. Free Flash models.', '#2d5bff', { freeTier: true, modelsApi: 'none', models: ['glm-4.6', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4-flash'] }),
  oai('moonshot-china', 'Moonshot Kimi (China)', 'https://api.moonshot.cn/v1', 'china', 'Kimi, mainland China endpoint.', '#000000', { models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview'] }),
  oai('volcengine', 'Volcengine Ark (Doubao)', 'https://ark.cn-beijing.volces.com/api/v3', 'china', 'ByteDance Doubao and hosted models.', '#1664ff', { modelsApi: 'none', models: ['doubao-seed-1-6-250615', 'deepseek-v3-1-250821', 'kimi-k2-250905'] }),
  oai('qianfan', 'Baidu Qianfan', 'https://qianfan.baidubce.com/v2', 'china', 'ERNIE and hosted models (OpenAI-compatible v2 API). Free Speed/Lite models.', '#2932e1', { freeTier: true, modelsApi: 'none', models: ['ernie-4.5-turbo-128k', 'ernie-x1-turbo-32k', 'deepseek-v3', 'ernie-speed-128k', 'ernie-lite-8k'] }),
  oai('hunyuan', 'Tencent Hunyuan', 'https://api.hunyuan.cloud.tencent.com/v1', 'china', 'Hunyuan models. hunyuan-lite is free.', '#0052d9', { freeTier: true, modelsApi: 'none', models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'] }),
  oai('spark', 'iFlytek Spark', 'https://spark-api-open.xf-yun.com/v1', 'china', 'Spark models (key format: APIKey:APISecret). Spark Lite is free.', '#1d4ed8', { freeTier: true, modelsApi: 'none', models: ['4.0Ultra', 'generalv3.5', 'lite'] }),
  oai('stepfun', 'StepFun', 'https://api.stepfun.com/v1', 'china', 'Step models.', '#0f172a', { models: ['step-2-16k', 'step-1-8k'] }),
  oai('baichuan', 'Baichuan', 'https://api.baichuan-ai.com/v1', 'china', 'Baichuan models.', '#f97316', { modelsApi: 'none', models: ['Baichuan4-Turbo', 'Baichuan4-Air'] }),
  oai('yi', '01.AI Yi', 'https://api.lingyiwanwu.com/v1', 'china', 'Yi models.', '#16a34a', { models: ['yi-lightning'] }),
  oai('siliconflow', 'SiliconFlow', 'https://api.siliconflow.com/v1', 'china', 'Open models, international endpoint. Free models.', '#7c3aed', { freeTier: true, models: ['deepseek-ai/DeepSeek-V3.1', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'moonshotai/Kimi-K2-Instruct-0905'] }),
  oai('siliconflow-china', 'SiliconFlow (China)', 'https://api.siliconflow.cn/v1', 'china', 'Open models, mainland China endpoint.', '#7c3aed', { freeTier: true, models: ['deepseek-ai/DeepSeek-V3.1', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'] }),
  oai('modelscope', 'ModelScope', 'https://api-inference.modelscope.cn/v1', 'china', 'ModelScope API inference. Free daily quota.', '#624aff', { freeTier: true, models: ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.1'] }),

  // --------------------------------------------------------------- local
  local('ollama', 'Ollama', 'http://127.0.0.1:11434/v1', 'Local models served by Ollama.', '#444444'),
  local('lmstudio', 'LM Studio', 'http://127.0.0.1:1234/v1', 'Local models served by LM Studio.', '#4f46e5'),
  local('llamacpp', 'llama.cpp server', 'http://127.0.0.1:8080/v1', 'llama-server from llama.cpp.'),
  local('vllm', 'vLLM', 'http://127.0.0.1:8000/v1', 'vLLM OpenAI-compatible server.'),
  local('sglang', 'SGLang', 'http://127.0.0.1:30000/v1', 'SGLang server.'),
  local('tgi', 'Hugging Face TGI', 'http://127.0.0.1:8080/v1', 'Text Generation Inference (Messages API).'),
  local('localai', 'LocalAI', 'http://127.0.0.1:8080/v1', 'LocalAI server.'),
  local('jan', 'Jan', 'http://127.0.0.1:1337/v1', 'Jan desktop app local server.'),
  local('koboldcpp', 'KoboldCpp', 'http://127.0.0.1:5001/v1', 'KoboldCpp OpenAI-compatible API.'),
  local('textgen-webui', 'text-generation-webui', 'http://127.0.0.1:5000/v1', 'oobabooga text-generation-webui API.'),
  local('xinference', 'Xinference', 'http://127.0.0.1:9997/v1', 'Xorbits Inference server.'),
  local('gpt4all', 'GPT4All', 'http://127.0.0.1:4891/v1', 'GPT4All local API server.'),
  local('lemonade', 'Lemonade Server', 'http://127.0.0.1:8000/api/v1', 'AMD Lemonade local server.'),
  local('docker-model-runner', 'Docker Model Runner', 'http://127.0.0.1:12434/engines/v1', 'Docker Desktop Model Runner.'),
  local('mlx', 'MLX LM (Apple)', 'http://127.0.0.1:8080/v1', 'mlx_lm.server on Apple silicon.'),
  local('llamafile', 'llamafile', 'http://127.0.0.1:8080/v1', 'Mozilla llamafile server.'),
  local('msty', 'Msty', 'http://127.0.0.1:10000/v1', 'Msty local AI server.'),
  p('antigravity', 'Antigravity (local app)', 'antigravity', 'local', 'local', 'Bridges the Google Antigravity desktop app on this machine. Tools are emulated.', '#3b82f6', {
    auth: 'none', keyOptional: true, modelsApi: 'none', toolMode: 'emulate',
    models: ['gemini-3.7-flash-high', 'gemini-pro-agent', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'],
  }),

  // -------------------------------------------------------------- custom
  oai('openai-compatible', 'Custom (OpenAI-compatible)', 'https://example.com/v1', 'custom', 'Any endpoint implementing /chat/completions (vLLM, LiteLLM, other proxies...).', '#64748b'),
  p('anthropic-compatible', 'Custom (Anthropic-compatible)', 'anthropic', 'https://example.com', 'custom', 'Any endpoint implementing /v1/messages.', '#64748b'),
  p('gemini-compatible', 'Custom (Gemini-compatible)', 'gemini', 'https://example.com', 'custom', 'Any endpoint implementing the Gemini generateContent API.', '#64748b'),
  p('responses-compatible', 'Custom (OpenAI Responses)', 'responses', 'https://example.com/v1', 'custom', 'Any endpoint implementing /responses.', '#64748b', { modelsApi: 'openai' }),
];

export function getTemplate(type: string): ProviderTemplate | undefined {
  return CATALOG.find((t) => t.type === type);
}

export function fillVars(url: string, vars: Record<string, string> | undefined): string {
  return url.replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] ? encodeURI(vars[name].trim()) : m));
}
