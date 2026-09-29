// Remaining credit / balance of a provider account, for providers that expose
// it through their API. Other providers only report rate limits (see quota.ts).
import type { ProviderConfig, ProviderKey } from '../core/config';
import { authHeaders, upstreamFetch } from './upstream';

export interface Balance {
  provider: string;
  keyId: string;
  ok: boolean;
  currency?: string;
  /** Credit left (in `currency`). */
  remaining?: number;
  /** Credit limit or total purchased, when known. */
  limit?: number;
  used?: number;
  freeTier?: boolean;
  note?: string;
  error?: string;
  at: number;
}

type Fetcher = (p: ProviderConfig, key: ProviderKey, get: (url: string) => Promise<any>) => Promise<Omit<Balance, 'provider' | 'keyId' | 'ok' | 'at'>>;

const root = (p: ProviderConfig) => p.baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
const num = (v: any) => (v === null || v === undefined || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

const openrouter: Fetcher = async (p, _k, get) => {
  const base = p.baseUrl.replace(/\/+$/, '');
  let credits: any;
  try {
    credits = (await get(`${base}/credits`))?.data;
  } catch { /* needs a provisioning key on some accounts */ }
  let info: any;
  try {
    info = (await get(`${base}/key`))?.data;
  } catch {
    info = (await get(`${base}/auth/key`))?.data;
  }
  if (credits && num(credits.total_credits) !== undefined) {
    const total = num(credits.total_credits)!;
    const used = num(credits.total_usage) ?? 0;
    return { currency: 'USD', remaining: Math.max(0, total - used), limit: total, used, freeTier: info?.is_free_tier };
  }
  const limit = num(info?.limit);
  const used = num(info?.usage);
  return {
    currency: 'USD', limit, used,
    remaining: num(info?.limit_remaining) ?? (limit !== undefined && used !== undefined ? Math.max(0, limit - used) : undefined),
    freeTier: info?.is_free_tier,
    note: limit === undefined ? 'No spending limit on this key' : undefined,
  };
};

const deepseek: Fetcher = async (p, _k, get) => {
  const d = await get(`${root(p)}/user/balance`);
  const b = (d?.balance_infos || []).find((x: any) => x.currency === 'USD') || d?.balance_infos?.[0];
  return { currency: b?.currency, remaining: num(b?.total_balance), note: d?.is_available === false ? 'Balance insufficient' : undefined };
};

const moonshot: Fetcher = async (p, _k, get) => {
  const d = (await get(`${root(p)}/v1/users/me/balance`))?.data;
  return { currency: /\.cn\b/.test(p.baseUrl) ? 'CNY' : 'USD', remaining: num(d?.available_balance), note: num(d?.voucher_balance) ? `includes ${num(d.voucher_balance)} voucher` : undefined };
};

const siliconflow: Fetcher = async (p, _k, get) => {
  const d = (await get(`${root(p)}/v1/user/info`))?.data;
  return { currency: /\.cn\b/.test(p.baseUrl) ? 'CNY' : 'USD', remaining: num(d?.totalBalance ?? d?.balance) };
};

/** one-api / new-api style relays expose the old OpenAI billing endpoints. */
const oneApi: Fetcher = async (p, _k, get) => {
  const r = root(p);
  const sub = await get(`${r}/dashboard/billing/subscription`);
  const limit = num(sub?.hard_limit_usd ?? sub?.system_hard_limit_usd);
  const end = new Date();
  const start = new Date(end.getTime() - 100 * 86400e3);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  let used: number | undefined;
  try {
    const u = await get(`${r}/dashboard/billing/usage?start_date=${fmt(start)}&end_date=${fmt(end)}`);
    used = num(u?.total_usage) !== undefined ? num(u.total_usage)! / 100 : undefined;
  } catch { /* optional */ }
  return { currency: 'USD', limit, used, remaining: limit !== undefined && used !== undefined ? Math.max(0, limit - used) : limit };
};

const FETCHERS: Record<string, Fetcher> = {
  openrouter,
  deepseek,
  'deepseek-anthropic': deepseek,
  moonshot,
  'moonshot-china': moonshot,
  'moonshot-anthropic': moonshot,
  siliconflow,
  'siliconflow-china': siliconflow,
  aihubmix: oneApi,
  'openai-compatible': oneApi,
};

export function supportsBalance(p: ProviderConfig): boolean {
  return !!FETCHERS[p.type];
}

const cache = new Map<string, Balance>();

export async function fetchBalance(p: ProviderConfig, key: ProviderKey, proxy?: string, force = false): Promise<Balance> {
  const ck = `${p.id}:${key.id}`;
  const hit = cache.get(ck);
  if (!force && hit && Date.now() - hit.at < 5 * 60e3) return hit;
  const f = FETCHERS[p.type];
  const base: Balance = { provider: p.id, keyId: key.id, ok: false, at: Date.now() };
  if (!f) return { ...base, error: 'This provider does not report a balance through its API' };
  const headers = { accept: 'application/json', ...authHeaders(p, key) };
  const get = async (url: string) => {
    const res = await upstreamFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15_000) }, { proxy: p.proxy || proxy, headersTimeout: 15_000, bodyTimeout: 15_000 });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    return text ? JSON.parse(text) : {};
  };
  try {
    const r = await f(p, key, get);
    const out: Balance = { ...base, ...r, ok: r.remaining !== undefined || r.limit !== undefined || r.used !== undefined };
    if (!out.ok && !out.error) out.error = 'The provider did not return a balance';
    cache.set(ck, out);
    return out;
  } catch (e: any) {
    const out = { ...base, error: e?.message || String(e) };
    cache.set(ck, out);
    return out;
  }
}
