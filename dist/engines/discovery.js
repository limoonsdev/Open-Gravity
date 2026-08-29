"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntigravityDiscovery = void 0;
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const https_1 = __importDefault(require("https"));
const logger_1 = require("../utils/logger");
const execAsync = util_1.default.promisify(child_process_1.exec);
class AntigravityDiscovery {
    static cachedInstance = null;
    static lastCheckTime = 0;
    static CACHE_TTL_MS = 5000;
    static async discover(forceRefresh = false) {
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
            }
            else {
                const instance = await this.discoverUnix();
                if (instance) {
                    this.cachedInstance = instance;
                    this.lastCheckTime = now;
                    return instance;
                }
            }
        }
        catch (e) {
            logger_1.logger.debug(`Antigravity discovery check: ${e.message}`);
        }
        this.cachedInstance = null;
        return null;
    }
    static async discoverWindows() {
        // 1. Find language_server processes
        const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'*language_server*\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"';
        const { stdout } = await execAsync(cmd);
        if (!stdout.trim())
            return null;
        let items;
        try {
            items = JSON.parse(stdout);
            if (!Array.isArray(items))
                items = [items];
        }
        catch {
            return null;
        }
        for (const item of items) {
            const cmdline = item.CommandLine || '';
            const pid = item.ProcessId;
            if (!cmdline || !pid)
                continue;
            const csrfMatch = cmdline.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
            if (!csrfMatch)
                continue;
            const csrfToken = csrfMatch[1];
            // Get ports
            const portCmd = `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object LocalPort | ConvertTo-Json"`;
            const portRes = await execAsync(portCmd);
            let ports = [];
            if (portRes.stdout.trim()) {
                try {
                    const pdata = JSON.parse(portRes.stdout);
                    if (Array.isArray(pdata)) {
                        ports = pdata.map((p) => p.LocalPort);
                    }
                    else if (pdata && pdata.LocalPort) {
                        ports = [pdata.LocalPort];
                    }
                }
                catch {
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
    static async discoverUnix() {
        const cmd = 'ps aux | grep language_server | grep csrf_token';
        const { stdout } = await execAsync(cmd);
        if (!stdout.trim())
            return null;
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            if (line.includes('grep'))
                continue;
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[1], 10);
            const csrfMatch = line.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
            if (!csrfMatch)
                continue;
            const csrfToken = csrfMatch[1];
            // Check ports with lsof
            try {
                const { stdout: lsofOut } = await execAsync(`lsof -Pan -p ${pid} -i | grep LISTEN`);
                const portMatches = lsofOut.match(/:(\d+)\s+\(LISTEN\)/g) || [];
                const ports = portMatches.map((m) => parseInt(m.replace(/[^0-9]/g, ''), 10));
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
            }
            catch {
                // ignore
            }
        }
        return null;
    }
    static testPort(port, csrfToken) {
        return new Promise((resolve) => {
            const agent = new https_1.default.Agent({ rejectUnauthorized: false });
            const req = https_1.default.request({
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
exports.AntigravityDiscovery = AntigravityDiscovery;
//# sourceMappingURL=discovery.js.map