"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router_1 = require("../../engines/router");
const stream_1 = require("../../utils/stream");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
// Anthropic Messages API (Claude Code CLI / Cursor / Aider)
router.post(['/messages', '/v1/messages'], async (req, res) => {
    try {
        const isStream = !!req.body.stream;
        if (isStream) {
            const helper = new stream_1.SSEStreamHelper(res);
            await router_1.requestRouter.handleAnthropicMessages(req.body, helper);
        }
        else {
            const resp = await router_1.requestRouter.handleAnthropicMessages(req.body);
            res.json(resp);
        }
    }
    catch (err) {
        logger_1.logger.error(`Anthropic Messages error: ${err.message}`, { stack: err.stack });
        if (!res.headersSent) {
            res.status(500).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: err.message || 'Internal server error in Gravity Bridge',
                },
            });
        }
    }
});
// Legacy Anthropic Complete API
router.post(['/complete', '/v1/complete'], async (req, res) => {
    try {
        const prompt = req.body.prompt || '';
        const messages = [{ role: 'user', content: prompt }];
        const resp = await router_1.requestRouter.handleAnthropicMessages({
            model: req.body.model,
            messages,
            max_tokens: req.body.max_tokens_to_sample || 4096,
        });
        const text = resp?.content?.[0]?.text || '';
        res.json({
            completion: text,
            stop_reason: 'stop_sequence',
            model: req.body.model,
        });
    }
    catch (err) {
        res.status(500).json({ type: 'error', error: { message: err.message } });
    }
});
exports.default = router;
//# sourceMappingURL=anthropic.js.map