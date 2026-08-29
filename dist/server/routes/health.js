"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const discovery_1 = require("../../engines/discovery");
const router_1 = require("../../engines/router");
const config_1 = require("../../utils/config");
const router = (0, express_1.Router)();
router.get(['/health', '/healthz'], (req, res) => {
    res.json({
        status: 'ok',
        service: 'Gravity Bridge',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});
router.get('/status', async (req, res) => {
    const instance = await discovery_1.AntigravityDiscovery.discover(true);
    const stats = router_1.requestRouter.getStats();
    const config = config_1.configManager.get();
    res.json({
        bridge: {
            status: 'active',
            host: config.host,
            port: config.port,
            defaultModel: config.defaultModel,
            hasGeminiApiKey: !!config.geminiApiKey,
        },
        antigravity: instance ? {
            connected: true,
            pid: instance.pid,
            activePort: instance.port,
            ports: instance.ports,
            csrfTokenConfigured: !!instance.csrfToken,
        } : {
            connected: false,
            message: 'Antigravity Language Server not detected or closed.',
        },
        stats,
    });
});
exports.default = router;
//# sourceMappingURL=health.js.map