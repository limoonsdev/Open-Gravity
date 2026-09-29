// Built-in provider templates. A configured provider is created from one of
// these and can then be customised (base URL, keys, models, headers...).
import type { UpstreamFormat } from '../translate';

export type ProviderFormat = UpstreamFormat | 'antigravity';
export type AuthStyle = 'bearer' | 'anthropic' | 'anthropic-compat' | 'goog' | 'none';

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
}

export interface ProviderTemplate {
  type: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  auth: AuthStyle;
  category: 'popular' | 'more' | 'local' | 'custom';
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
}

export const REASONING_MODEL_RE = /(^|\/)(o[1-9](-mini|-pro)?|gpt-5|codex)/i;

export const CATALOG: ProviderTemplate[] = [
  {
    type: 'openai', name: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', auth: 'bearer', category: 'popular',
    description: 'GPT-5, GPT-4.1, o-series via the Chat Completions API.',
    keyUrl: 'https://platform.openai.com/api-keys', modelsApi: 'openai', color: '#10a37f',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    flags: { maxTokensField: 'max_completion_tokens', reasoningEffort: 'models', stripSamplingForReasoning: true },
  },
  {
    type: 'anthropic', name: 'Anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com', auth: 'anthropic', category: 'popular',
    description: 'Claude models via the native Messages API (prompt caching, thinking).',
    keyUrl: 'https://console.anthropic.com/settings/keys', modelsApi: 'anthropic', color: '#d97757',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5', 'claude-opus-4-1'],
    flags: { autoCache: true },
  },
  {
    type: 'gemini', name: 'Google Gemini', format: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', auth: 'goog', category: 'popular',
    description: 'Gemini via Google AI Studio. Generous free tier.', freeTier: true,
    keyUrl: 'https://aistudio.google.com/apikey', modelsApi: 'gemini', color: '#4285f4',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview', 'gemini-3-flash-preview'],
  },
  {
    type: 'openrouter', name: 'OpenRouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer', category: 'popular',
    description: '300+ models behind one key, including free models.', freeTier: true,
    keyUrl: 'https://openrouter.ai/keys', modelsApi: 'openai', color: '#6467f2',
    headers: { 'HTTP-Referer': 'https://github.com/limoonsdev/Open-Gravity', 'X-Title': 'Open Gravity' },
    models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat-v3.1', 'z-ai/glm-4.6', 'moonshotai/kimi-k2', 'qwen/qwen3-coder'],
    flags: { openrouterReasoning: true },
  },
  {
    type: 'groq', name: 'Groq', format: 'openai', baseUrl: 'https://api.groq.com/openai/v1', auth: 'bearer', category: 'popular',
    description: 'Ultra-fast inference (LPU). Free tier.', freeTier: true,
    keyUrl: 'https://console.groq.com/keys', modelsApi: 'openai', color: '#f55036',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'],
  },
  {
    type: 'deepseek', name: 'DeepSeek', format: 'openai', baseUrl: 'https://api.deepseek.com/v1', auth: 'bearer', category: 'popular',
    description: 'DeepSeek V3 chat and reasoner at very low prices.',
    keyUrl: 'https://platform.deepseek.com/api_keys', modelsApi: 'openai', color: '#4d6bfe',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    flags: { echoReasoning: true },
  },
  {
    type: 'xai', name: 'xAI Grok', format: 'openai', baseUrl: 'https://api.x.ai/v1', auth: 'bearer', category: 'popular',
    description: 'Grok 4 and grok-code-fast.', keyUrl: 'https://console.x.ai', modelsApi: 'openai', color: '#111111',
    models: ['grok-4', 'grok-code-fast-1', 'grok-3-mini'],
  },
  {
    type: 'mistral', name: 'Mistral AI', format: 'openai', baseUrl: 'https://api.mistral.ai/v1', auth: 'bearer', category: 'popular',
    description: 'Mistral Large, Codestral and Devstral.', freeTier: true,
    keyUrl: 'https://console.mistral.ai/api-keys', modelsApi: 'openai', color: '#fa520f',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest', 'devstral-medium-latest', 'mistral-small-latest'],
    flags: { toolIdStyle: 'mistral', streamOptions: false },
  },
  {
    type: 'zai', name: 'Z.ai GLM', format: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', auth: 'bearer', category: 'more',
    description: 'GLM models (OpenAI-compatible endpoint).', keyUrl: 'https://z.ai/manage-apikey/apikey-list', modelsApi: 'none', color: '#2d5bff',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
  },
  {
    type: 'zai-coding', name: 'Z.ai GLM Coding Plan', format: 'anthropic', baseUrl: 'https://api.z.ai/api/anthropic', auth: 'anthropic-compat', category: 'more',
    description: 'GLM Coding Plan subscription (Anthropic-compatible endpoint).', keyUrl: 'https://z.ai/manage-apikey/apikey-list', modelsApi: 'none', color: '#2d5bff',
    models: ['glm-4.6', 'glm-4.5-air'],
  },
  {
    type: 'moonshot', name: 'Moonshot Kimi', format: 'openai', baseUrl: 'https://api.moonshot.ai/v1', auth: 'bearer', category: 'more',
    description: 'Kimi K2 models.', keyUrl: 'https://platform.moonshot.ai/console/api-keys', modelsApi: 'openai', color: '#000000',
    models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking'],
  },
  {
    type: 'minimax', name: 'MiniMax', format: 'anthropic', baseUrl: 'https://api.minimax.io/anthropic', auth: 'anthropic-compat', category: 'more',
    description: 'MiniMax M2 agentic coding model (Anthropic-compatible).', keyUrl: 'https://www.minimax.io/platform', modelsApi: 'none', color: '#e2167e',
    models: ['MiniMax-M2'],
  },
  {
    type: 'qwen', name: 'Alibaba Qwen (DashScope)', format: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', auth: 'bearer', category: 'more',
    description: 'Qwen3 Coder, Qwen Max/Plus.', keyUrl: 'https://modelstudio.console.alibabacloud.com', modelsApi: 'openai', color: '#615ced',
    models: ['qwen3-coder-plus', 'qwen3-max', 'qwen-plus', 'qwen-flash'],
  },
  {
    type: 'cerebras', name: 'Cerebras', format: 'openai', baseUrl: 'https://api.cerebras.ai/v1', auth: 'bearer', category: 'more',
    description: 'Wafer-scale fast inference. Free tier.', freeTier: true,
    keyUrl: 'https://cloud.cerebras.ai', modelsApi: 'openai', color: '#f15a29',
    models: ['gpt-oss-120b', 'qwen-3-coder-480b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507'],
  },
  {
    type: 'together', name: 'Together AI', format: 'openai', baseUrl: 'https://api.together.xyz/v1', auth: 'bearer', category: 'more',
    description: 'Open models at scale.', keyUrl: 'https://api.together.ai/settings/api-keys', modelsApi: 'openai', color: '#0f6fff',
    models: ['moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', 'deepseek-ai/DeepSeek-V3.1', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    type: 'fireworks', name: 'Fireworks AI', format: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', auth: 'bearer', category: 'more',
    description: 'Fast open-model inference.', keyUrl: 'https://fireworks.ai/account/api-keys', modelsApi: 'openai', color: '#6720ff',
    models: ['accounts/fireworks/models/kimi-k2-instruct-0905', 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct', 'accounts/fireworks/models/deepseek-v3p1', 'accounts/fireworks/models/glm-4p6'],
  },
  {
    type: 'nvidia', name: 'NVIDIA NIM', format: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', auth: 'bearer', category: 'more',
    description: 'Hosted NIM endpoints. Free credits.', freeTier: true,
    keyUrl: 'https://build.nvidia.com', modelsApi: 'openai', color: '#76b900',
    models: ['moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-coder-480b-a35b-instruct', 'deepseek-ai/deepseek-v3.1', 'meta/llama-3.3-70b-instruct'],
  },
  {
    type: 'github', name: 'GitHub Models', format: 'openai', baseUrl: 'https://models.github.ai/inference', auth: 'bearer', category: 'more',
    description: 'Free rate-limited models with a GitHub token (models:read).', freeTier: true,
    keyUrl: 'https://github.com/settings/personal-access-tokens', modelsApi: 'none', color: '#24292f',
    models: ['openai/gpt-4.1', 'openai/gpt-4o', 'openai/gpt-4.1-mini', 'meta/Llama-3.3-70B-Instruct', 'deepseek/DeepSeek-V3-0324'],
  },
  {
    type: 'huggingface', name: 'Hugging Face', format: 'openai', baseUrl: 'https://router.huggingface.co/v1', auth: 'bearer', category: 'more',
    description: 'Inference Providers router.', freeTier: true,
    keyUrl: 'https://huggingface.co/settings/tokens', modelsApi: 'openai', color: '#ffae00',
    models: ['openai/gpt-oss-120b', 'moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.1'],
  },
  {
    type: 'vercel', name: 'Vercel AI Gateway', format: 'openai', baseUrl: 'https://ai-gateway.vercel.sh/v1', auth: 'bearer', category: 'more',
    description: 'Vercel AI Gateway (OpenAI-compatible).', keyUrl: 'https://vercel.com/dashboard', modelsApi: 'openai', color: '#000000',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'xai/grok-code-fast-1'],
  },
  {
    type: 'deepinfra', name: 'DeepInfra', format: 'openai', baseUrl: 'https://api.deepinfra.com/v1/openai', auth: 'bearer', category: 'more',
    description: 'Cheap open-model hosting.', keyUrl: 'https://deepinfra.com/dash/api_keys', modelsApi: 'openai', color: '#3b82f6',
    models: ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'moonshotai/Kimi-K2-Instruct-0905', 'deepseek-ai/DeepSeek-V3.1', 'zai-org/GLM-4.6'],
  },
  {
    type: 'perplexity', name: 'Perplexity', format: 'openai', baseUrl: 'https://api.perplexity.ai', auth: 'bearer', category: 'more',
    description: 'Sonar models with live web search.', keyUrl: 'https://www.perplexity.ai/settings/api', modelsApi: 'none', color: '#20808d',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    flags: { streamOptions: false },
  },
  {
    type: 'openai-responses', name: 'OpenAI (Responses API)', format: 'responses', baseUrl: 'https://api.openai.com/v1', auth: 'bearer', category: 'more',
    description: 'Responses-only models like gpt-5-codex and o3-pro.', keyUrl: 'https://platform.openai.com/api-keys', modelsApi: 'openai', color: '#10a37f',
    models: ['gpt-5-codex', 'gpt-5', 'o3-pro', 'gpt-5-mini'],
    flags: { stripSamplingForReasoning: true },
  },
  {
    type: 'ollama', name: 'Ollama', format: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', auth: 'bearer', category: 'local',
    description: 'Local models served by Ollama.', keyOptional: true, modelsApi: 'openai', color: '#444444',
    models: [],
  },
  {
    type: 'lmstudio', name: 'LM Studio', format: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', auth: 'bearer', category: 'local',
    description: 'Local models served by LM Studio.', keyOptional: true, modelsApi: 'openai', color: '#4f46e5',
    models: [],
  },
  {
    type: 'antigravity', name: 'Antigravity (local app)', format: 'antigravity', baseUrl: 'local', auth: 'none', category: 'local',
    description: 'Bridges the Google Antigravity desktop app running on this machine (text only, no tool calls).',
    keyOptional: true, modelsApi: 'none', color: '#3b82f6',
    models: ['gemini-3.7-flash-high', 'gemini-pro-agent', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'],
  },
  {
    type: 'openai-compatible', name: 'Custom (OpenAI-compatible)', format: 'openai', baseUrl: 'https://example.com/v1', auth: 'bearer', category: 'custom',
    description: 'Any endpoint implementing /v1/chat/completions (vLLM, LiteLLM, llama.cpp, other proxies...).', modelsApi: 'openai', color: '#64748b',
    models: [],
  },
  {
    type: 'anthropic-compatible', name: 'Custom (Anthropic-compatible)', format: 'anthropic', baseUrl: 'https://example.com', auth: 'anthropic-compat', category: 'custom',
    description: 'Any endpoint implementing /v1/messages.', modelsApi: 'anthropic', color: '#64748b',
    models: [],
  },
  {
    type: 'gemini-compatible', name: 'Custom (Gemini-compatible)', format: 'gemini', baseUrl: 'https://example.com', auth: 'goog', category: 'custom',
    description: 'Any endpoint implementing the Gemini generateContent API.', modelsApi: 'gemini', color: '#64748b',
    models: [],
  },
];

export function getTemplate(type: string): ProviderTemplate | undefined {
  return CATALOG.find((t) => t.type === type);
}
