// Shapes returned by the router's admin API (/admin/api/*).

export type ToolMode = 'auto' | 'native' | 'emulate';
export type Strategy = 'fallback' | 'round-robin' | 'random' | 'fastest' | 'cheapest' | 'race';
export type FreeKind = 'free-tier' | 'free-models' | 'free-credits' | 'no-key' | 'local';
export type Category = 'popular' | 'cloud' | 'gateway' | 'china' | 'local' | 'custom';
export type AuthStyle = 'bearer' | 'anthropic' | 'anthropic-compat' | 'goog' | 'api-key' | 'custom' | 'none';

export interface FreeInfo {
  kind: FreeKind;
  summary: string;
  limitsUrl?: string;
  models?: string[];
  rank: number;
}

export interface UrlVar {
  name: string;
  label: string;
  placeholder?: string;
}

export interface CatalogEntry {
  type: string;
  name: string;
  format: string;
  baseUrl: string;
  category: Category;
  description: string;
  keyUrl?: string;
  keyOptional?: boolean;
  freeTier?: boolean;
  models: string[];
  color: string;
  vars?: UrlVar[];
  toolMode?: ToolMode;
  free?: FreeInfo;
}

export interface KeyHealth {
  cooldownUntil: number;
  reason?: string;
  lastError?: string;
  lastErrorAt?: number;
  lastStatus?: number;
  lastOkAt?: number;
  modelCooldowns?: Record<string, number>;
}

export interface ProviderKeyView {
  id: string;
  label?: string;
  enabled: boolean;
  masked: string;
  health: KeyHealth;
  stats: { requests: number; errors: number; lastUsed: number; tokens: number };
}

/** [context, maxOutput, tools (1 native / 0 none / -1 unknown), vision, reasoning] */
export type ModelCaps = [number, number, number, number, number];

export interface Provider {
  id: string;
  type: string;
  name: string;
  format: string;
  baseUrl: string;
  auth: AuthStyle;
  keys: ProviderKeyView[];
  models: string[];
  enabled: boolean;
  rotation: 'round-robin' | 'fill-first';
  headers?: Record<string, string>;
  toolMode: ToolMode;
  authHeader?: string;
  authPrefix?: string;
  timeoutMs?: number;
  proxy?: string;
  keyOptional: boolean;
  color: string;
  caps: Record<string, ModelCaps>;
}

export interface Combo {
  id: string;
  description?: string;
  targets: string[];
  strategy: Strategy;
  enabled: boolean;
}

export interface RouterKey {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  masked: string;
}

export interface TokenSaverSettings {
  mode: 'off' | 'safe' | 'balanced' | 'aggressive' | 'custom';
  toolResultMaxTokens: number;
  keepRecentTurns: number;
  dedupeToolResults: boolean;
  compactWhitespace: boolean;
  minifyJson: boolean;
  dropOldImages: boolean;
  dropOldThinking: boolean;
  compactAt: number;
  compactTarget: number;
  summarizer: string;
}

export interface Settings {
  port: number;
  host: string;
  defaultModel: string;
  unknownModelFallback: boolean;
  requireApiKey: boolean;
  openBrowser: boolean;
  headersTimeoutMs: number;
  idleTimeoutMs: number;
  maxAttempts: number;
  cooldownRateLimitMs: number;
  cooldownAuthMs: number;
  cooldownServerMs: number;
  logRetentionDays: number;
  captureBodies: boolean;
  upstreamProxy?: string;
  passthrough: boolean;
  adaptiveCompat: boolean;
  cacheTtlSeconds: number;
  modelDbAutoUpdate: boolean;
  tokenSaver: TokenSaverSettings;
  onboarded: boolean;
  passwordSet: boolean;
}

export interface CompatFix {
  emulateTools?: boolean;
  mergeSystem?: boolean;
  stripImages?: boolean;
  noReasoning?: boolean;
  noResponseFormat?: boolean;
  noStreamOptions?: boolean;
  maxTokensField?: string;
  maxTokensCap?: number;
  contextWindow?: number;
  noNativeFim?: boolean;
  dropParams?: string[];
  reasons?: string[];
  learnedAt?: number;
}

export interface AppState {
  version: string;
  dataDir: string;
  baseUrl: string;
  listening: { host: string; port: number };
  startedAt: number;
  platform: string;
  settings: Settings;
  effectiveDefault: string;
  providers: Provider[];
  combos: Combo[];
  aliases: Record<string, string>;
  apiKeys: RouterKey[];
  catalog: CatalogEntry[];
  models: Array<{ id: string; owned_by: string; kind: 'combo' | 'model' | 'alias' }>;
  compat: Record<string, CompatFix>;
  latencies: Record<string, number>;
  modelDb: { source: string; updated: string; models: number; providers: number };
  cacheSize: number;
}

export interface Attempt {
  provider: string;
  model: string;
  keyId?: string;
  status?: number;
  error?: string;
  ms: number;
}

export interface UsageRecord {
  id: string;
  ts: number;
  endpoint: string;
  requestedModel: string;
  provider?: string;
  model?: string;
  keyId?: string;
  combo?: string;
  apiKeyId?: string;
  status: number;
  ok: boolean;
  error?: string;
  latencyMs: number;
  ttftMs?: number;
  stream: boolean;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  cost: number;
  estimated?: boolean;
  attempts: Attempt[];
  client?: string;
  clientId?: string;
  ua?: string;
  saved?: number;
  savedCost?: number;
  saverActions?: string[];
  emulatedTools?: boolean;
  adapted?: string[];
  cached?: boolean;
}

export type Range = '1h' | '24h' | '7d' | '30d';

export interface SeriesPoint {
  t: number;
  requests: number;
  errors: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  saved: number;
}

export interface GroupStats {
  key: string;
  label: string;
  requests: number;
  errors: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  saved: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastAt: number;
}

export interface Analytics {
  range: Range;
  from: number;
  to: number;
  bucketMs: number;
  totals: {
    requests: number; ok: number; errors: number; successRate: number; input: number; output: number; cacheRead: number; cacheWrite: number;
    reasoning: number; tokens: number; cost: number; saved: number; savedCost: number; fallbacks: number; emulated: number; adapted: number; cached: number;
    avgLatencyMs: number; p50LatencyMs: number; p95LatencyMs: number; avgTtftMs: number; p50TtftMs: number; p95TtftMs: number;
    promptCacheRatio: number; outputTokensPerSec: number;
  };
  series: SeriesPoint[];
  byModel: GroupStats[];
  byProvider: GroupStats[];
  byKey: GroupStats[];
  byClient: GroupStats[];
  byApiKey: GroupStats[];
  byEndpoint: GroupStats[];
  byCombo: GroupStats[];
  statuses: Array<{ status: number; count: number }>;
  topErrors: Array<{ message: string; count: number; lastAt: number }>;
  heatmap: number[][];
  savings: { tokens: number; cost: number; requests: number; byAction: Array<{ action: string; count: number }> };
  projection: {
    todayCost: number; todayTokens: number; todayRequests: number; monthToDateCost: number; monthToDateTokens: number;
    projectedMonthCost: number; avgDailyCost7d: number; avgDailyTokens7d: number; savedCostMonthToDate: number;
  };
}

export interface RateBucket {
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

export interface QuotaSnapshot {
  provider: string;
  providerName: string;
  keyId: string;
  keyLabel: string;
  model?: string;
  at: number;
  buckets: Record<string, RateBucket>;
}

export type LimitScope = 'global' | 'provider' | 'key' | 'model' | 'apikey' | 'client';
export type LimitPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface LimitRule {
  id: string;
  name?: string;
  scope: LimitScope;
  target: string;
  period: LimitPeriod;
  maxRequests?: number;
  maxTokens?: number;
  maxCost?: number;
  action: 'block' | 'warn';
  enabled: boolean;
}

export interface LimitStatus {
  rule: LimitRule;
  windowStart: number;
  windowEnd: number;
  requests: number;
  tokens: number;
  cost: number;
  ratio: number;
  exceeded: boolean;
}

export interface QuotaAlert {
  at: number;
  ruleId: string;
  level: 'warning' | 'exceeded';
  message: string;
}

export interface QuotaView {
  snapshots: QuotaSnapshot[];
  limits: LimitStatus[];
  /** Every rule, including disabled ones. */
  rules: LimitRule[];
  alerts: QuotaAlert[];
  balanceProviders: string[];
}

export interface Balance {
  provider: string;
  keyId: string;
  keyLabel: string;
  ok: boolean;
  currency?: string;
  remaining?: number;
  limit?: number;
  used?: number;
  freeTier?: boolean;
  note?: string;
  error?: string;
  at: number;
}

export interface FreeOffer {
  type: string;
  name: string;
  category: Category;
  color: string;
  description: string;
  keyUrl?: string;
  keyOptional: boolean;
  vars?: UrlVar[];
  free: FreeInfo;
  configured: Array<{ id: string; enabled: boolean; keys: number }>;
}

export interface FreeModel {
  id: string;
  name: string;
  context: number;
  tools: boolean;
  reasoning: boolean;
}

export interface FreeView {
  offers: FreeOffer[];
  openrouter?: { models: FreeModel[]; updatedAt?: number; error?: string };
  count: number;
}

export type ToolCategory = 'cli' | 'ide' | 'chat' | 'framework' | 'universal';

export interface ToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  docs?: string;
  description: string;
  detected: boolean;
  canApply: boolean;
  applied: boolean;
  files: string[];
  snippet: string;
  snippetLang: string;
  notes?: string;
  hasBackup: boolean;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: 'debug' | 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  model: string;
  keyId?: string;
  text?: string;
  error?: string;
}

export interface SimulateResult {
  format: string;
  tokens: number;
  messages: number;
  contextWindow?: number;
  results: Array<{ mode: string; before: number; after: number; saved: number; actions: string[] }>;
}

export interface Session {
  authenticated: boolean;
  needsLogin: boolean;
  reason?: string;
  passwordSet: boolean;
  remote: boolean;
  version: string;
}

export interface LocalEngine {
  type: string;
  name: string;
  baseUrl: string;
  models: string[];
  configured: boolean;
}
