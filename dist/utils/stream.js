"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSEStreamHelper = void 0;
class SSEStreamHelper {
    res;
    isClosed = false;
    constructor(res) {
        this.res = res;
        this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        this.res.setHeader('Cache-Control', 'no-cache, no-transform');
        this.res.setHeader('Connection', 'keep-alive');
        this.res.setHeader('X-Accel-Buffering', 'no');
        this.res.flushHeaders?.();
        res.on('close', () => {
            this.isClosed = true;
        });
    }
    get closed() {
        return this.isClosed;
    }
    sendOpenAIChunk(chunk) {
        if (this.isClosed)
            return;
        const payload = {
            id: chunk.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: chunk.model,
            choices: [
                {
                    index: 0,
                    delta: {
                        ...(chunk.role ? { role: chunk.role } : {}),
                        ...(chunk.contentDelta !== undefined ? { content: chunk.contentDelta } : {}),
                        ...(chunk.toolCalls ? { tool_calls: chunk.toolCalls } : {})
                    },
                    finish_reason: chunk.finishReason || null
                }
            ]
        };
        this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
    sendOpenAIDone() {
        if (this.isClosed)
            return;
        this.res.write(`data: [DONE]\n\n`);
        this.res.end();
        this.isClosed = true;
    }
    sendAnthropicEvent(eventType, data) {
        if (this.isClosed)
            return;
        this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    sendAnthropicMessageStart(id, model, inputTokens = 10) {
        this.sendAnthropicEvent('message_start', {
            type: 'message_start',
            message: {
                id,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: 0
                }
            }
        });
    }
    sendAnthropicContentBlockStart(index = 0, initialText = '') {
        this.sendAnthropicEvent('content_block_start', {
            type: 'content_block_start',
            index,
            content_block: {
                type: 'text',
                text: initialText
            }
        });
    }
    sendAnthropicToolUseBlockStart(index = 0, id, name) {
        this.sendAnthropicEvent('content_block_start', {
            type: 'content_block_start',
            index,
            content_block: {
                type: 'tool_use',
                id,
                name,
                input: {}
            }
        });
    }
    sendAnthropicThinkingBlockStart(index = 0) {
        this.sendAnthropicEvent('content_block_start', {
            type: 'content_block_start',
            index,
            content_block: {
                type: 'thinking',
                thinking: ''
            }
        });
    }
    sendAnthropicTextDelta(index = 0, text) {
        this.sendAnthropicEvent('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: {
                type: 'text_delta',
                text
            }
        });
    }
    sendAnthropicThinkingDelta(index = 0, thinking) {
        this.sendAnthropicEvent('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: {
                type: 'thinking_delta',
                thinking
            }
        });
    }
    sendAnthropicInputJsonDelta(index = 0, partial_json) {
        this.sendAnthropicEvent('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: {
                type: 'input_json_delta',
                partial_json
            }
        });
    }
    sendAnthropicContentBlockStop(index = 0) {
        this.sendAnthropicEvent('content_block_stop', {
            type: 'content_block_stop',
            index
        });
    }
    sendAnthropicMessageDelta(stopReason = 'end_turn', outputTokens = 50) {
        this.sendAnthropicEvent('message_delta', {
            type: 'message_delta',
            delta: {
                stop_reason: stopReason,
                stop_sequence: null
            },
            usage: {
                output_tokens: outputTokens
            }
        });
    }
    sendAnthropicMessageStop() {
        this.sendAnthropicEvent('message_stop', {
            type: 'message_stop'
        });
        this.res.end();
        this.isClosed = true;
    }
}
exports.SSEStreamHelper = SSEStreamHelper;
//# sourceMappingURL=stream.js.map