// Request log + usage analytics, persisted as daily JSONL files.
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { dataDir } from './util';
import { logger } from './logger';

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
  emulatedTools?: boolean;
  adapted?: string[];
  cached?: boolean;
}

export interface CapturedBodies {
  request?: any;
  upstreamRequest?: any;
  response?: string;
}

export type Range = '1h' | '24h' | '7d' | '30d';

const RANGE_MS: Record<Range, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };

interface Bucket { t: number; requests: number; errors: number; input: number; output: number; cost: number }
interface Group { key: string; requests: number; errors: number; input: number; output: number; cost: number; latency: number }

export class UsageStore extends EventEmitter {
  private records: UsageRecord[] = [];
  private bodies = new Map<string, CapturedBodies>();
  private dir: string;
  private retentionDays: number;

  constructor(retentionDays = 30, dir = path.join(dataDir(), 'usage')) {
    super();
    this.setMaxListeners(100);
    this.dir = dir;
    this.retentionDays = retentionDays;
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  setRetention(days: number) {
    this.retentionDays = Math.max(1, days);
  }

  private fileFor(ts: number) {
    return path.join(this.dir, `${new Date(ts).toISOString().slice(0, 10)}.jsonl`);
  }

  private load() {
    const cutoff = Date.now() - this.retentionDays * 86400e3;
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
    } catch { /* empty */ }
    for (const f of files) {
      const day = Date.parse(f.slice(0, 10));
      if (day + 86400e3 < cutoff) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ignore */ }
        continue;
      }
      try {
        const lines = fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const r = JSON.parse(line);
            if (r.ts >= cutoff) this.records.push(r);
          } catch { /* skip */ }
        }
      } catch (e: any) {
        logger.warn(`Could not read usage log ${f}: ${e.message}`);
      }
    }
    this.records.sort((a, b) => a.ts - b.ts);
  }

  add(r: UsageRecord, bodies?: CapturedBodies) {
    this.records.push(r);
    const cutoff = Date.now() - this.retentionDays * 86400e3;
    while (this.records.length && this.records[0].ts < cutoff) this.records.shift();
    if (bodies) {
      this.bodies.set(r.id, bodies);
      if (this.bodies.size > 50) this.bodies.delete(this.bodies.keys().next().value!);
    }
    fs.appendFile(this.fileFor(r.ts), JSON.stringify(r) + '\n', () => { /* best effort */ });
    this.emit('record', r);
  }

  getBodies(id: string) {
    return this.bodies.get(id);
  }

  recent(limit = 100, filter?: { ok?: boolean; q?: string }): UsageRecord[] {
    const out: UsageRecord[] = [];
    const q = filter?.q?.toLowerCase();
    for (let i = this.records.length - 1; i >= 0 && out.length < limit; i--) {
      const r = this.records[i];
      if (filter?.ok !== undefined && r.ok !== filter.ok) continue;
      if (q && !`${r.requestedModel} ${r.provider} ${r.model} ${r.endpoint} ${r.error || ''}`.toLowerCase().includes(q)) continue;
      out.push(r);
    }
    return out;
  }

  get(id: string) {
    for (let i = this.records.length - 1; i >= 0; i--) if (this.records[i].id === id) return this.records[i];
    return undefined;
  }

  /** Stats per provider key over the retention window (for provider health display). */
  keyStats(): Record<string, { requests: number; errors: number; lastUsed: number; tokens: number }> {
    const out: Record<string, { requests: number; errors: number; lastUsed: number; tokens: number }> = {};
    for (const r of this.records) {
      for (const a of r.attempts) {
        if (!a.keyId) continue;
        const k = `${a.provider}:${a.keyId}`;
        const s = (out[k] ||= { requests: 0, errors: 0, lastUsed: 0, tokens: 0 });
        s.requests++;
        if (a.error) s.errors++;
        s.lastUsed = Math.max(s.lastUsed, r.ts);
      }
      if (r.ok && r.provider && r.keyId) {
        const k = `${r.provider}:${r.keyId}`;
        if (out[k]) out[k].tokens += r.input + r.output;
      }
    }
    return out;
  }

  summary(range: Range = '24h') {
    const now = Date.now();
    const span = RANGE_MS[range] || RANGE_MS['24h'];
    const start = now - span;
    const bucketMs = range === '1h' ? 5 * 60e3 : range === '24h' ? 3600e3 : 86400e3;
    const first = Math.floor(start / bucketMs) * bucketMs;
    const last = Math.floor(now / bucketMs) * bucketMs;
    const buckets: Bucket[] = [];
    for (let t = first; t <= last; t += bucketMs) buckets.push({ t, requests: 0, errors: 0, input: 0, output: 0, cost: 0 });

    const totals = { requests: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cost: 0, latencySum: 0, ttftSum: 0, ttftCount: 0 };
    const byModel = new Map<string, Group>();
    const byProvider = new Map<string, Group>();
    const byEndpoint = new Map<string, Group>();
    const bump = (map: Map<string, Group>, key: string, r: UsageRecord) => {
      const g = map.get(key) || { key, requests: 0, errors: 0, input: 0, output: 0, cost: 0, latency: 0 };
      g.requests++;
      if (!r.ok) g.errors++;
      g.input += r.input;
      g.output += r.output;
      g.cost += r.cost;
      g.latency += r.latencyMs;
      map.set(key, g);
    };

    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.ts < start) break;
      totals.requests++;
      if (!r.ok) totals.errors++;
      totals.input += r.input;
      totals.output += r.output;
      totals.cacheRead += r.cacheRead || 0;
      totals.cost += r.cost;
      totals.latencySum += r.latencyMs;
      if (r.ttftMs) { totals.ttftSum += r.ttftMs; totals.ttftCount++; }
      const b = buckets[Math.min(Math.max(Math.floor((r.ts - first) / bucketMs), 0), buckets.length - 1)];
      if (b) {
        b.requests++;
        if (!r.ok) b.errors++;
        b.input += r.input;
        b.output += r.output;
        b.cost += r.cost;
      }
      bump(byModel, r.ok && r.provider ? `${r.provider}/${r.model}` : r.requestedModel || '(none)', r);
      bump(byProvider, r.provider || '(unrouted)', r);
      bump(byEndpoint, r.endpoint, r);
    }
    const sorted = (m: Map<string, Group>) => [...m.values()].sort((a, b) => b.requests - a.requests).slice(0, 12);
    return {
      range,
      bucketMs,
      totals: {
        requests: totals.requests,
        errors: totals.errors,
        successRate: totals.requests ? (totals.requests - totals.errors) / totals.requests : 1,
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        cost: Math.round(totals.cost * 10000) / 10000,
        avgLatencyMs: totals.requests ? Math.round(totals.latencySum / totals.requests) : 0,
        avgTtftMs: totals.ttftCount ? Math.round(totals.ttftSum / totals.ttftCount) : 0,
      },
      series: buckets,
      byModel: sorted(byModel),
      byProvider: sorted(byProvider),
      byEndpoint: sorted(byEndpoint),
    };
  }

  clear() {
    this.records = [];
    this.bodies.clear();
    try {
      for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.jsonl')) fs.unlinkSync(path.join(this.dir, f));
    } catch { /* ignore */ }
  }
}
