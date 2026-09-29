// Dashboard management API: /admin/api/*
import type { IncomingMessage, ServerResponse } from 'http';
import os from 'os';
import type { AppConfig, ProviderConfig, ComboConfig } from '../core/config';
import { newProviderFromTemplate, normalize } from '../core/config';
import { logger } from '../core/logger';
import { hashPassword, verifyPassword, maskKey, randomId, randomKey, slugify, VERSION, dataDir, isLoopback } from '../core/util';
import type { Range } from '../core/usage';
import { CATALOG, getTemplate } from '../providers/catalog';
import { fetchProviderModels } from '../providers/upstream';
import { antigravityStatus } from '../providers/antigravity';
import { health } from '../router/health';
import { probeProvider } from '../router/probe';
import { listRoutableModels, effectiveDefault, resolveModel } from '../router/resolve';
import { handleInference, Deps } from '../router/executor';
import { listTools, applyTool, restoreTool, ToolContext } from '../integrations/tools';
import { json, readJson, HttpError, clientIp } from './http';
import { createSession, sessionCookie, clearSessionCookie, dashboardAccess, isSameOrigin } from './security';

export interface ServerInfo {
  port: number;
  host: string;
  startedAt: number;
}

function publicBaseUrl(info: ServerInfo): string {
  const host = info.host === '0.0.0.0' || info.host === '::' ? '127.0.0.1' : info.host;
  return `http://${host.includes(':') ? `[${host}]` : host}:${info.port}`;
}

function providerView(p: ProviderConfig, keyStats: ReturnType<Deps['usage']['keyStats']>) {
  const tpl = getTemplate(p.type);
  return {
    ...p,
    keyOptional: !!tpl?.keyOptional,
    color: tpl?.color || '#64748b',
    keys: p.keys.map((k) => ({
      id: k.id,
      label: k.label,
      enabled: k.enabled,
      masked: maskKey(k.key),
      health: health.snapshot(p.id, k.id),
      stats: keyStats[`${p.id}:${k.id}`] || { requests: 0, errors: 0, lastUsed: 0, tokens: 0 },
    })),
  };
}

function stateView(cfg: AppConfig, deps: Deps, info: ServerInfo) {
  const keyStats = deps.usage.keyStats();
  const { dashboardPassword, sessionSecret, ...settings } = cfg.settings;
  return {
    version: VERSION,
    dataDir: dataDir(),
    baseUrl: publicBaseUrl(info),
    listening: { host: info.host, port: info.port },
    startedAt: info.startedAt,
    platform: `${os.platform()}-${os.arch()}`,
    settings: { ...settings, passwordSet: !!dashboardPassword },
    effectiveDefault: effectiveDefault(cfg),
    providers: cfg.providers.map((p) => providerView(p, keyStats)),
    combos: cfg.combos,
    aliases: cfg.aliases,
    apiKeys: cfg.apiKeys.map((k) => ({ ...k, masked: maskKey(k.key) })),
    catalog: CATALOG.map(({ type, name, format, baseUrl, category, description, keyUrl, keyOptional, freeTier, models, color }) => ({
      type, name, format, baseUrl, category, description, keyUrl, keyOptional, freeTier, models, color,
    })),
    models: listRoutableModels(cfg),
  };
}

function findProvider(cfg: AppConfig, id: string): ProviderConfig {
  const p = cfg.providers.find((x) => x.id === id);
  if (!p) throw new HttpError(404, `Provider "${id}" not found`);
  return p;
}

function validateComboId(cfg: AppConfig, id: string, current?: string) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id)) throw new HttpError(400, 'Combo names may only contain letters, digits, ".", "_", ":" and "-"');
  if (cfg.combos.some((c) => c.id === id && c.id !== current)) throw new HttpError(409, `A combo named "${id}" already exists`);
  if (cfg.providers.some((p) => p.id === id)) throw new HttpError(409, `"${id}" is already a provider id`);
}

function toolContext(cfg: AppConfig, info: ServerInfo, body: any): ToolContext {
  const def = effectiveDefault(cfg);
  const model = String(body.model || def || '');
  if (!model) throw new HttpError(400, 'Choose a model first (add a provider or a combo).');
  const key = body.apiKeyId ? cfg.apiKeys.find((k) => k.id === body.apiKeyId)?.key : cfg.apiKeys.find((k) => k.enabled)?.key;
  return {
    baseUrl: publicBaseUrl(info),
    apiKey: key || '',
    model,
    smallModel: String(body.smallModel || model),
    models: listRoutableModels(cfg).map((m) => m.id),
  };
}

export async function routeAdmin(req: IncomingMessage, res: ServerResponse, url: URL, deps: Deps, info: ServerInfo): Promise<void> {
  const method = req.method || 'GET';
  const path = url.pathname.replace(/^\/admin\/api/, '') || '/';
  const store = deps.config;
  const cfg = store.get();

  // CSRF: browsers cannot set this header cross-origin without a preflight we never allow.
  if (method !== 'GET' && req.headers['x-og-admin'] !== '1') throw new HttpError(403, 'Missing x-og-admin header');
  if (!isSameOrigin(req)) throw new HttpError(403, 'Cross-origin requests are not allowed');

  const access = dashboardAccess(req, cfg);

  if (path === '/session' && method === 'GET') {
    return json(res, 200, {
      authenticated: access.allowed, needsLogin: access.needsLogin, reason: access.reason,
      passwordSet: !!cfg.settings.dashboardPassword, remote: !isLoopback(clientIp(req)), version: VERSION,
    });
  }
  if (path === '/login' && method === 'POST') {
    const body = await readJson(req);
    if (!cfg.settings.dashboardPassword) throw new HttpError(400, 'No password is set');
    if (!verifyPassword(String(body.password || ''), cfg.settings.dashboardPassword)) {
      logger.warn(`Failed dashboard login from ${clientIp(req)}`);
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, 'Wrong password');
    }
    const secure = req.headers['x-forwarded-proto'] === 'https';
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(createSession(cfg.settings.sessionSecret), secure) });
  }
  if (path === '/logout' && method === 'POST') {
    return json(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
  }

  if (!access.allowed) throw new HttpError(access.needsLogin ? 401 : 403, access.reason || 'Login required');

  const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
  let m: RegExpExecArray | null;

  // ---- state & settings
  if (path === '/state' && method === 'GET') return json(res, 200, stateView(cfg, deps, info));

  if (path === '/settings' && method === 'PUT') {
    const allowed = ['port', 'host', 'defaultModel', 'unknownModelFallback', 'requireApiKey', 'openBrowser', 'headersTimeoutMs', 'idleTimeoutMs',
      'maxAttempts', 'cooldownRateLimitMs', 'cooldownAuthMs', 'cooldownServerMs', 'logRetentionDays', 'captureBodies', 'upstreamProxy', 'passthrough'] as const;
    store.update((c) => {
      for (const k of allowed) if (k in body) (c.settings as any)[k] = body[k];
      c.settings.port = Math.min(65535, Math.max(1, Number(c.settings.port) || 18080));
      c.settings.maxAttempts = Math.min(20, Math.max(1, Number(c.settings.maxAttempts) || 6));
    });
    deps.usage.setRetention(store.settings.logRetentionDays);
    const restart = ('port' in body && body.port !== info.port) || ('host' in body && body.host !== info.host);
    return json(res, 200, { ok: true, restartRequired: restart });
  }

  if (path === '/password' && method === 'POST') {
    const pw = String(body.password || '');
    if (pw && pw.length < 6) throw new HttpError(400, 'Password must have at least 6 characters');
    store.update((c) => {
      c.settings.dashboardPassword = pw ? hashPassword(pw) : undefined;
    });
    const secure = req.headers['x-forwarded-proto'] === 'https';
    return json(res, 200, { ok: true }, pw ? { 'set-cookie': sessionCookie(createSession(cfg.settings.sessionSecret), secure) } : {});
  }

  // ---- providers
  if (path === '/providers' && method === 'POST') {
    const tpl = getTemplate(String(body.type || ''));
    if (!tpl) throw new HttpError(400, 'Unknown provider type');
    const keys = (Array.isArray(body.keys) ? body.keys : body.key ? [body.key] : [])
      .map((k: string) => String(k).trim()).filter(Boolean)
      .map((k: string, i: number) => ({ id: randomId(8), label: `key ${i + 1}`, key: k, enabled: true }));
    if (!keys.length && !tpl.keyOptional) throw new HttpError(400, 'An API key is required for this provider');
    const p = newProviderFromTemplate(tpl.type, cfg, { name: body.name, baseUrl: body.baseUrl, keys, id: body.id });
    if (Array.isArray(body.models) && body.models.length) p.models = body.models;
    store.update((c) => c.providers.push(p));
    logger.success(`Provider added: ${p.name} (${p.id})`);
    // Discover real model list in the background.
    if (tpl.modelsApi !== 'none') {
      fetchProviderModels(p, cfg.settings.upstreamProxy).then((r) => {
        if (r.models.length) {
          store.update((c) => {
            const cur = c.providers.find((x) => x.id === p.id);
            if (cur && (!tpl.models.length || cur.models.join() === tpl.models.join())) cur.models = mergeModels(tpl.models, r.models);
          });
        }
      }).catch(() => undefined);
    }
    return json(res, 201, { ok: true, id: p.id });
  }

  if ((m = /^\/providers\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const p = findProvider(cfg, id);
    if (method === 'DELETE') {
      store.update((c) => {
        c.providers = c.providers.filter((x) => x.id !== id);
      });
      health.reset(id);
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const newId = body.id !== undefined ? slugify(String(body.id)) : id;
      if (newId !== id && cfg.providers.some((x) => x.id === newId)) throw new HttpError(409, `Provider id "${newId}" is taken`);
      store.update((c) => {
        const cur = c.providers.find((x) => x.id === id)!;
        if (body.name !== undefined) cur.name = String(body.name);
        if (body.baseUrl !== undefined) cur.baseUrl = String(body.baseUrl).trim().replace(/\/+$/, '');
        if (body.enabled !== undefined) cur.enabled = !!body.enabled;
        if (body.rotation !== undefined) cur.rotation = body.rotation === 'fill-first' ? 'fill-first' : 'round-robin';
        if (body.models !== undefined) cur.models = [...new Set((body.models as string[]).map((x) => String(x).trim()).filter(Boolean))];
        if (body.headers !== undefined) cur.headers = body.headers && Object.keys(body.headers).length ? body.headers : undefined;
        if (body.flags !== undefined) cur.flags = body.flags;
        if (body.timeoutMs !== undefined) cur.timeoutMs = Number(body.timeoutMs) || undefined;
        if (body.proxy !== undefined) cur.proxy = String(body.proxy || '').trim() || undefined;
        if (newId !== id) {
          cur.id = newId;
          // Keep combos and aliases pointing at the renamed provider.
          const fix = (t: string) => (t.startsWith(`${id}/`) ? `${newId}/${t.slice(id.length + 1)}` : t);
          for (const combo of c.combos) combo.targets = combo.targets.map(fix);
          for (const k of Object.keys(c.aliases)) c.aliases[k] = fix(c.aliases[k]);
          if (c.settings.defaultModel) c.settings.defaultModel = fix(c.settings.defaultModel);
        }
      });
      return json(res, 200, { ok: true, id: newId });
    }
    void p;
  }

  if ((m = /^\/providers\/([^/]+)\/keys$/.exec(path)) && method === 'POST') {
    const p = findProvider(cfg, decodeURIComponent(m[1]));
    const keys = String(body.key || '').split(/[\s,]+/).map((k) => k.trim()).filter(Boolean);
    if (!keys.length) throw new HttpError(400, 'Key is required');
    store.update(() => {
      for (const k of keys) {
        if (p.keys.some((x) => x.key === k)) continue;
        p.keys.push({ id: randomId(8), label: body.label || `key ${p.keys.length + 1}`, key: k, enabled: true });
      }
    });
    return json(res, 201, { ok: true, added: keys.length });
  }

  if ((m = /^\/providers\/([^/]+)\/keys\/([^/]+)$/.exec(path))) {
    const p = findProvider(cfg, decodeURIComponent(m[1]));
    const keyId = decodeURIComponent(m[2]);
    const k = p.keys.find((x) => x.id === keyId);
    if (!k) throw new HttpError(404, 'Key not found');
    if (method === 'DELETE') {
      store.update(() => {
        p.keys = p.keys.filter((x) => x.id !== keyId);
      });
      health.reset(p.id, keyId);
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      store.update(() => {
        if (body.enabled !== undefined) k.enabled = !!body.enabled;
        if (body.label !== undefined) k.label = String(body.label);
        if (body.key) k.key = String(body.key).trim();
      });
      return json(res, 200, { ok: true });
    }
  }

  if ((m = /^\/providers\/([^/]+)\/models\/fetch$/.exec(path)) && method === 'POST') {
    const p = findProvider(cfg, decodeURIComponent(m[1]));
    let r: { models: string[]; error?: string };
    if (p.format === 'antigravity') {
      const st = await antigravityStatus();
      r = st.connected ? { models: st.models } : { models: [], error: 'Antigravity app not detected' };
    } else r = await fetchProviderModels(p, cfg.settings.upstreamProxy);
    if (r.error && !r.models.length) throw new HttpError(502, r.error);
    return json(res, 200, { models: r.models });
  }

  if ((m = /^\/providers\/([^/]+)\/test$/.exec(path)) && method === 'POST') {
    const p = findProvider(cfg, decodeURIComponent(m[1]));
    const result = await probeProvider(p, cfg.settings, { keyId: body.keyId, model: body.model });
    return json(res, 200, result);
  }

  if ((m = /^\/providers\/([^/]+)\/reset$/.exec(path)) && method === 'POST') {
    health.reset(decodeURIComponent(m[1]));
    return json(res, 200, { ok: true });
  }

  // ---- combos
  if (path === '/combos' && method === 'POST') {
    const id = String(body.id || '').trim();
    validateComboId(cfg, id);
    const combo: ComboConfig = {
      id, description: body.description || '', targets: (body.targets || []).filter(Boolean),
      strategy: ['fallback', 'round-robin', 'random'].includes(body.strategy) ? body.strategy : 'fallback', enabled: true,
    };
    store.update((c) => c.combos.push(combo));
    return json(res, 201, { ok: true });
  }
  if ((m = /^\/combos\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const combo = cfg.combos.find((c) => c.id === id);
    if (!combo) throw new HttpError(404, 'Combo not found');
    if (method === 'DELETE') {
      store.update((c) => {
        c.combos = c.combos.filter((x) => x.id !== id);
      });
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const newId = body.id !== undefined ? String(body.id).trim() : id;
      if (newId !== id) validateComboId(cfg, newId, id);
      store.update((c) => {
        const cur = c.combos.find((x) => x.id === id)!;
        if (body.targets !== undefined) cur.targets = (body.targets as string[]).filter(Boolean);
        if (body.strategy !== undefined) cur.strategy = body.strategy;
        if (body.description !== undefined) cur.description = body.description;
        if (body.enabled !== undefined) cur.enabled = !!body.enabled;
        if (newId !== id) {
          cur.id = newId;
          for (const k of Object.keys(c.aliases)) if (c.aliases[k] === id) c.aliases[k] = newId;
          if (c.settings.defaultModel === id) c.settings.defaultModel = newId;
        }
      });
      return json(res, 200, { ok: true });
    }
  }

  // ---- aliases
  if (path === '/aliases' && method === 'PUT') {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.aliases || {})) {
      if (String(k).trim() && String(v).trim()) next[String(k).trim()] = String(v).trim();
    }
    store.update((c) => {
      c.aliases = next;
    });
    return json(res, 200, { ok: true });
  }

  // ---- router API keys
  if (path === '/keys' && method === 'POST') {
    const key = { id: randomId(8), name: String(body.name || 'key').slice(0, 60), key: randomKey(), enabled: true, createdAt: Date.now() };
    store.update((c) => c.apiKeys.push(key));
    return json(res, 201, key);
  }
  if ((m = /^\/keys\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const k = cfg.apiKeys.find((x) => x.id === id);
    if (!k) throw new HttpError(404, 'Key not found');
    if (method === 'DELETE') {
      store.update((c) => {
        c.apiKeys = c.apiKeys.filter((x) => x.id !== id);
      });
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      store.update(() => {
        if (body.enabled !== undefined) k.enabled = !!body.enabled;
        if (body.name !== undefined) k.name = String(body.name).slice(0, 60);
      });
      return json(res, 200, { ok: true });
    }
  }
  if ((m = /^\/keys\/([^/]+)\/reveal$/.exec(path)) && method === 'POST') {
    const k = cfg.apiKeys.find((x) => x.id === decodeURIComponent(m![1]));
    if (!k) throw new HttpError(404, 'Key not found');
    return json(res, 200, { key: k.key });
  }

  // ---- usage & logs
  if (path === '/usage/summary' && method === 'GET') {
    return json(res, 200, deps.usage.summary((url.searchParams.get('range') as Range) || '24h'));
  }
  if (path === '/usage/recent' && method === 'GET') {
    const status = url.searchParams.get('status');
    return json(res, 200, deps.usage.recent(Math.min(500, Number(url.searchParams.get('limit')) || 100), {
      ok: status === 'ok' ? true : status === 'error' ? false : undefined,
      q: url.searchParams.get('q') || undefined,
    }));
  }
  if ((m = /^\/usage\/([^/]+)$/.exec(path)) && method === 'GET') {
    const rec = deps.usage.get(m[1]);
    if (!rec) throw new HttpError(404, 'Request not found');
    return json(res, 200, { record: rec, bodies: deps.usage.getBodies(m[1]) || null });
  }
  if (path === '/usage' && method === 'DELETE') {
    deps.usage.clear();
    return json(res, 200, { ok: true });
  }
  if (path === '/events' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const l of logger.recent().slice(-150)) send('log', l);
    const onLog = (l: any) => send('log', l);
    const onRecord = (r: any) => send('request', r);
    logger.on('log', onLog);
    deps.usage.on('record', onRecord);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      logger.off('log', onLog);
      deps.usage.off('record', onRecord);
    });
    return;
  }

  // ---- integrations
  if (path === '/integrations' && method === 'GET') {
    const def = effectiveDefault(cfg);
    const ctx = toolContext(cfg, info, { model: url.searchParams.get('model') || def || 'your-model', smallModel: url.searchParams.get('smallModel') || undefined, apiKeyId: url.searchParams.get('apiKeyId') || undefined });
    return json(res, 200, listTools(ctx));
  }
  if ((m = /^\/integrations\/([^/]+)\/(apply|restore)$/.exec(path)) && method === 'POST') {
    try {
      const result = m[2] === 'apply' ? applyTool(m[1], toolContext(cfg, info, body)) : restoreTool(m[1]);
      logger.success(`${m[2] === 'apply' ? 'Configured' : 'Restored'} ${m[1]}: ${result.files.join(', ')}`);
      return json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, e.message);
    }
  }

  // ---- config import/export
  if (path === '/config/export' && method === 'GET') {
    return json(res, 200, cfg, { 'content-disposition': 'attachment; filename="open-gravity-config.json"' });
  }
  if (path === '/config/import' && method === 'POST') {
    const next = normalize(body);
    next.settings.sessionSecret = cfg.settings.sessionSecret;
    if (!body?.settings?.dashboardPassword) next.settings.dashboardPassword = cfg.settings.dashboardPassword;
    store.replace(next);
    logger.success('Configuration imported');
    return json(res, 200, { ok: true });
  }

  // ---- misc
  if (path === '/antigravity' && method === 'GET') return json(res, 200, await antigravityStatus());

  if (path === '/resolve' && method === 'GET') {
    const r = resolveModel(cfg, url.searchParams.get('model') || '');
    return json(res, 200, {
      via: r.via, combo: r.combo, error: r.error,
      candidates: r.candidates.map((c) => ({
        target: c.target, provider: c.provider.id, model: c.model, combo: c.combo,
        keys: c.provider.keys.length ? c.provider.keys.map((k) => ({ id: k.id, label: k.label, enabled: k.enabled, cooling: health.isCooling(c.provider.id, k.id, c.model) })) : [],
      })),
    });
  }

  if (path === '/playground' && method === 'POST') {
    await handleInference({
      format: 'openai', body, model: String(body.model || ''), stream: !!body.stream, headers: req.headers, apiKeyId: 'dashboard', endpoint: 'playground',
    }, req, res, deps);
    return;
  }

  throw new HttpError(404, `No admin route for ${method} ${path}`);
}

function mergeModels(suggested: string[], fetched: string[]): string[] {
  // Keep curated suggestions that exist upstream first, then everything else.
  const set = new Set(fetched);
  const head = suggested.filter((m) => set.has(m));
  return [...new Set([...head, ...fetched])];
}
