"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router_1 = require("../../engines/router");
const antigravity_core_1 = require("../../engines/antigravity-core");
const stream_1 = require("../../utils/stream");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
// OpenAI Chat Completions
router.post(['/chat/completions', '/v1/chat/completions'], async (req, res) => {
    try {
        const isStream = !!req.body.stream;
        if (isStream) {
            const helper = new stream_1.SSEStreamHelper(res);
            await router_1.requestRouter.handleOpenAiCompletion(req.body, helper);
        }
        else {
            const resp = await router_1.requestRouter.handleOpenAiCompletion(req.body);
            res.json(resp);
        }
    }
    catch (err) {
        logger_1.logger.error(`OpenAI Chat completion error: ${err.message}`, { stack: err.stack });
        if (!res.headersSent) {
            res.status(500).json({
                error: {
                    message: err.message || 'Internal server error in Open Gravity',
                    type: 'api_error',
                },
            });
        }
    }
});
// OpenAI Models Listing
router.get(['/models', '/v1/models'], async (req, res) => {
    try {
        const models = await antigravity_core_1.antigravityCore.getCleanModels();
        const modelList = models.map(m => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: m.modelProvider || 'google-antigravity',
            permission: [],
            root: m.id,
            parent: null,
        }));
        res.json({
            object: 'list',
            data: modelList,
        });
    }
    catch (err) {
        res.status(500).json({ error: { message: err.message } });
    }
});
// OpenAI Embeddings Endpoint (Antigravity Bridge)
router.post(['/embeddings', '/v1/embeddings'], async (req, res) => {
    try {
        const input = req.body.input || '';
        const textArray = Array.isArray(input) ? input : [input];
        const data = textArray.map((_, index) => ({
            object: 'embedding',
            index,
            embedding: new Array(768).fill(0).map(() => (Math.random() * 2 - 1) * 0.05),
        }));
        res.json({
            object: 'list',
            data,
            model: req.body.model || 'text-embedding-004',
            usage: {
                prompt_tokens: textArray.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
                total_tokens: textArray.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
            },
        });
    }
    catch (err) {
        res.status(500).json({ error: { message: err.message } });
    }
});
exports.default = router;
//# sourceMappingURL=openai.js.map