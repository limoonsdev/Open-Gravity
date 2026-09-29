// Quotas: what providers tell us (rate-limit headers), what the user allows
// (limit rules / budgets), and enforcement of both while routing.
import type { UsageRecord } from '../core/usage';

// ------------------------------------------------------ provider rate limits

export interface RateBucket {
  limit?: number;
  remaining?: number;
  /** Epoch ms when the bucket refills. */
  resetAt?: number;
}

export interface QuotaSnapshot {
  provider: string;
  keyId: string;
  model?: string;
  at: number;
  buckets: Record<string, RateBucket>;
}

const FIELDS = new Set(['limit', 'remaining', 'reset', 'used']);

/** "6m0s", "1.5s", "20ms", "1h2m", RFC 3339 dates, epoch seconds/ms or seconds-from-now. */
export function parseReset(v: string, now = Date.now()): number | undefined {
  const s = v.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? undefined : t;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1e12) return n;
    if (n > 1e9) return n * 1000;
    return now + n * 1000;
  }
  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s|d)/g)) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60e3 : m[2] === 'h' ? n * 3600e3 : n * 86400e3;
  }
  return matched ? now + ms : undefined;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined> | Iterable<[string, string]>;

function headerEntries(h: HeaderSource): Array<[string, string]> {
  if (typeof (h as any)?.forEach === 'function' && typeof (h as any)?.get === 'function') {
    const out: Array<[string, string]> = [];
    (h as Headers).forEach((v, k) => out.push([k, v]));
    return out;
  }
  if (Symbol.iterator in Object(h) && !Array.isArray(h) && typeof (h as any)[Symbol.iterator] === 'function' && !(h as any).constructor?.name?.includes('Object')) {
    return [...(h as Iterable<[string, string]>)];
  }
  return Object.entries(h as Record<string, any>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]);
}

/**
 * Parse rate-limit headers of any common flavour:
 *   x-ratelimit-remaining-requests (OpenAI, Groq, OpenRouter...)
 *   x-ratelimit-limit-tokens-minute (Cerebras)
 *   anthropic-ratelimit-input-tokens-remaining (Anthropic)
 *   ratelimit-remaining / x-ratelimit-remaining (generic)
 */
export function parseRateLimitHeaders(h: HeaderSource, now = Date.now()): Record<string, RateBucket> {
  const out: Record<string, RateBucket & { used?: number }> = {};
  for (const [rawKey, value] of headerEntries(h)) {
    const m = /^(?:x-)?(?:anthropic-)?ratelimit-(.+)$/.exec(rawKey.toLowerCase());
    if (!m) continue;
    const parts = m[1].split('-');
    const fi = parts.findIndex((p) => FIELDS.has(p));
    if (fi < 0) continue;
    const field = parts[fi];
    const bucket = parts.filter((_, i) => i !== fi).join('-') || 'requests';
    const b = (out[bucket] ||= {});
    if (field === 'reset') b.resetAt = parseReset(value, now);
    else {
      const n = Number(String(value).split(',')[0]);
      if (Number.isFinite(n)) (b as any)[field] = n;
    }
  }
  for (const b of Object.values(out)) {
    if (b.remaining === undefined && b.limit !== undefined && b.used !== undefined) b.remaining = Math.max(0, b.limit - b.used);
    delete b.used;
  }
  return out;
}

// --------------------------------------------------------------- limit rules

export type LimitScope = 'global' | 'provider' | 'key' | 'model' | 'apikey' | 'client';
export type LimitPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface LimitRule {
  id: string;
  name?: string;
  scope: LimitScope;
  /** provider id, "provider:keyId", model id or pattern with *, router key id, client id; empty for global. */
  target: string;
  period: LimitPeriod;
  maxRequests?: number;
  maxTokens?: number;
  maxCost?: number;
  /** block: stop routing there once reached; warn: only alert. */
  action: 'block' | 'warn';
  enabled: boolean;
}

export interface LimitUsage {
  windowStart: number;
  windowEnd: number;
  requests: number;
  tokens: number;
  cost: number;
}

export interface LimitStatus extends LimitUsage {
  rule: LimitRule;
  /** Highest fraction used across the configured maxima (1 = reached). */
  ratio: number;
  exceeded: boolean;
}

export interface QuotaAlert {
  at: number;
  ruleId: string;
  level: 'warning' | 'exceeded';
  message: string;
}

/** Start of the calendar period containing ts, in local time. */
export function periodStart(period: LimitPeriod, ts = Date.now()): number {
  const d = new Date(ts);
  switch (period) {
    case 'minute':
      d.setSeconds(0, 0);
      break;
    case 'hour':
      d.setMinutes(0, 0, 0);
      break;
    case 'day':
      d.setHours(0, 0, 0, 0);
      break;
    case 'week': {
      d.setHours(0, 0, 0, 0);
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - dow);
      break;
    }
    case 'month':
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      break;
  }
  return d.getTime();
}

export function periodEnd(period: LimitPeriod, start: number): number {
  const d = new Date(start);
  switch (period) {
    case 'minute': return start + 60e3;
    case 'hour': return start + 3600e3;
    case 'day': d.setDate(d.getDate() + 1); return d.getTime();
    case 'week': d.setDate(d.getDate() + 7); return d.getTime();
    case 'month': d.setMonth(d.getMonth() + 1); return d.getTime();
  }
}

function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(value);
}

/** Does a usage record count towards this rule? */
export function recordMatches(rule: LimitRule, r: Pick<UsageRecord, 'provider' | 'model' | 'keyId' | 'apiKeyId'> & { clientId?: string }): boolean {
  switch (rule.scope) {
    case 'global': return true;
    case 'provider': return !!r.provider && r.provider === rule.target;
    case 'key': return !!r.provider && `${r.provider}:${r.keyId || ''}` === rule.target;
    case 'model': return !!r.provider && (globMatch(rule.target, `${r.provider}/${r.model}`) || globMatch(rule.target, r.model || ''));
    case 'apikey': return !!r.apiKeyId && r.apiKeyId === rule.target;
    case 'client': return !!r.clientId && r.clientId === rule.target;
  }
}

function ratioOf(rule: LimitRule, u: LimitUsage): number {
  const rs: number[] = [];
  if (rule.maxRequests) rs.push(u.requests / rule.maxRequests);
  if (rule.maxTokens) rs.push(u.tokens / rule.maxTokens);
  if (rule.maxCost) rs.push(u.cost / rule.maxCost);
  return rs.length ? Math.max(...rs) : 0;
}

// ------------------------------------------------------------------- tracker

export class QuotaTracker {
  private snaps = new Map<string, QuotaSnapshot>();
  private rules: LimitRule[] = [];
  private usage = new Map<string, LimitUsage>();
  private alerted = new Map<string, number>();
  readonly alerts: QuotaAlert[] = [];

  // ---- provider headers

  observe(provider: string, keyId: string, model: string | undefined, headers: HeaderSource, now = Date.now()) {
    const buckets = parseRateLimitHeaders(headers, now);
    if (!Object.keys(buckets).length) return;
    const k = `${provider}:${keyId}:${model || ''}`;
    this.snaps.delete(k);
    this.snaps.set(k, { provider, keyId, model, at: now, buckets });
    while (this.snaps.size > 500) this.snaps.delete(this.snaps.keys().next().value!);
  }

  snapshots(): QuotaSnapshot[] {
    return [...this.snaps.values()].sort((a, b) => b.at - a.at);
  }

  /**
   * If the provider said a key has no requests (or tokens) left for this model,
   * return when it refills so routing can skip it without a failed call.
   */
  exhaustedUntil(provider: string, keyId: string, model: string, now = Date.now()): number | undefined {
    let until: number | undefined;
    for (const k of [`${provider}:${keyId}:${model}`, `${provider}:${keyId}:`]) {
      const s = this.snaps.get(k);
      if (!s) continue;
      for (const b of Object.values(s.buckets)) {
        if (b.remaining === 0 && b.resetAt && b.resetAt > now) until = Math.max(until || 0, b.resetAt);
      }
    }
    return until;
  }

  // ---- limit rules

  setRules(rules: LimitRule[], records: Iterable<UsageRecord & { clientId?: string }>) {
    this.rules = rules.filter((r) => r.enabled);
    this.usage.clear();
    const now = Date.now();
    for (const rule of this.rules) this.usage.set(rule.id, this.fresh(rule, now));
    for (const r of records) this.add(r, false);
  }

  private fresh(rule: LimitRule, now: number): LimitUsage {
    const windowStart = periodStart(rule.period, now);
    return { windowStart, windowEnd: periodEnd(rule.period, windowStart), requests: 0, tokens: 0, cost: 0 };
  }

  private current(rule: LimitRule, now = Date.now()): LimitUsage {
    let u = this.usage.get(rule.id);
    if (!u || now >= u.windowEnd) {
      u = this.fresh(rule, now);
      this.usage.set(rule.id, u);
    }
    return u;
  }

  /** Count a finished request (called for every usage record). */
  add(r: UsageRecord & { clientId?: string }, alert = true) {
    if (!r.provider || r.cached) return;
    for (const rule of this.rules) {
      const u = this.current(rule);
      if (r.ts < u.windowStart || r.ts >= u.windowEnd || !recordMatches(rule, r)) continue;
      u.requests++;
      if (r.ok) {
        u.tokens += (r.input || 0) + (r.output || 0);
        u.cost += r.cost || 0;
      }
      if (alert) this.maybeAlert(rule, u);
    }
  }

  private maybeAlert(rule: LimitRule, u: LimitUsage) {
    const ratio = ratioOf(rule, u);
    const level = ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : undefined;
    if (!level) return;
    const key = `${rule.id}:${u.windowStart}:${level}`;
    if (this.alerted.has(key)) return;
    this.alerted.set(key, Date.now());
    if (this.alerted.size > 1000) this.alerted.delete(this.alerted.keys().next().value!);
    const label = rule.name || `${rule.scope}${rule.target ? ` ${rule.target}` : ''} (${rule.period})`;
    this.alerts.unshift({
      at: Date.now(), ruleId: rule.id, level,
      message: level === 'exceeded'
        ? `${label}: limit reached${rule.action === 'block' ? ', routing paused until the period resets' : ''}`
        : `${label}: ${Math.round(ratio * 100)}% of the limit used`,
    });
    this.alerts.length = Math.min(this.alerts.length, 50);
  }

  status(): LimitStatus[] {
    const now = Date.now();
    return this.rules.map((rule) => {
      const u = this.current(rule, now);
      const ratio = ratioOf(rule, u);
      return { rule, ...u, ratio, exceeded: ratio >= 1 };
    });
  }

  /**
   * First blocking rule already reached for this request / target.
   * `ctx` fields that are undefined are not checked.
   */
  blocking(ctx: { provider?: string; keyId?: string; model?: string; apiKeyId?: string; clientId?: string }, scopes: LimitScope[]): LimitStatus | undefined {
    const now = Date.now();
    for (const rule of this.rules) {
      if (rule.action !== 'block' || !scopes.includes(rule.scope)) continue;
      if (!recordMatches(rule, ctx)) continue;
      const u = this.current(rule, now);
      const ratio = ratioOf(rule, u);
      if (ratio >= 1) return { rule, ...u, ratio, exceeded: true };
    }
    return undefined;
  }
}

export const quota = new QuotaTracker();

export function describeLimit(s: LimitStatus): string {
  const r = s.rule;
  const label = r.name || `${r.scope === 'global' ? 'Global' : r.scope} ${r.target}`.trim();
  const reset = new Date(s.windowEnd).toLocaleString();
  return `${label} limit reached for this ${r.period} (resets ${reset})`;
}
