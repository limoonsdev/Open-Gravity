// Format registry: one place that knows how to parse, encode and decode each protocol.
import {
  ApiFormat, IRRequest, IREvent, IRPart, IRResponse, IRStop, IRUsage, StreamDecoder, StreamEncoder, mergeUsage,
} from './ir';
import { parseOpenAIRequest, OpenAIStreamEncoder, OpenAIStreamDecoder, buildOpenAIResponse, openAIError } from './openai';
import { parseAnthropicRequest, AnthropicStreamEncoder, AnthropicStreamDecoder, buildAnthropicResponse, anthropicError } from './anthropic';
import { parseGeminiRequest, GeminiStreamEncoder, GeminiStreamDecoder, buildGeminiResponse, geminiError } from './gemini';
import { parseResponsesRequest, ResponsesStreamEncoder, ResponsesStreamDecoder, buildResponsesResponse, customToolNames } from './responses';

export * from './ir';

/** Wire formats an upstream provider can speak. */
export type UpstreamFormat = 'openai' | 'anthropic' | 'gemini' | 'responses';

export interface ClientContext {
  format: ApiFormat;
  /** Model name echoed back to the client. */
  model: string;
  ir: IRRequest;
  estimatedInput: number;
}

export function parseClientRequest(format: ApiFormat, body: any, opts: { model?: string; stream?: boolean } = {}): IRRequest {
  switch (format) {
    case 'openai': return parseOpenAIRequest(body);
    case 'anthropic': return parseAnthropicRequest(body);
    case 'responses': return parseResponsesRequest(body);
    case 'gemini': return parseGeminiRequest(body, opts.model || '', !!opts.stream);
  }
}

export function createEncoder(ctx: ClientContext): StreamEncoder {
  switch (ctx.format) {
    case 'openai': return new OpenAIStreamEncoder(ctx.model, ctx.ir.includeUsage);
    case 'anthropic': return new AnthropicStreamEncoder(ctx.model, ctx.estimatedInput);
    case 'responses': return new ResponsesStreamEncoder(ctx.model, customToolNames(ctx.ir));
    case 'gemini': return new GeminiStreamEncoder(ctx.model);
  }
}

export function createDecoder(format: UpstreamFormat): StreamDecoder {
  switch (format) {
    case 'openai': return new OpenAIStreamDecoder();
    case 'anthropic': return new AnthropicStreamDecoder();
    case 'responses': return new ResponsesStreamDecoder();
    case 'gemini': return new GeminiStreamDecoder();
  }
}

export function buildClientResponse(ctx: ClientContext, res: IRResponse): any {
  switch (ctx.format) {
    case 'openai': return buildOpenAIResponse(res, ctx.model);
    case 'anthropic': return buildAnthropicResponse(res, ctx.model);
    case 'responses': return buildResponsesResponse(res, ctx.model, customToolNames(ctx.ir));
    case 'gemini': return buildGeminiResponse(res, ctx.model);
  }
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  500: 'api_error',
  502: 'api_error',
  503: 'overloaded_error',
  529: 'overloaded_error',
};

const GEMINI_STATUS: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  503: 'UNAVAILABLE',
};

export function errorBody(format: ApiFormat, status: number, message: string): any {
  const type = ERROR_TYPES[status] || (status >= 500 ? 'api_error' : 'invalid_request_error');
  switch (format) {
    case 'anthropic': return anthropicError(message, type);
    case 'gemini': return geminiError(message, status, GEMINI_STATUS[status] || 'INTERNAL');
    default: return openAIError(message, type, status);
  }
}

/** Collects streamed IR events into a complete response (for non-streaming clients). */
export class Aggregator {
  parts: IRPart[] = [];
  usage: IRUsage = { input: 0, output: 0 };
  stop: IRStop = 'end_turn';
  error?: { message: string; status?: number };
  private tools = new Map<number, IRPart & { type: 'tool_call' }>();

  push(ev: IREvent) {
    const last = this.parts[this.parts.length - 1];
    switch (ev.type) {
      case 'text':
        if (last?.type === 'text') last.text += ev.text;
        else this.parts.push({ type: 'text', text: ev.text });
        break;
      case 'thinking':
        if (last?.type === 'thinking') last.text += ev.text;
        else this.parts.push({ type: 'thinking', text: ev.text });
        break;
      case 'thinking_signature': {
        const t = [...this.parts].reverse().find((p) => p.type === 'thinking') as any;
        if (t) t.signature = (t.signature || '') + ev.signature;
        else this.parts.push({ type: 'thinking', text: '', signature: ev.signature });
        break;
      }
      case 'tool_start': {
        const part = { type: 'tool_call' as const, id: ev.id, name: ev.name, args: '' };
        this.tools.set(ev.index, part);
        this.parts.push(part);
        break;
      }
      case 'tool_args': {
        const t = this.tools.get(ev.index);
        if (t) t.args += ev.delta;
        break;
      }
      case 'usage':
        mergeUsage(this.usage, ev.usage);
        break;
      case 'stop':
        this.stop = ev.reason;
        break;
      case 'error':
        this.error = { message: ev.message, status: ev.status };
        break;
    }
  }

  result(model: string): IRResponse {
    for (const t of this.tools.values()) if (!t.args) t.args = '{}';
    return { id: '', model, parts: this.parts, stop: this.stop, usage: this.usage };
  }
}
