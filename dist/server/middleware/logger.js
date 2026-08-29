"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const chalk_1 = __importDefault(require("chalk"));
const logger_1 = require("../../utils/logger");
function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.originalUrl || req.url;
    // Filter out noisy polling from dashboard
    const isPolling = url.includes('/api/dashboard/stats') || url.includes('/status') || url.includes('/api/dashboard/logs');
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const isError = status >= 400;
        let modelTag = '';
        if (req.body?.model) {
            modelTag = chalk_1.default.gray(` (${req.body.model})`);
        }
        let statusColor = chalk_1.default.green;
        if (status >= 500)
            statusColor = chalk_1.default.red;
        else if (status >= 400)
            statusColor = chalk_1.default.yellow;
        const formattedLog = `${statusColor(String(status))} ${chalk_1.default.bold(method)} ${url}${modelTag} ${chalk_1.default.gray(`${duration}ms`)}`;
        if (!isPolling) {
            if (isError) {
                logger_1.logger.warn(formattedLog);
            }
            else {
                logger_1.logger.request(formattedLog);
            }
        }
    });
    next();
}
//# sourceMappingURL=logger.js.map