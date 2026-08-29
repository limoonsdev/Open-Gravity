"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gemini_direct_1 = require("../../engines/gemini-direct");
const config_1 = require("../../utils/config");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
// Gemini GenerateContent
router.post('/v1beta/models/:modelAndMethod', async (req, res) => {
    try {
        const raw = req.params.modelAndMethod;
        const isStream = raw.includes(':streamGenerateContent');
        const model = raw.replace(/:(generateContent|streamGenerateContent)$/, '');
        const config = config_1.configManager.get();
        const apiKey = req.query.key || config.geminiApiKey;
        if (!apiKey) {
            return res.status(400).json({
                error: { message: 'Missing Gemini API key in query params (?key=...) or config' },
            });
        }
        if (isStream) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            await gemini_direct_1.geminiDirectEngine.streamGenerateContent({
                apiKey,
                model,
                body: req.body,
                onChunk: (chunk) => {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                },
            });
            res.end();
        }
        else {
            const resp = await gemini_direct_1.geminiDirectEngine.generateContent({
                apiKey,
                model,
                body: req.body,
            });
            res.json(resp);
        }
    }
    catch (err) {
        logger_1.logger.error(`Gemini route error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: { message: err.message } });
        }
    }
});
exports.default = router;
//# sourceMappingURL=gemini.js.map