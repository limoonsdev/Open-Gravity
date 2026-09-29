// Persistent configuration (providers, combos, aliases, API keys, settings).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { dataDir, randomId, randomKey, writeFileAtomic, slugify } from './util';
import { logger } from './logger';
import type { AuthStyle, ProviderFlags, ProviderFormat, ToolMode } from '../providers/catalog';
import { getTemplate, fillVars } from '../providers/catalog';
import type { CompatFix } from '../router/compat';
import type { LimitRule } from '../router/quota';
import { modelDb } from './modeldb';

export interface ProviderKey {
  id: string;
  label?: string;
  key: string;
  enabled: boolean;
}

export interface ProviderConfig {
  id: string;
  type: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  auth: AuthStyle;
  keys: ProviderKey[];
  models: string[];
  enabled: boolean;
  rotation: 'round-robin' | 'fill-first';
  headers?: Record<string, string>;
  flags?: ProviderFlags;
  timeoutMs?: number;
  proxy?: string;
  /** Tool calling: 'auto' (detect), 'native' (never emulate) or 'emulate' (prompt-based). */
  toolMode?: ToolMode;
  /** For auth 'custom': header name and value prefix. */
  authHeader?: string;
  authPrefix?: string;
  createdAt: number;
}

export type ComboStrategy = 'fallback' | 'round-robin' | 'random' | 'fastest' | 'cheapest' | 'race';

export interface ComboConfig {
  id: string;
  description?: string;
  targets: string[];
  strategy: ComboStrategy;
  enabled: boolean;
}

export interface RouterKey {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  createdAt: number;
}

export interface Settings {
  port: number;
  host: string;
  defaultModel: string;
  unknownModelFallback: boolean;
  requireApiKey: boolean;
  dashboardPassword?: string;
  sessionSecret: string;
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
  /** Learn and apply fixes when a provider rejects a request (unsupported params, tools...). */
  adaptiveCompat: boolean;
  /** Cache identical requests for this many seconds (0 = off). */
  cacheTtlSeconds: number;
  /** Refresh the model capability database weekly. */
  modelDbAutoUpdate: boolean;
  /** Shrink prompts before they are sent (see router/tokensaver.ts). */
  tokenSaver: TokenSaverSettings;
  /** The dashboard's "Get started" guide was completed or dismissed. */
  onboarded: boolean;
}

export type TokenSaverMode = 'off' | 'safe' | 'balanced' | 'aggressive' | 'custom';

export interface TokenSaverSettings {
  mode: TokenSaverMode;
  /** Old tool results above this size (tokens) keep only their head and tail. 0 = off. */
  toolResultMaxTokens: number;
  /** The last N conversation turns are never modified. */
  keepRecentTurns: number;
  /** Replace repeated identical tool results with a short reference. */
  dedupeToolResults: boolean;
  /** Trailing spaces, runs of blank lines, CRLF. */
  compactWhitespace: boolean;
  /** Minify JSON found in old tool results. */
  minifyJson: boolean;
  /** Keep images only in the most recent turns. */
  dropOldImages: boolean;
  /** Drop reasoning blocks from earlier turns (providers ignore most of them anyway). */
  dropOldThinking: boolean;
  /** Compact the conversation when it exceeds this fraction of the model's context window (0 = off). */
  compactAt: number;
  /** Aim for this fraction of the context window after compaction. */
  compactTarget: number;
  /** Model used to summarise compacted turns ("" = fast built-in compaction only). */
  summarizer: string;
}

export const TOKEN_SAVER_PRESETS: Record<Exclude<TokenSaverMode, 'custom'>, TokenSaverSettings> = {
  off: { mode: 'off', toolResultMaxTokens: 0, keepRecentTurns: 4, dedupeToolResults: false, compactWhitespace: false, minifyJson: false, dropOldImages: false, dropOldThinking: false, compactAt: 0, compactTarget: 0.6, summarizer: '' },
  safe: { mode: 'safe', toolResultMaxTokens: 12000, keepRecentTurns: 6, dedupeToolResults: true, compactWhitespace: true, minifyJson: false, dropOldImages: false, dropOldThinking: false, compactAt: 0.92, compactTarget: 0.7, summarizer: '' },
  balanced: { mode: 'balanced', toolResultMaxTokens: 4000, keepRecentTurns: 4, dedupeToolResults: true, compactWhitespace: true, minifyJson: true, dropOldImages: true, dropOldThinking: true, compactAt: 0.85, compactTarget: 0.6, summarizer: '' },
  aggressive: { mode: 'aggressive', toolResultMaxTokens: 1500, keepRecentTurns: 2, dedupeToolResults: true, compactWhitespace: true, minifyJson: true, dropOldImages: true, dropOldThinking: true, compactAt: 0.7, compactTarget: 0.45, summarizer: '' },
};

export interface AppConfig {
  version: number;
  settings: Settings;
  providers: ProviderConfig[];
  combos: ComboConfig[];
  aliases: Record<string, string>;
  apiKeys: RouterKey[];
  /** Compatibility fixes learned per "provider::model". */
  compat: Record<string, CompatFix>;
  /** Budgets and request/token limits (see router/quota.ts). */
  limits: LimitRule[];
}

export const DEFAULT_PORT = 18080;

export function defaultConfig(): AppConfig {
  return {
    version: 2,
    settings: {
      port: parseInt(process.env.OG_PORT || process.env.PORT || '', 10) || DEFAULT_PORT,
      host: process.env.OG_HOST || '127.0.0.1',
      defaultModel: '',
      unknownModelFallback: true,
      requireApiKey: false,
      sessionSecret: randomKey(''),
      openBrowser: true,
      headersTimeoutMs: 120_000,
      idleTimeoutMs: 300_000,
      maxAttempts: 6,
      cooldownRateLimitMs: 60_000,
      cooldownAuthMs: 600_000,
      cooldownServerMs: 20_000,
      logRetentionDays: 30,
      captureBodies: false,
      passthrough: true,
      adaptiveCompat: true,
      cacheTtlSeconds: 0,
      modelDbAutoUpdate: true,
      tokenSaver: { ...TOKEN_SAVER_PRESETS.safe },
      onboarded: false,
    },
    providers: [],
    combos: [],
    aliases: {},
    apiKeys: [],
    compat: {},
    limits: [],
  };
}

export class ConfigStore extends EventEmitter {
  readonly file: string;
  private config: AppConfig;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastWritten = '';

  constructor(file = path.join(dataDir(), 'config.json')) {
    super();
    this.file = file;
    this.config = this.load();
  }

  get(): AppConfig {
    return this.config;
  }

  get settings(): Settings {
    return this.config.settings;
  }

  /** Apply a mutation and persist (debounced). */
  update(mutator: (cfg: AppConfig) => void): AppConfig {
    mutator(this.config);
    this.scheduleSave();
    this.emit('change', this.config);
    return this.config;
  }

  replace(next: AppConfig) {
    this.config = normalize(next);
    this.saveNow();
    this.emit('change', this.config);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const data = JSON.stringify(this.config, null, 2);
      writeFileAtomic(this.file, data);
      this.lastWritten = data;
    } catch (e: any) {
      logger.error(`Could not save config: ${e.message}`);
    }
  }

  /** Reload when the file is edited externally (CLI commands, manual edits). */
  watch() {
    fs.watchFile(this.file, { interval: 1500 }, () => {
      let raw: string;
      try {
        raw = fs.readFileSync(this.file, 'utf8');
      } catch {
        return;
      }
      if (raw === this.lastWritten || this.saveTimer) return;
      try {
        this.config = normalize(JSON.parse(raw));
        this.lastWritten = raw;
        this.emit('change', this.config);
        logger.info('Configuration reloaded from disk');
      } catch (e: any) {
        logger.warn(`Ignoring invalid config edit: ${e.message}`);
      }
    });
  }

  unwatch() {
    fs.unwatchFile(this.file);
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 150);
    this.saveTimer.unref?.();
  }

  private load(): AppConfig {
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        this.lastWritten = raw;
        return normalize(JSON.parse(raw));
      } catch (e: any) {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(this.file, backup); } catch { /* ignore */ }
        logger.error(`Config file is invalid (${e.message}). A backup was saved to ${backup}; starting fresh.`);
      }
    }
    const cfg = defaultConfig();
    migrateLegacy(cfg);
    writeFileAtomic(this.file, JSON.stringify(cfg, null, 2));
    return cfg;
  }
}

/** Fill defaults so older/partial config files keep working. */
export function normalize(raw: any): AppConfig {
  const base = defaultConfig();
  const cfg: AppConfig = {
    version: 2,
    settings: { ...base.settings, ...(raw?.settings || {}) },
    providers: Array.isArray(raw?.providers) ? raw.providers : [],
    combos: Array.isArray(raw?.combos) ? raw.combos : [],
    aliases: raw?.aliases && typeof raw.aliases === 'object' ? raw.aliases : {},
    apiKeys: Array.isArray(raw?.apiKeys) ? raw.apiKeys : [],
    compat: raw?.compat && typeof raw.compat === 'object' ? raw.compat : {},
    limits: Array.isArray(raw?.limits) ? raw.limits : [],
  };
  if (!cfg.settings.sessionSecret) cfg.settings.sessionSecret = randomKey('');
  cfg.settings.tokenSaver = normalizeTokenSaver(raw?.settings?.tokenSaver);
  // Existing installs that already have providers don't need the welcome guide.
  if (raw?.settings?.onboarded === undefined) cfg.settings.onboarded = cfg.providers.length > 0;
  cfg.limits = cfg.limits.map(normalizeLimit).filter((l): l is LimitRule => !!l);
  cfg.providers = cfg.providers.map((p: any) => {
    const tpl = getTemplate(p.type);
    return {
      id: slugify(p.id || p.name || p.type || 'provider'),
      type: p.type || 'openai-compatible',
      name: p.name || tpl?.name || p.id,
      format: p.format || tpl?.format || 'openai',
      baseUrl: (p.baseUrl || tpl?.baseUrl || '').replace(/\/+$/, ''),
      auth: p.auth || tpl?.auth || 'bearer',
      keys: (Array.isArray(p.keys) ? p.keys : []).map((k: any) => ({ id: k.id || randomId(8), label: k.label, key: String(k.key || ''), enabled: k.enabled !== false })),
      models: Array.isArray(p.models) ? p.models.filter((m: any) => typeof m === 'string' && m) : [],
      enabled: p.enabled !== false,
      rotation: p.rotation === 'fill-first' ? 'fill-first' : 'round-robin',
      headers: p.headers && typeof p.headers === 'object' ? p.headers : undefined,
      flags: p.flags,
      toolMode: ['auto', 'native', 'emulate'].includes(p.toolMode) ? p.toolMode : tpl?.toolMode,
      authHeader: p.authHeader ?? tpl?.authHeader,
      authPrefix: p.authPrefix ?? tpl?.authPrefix,
      timeoutMs: p.timeoutMs,
      proxy: p.proxy,
      createdAt: p.createdAt || Date.now(),
    } as ProviderConfig;
  });
  cfg.combos = cfg.combos
    .filter((c: any) => c && c.id)
    .map((c: any) => ({
      id: String(c.id),
      description: c.description,
      targets: Array.isArray(c.targets) ? c.targets.filter((t: any) => typeof t === 'string' && t) : [],
      strategy: ['fallback', 'round-robin', 'random', 'fastest', 'cheapest', 'race'].includes(c.strategy) ? c.strategy : 'fallback',
      enabled: c.enabled !== false,
    }));
  cfg.apiKeys = cfg.apiKeys.filter((k: any) => k && k.key).map((k: any) => ({
    id: k.id || randomId(8), name: k.name || 'key', key: k.key, enabled: k.enabled !== false, createdAt: k.createdAt || Date.now(),
  }));
  return cfg;
}

/** Import settings from Open Gravity 1.x (~/.gemini/gravity-bridge.json). */
function migrateLegacy(cfg: AppConfig) {
  const legacy = path.join(os.homedir(), '.gemini', 'gravity-bridge.json');
  const envGemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  let geminiKey = envGemini;
  try {
    if (fs.existsSync(legacy)) {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      geminiKey = old.geminiApiKey || geminiKey;
      logger.info('Imported settings from Open Gravity 1.x');
    }
  } catch { /* ignore */ }
  if (geminiKey) {
    const tpl = getTemplate('gemini')!;
    cfg.providers.push({
      id: 'gemini', type: 'gemini', name: tpl.name, format: tpl.format, baseUrl: tpl.baseUrl, auth: tpl.auth,
      keys: [{ id: randomId(8), label: 'imported', key: geminiKey, enabled: true }],
      models: [...tpl.models], enabled: true, rotation: 'round-robin', createdAt: Date.now(),
    });
    cfg.settings.defaultModel = 'gemini/gemini-2.5-flash';
  }
}

export function newProviderFromTemplate(
  type: string, cfg: AppConfig, overrides: Partial<ProviderConfig> & { vars?: Record<string, string> } = {},
): ProviderConfig {
  const tpl = getTemplate(type) || getTemplate('openai-compatible')!;
  let id = slugify(overrides.id || (tpl.category === 'custom' ? overrides.name || 'custom' : tpl.type));
  const taken = new Set(cfg.providers.map((p) => p.id));
  if (taken.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  return {
    id,
    type: tpl.type,
    name: overrides.name || tpl.name,
    format: tpl.format,
    baseUrl: fillVars(overrides.baseUrl || tpl.baseUrl, overrides.vars).replace(/\/+$/, ''),
    auth: tpl.auth,
    keys: overrides.keys || [],
    // Providers without a model-list API also get what the model database knows about them.
    models: overrides.models || (tpl.modelsApi === 'none' ? [...new Set([...tpl.models, ...modelDb.modelsFor(tpl.type).slice(0, 200)])] : [...tpl.models]),
    enabled: true,
    rotation: 'round-robin',
    headers: tpl.headers ? { ...tpl.headers, ...(overrides.headers || {}) } : overrides.headers,
    flags: tpl.flags ? { ...tpl.flags } : undefined,
    toolMode: tpl.toolMode,
    authHeader: tpl.authHeader,
    authPrefix: tpl.authPrefix,
    createdAt: Date.now(),
  };
}

export function normalizeTokenSaver(raw: any): TokenSaverSettings {
  const mode: TokenSaverMode = ['off', 'safe', 'balanced', 'aggressive', 'custom'].includes(raw?.mode) ? raw.mode : 'safe';
  if (mode !== 'custom') return { ...TOKEN_SAVER_PRESETS[mode] };
  const base = TOKEN_SAVER_PRESETS.balanced;
  const num = (v: any, d: number, min: number, max: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);
  const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    mode,
    toolResultMaxTokens: num(raw.toolResultMaxTokens, base.toolResultMaxTokens, 0, 1_000_000),
    keepRecentTurns: num(raw.keepRecentTurns, base.keepRecentTurns, 0, 100),
    dedupeToolResults: bool(raw.dedupeToolResults, base.dedupeToolResults),
    compactWhitespace: bool(raw.compactWhitespace, base.compactWhitespace),
    minifyJson: bool(raw.minifyJson, base.minifyJson),
    dropOldImages: bool(raw.dropOldImages, base.dropOldImages),
    dropOldThinking: bool(raw.dropOldThinking, base.dropOldThinking),
    compactAt: num(raw.compactAt, base.compactAt, 0, 1),
    compactTarget: num(raw.compactTarget, base.compactTarget, 0.1, 0.95),
    summarizer: typeof raw.summarizer === 'string' ? raw.summarizer.trim() : '',
  };
}

export function normalizeLimit(l: any): LimitRule | undefined {
  if (!l || typeof l !== 'object') return undefined;
  const scope = ['global', 'provider', 'key', 'model', 'apikey', 'client'].includes(l.scope) ? l.scope : undefined;
  const period = ['minute', 'hour', 'day', 'week', 'month'].includes(l.period) ? l.period : undefined;
  if (!scope || !period) return undefined;
  const pos = (v: any) => (Number(v) > 0 ? Number(v) : undefined);
  const rule: LimitRule = {
    id: String(l.id || randomId(8)),
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 80) : undefined,
    scope,
    target: scope === 'global' ? '' : String(l.target || '').trim(),
    period,
    maxRequests: pos(l.maxRequests),
    maxTokens: pos(l.maxTokens),
    maxCost: pos(l.maxCost),
    action: l.action === 'warn' ? 'warn' : 'block',
    enabled: l.enabled !== false,
  };
  if (!rule.maxRequests && !rule.maxTokens && !rule.maxCost) return undefined;
  if (scope !== 'global' && !rule.target) return undefined;
  return rule;
}
