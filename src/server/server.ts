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
import { panelHtml, logoSvg } from './assets';

export interface RouterServer {
  server: http.Server;
  info: ServerInfo;
  close(): Promise<void>;
}

function formatForPath(path: string): ApiFormat {
  const p = normalizeApiPath(path);
  if (p.includes('/messages')) return 'anthropic';
  if (p.startsWith('/v1beta') || p.startsWith('/v1alpha') || /:(generate|streamGenerate)Content$/.test(p)) return 'gemini';
  if (p.includes('/responses')) return 'responses';
  return 'openai';
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

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

    try {
      if (!hostAllowed(req, cfg)) {
        return text(res, 403, 'Forbidden host');
      }

      const api = isApiPath(path);
      if (api) {
        // CORS for browser-based clients; authorization still applies.
        res.setHeader('access-control-allow-origin', req.headers.origin || '*');
        res.setHeader('vary', 'origin');
        res.setHeader('access-control-expose-headers', 'x-og-provider, x-og-model, x-og-request-id');
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

      if (req.method === 'GET' && (path === '/' || path === '/dashboard' || path.startsWith('/ui'))) {
        const access = dashboardAccess(req, cfg);
        if (!access.allowed && !access.needsLogin) {
          return text(res, 403, `<!doctype html><meta charset="utf-8"><title>Open Gravity</title><body style="font-family:system-ui;padding:40px;background:#0b0f19;color:#e5e7eb"><h2>Dashboard locked</h2><p>${access.reason}</p></body>`, 'text/html; charset=utf-8', SECURITY_HEADERS);
        }
        return text(res, 200, panelHtml(), 'text/html; charset=utf-8', { ...SECURITY_HEADERS, 'cache-control': 'no-store' });
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
