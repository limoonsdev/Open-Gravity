// Persistent configuration (providers, combos, aliases, API keys, settings).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { dataDir, randomId, randomKey, writeFileAtomic, slugify } from './util';
import { logger } from './logger';
import type { AuthStyle, ProviderFlags, ProviderFormat } from '../providers/catalog';
import { getTemplate } from '../providers/catalog';

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
  createdAt: number;
}

export type ComboStrategy = 'fallback' | 'round-robin' | 'random';

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
}

export interface AppConfig {
  version: number;
  settings: Settings;
  providers: ProviderConfig[];
  combos: ComboConfig[];
  aliases: Record<string, string>;
  apiKeys: RouterKey[];
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
    },
    providers: [],
    combos: [],
    aliases: {},
    apiKeys: [],
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
  };
  if (!cfg.settings.sessionSecret) cfg.settings.sessionSecret = randomKey('');
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
      strategy: ['fallback', 'round-robin', 'random'].includes(c.strategy) ? c.strategy : 'fallback',
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

export function newProviderFromTemplate(type: string, cfg: AppConfig, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
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
    baseUrl: (overrides.baseUrl || tpl.baseUrl).replace(/\/+$/, ''),
    auth: tpl.auth,
    keys: overrides.keys || [],
    models: overrides.models || [...tpl.models],
    enabled: true,
    rotation: 'round-robin',
    headers: tpl.headers ? { ...tpl.headers, ...(overrides.headers || {}) } : overrides.headers,
    flags: tpl.flags ? { ...tpl.flags } : undefined,
    createdAt: Date.now(),
  };
}
