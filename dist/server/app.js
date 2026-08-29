"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBridgeApp = createBridgeApp;
const express_1 = __importDefault(require("express"));
const logger_1 = require("./middleware/logger");
const cors_1 = require("./middleware/cors");
const auth_1 = require("./middleware/auth");
const openai_1 = __importDefault(require("./routes/openai"));
const anthropic_1 = __importDefault(require("./routes/anthropic"));
const gemini_1 = __importDefault(require("./routes/gemini"));
const health_1 = __importDefault(require("./routes/health"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
function createBridgeApp() {
    const app = (0, express_1.default)();
    // Basic middleware
    app.use(express_1.default.json({ limit: '50mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
    app.use(cors_1.corsMiddleware);
    app.use(logger_1.requestLogger);
    app.use(auth_1.bridgeAuthMiddleware);
    // Mount API routes
    app.use('/v1', openai_1.default);
    app.use('/v1', anthropic_1.default);
    app.use('/', openai_1.default);
    app.use('/', anthropic_1.default);
    app.use('/', gemini_1.default);
    app.use('/', health_1.default);
    app.use('/', dashboard_1.default);
    // 404 Catch-all
    app.use((req, res) => {
        res.status(404).json({
            error: {
                message: `Endpoint ${req.method} ${req.path} not found on Gravity Bridge.`,
                type: 'invalid_request_error',
            },
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map