// Legacy OpenAI text completions (/v1/completions) <-> IR, served through
// chat models. Used by autocomplete plugins and older SDKs.
import type { IRRequest, IREvent, IRResponse, IRStop, IRUsage, StreamEncoder } from './ir';
import { genId } from './ir';
import { sseData } from './sse';

export function parseCompletionsRequest(body: any): IRRequest {
  let prompt = Array.isArray(body.prompt) ? body.prompt.join('\n') : String(body.prompt ?? '');
  let system: string | undefined = 'Continue the text exactly where it stops. Output only the continuation.';
  if (body.suffix) {
    system = 'Fill in the missing text between PREFIX and SUFFIX. Output only the missing text, nothing else.';
    prompt = `PREFIX:\n${prompt}\n\nSUFFIX:\n${body.suffix}`;
  }
  return {
    model: body.model || '',
    system,
    messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
    maxTokens: body.max_tokens ?? undefined,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    stop: typeof body.stop === 'string' ? [body.stop] : Array.isArray(body.stop) ? body.stop : undefined,
    stream: !!body.stream,
    includeUsage: !!body.stream_options?.include_usage,
    user: body.user,
  };
}

const FINISH: Record<IRStop, string> = { end_turn: 'stop', stop_sequence: 'stop', tool_use: 'stop', max_tokens: 'length', content_filter: 'content_filter', error: 'stop' };

function usageOf(u: IRUsage) {
  const prompt = u.input + (u.cacheRead || 0) + (u.cacheWrite || 0);
  return { prompt_tokens: prompt, completion_tokens: u.output, total_tokens: prompt + u.output };
}

export class CompletionsStreamEncoder implements StreamEncoder {
  private id = genId('cmpl-');
  private created = Math.floor(Date.now() / 1000);
  private finished = false;
  private usage: IRUsage = { input: 0, output: 0 };

  constructor(private model: string, private includeUsage = false) {}

  private chunk(text: string, finish: string | null) {
    return sseData({ id: this.id, object: 'text_completion', created: this.created, model: this.model, choices: [{ text, index: 0, logprobs: null, finish_reason: finish }] });
  }

  push(ev: IREvent): string {
    if (this.finished) return '';
    switch (ev.type) {
      case 'text': return this.chunk(ev.text, null);
      case 'usage':
        Object.assign(this.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)));
        return '';
      case 'stop': return this.finish(ev.reason);
      case 'error':
        this.finished = true;
        return sseData({ error: { message: ev.message, type: 'api_error' } }) + 'data: [DONE]\n\n';
    }
    return '';
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    this.finished = true;
    let out = this.chunk('', FINISH[reason] || 'stop');
    if (this.includeUsage) out += sseData({ id: this.id, object: 'text_completion', created: this.created, model: this.model, choices: [], usage: usageOf(this.usage) });
    return out + 'data: [DONE]\n\n';
  }

  end(): string {
    return this.finish('end_turn');
  }
}

export function buildCompletionsResponse(res: IRResponse, model: string): any {
  const text = res.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('');
  return {
    id: genId('cmpl-'), object: 'text_completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ text, index: 0, logprobs: null, finish_reason: FINISH[res.stop] || 'stop' }],
    usage: usageOf(res.usage),
  };
}
