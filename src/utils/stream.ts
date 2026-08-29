import { Response } from 'express';

export class SSEStreamHelper {
  private res: Response;
  private isClosed: boolean = false;

  constructor(res: Response) {
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

  public get closed(): boolean {
    return this.isClosed;
  }

  public sendOpenAIChunk(chunk: {
    id: string;
    model: string;
    contentDelta?: string;
    finishReason?: string | null;
    role?: string;
    toolCalls?: any[];
  }) {
    if (this.isClosed) return;

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

  public sendOpenAIDone() {
    if (this.isClosed) return;
    this.res.write(`data: [DONE]\n\n`);
    this.res.end();
    this.isClosed = true;
  }

  public sendAnthropicEvent(eventType: string, data: any) {
    if (this.isClosed) return;
    this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  public sendAnthropicMessageStart(id: string, model: string, inputTokens: number = 10) {
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

  public sendAnthropicContentBlockStart(index: number = 0, initialText: string = '') {
    this.sendAnthropicEvent('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'text',
        text: initialText
      }
    });
  }

  public sendAnthropicTextDelta(index: number = 0, text: string) {
    this.sendAnthropicEvent('content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: {
        type: 'text_delta',
        text
      }
    });
  }

  public sendAnthropicContentBlockStop(index: number = 0) {
    this.sendAnthropicEvent('content_block_stop', {
      type: 'content_block_stop',
      index
    });
  }

  public sendAnthropicMessageDelta(stopReason: string = 'end_turn', outputTokens: number = 50) {
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

  public sendAnthropicMessageStop() {
    this.sendAnthropicEvent('message_stop', {
      type: 'message_stop'
    });
    this.res.end();
    this.isClosed = true;
  }
}
