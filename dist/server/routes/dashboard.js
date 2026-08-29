"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../../utils/logger");
const router_1 = require("../../engines/router");
const config_1 = require("../../utils/config");
const discovery_1 = require("../../engines/discovery");
const antigravity_core_1 = require("../../engines/antigravity-core");
const router = (0, express_1.Router)();
function getDashboardHtml() {
    const htmlPath = path_1.default.join(__dirname, '..', '..', 'web', 'index.html');
    if (fs_1.default.existsSync(htmlPath)) {
        return fs_1.default.readFileSync(htmlPath, 'utf-8');
    }
    const distHtml = path_1.default.join(__dirname, '..', 'web', 'index.html');
    if (fs_1.default.existsSync(distHtml)) {
        return fs_1.default.readFileSync(distHtml, 'utf-8');
    }
    // Safe minimal inline dashboard for single-binary packaging
    return `<!DOCTYPE html>
<html>
<head>
<title>Open Gravity</title>
<style>
body { background: #080c14; color: #f1f5f9; font-family: system-ui, sans-serif; padding: 32px; }
h1 { color: #38bdf8; }
.card { background: #0f1624; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; margin-top: 16px; }
pre { background: #050810; padding: 12px; border-radius: 8px; color: #a855f7; }
</style>
</head>
<body>
<h1>🪐 Open Gravity is Running</h1>
<div class="card">
<p>Proxy endpoints are active:</p>
<ul>
<li>Claude Code / Anthropic: <pre>http://127.0.0.1:8080</pre></li>
<li>OpenAI / Codex: <pre>http://127.0.0.1:8080/v1</pre></li>
</ul>
</div>
</body>
</html>`;
}
// Serve the dashboard HTML
router.get(['/', '/dashboard'], (req, res) => {
    const html = getDashboardHtml();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});
// SSE Stream of live logs
router.get('/api/dashboard/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const recent = logger_1.logger.getRecentLogs();
    for (const r of recent) {
        res.write(`data: ${JSON.stringify(r)}\n\n`);
    }
    const onLog = (log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
    };
    logger_1.logger.on('log', onLog);
    req.on('close', () => {
        logger_1.logger.removeListener('log', onLog);
    });
});
// Dashboard stats endpoint
router.get('/api/dashboard/stats', async (req, res) => {
    const instance = await discovery_1.AntigravityDiscovery.discover();
    const stats = router_1.requestRouter.getStats();
    const config = config_1.configManager.get();
    const account = await antigravity_core_1.antigravityCore.getUserAccountDetails();
    res.json({
        stats,
        account,
        config: {
            port: config.port,
            host: config.host,
            defaultModel: config.defaultModel,
            hasGeminiKey: !!config.geminiApiKey,
        },
        antigravity: instance ? {
            connected: true,
            pid: instance.pid,
            port: instance.port,
            ports: instance.ports,
        } : { connected: false },
    });
});
// Update configuration
router.post('/api/dashboard/config', (req, res) => {
    const updated = config_1.configManager.update(req.body);
    res.json({ success: true, config: updated });
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map