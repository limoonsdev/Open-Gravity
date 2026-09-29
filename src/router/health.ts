// In-memory health / cooldown tracking for provider keys.
// Rate limits cool down a (key, model) pair; auth failures cool down the whole key.

export interface KeyHealth {
  cooldownUntil: number;
  reason?: string;
  lastError?: string;
  lastErrorAt?: number;
  lastStatus?: number;
  lastOkAt?: number;
  failures: number;
}

class HealthTracker {
  private keys = new Map<string, KeyHealth>();
  private models = new Map<string, number>();
  private latency = new Map<string, number>();

  /** Exponentially weighted time-to-first-token per "provider/model" target. */
  recordLatency(target: string, ms: number) {
    const prev = this.latency.get(target);
    this.latency.set(target, prev === undefined ? ms : prev * 0.7 + ms * 0.3);
  }

  latencyOf(target: string): number | undefined {
    return this.latency.get(target);
  }

  latencies(): Record<string, number> {
    return Object.fromEntries([...this.latency].map(([k, v]) => [k, Math.round(v)]));
  }

  private k(provider: string, keyId: string) {
    return `${provider}:${keyId}`;
  }

  private entry(provider: string, keyId: string): KeyHealth {
    const id = this.k(provider, keyId);
    let e = this.keys.get(id);
    if (!e) {
      e = { cooldownUntil: 0, failures: 0 };
      this.keys.set(id, e);
    }
    return e;
  }

  coolingUntil(provider: string, keyId: string, model?: string): number {
    const keyUntil = this.keys.get(this.k(provider, keyId))?.cooldownUntil || 0;
    const modelUntil = model ? this.models.get(`${this.k(provider, keyId)}:${model}`) || 0 : 0;
    return Math.max(keyUntil, modelUntil);
  }

  isCooling(provider: string, keyId: string, model?: string): boolean {
    return this.coolingUntil(provider, keyId, model) > Date.now();
  }

  fail(provider: string, keyId: string, opts: { status?: number; error: string; cooldownMs: number; model?: string }) {
    const e = this.entry(provider, keyId);
    e.failures++;
    e.lastError = opts.error;
    e.lastErrorAt = Date.now();
    e.lastStatus = opts.status;
    if (opts.cooldownMs > 0) {
      const until = Date.now() + opts.cooldownMs;
      if (opts.model) this.models.set(`${this.k(provider, keyId)}:${opts.model}`, until);
      else {
        e.cooldownUntil = until;
        e.reason = opts.error;
      }
    }
  }

  ok(provider: string, keyId: string, model?: string) {
    const e = this.entry(provider, keyId);
    e.failures = 0;
    e.lastOkAt = Date.now();
    e.lastStatus = 200;
    if (model) this.models.delete(`${this.k(provider, keyId)}:${model}`);
  }

  reset(provider: string, keyId?: string) {
    for (const id of [...this.keys.keys()]) if (id.startsWith(`${provider}:`) && (!keyId || id === this.k(provider, keyId))) this.keys.delete(id);
    for (const id of [...this.models.keys()]) if (id.startsWith(`${provider}:`) && (!keyId || id.startsWith(`${this.k(provider, keyId)}:`))) this.models.delete(id);
  }

  snapshot(provider: string, keyId: string) {
    const e = this.keys.get(this.k(provider, keyId));
    const now = Date.now();
    const modelCooldowns: Record<string, number> = {};
    const prefix = `${this.k(provider, keyId)}:`;
    for (const [id, until] of this.models) if (id.startsWith(prefix) && until > now) modelCooldowns[id.slice(prefix.length)] = until;
    return {
      cooldownUntil: e && e.cooldownUntil > now ? e.cooldownUntil : 0,
      reason: e?.reason,
      lastError: e?.lastError,
      lastErrorAt: e?.lastErrorAt,
      lastStatus: e?.lastStatus,
      lastOkAt: e?.lastOkAt,
      failures: e?.failures || 0,
      modelCooldowns,
    };
  }
}

export const health = new HealthTracker();
