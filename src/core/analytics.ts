// Usage analytics over the request log: totals with percentiles, time series,
// breakdowns (model, provider, key, client, router key, endpoint, combo),
// status codes, top errors, weekday x hour heatmap, cost projections and
// token-saver savings. Pure functions over UsageRecord arrays.
import type { UsageRecord } from './usage';
import { clientFromUserAgent } from './clients';

export type AnalyticsRange = '1h' | '24h' | '7d' | '30d';
export const RANGE_MS: Record<AnalyticsRange, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };

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

interface GroupAcc extends Omit<GroupStats, 'avgLatencyMs' | 'p95LatencyMs'> {
  latencies: number[];
}

export interface Totals {
  requests: number;
  ok: number;
  errors: number;
  successRate: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  tokens: number;
  cost: number;
  saved: number;
  savedCost: number;
  fallbacks: number;
  emulated: number;
  adapted: number;
  cached: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTtftMs: number;
  p50TtftMs: number;
  p95TtftMs: number;
  /** Share of prompt tokens served from the provider's prompt cache. */
  promptCacheRatio: number;
  /** Average output speed (tokens/s after the first token). */
  outputTokensPerSec: number;
}

export interface Projection {
  todayCost: number;
  todayTokens: number;
  todayRequests: number;
  monthToDateCost: number;
  monthToDateTokens: number;
  projectedMonthCost: number;
  avgDailyCost7d: number;
  avgDailyTokens7d: number;
  savedCostMonthToDate: number;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  from: number;
  to: number;
  bucketMs: number;
  totals: Totals;
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
  /** [weekday 0=Monday][hour 0-23] request counts, local time. */
  heatmap: number[][];
  savings: { tokens: number; cost: number; requests: number; byAction: Array<{ action: string; count: number }> };
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i]);
}

export function clientOf(r: UsageRecord): { id: string; name: string } {
  if (r.clientId) return { id: r.clientId, name: r.client || r.clientId };
  return clientFromUserAgent(r.ua || r.client);
}

function bump(map: Map<string, GroupAcc>, key: string, label: string, r: UsageRecord) {
  let g = map.get(key);
  if (!g) {
    g = { key, label, requests: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cost: 0, saved: 0, lastAt: 0, latencies: [] };
    map.set(key, g);
  }
  g.requests++;
  if (!r.ok) g.errors++;
  g.input += r.input || 0;
  g.output += r.output || 0;
  g.cacheRead += r.cacheRead || 0;
  g.cost += r.cost || 0;
  g.saved += r.saved || 0;
  g.lastAt = Math.max(g.lastAt, r.ts);
  if (g.latencies.length < 5000) g.latencies.push(r.latencyMs);
}

function finish(map: Map<string, GroupAcc>, limit = 25): GroupStats[] {
  return [...map.values()]
    .sort((a, b) => b.requests - a.requests || b.cost - a.cost)
    .slice(0, limit)
    .map(({ latencies, ...g }) => {
      const sorted = latencies.sort((a, b) => a - b);
      return {
        ...g,
        cost: round6(g.cost),
        avgLatencyMs: sorted.length ? Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length) : 0,
        p95LatencyMs: percentile(sorted, 95),
      };
    });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function bucketFor(range: AnalyticsRange): number {
  return range === '1h' ? 5 * 60e3 : range === '24h' ? 3600e3 : 86400e3;
}

/** Local midnight of the day containing ts. */
function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Analytics over records (oldest first) for the given range. */
export function analyze(records: readonly UsageRecord[], range: AnalyticsRange = '24h', now = Date.now()): AnalyticsReport {
  const span = RANGE_MS[range] || RANGE_MS['24h'];
  const from = now - span;
  const bucketMs = bucketFor(range);
  // Day buckets align on local midnight, others on the epoch grid.
  const align = (t: number) => (bucketMs === 86400e3 ? dayStart(t) : Math.floor(t / bucketMs) * bucketMs);
  const first = align(from);
  const series: SeriesPoint[] = [];
  const index = new Map<number, SeriesPoint>();
  for (let t = first; t <= now; t = bucketMs === 86400e3 ? dayStart(t + 36 * 3600e3) : t + bucketMs) {
    const p = { t, requests: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cost: 0, saved: 0 };
    series.push(p);
    index.set(t, p);
  }

  const byModel = new Map<string, GroupAcc>();
  const byProvider = new Map<string, GroupAcc>();
  const byKey = new Map<string, GroupAcc>();
  const byClient = new Map<string, GroupAcc>();
  const byApiKey = new Map<string, GroupAcc>();
  const byEndpoint = new Map<string, GroupAcc>();
  const byCombo = new Map<string, GroupAcc>();
  const statuses = new Map<number, number>();
  const errors = new Map<string, { message: string; count: number; lastAt: number }>();
  const actions = new Map<string, number>();
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const latencies: number[] = [];
  const ttfts: number[] = [];
  let genMs = 0;
  let genTokens = 0;

  const t: Totals = {
    requests: 0, ok: 0, errors: 0, successRate: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0, cost: 0, saved: 0, savedCost: 0,
    fallbacks: 0, emulated: 0, adapted: 0, cached: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, avgTtftMs: 0, p50TtftMs: 0, p95TtftMs: 0,
    promptCacheRatio: 0, outputTokensPerSec: 0,
  };
  let savingRequests = 0;

  for (const r of records) {
    if (r.ts < from || r.ts > now) continue;
    t.requests++;
    if (r.ok) t.ok++;
    else t.errors++;
    t.input += r.input || 0;
    t.output += r.output || 0;
    t.cacheRead += r.cacheRead || 0;
    t.cacheWrite += r.cacheWrite || 0;
    t.reasoning += r.reasoning || 0;
    t.cost += r.cost || 0;
    t.saved += r.saved || 0;
    t.savedCost += r.savedCost || 0;
    if (r.saved) savingRequests++;
    if (r.ok && r.attempts.filter((a) => a.ms > 0 || a.status !== 429).length > 1) t.fallbacks++;
    if (r.emulatedTools) t.emulated++;
    if (r.adapted?.length) t.adapted++;
    if (r.cached) t.cached++;
    if (latencies.length < 200_000) latencies.push(r.latencyMs);
    if (r.ttftMs) {
      if (ttfts.length < 200_000) ttfts.push(r.ttftMs);
      if (r.ok && r.stream && r.output > 0 && r.latencyMs > r.ttftMs) {
        genMs += r.latencyMs - r.ttftMs;
        genTokens += r.output;
      }
    }
    for (const a of r.saverActions || []) actions.set(a, (actions.get(a) || 0) + 1);

    const p = index.get(align(r.ts));
    if (p) {
      p.requests++;
      if (!r.ok) p.errors++;
      p.input += r.input || 0;
      p.output += r.output || 0;
      p.cacheRead += r.cacheRead || 0;
      p.cost += r.cost || 0;
      p.saved += r.saved || 0;
    }

    const routed = r.ok && r.provider;
    bump(byModel, routed ? `${r.provider}/${r.model}` : r.requestedModel || '(none)', routed ? `${r.provider}/${r.model}` : r.requestedModel || '(none)', r);
    bump(byProvider, r.provider || '(unrouted)', r.provider || '(unrouted)', r);
    if (r.provider && r.keyId) bump(byKey, `${r.provider}:${r.keyId}`, `${r.provider}:${r.keyId}`, r);
    const client = clientOf(r);
    bump(byClient, client.id, client.name, r);
    bump(byApiKey, r.apiKeyId || '(local)', r.apiKeyId || '(local)', r);
    bump(byEndpoint, r.endpoint, r.endpoint, r);
    if (r.combo) bump(byCombo, r.combo, r.combo, r);

    statuses.set(r.status, (statuses.get(r.status) || 0) + 1);
    if (!r.ok && r.error) {
      const msg = r.error.replace(/\d{3,}/g, 'N').slice(0, 160);
      const e = errors.get(msg) || { message: r.error.slice(0, 200), count: 0, lastAt: 0 };
      e.count++;
      e.lastAt = Math.max(e.lastAt, r.ts);
      errors.set(msg, e);
    }
    const d = new Date(r.ts);
    heatmap[(d.getDay() + 6) % 7][d.getHours()]++;
  }

  latencies.sort((a, b) => a - b);
  ttfts.sort((a, b) => a - b);
  t.tokens = t.input + t.output;
  t.cost = round6(t.cost);
  t.savedCost = round6(t.savedCost);
  t.successRate = t.requests ? t.ok / t.requests : 1;
  t.avgLatencyMs = latencies.length ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : 0;
  t.p50LatencyMs = percentile(latencies, 50);
  t.p95LatencyMs = percentile(latencies, 95);
  t.avgTtftMs = ttfts.length ? Math.round(ttfts.reduce((s, x) => s + x, 0) / ttfts.length) : 0;
  t.p50TtftMs = percentile(ttfts, 50);
  t.p95TtftMs = percentile(ttfts, 95);
  t.promptCacheRatio = t.input + t.cacheRead ? t.cacheRead / (t.input + t.cacheRead) : 0;
  t.outputTokensPerSec = genMs > 0 ? Math.round((genTokens / genMs) * 1000 * 10) / 10 : 0;
  for (const p of series) p.cost = round6(p.cost);

  return {
    range, from, to: now, bucketMs, totals: t, series,
    byModel: finish(byModel), byProvider: finish(byProvider), byKey: finish(byKey), byClient: finish(byClient),
    byApiKey: finish(byApiKey), byEndpoint: finish(byEndpoint), byCombo: finish(byCombo),
    statuses: [...statuses].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    topErrors: [...errors.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    heatmap,
    savings: { tokens: t.saved, cost: t.savedCost, requests: savingRequests, byAction: [...actions].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count) },
  };
}

/** Today / month-to-date figures and a naive end-of-month projection. */
export function project(records: readonly UsageRecord[], now = Date.now()): Projection {
  const today = dayStart(now);
  const m = new Date(now);
  m.setHours(0, 0, 0, 0);
  m.setDate(1);
  const monthStart = m.getTime();
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const weekAgo = now - 7 * 86400e3;
  const p: Projection = { todayCost: 0, todayTokens: 0, todayRequests: 0, monthToDateCost: 0, monthToDateTokens: 0, projectedMonthCost: 0, avgDailyCost7d: 0, avgDailyTokens7d: 0, savedCostMonthToDate: 0 };
  let cost7 = 0;
  let tokens7 = 0;
  let firstTs = now;
  for (const r of records) {
    const tokens = (r.input || 0) + (r.output || 0);
    firstTs = Math.min(firstTs, r.ts);
    if (r.ts >= today) {
      p.todayCost += r.cost || 0;
      p.todayTokens += tokens;
      p.todayRequests++;
    }
    if (r.ts >= monthStart) {
      p.monthToDateCost += r.cost || 0;
      p.monthToDateTokens += tokens;
      p.savedCostMonthToDate += r.savedCost || 0;
    }
    if (r.ts >= weekAgo) {
      cost7 += r.cost || 0;
      tokens7 += tokens;
    }
  }
  const days7 = Math.max(1, Math.min(7, (now - Math.max(weekAgo, firstTs)) / 86400e3));
  p.avgDailyCost7d = round6(cost7 / days7);
  p.avgDailyTokens7d = Math.round(tokens7 / days7);
  const remainingDays = (nextMonth.getTime() - now) / 86400e3;
  p.projectedMonthCost = round6(p.monthToDateCost + p.avgDailyCost7d * remainingDays);
  p.todayCost = round6(p.todayCost);
  p.monthToDateCost = round6(p.monthToDateCost);
  p.savedCostMonthToDate = round6(p.savedCostMonthToDate);
  return p;
}

const CSV_COLUMNS = ['time', 'id', 'endpoint', 'requested_model', 'provider', 'model', 'key', 'client', 'router_key', 'status', 'ok', 'latency_ms', 'ttft_ms',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'cost_usd', 'saved_tokens', 'attempts', 'error'] as const;

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(records: readonly UsageRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    lines.push([
      new Date(r.ts).toISOString(), r.id, r.endpoint, r.requestedModel, r.provider, r.model, r.keyId, clientOf(r).name, r.apiKeyId, r.status, r.ok,
      r.latencyMs, r.ttftMs, r.input, r.output, r.cacheRead, r.cacheWrite, r.reasoning, r.cost, r.saved, r.attempts.length, r.error,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
