// Access control for the inference API and the dashboard.
//
// Threat model: the router usually listens on localhost and holds provider
// API keys. We must stop (1) other machines on the network, (2) malicious web
// pages in the user's browser (CSRF / DNS rebinding) from using or reading it.
import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { AppConfig, RouterKey } from '../core/config';
import { isLoopback, safeEqual } from '../core/util';
import { clientIp, parseCookies } from './http';
import { isInternal } from '../router/internal';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostname(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase();
  return hostHeader.split(':')[0].toLowerCase();
}

/** Reject DNS-rebinding: when bound to loopback, Host must be a loopback name. */
export function hostAllowed(req: IncomingMessage, cfg: AppConfig): boolean {
  const bindHost = cfg.settings.host;
  if (!isLoopback(bindHost) && bindHost !== 'localhost') return true;
  const h = hostname(req.headers.host);
  return !h || LOCAL_HOSTNAMES.has(h) || h.endsWith('.localhost');
}

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

export function extractApiKey(req: IncomingMessage, url: URL): string {
  const auth = req.headers.authorization;
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const x = req.headers['x-api-key'] || req.headers['x-goog-api-key'];
  if (typeof x === 'string' && x) return x.trim();
  return url.searchParams.get('key') || '';
}

export function findRouterKey(cfg: AppConfig, key: string): RouterKey | undefined {
  if (!key) return undefined;
  return cfg.apiKeys.find((k) => k.enabled && safeEqual(k.key, key));
}

export interface ApiAuthResult {
  ok: boolean;
  status?: number;
  message?: string;
  keyId?: string;
}

export function authorizeApi(req: IncomingMessage, url: URL, cfg: AppConfig, hasDashboardSession: boolean): ApiAuthResult {
  const key = extractApiKey(req, url);
  const match = findRouterKey(cfg, key);
  if (match) return { ok: true, keyId: match.id };
  const remote = !isLoopback(clientIp(req));
  if (!remote && isInternal(req.headers)) return { ok: true, keyId: 'internal' };
  const crossOrigin = !isSameOrigin(req);
  if (!cfg.settings.requireApiKey && !remote && !crossOrigin) return { ok: true };
  if (hasDashboardSession && !crossOrigin) return { ok: true, keyId: 'dashboard' };
  let why = 'API key required.';
  if (remote) why = 'Remote access requires an Open Gravity API key.';
  else if (crossOrigin) why = 'Browser requests from other websites require an Open Gravity API key.';
  return {
    ok: false,
    status: 401,
    message: `${why} Create one in the dashboard (API Keys) and send it as "Authorization: Bearer <key>" or "x-api-key".`,
  };
}

// ---- dashboard sessions (HMAC-signed, stateless)

const SESSION_COOKIE = 'og_session';
const SESSION_TTL = 30 * 86400e3;

export function createSession(secret: string): string {
  const exp = Date.now() + SESSION_TTL;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  return `${exp}.${sig}`;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function hasValidSession(req: IncomingMessage, secret: string): boolean {
  const v = parseCookies(req)[SESSION_COOKIE];
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', secret).update(exp).digest('base64url');
  return safeEqual(sig, expected);
}

export interface DashboardAccess {
  allowed: boolean;
  needsLogin: boolean;
  reason?: string;
}

export function dashboardAccess(req: IncomingMessage, cfg: AppConfig): DashboardAccess {
  const remote = !isLoopback(clientIp(req));
  const pw = cfg.settings.dashboardPassword;
  if (!pw) {
    if (remote) return { allowed: false, needsLogin: false, reason: 'Set a dashboard password (from this machine) before accessing the dashboard remotely.' };
    return { allowed: true, needsLogin: false };
  }
  if (hasValidSession(req, cfg.settings.sessionSecret)) return { allowed: true, needsLogin: false };
  return { allowed: false, needsLogin: true };
}
