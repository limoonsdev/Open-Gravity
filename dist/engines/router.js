"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestRouter = exports.RequestRouter = void 0;
const converter_1 = require("./converter");
const gemini_direct_1 = require("./gemini-direct");
const antigravity_core_1 = require("./antigravity-core");
const discovery_1 = require("./discovery");
const config_1 = require("../utils/config");
const logger_1 = require("../utils/logger");
class RequestRouter {
    static instance = null;
    stats = {
        totalRequests: 0,
        activeRequests: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        lastLatencyMs: 0,
        antigravityConnected: false,
    };
    constructor() { }
    static getInstance() {
        if (!this.instance) {
            this.instance = new RequestRouter();
        }
        return this.instance;
    }
    getStats() {
        return { ...this.stats };
    }
    /**
     * Routes a chat completion request in OpenAI format.
     */
    async handleOpenAiCompletion(body, streamHelper) {
        const startTime = Date.now();
        this.stats.totalRequests++;
        this.stats.activeRequests++;
        const config = config_1.configManager.get();
        const resolvedModel = config_1.configManager.resolveModel(body.model);
        const requestId = `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
        try {
            const antigravityInstance = await discovery_1.AntigravityDiscovery.discover();
            this.stats.antigravityConnected = !!antigravityInstance;
            const hasApiKey = !!config.geminiApiKey;
            const isStreaming = !!body.stream;
            if (hasApiKey) {
                logger_1.logger.debug(`Routing OpenAI request to Direct Gemini engine (${resolvedModel})`);
                const geminiReq = converter_1.ProtocolConverter.openAIToGemini(body);
                if (isStreaming && streamHelper) {
                    streamHelper.sendOpenAIChunk({
                        id: requestId,
                        model: resolvedModel,
                        role: 'assistant',
                        contentDelta: '',
                    });
                    await gemini_direct_1.geminiDirectEngine.streamGenerateContent({
                        apiKey: config.geminiApiKey,
                        model: resolvedModel,
                        body: geminiReq,
                        onChunk: (data) => {
                            const candidate = data?.candidates?.[0];
                            const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
                            if (text) {
                                streamHelper.sendOpenAIChunk({
                                    id: requestId,
                                    model: resolvedModel,
                                    contentDelta: text,
                                });
                            }
                        },
                    });
                    streamHelper.sendOpenAIDone();
                    return;
                }
                else {
                    const resp = await gemini_direct_1.geminiDirectEngine.generateContent({
                        apiKey: config.geminiApiKey,
                        model: resolvedModel,
                        body: geminiReq,
                    });
                    const formatted = converter_1.ProtocolConverter.geminiToOpenAI(resp, resolvedModel, requestId);
                    this.recordTokenUsage(formatted.usage?.prompt_tokens, formatted.usage?.completion_tokens);
                    return formatted;
                }
            }
            // Live Antigravity Language Server Engine
            if (antigravityInstance) {
                logger_1.logger.debug(`Routing OpenAI request to Antigravity Live engine (${resolvedModel})`);
                const prompt = converter_1.ProtocolConverter.messagesToAgentApiPrompt(body.messages);
                const tier = this.modelToTier(resolvedModel);
                if (isStreaming && streamHelper) {
                    streamHelper.sendOpenAIChunk({
                        id: requestId,
                        model: resolvedModel,
                        role: 'assistant',
                        contentDelta: '',
                    });
                    await antigravity_core_1.antigravityCore.generateViaAgentApi({
                        prompt,
                        modelTier: tier,
                        onDelta: (chunk) => {
                            streamHelper.sendOpenAIChunk({
                                id: requestId,
                                model: resolvedModel,
                                contentDelta: chunk,
                            });
                        },
                    });
                    streamHelper.sendOpenAIDone();
                    return;
                }
                else {
                    const text = await antigravity_core_1.antigravityCore.generateViaAgentApi({
                        prompt,
                        modelTier: tier,
                    });
                    return {
                        id: requestId,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: resolvedModel,
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: text,
                                },
                                finish_reason: 'stop',
                            },
                        ],
                        usage: {
                            prompt_tokens: Math.ceil(prompt.length / 4),
                            completion_tokens: Math.ceil(text.length / 4),
                            total_tokens: Math.ceil((prompt.length + text.length) / 4),
                        },
                    };
                }
            }
            throw new Error('No available engine: Google Antigravity is not running, and no GEMINI_API_KEY is configured.');
        }
        finally {
            this.stats.activeRequests--;
            this.stats.lastLatencyMs = Date.now() - startTime;
        }
    }
    /**
     * Routes a messages request in Anthropic format (for Claude Code).
     */
    async handleAnthropicMessages(body, streamHelper) {
        const startTime = Date.now();
        this.stats.totalRequests++;
        this.stats.activeRequests++;
        const config = config_1.configManager.get();
        const resolvedModel = config_1.configManager.resolveModel(body.model);
        const requestId = `msg_${Math.random().toString(36).substring(2, 15)}`;
        try {
            const antigravityInstance = await discovery_1.AntigravityDiscovery.discover();
            this.stats.antigravityConnected = !!antigravityInstance;
            const hasApiKey = !!config.geminiApiKey;
            const isStreaming = !!body.stream;
            if (hasApiKey) {
                logger_1.logger.debug(`Routing Anthropic request to Direct Gemini engine (${resolvedModel})`);
                const geminiReq = converter_1.ProtocolConverter.anthropicToGemini(body);
                if (isStreaming && streamHelper) {
                    streamHelper.sendAnthropicMessageStart(requestId, resolvedModel, 20);
                    let outputTokens = 0;
                    let blockIndex = 0;
                    let hasOpenTextBlock = false;
                    let hasToolCall = false;
                    await gemini_direct_1.geminiDirectEngine.streamGenerateContent({
                        apiKey: config.geminiApiKey,
                        model: resolvedModel,
                        body: geminiReq,
                        onChunk: (data) => {
                            const candidate = data?.candidates?.[0];
                            const parts = candidate?.content?.parts || [];
                            for (const p of parts) {
                                if (p.text) {
                                    if (!hasOpenTextBlock) {
                                        streamHelper.sendAnthropicContentBlockStart(blockIndex, '');
                                        hasOpenTextBlock = true;
                                    }
                                    outputTokens += Math.ceil(p.text.length / 4);
                                    streamHelper.sendAnthropicTextDelta(blockIndex, p.text);
                                }
                                if (p.functionCall) {
                                    if (hasOpenTextBlock) {
                                        streamHelper.sendAnthropicContentBlockStop(blockIndex);
                                        hasOpenTextBlock = false;
                                        blockIndex++;
                                    }
                                    hasToolCall = true;
                                    const toolId = `toolu_${Math.random().toString(36).substring(2, 9)}`;
                                    streamHelper.sendAnthropicToolUseBlockStart(blockIndex, toolId, p.functionCall.name);
                                    streamHelper.sendAnthropicInputJsonDelta(blockIndex, JSON.stringify(p.functionCall.args || {}));
                                    streamHelper.sendAnthropicContentBlockStop(blockIndex);
                                    blockIndex++;
                                }
                            }
                        },
                    });
                    if (hasOpenTextBlock) {
                        streamHelper.sendAnthropicContentBlockStop(blockIndex);
                    }
                    const stopReason = hasToolCall ? 'tool_use' : 'end_turn';
                    streamHelper.sendAnthropicMessageDelta(stopReason, outputTokens);
                    streamHelper.sendAnthropicMessageStop();
                    return;
                }
                else {
                    const resp = await gemini_direct_1.geminiDirectEngine.generateContent({
                        apiKey: config.geminiApiKey,
                        model: resolvedModel,
                        body: geminiReq,
                    });
                    const formatted = converter_1.ProtocolConverter.geminiToAnthropic(resp, resolvedModel, requestId);
                    this.recordTokenUsage(formatted.usage?.input_tokens, formatted.usage?.output_tokens);
                    return formatted;
                }
            }
            // Live Antigravity Language Server Engine
            if (antigravityInstance) {
                logger_1.logger.debug(`Routing Anthropic request to Antigravity Live engine (${resolvedModel})`);
                let systemPrompt = typeof body.system === 'string' ? body.system : (Array.isArray(body.system) ? body.system.map((s) => s.text || '').join('\n') : undefined);
                const prompt = converter_1.ProtocolConverter.messagesToAgentApiPrompt(body.messages, systemPrompt, body.tools);
                const tier = this.modelToTier(resolvedModel);
                if (isStreaming && streamHelper) {
                    streamHelper.sendAnthropicMessageStart(requestId, resolvedModel, Math.ceil(prompt.length / 4));
                    streamHelper.sendAnthropicContentBlockStart(0, '');
                    let outputTokens = 0;
                    let fullOutput = '';
                    await antigravity_core_1.antigravityCore.generateViaAgentApi({
                        prompt,
                        modelTier: tier,
                        onDelta: (chunk) => {
                            outputTokens += Math.ceil(chunk.length / 4);
                            fullOutput += chunk;
                            streamHelper.sendAnthropicTextDelta(0, chunk);
                        },
                    });
                    streamHelper.sendAnthropicContentBlockStop(0);
                    streamHelper.sendAnthropicMessageDelta('end_turn', outputTokens);
                    streamHelper.sendAnthropicMessageStop();
                    return;
                }
                else {
                    const text = await antigravity_core_1.antigravityCore.generateViaAgentApi({
                        prompt,
                        modelTier: tier,
                    });
                    return {
                        id: requestId,
                        type: 'message',
                        role: 'assistant',
                        model: resolvedModel,
                        content: [{ type: 'text', text }],
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                        usage: {
                            input_tokens: Math.ceil(prompt.length / 4),
                            output_tokens: Math.ceil(text.length / 4),
                        },
                    };
                }
            }
            throw new Error('No available engine: Google Antigravity is not running, and no GEMINI_API_KEY is configured.');
        }
        finally {
            this.stats.activeRequests--;
            this.stats.lastLatencyMs = Date.now() - startTime;
        }
    }
    modelToTier(model) {
        const lower = model.toLowerCase();
        if (lower.includes('pro') || lower.includes('opus') || lower.includes('gpt-4') || lower.includes('120b')) {
            return 'pro';
        }
        if (lower.includes('lite') || lower.includes('haiku') || lower.includes('mini')) {
            return 'flash_lite';
        }
        return 'flash';
    }
    recordTokenUsage(promptTokens = 0, completionTokens = 0) {
        this.stats.totalPromptTokens += promptTokens;
        this.stats.totalCompletionTokens += completionTokens;
    }
}
exports.RequestRouter = RequestRouter;
exports.requestRouter = RequestRouter.getInstance();
//# sourceMappingURL=router.js.map