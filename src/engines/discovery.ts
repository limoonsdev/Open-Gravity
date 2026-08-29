import { exec } from 'child_process';
import util from 'util';
import https from 'https';
import http from 'http';
import { logger } from '../utils/logger';

const execAsync = util.promisify(exec);

export interface AntigravityInstance {
  pid: number;
  csrfToken: string;
  port: number;
  ports: number[];
  commandLine: string;
  isAlive: boolean;
  version?: string;
  userEmail?: string;
  planName?: string;
}

export class AntigravityDiscovery {
  private static cachedInstance: AntigravityInstance | null = null;
  private static lastCheckTime: number = 0;
  private static readonly CACHE_TTL_MS = 5000;

  public static async discover(forceRefresh: boolean = false): Promise<AntigravityInstance | null> {
    const now = Date.now();
    if (!forceRefresh && this.cachedInstance && (now - this.lastCheckTime < this.CACHE_TTL_MS)) {
      return this.cachedInstance;
    }

    try {
      if (process.platform === 'win32') {
        const instance = await this.discoverWindows();
        if (instance) {
          this.cachedInstance = instance;
          this.lastCheckTime = now;
          return instance;
        }
      } else {
        const instance = await this.discoverUnix();
        if (instance) {
          this.cachedInstance = instance;
          this.lastCheckTime = now;
          return instance;
        }
      }
    } catch (e: any) {
      logger.debug(`Antigravity discovery check: ${e.message}`);
    }

    this.cachedInstance = null;
    return null;
  }

  private static async discoverWindows(): Promise<AntigravityInstance | null> {
    // 1. Find language_server processes
    const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'*language_server*\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"';
    const { stdout } = await execAsync(cmd);
    
    if (!stdout.trim()) return null;

    let items: any;
    try {
      items = JSON.parse(stdout);
      if (!Array.isArray(items)) items = [items];
    } catch {
      return null;
    }

    for (const item of items) {
      const cmdline = item.CommandLine || '';
      const pid = item.ProcessId;
      if (!cmdline || !pid) continue;

      const csrfMatch = cmdline.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
      if (!csrfMatch) continue;
      const csrfToken = csrfMatch[1];

      // Get ports
      const portCmd = `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object LocalPort | ConvertTo-Json"`;
      const portRes = await execAsync(portCmd);
      let ports: number[] = [];
      if (portRes.stdout.trim()) {
        try {
          const pdata = JSON.parse(portRes.stdout);
          if (Array.isArray(pdata)) {
            ports = pdata.map((p: any) => p.LocalPort);
          } else if (pdata && pdata.LocalPort) {
            ports = [pdata.LocalPort];
          }
        } catch {
          // ignore
        }
      }

      // Test active port
      for (const port of ports) {
        const alive = await this.testPort(port, csrfToken);
        if (alive) {
          return {
            pid,
            csrfToken,
            port,
            ports,
            commandLine: cmdline,
            isAlive: true,
          };
        }
      }
    }

    return null;
  }

  private static async discoverUnix(): Promise<AntigravityInstance | null> {
    const cmd = 'ps aux | grep language_server | grep csrf_token';
    const { stdout } = await execAsync(cmd);
    if (!stdout.trim()) return null;

    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      if (line.includes('grep')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      const csrfMatch = line.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
      if (!csrfMatch) continue;
      const csrfToken = csrfMatch[1];

      // Check ports with lsof
      try {
        const { stdout: lsofOut } = await execAsync(`lsof -Pan -p ${pid} -i | grep LISTEN`);
        const portMatches = lsofOut.match(/:(\d+)\s+\(LISTEN\)/g) || [];
        const ports = portMatches.map((m: string) => parseInt(m.replace(/[^0-9]/g, ''), 10));

        for (const port of ports) {
          const alive = await this.testPort(port, csrfToken);
          if (alive) {
            return {
              pid,
              csrfToken,
              port,
              ports,
              commandLine: line,
              isAlive: true,
            };
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private static testPort(port: number, csrfToken: string): Promise<boolean> {
    return new Promise((resolve) => {
      const agent = new https.Agent({ rejectUnauthorized: false });
      const req = https.request({
        hostname: '127.0.0.1',
        port,
        path: '/healthz',
        method: 'GET',
        agent,
        timeout: 1500,
        headers: {
          'x-codeium-csrf-token': csrfToken,
        },
      }, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }
}
