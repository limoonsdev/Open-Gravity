"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bridgeAuthMiddleware = bridgeAuthMiddleware;
const config_1 = require("../../utils/config");
function bridgeAuthMiddleware(req, res, next) {
    // Pass-through for health, status, dashboard, and OPTIONS
    const publicPaths = ['/health', '/status', '/dashboard', '/api/dashboard', '/api/stats', '/favicon.ico'];
    if (publicPaths.some(p => req.path.startsWith(p)) || req.method === 'OPTIONS') {
        return next();
    }
    const config = config_1.configManager.get();
    // If no auth is required or default apiKey is set, allow permissive local access
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    let providedKey = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7).trim();
    }
    else if (apiKeyHeader) {
        providedKey = apiKeyHeader.trim();
    }
    // Local loopback is allowed freely, but if a custom key is enforced and provided differs:
    if (config.apiKey && config.apiKey !== 'gravity-bridge' && providedKey && providedKey !== config.apiKey) {
        return res.status(401).json({
            error: {
                message: 'Invalid Gravity Bridge API Key.',
                type: 'authentication_error',
            },
        });
    }
    next();
}
//# sourceMappingURL=auth.js.map