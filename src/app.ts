// Application bootstrap: config + usage stores, HTTP server, port handling.
import net from 'net';
import { spawn } from 'child_process';
import { ConfigStore } from './core/config';
import { UsageStore } from './core/usage';
import { logger } from './core/logger';
import { createRouterServer, listen } from './server/server';
import type { ServerInfo } from './server/admin';
import type http from 'http';

export interface RunningApp {
  config: ConfigStore;
  usage: UsageStore;
  server: http.Server;
  info: ServerInfo;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function probeExisting(host: string, port: number): Promise<boolean> {
  const h = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  try {
    const res = await fetch(`http://${h.includes(':') ? `[${h}]` : h}:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const body: any = await res.json();
    return body?.service === 'open-gravity';
  } catch {
    return false;
  }
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

export function baseUrlFor(host: string, port: number) {
  const h = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${h.includes(':') ? `[${h}]` : h}:${port}`;
}

export async function startApp(opts: { port?: number; host?: string; config?: ConfigStore; usage?: UsageStore; strictPort?: boolean } = {}): Promise<RunningApp> {
  const config = opts.config || new ConfigStore();
  const usage = opts.usage || new UsageStore(config.settings.logRetentionDays);
  const host = opts.host || config.settings.host;
  let port = opts.port ?? config.settings.port;

  if (!opts.strictPort && port !== 0 && !(await portFree(port, host))) {
    if (await probeExisting(host, port)) {
      throw Object.assign(new Error(`Open Gravity is already running at ${baseUrlFor(host, port)}`), { code: 'ALREADY_RUNNING', port, host });
    }
    const original = port;
    for (let p = port + 1; p < port + 30; p++) {
      if (await portFree(p, host)) {
        port = p;
        break;
      }
    }
    if (port === original) throw new Error(`Port ${original} is busy. Use --port to choose another one.`);
    logger.warn(`Port ${original} is busy, using ${port} instead.`);
  }

  const info: ServerInfo = { port, host, startedAt: Date.now() };
  const server = createRouterServer({ config, usage }, info);
  await listen(server, port, host);
  const addr = server.address();
  if (addr && typeof addr === 'object') info.port = addr.port;
  config.watch();

  return {
    config,
    usage,
    server,
    info,
    baseUrl: baseUrlFor(host, info.port),
    stop: () => new Promise<void>((resolve) => {
      config.unwatch();
      config.saveNow();
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

export function openBrowser(url: string) {
  try {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch { /* no browser available */ }
}
