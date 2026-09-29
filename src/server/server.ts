import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ConfigStore } from '../core/config';
import type { UsageStore } from '../core/usage';
import { logger } from '../core/logger';
import { errorBody } from '../translate';
import type { ApiFormat } from '../translate';
import { routeApi, isApiPath, normalizeApiPath } from './api';
import { routeAdmin, ServerInfo } from './admin';
import { json, text, HttpError } from './http';
import { authorizeApi, hostAllowed, hasValidSession, dashboardAccess } from './security';
import { uiAsset, uiNotFound, hasUi, decompress, logoSvg, type UiAsset } from './assets';

export interface RouterServer {
  server: http.Server;
  info: ServerInfo;
  close(): Promise<void>;
}

function formatForPath(path: string): ApiFormat {
  const p = normalizeApiPath(path);
  if (p.startsWith('/api/')) return 'ollama';
  if (p.includes('/messages')) return 'anthropic';
  if (p.startsWith('/v1beta') || p.startsWith('/v1alpha') || /:(generate|streamGenerate)Content$/.test(p)) return 'gemini';
  if (p.includes('/responses')) return 'responses';
  return 'openai';
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // ipc: / ipc.localhost are the desktop app's (Tauri) IPC channels.
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function sendAsset(req: IncomingMessage, res: ServerResponse, a: UiAsset, status = 200) {
  const headers: Record<string, string> = {
    'content-type': a.type,
    etag: a.etag,
    'cache-control': a.immutable ? 'public, max-age=31536000, immutable' : a.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    vary: 'accept-encoding',
    ...(a.type.startsWith('text/html') ? SECURITY_HEADERS : { 'x-content-type-options': 'nosniff' }),
  };
  if (status === 200 && req.headers['if-none-match'] === a.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const acceptsBr = /\bbr\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = a.br && !acceptsBr ? decompress(a) : a.body;
  if (a.br && acceptsBr) headers['content-encoding'] = 'br';
  headers['content-length'] = String(body.length);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createRouterServer(deps: { config: ConfigStore; usage: UsageStore }, info: ServerInfo): http.Server {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const cfg = deps.config.get();
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return text(res, 400, 'Bad request');
    }
    const path = url.pathname;
    // Lets tools (and other Open Gravity instances probing local engines) recognise the router.
    res.setHeader('x-og-router', 'open-gravity');

    try {
      if (!hostAllowed(req, cfg)) {
        return text(res, 403, 'Forbidden host');
      }

      // POST / is an API call (protocol auto-detection); GET / is the dashboard.
      const api = isApiPath(path) || (req.method === 'POST' && path === '/');
      if (api) {
        // CORS for browser-based clients; authorization still applies.
        res.setHeader('access-control-allow-origin', req.headers.origin || '*');
        res.setHeader('vary', 'origin');
        res.setHeader('access-control-expose-headers', 'x-og-provider, x-og-model, x-og-request-id, x-og-attempt, x-og-emulated-tools, x-og-cache');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': String(req.headers['access-control-request-headers'] || 'authorization, content-type, x-api-key'),
            'access-control-max-age': '86400',
          });
          return res.end();
        }
        const isHealth = /^\/(v1\/)?healthz?$/.test(normalizeApiPath(path));
        let apiKeyId: string | undefined;
        if (!isHealth) {
          const auth = authorizeApi(req, url, cfg, hasValidSession(req, cfg.settings.sessionSecret));
          if (!auth.ok) return json(res, auth.status || 401, errorBody(formatForPath(path), auth.status || 401, auth.message || 'Unauthorized'));
          apiKeyId = auth.keyId;
        }
        if (await routeApi({ req, res, url, path, apiKeyId }, deps)) return;
        return json(res, 404, errorBody(formatForPath(path), 404, `Unknown endpoint ${req.method} ${path}`));
      }

      if (path.startsWith('/admin/api/')) {
        await routeAdmin(req, res, url, deps, info);
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/ui' || path.startsWith('/ui/') || path === '/' || path === '/dashboard')) {
        const access = dashboardAccess(req, cfg);
        if (!access.allowed && !access.needsLogin) {
          return text(res, 403, `<!doctype html><meta charset="utf-8"><title>Open Gravity</title><body style="font-family:system-ui;padding:40px;background:#090a13;color:#e5e7eb"><h2>Dashboard locked</h2><p>${access.reason}</p></body>`, 'text/html; charset=utf-8', SECURITY_HEADERS);
        }
        if (path === '/' || path === '/dashboard' || path === '/ui') {
          res.writeHead(302, { location: `/ui/${url.search}`, 'cache-control': 'no-store' });
          return res.end();
        }
        const asset = uiAsset(path);
        if (asset) return sendAsset(req, res, asset);
        const nf = uiNotFound();
        if (nf) return sendAsset(req, res, nf, 404);
        if (!hasUi()) return text(res, 503, 'The dashboard was not built. Run "npm run build:ui".', 'text/plain; charset=utf-8');
        return text(res, 404, 'Not found');
      }
      if (req.method === 'GET' && (path === '/logo.svg' || path === '/favicon.svg' || path === '/favicon.ico')) {
        return text(res, 200, logoSvg(), 'image/svg+xml', { 'cache-control': 'public, max-age=86400' });
      }
      return json(res, 404, { error: { message: `Not found: ${req.method} ${path}`, type: 'not_found_error' } });
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) logger.error(`${req.method} ${path}: ${e?.stack || e}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      if (isApiPath(path)) return json(res, status, errorBody(formatForPath(path), status, e.message));
      return json(res, status, { error: { message: e.message } });
    }
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      logger.error(`Unhandled: ${e?.stack || e}`);
      if (!res.headersSent) json(res, 500, { error: { message: 'Internal error' } });
      else res.end();
    });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;
  return server;
}

export function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: any) => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
