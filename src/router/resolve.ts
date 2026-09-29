// Model string -> ordered list of (provider, model) candidates.
//
// Supported forms, in priority order:
//   alias          user-defined, supports * wildcards ("claude-*haiku*")
//   combo          named fallback chain / load-balanced group
//   provider/model explicit routing ("openrouter/qwen/qwen3-coder")
//   model          any provider that lists this exact model id
//   (fallback)     the default model, when unknown models are allowed
import type { AppConfig, ProviderConfig, ProviderKey, ComboConfig } from '../core/config';
import { globToRegExp } from '../core/util';
import { health } from './health';

export interface Candidate {
  provider: ProviderConfig;
  model: string;
  /** Canonical "provider/model" id. */
  target: string;
  combo?: string;
}

export interface Resolution {
  candidates: Candidate[];
  combo?: string;
  via?: 'alias' | 'combo' | 'prefix' | 'model' | 'default';
  error?: string;
}

const comboCounters = new Map<string, number>();
const keyCounters = new Map<string, number>();

function lookupAlias(cfg: AppConfig, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(cfg.aliases)) if (k.toLowerCase() === lower && v) return v;
  for (const [k, v] of Object.entries(cfg.aliases)) if (k.includes('*') && v && globToRegExp(k).test(name)) return v;
  return undefined;
}

function orderTargets(combo: ComboConfig): string[] {
  const t = [...combo.targets];
  if (combo.strategy === 'round-robin' && t.length > 1) {
    const n = comboCounters.get(combo.id) || 0;
    comboCounters.set(combo.id, n + 1);
    const s = n % t.length;
    return [...t.slice(s), ...t.slice(0, s)];
  }
  if (combo.strategy === 'random') {
    for (let i = t.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [t[i], t[j]] = [t[j], t[i]];
    }
  }
  return t;
}

function expand(cfg: AppConfig, name: string, depth: number, via: { v?: Resolution['via']; combo?: string }): Candidate[] {
  if (!name || depth > 4) return [];
  const alias = lookupAlias(cfg, name);
  if (alias && alias !== name) {
    via.v ||= 'alias';
    return expand(cfg, alias, depth + 1, via);
  }

  const combo = cfg.combos.find((c) => c.enabled && c.id.toLowerCase() === name.toLowerCase());
  if (combo) {
    via.v = via.v || 'combo';
    via.combo ||= combo.id;
    return orderTargets(combo).flatMap((t) => expand(cfg, t, depth + 1, via).map((c) => ({ ...c, combo: combo.id })));
  }

  const slash = name.indexOf('/');
  if (slash > 0) {
    const pid = name.slice(0, slash).toLowerCase();
    const provider = cfg.providers.find((p) => p.id.toLowerCase() === pid);
    if (provider) {
      via.v ||= 'prefix';
      if (!provider.enabled) return [];
      const model = name.slice(slash + 1);
      return [{ provider, model, target: `${provider.id}/${model}` }];
    }
  }

  const matches = cfg.providers.filter((p) => p.enabled && p.models.some((m) => m === name));
  if (matches.length) {
    via.v ||= 'model';
    return matches.map((p) => ({ provider: p, model: name, target: `${p.id}/${name}` }));
  }
  return [];
}

export function effectiveDefault(cfg: AppConfig): string {
  if (cfg.settings.defaultModel) return cfg.settings.defaultModel;
  const combo = cfg.combos.find((c) => c.enabled && c.targets.length);
  if (combo) return combo.id;
  const p = cfg.providers.find((x) => x.enabled && x.models.length);
  return p ? `${p.id}/${p.models[0]}` : '';
}

export function resolveModel(cfg: AppConfig, requested: string): Resolution {
  let name = (requested || '').trim();
  if (!name || name === 'auto' || name === 'default') name = effectiveDefault(cfg);
  const via: { v?: Resolution['via']; combo?: string } = {};
  let candidates = expand(cfg, name, 0, via);

  if (!candidates.length && cfg.settings.unknownModelFallback) {
    const def = effectiveDefault(cfg);
    if (def && def !== name) {
      const v2: { v?: Resolution['via']; combo?: string } = {};
      candidates = expand(cfg, def, 0, v2);
      via.v = 'default';
      via.combo = v2.combo;
    }
  }

  const seen = new Set<string>();
  candidates = candidates.filter((c) => (seen.has(c.target) ? false : (seen.add(c.target), true)));

  if (!candidates.length) {
    const hasProviders = cfg.providers.some((p) => p.enabled);
    return {
      candidates,
      error: hasProviders
        ? `Model "${requested}" is not routable. Use a combo name, "provider/model", or set a default model in the Open Gravity dashboard.`
        : 'No provider is configured yet. Open the Open Gravity dashboard and add a provider.',
    };
  }
  return { candidates, combo: via.combo, via: via.v };
}

const KEYLESS: ProviderKey = { id: 'none', key: '', enabled: true };

/** Ordered keys to try for a provider/model, honouring rotation and cooldowns. */
export function pickKeys(p: ProviderConfig, model: string, ignoreCooldown = false): ProviderKey[] {
  const enabled = p.keys.filter((k) => k.enabled);
  if (!enabled.length) return p.keys.length ? [] : [KEYLESS];
  let ordered = enabled;
  if (p.rotation === 'round-robin' && enabled.length > 1) {
    const n = keyCounters.get(p.id) || 0;
    keyCounters.set(p.id, n + 1);
    const s = n % enabled.length;
    ordered = [...enabled.slice(s), ...enabled.slice(0, s)];
  }
  if (ignoreCooldown) {
    return [...ordered].sort((a, b) => health.coolingUntil(p.id, a.id, model) - health.coolingUntil(p.id, b.id, model));
  }
  return ordered.filter((k) => !health.isCooling(p.id, k.id, model));
}

/** All routable model ids (for /v1/models and the dashboard). */
export function listRoutableModels(cfg: AppConfig): Array<{ id: string; owned_by: string; kind: 'combo' | 'model' | 'alias' }> {
  const out: Array<{ id: string; owned_by: string; kind: 'combo' | 'model' | 'alias' }> = [];
  for (const c of cfg.combos) if (c.enabled) out.push({ id: c.id, owned_by: 'combo', kind: 'combo' });
  for (const [a] of Object.entries(cfg.aliases)) if (!a.includes('*')) out.push({ id: a, owned_by: 'alias', kind: 'alias' });
  for (const p of cfg.providers) {
    if (!p.enabled) continue;
    for (const m of p.models) out.push({ id: `${p.id}/${m}`, owned_by: p.id, kind: 'model' });
  }
  return out;
}
