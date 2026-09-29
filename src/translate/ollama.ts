// Ollama native API (/api/chat, /api/generate) <-> IR. Lets clients that only
// speak Ollama (VS Code Copilot "Ollama" provider, Open WebUI, many plugins)
// use any model behind the router. Streams are NDJSON, not SSE.
import type { IRRequest, IRMessage, IRPart, IREvent, IRResponse, IRStop, IRUsage, StreamEncoder, IRTool, IREffort } from './ir';
import { genId, safeJsonParse } from './ir';

function imagesToParts(images: any): IRPart[] {
  return Array.isArray(images) ? images.filter((b) => typeof b === 'string').map((data) => ({ type: 'image' as const, mediaType: 'image/png', data })) : [];
}

function optionsToIR(o: any): Partial<IRRequest> {
  if (!o || typeof o !== 'object') return {};
  return {
    temperature: o.temperature,
    topP: o.top_p,
    topK: o.top_k,
    maxTokens: typeof o.num_predict === 'number' && o.num_predict > 0 ? o.num_predict : undefined,
    stop: Array.isArray(o.stop) ? o.stop : typeof o.stop === 'string' ? [o.stop] : undefined,
  };
}

function thinkToIR(think: any): IRRequest['reasoning'] {
  if (think === true) return { effort: 'medium' };
  if (typeof think === 'string' && ['low', 'medium', 'high'].includes(think)) return { effort: think as IREffort };
  return undefined;
}

function formatToIR(format: any): IRRequest['responseFormat'] {
  if (format === 'json') return { type: 'json_object' };
  if (format && typeof format === 'object') return { type: 'json_schema', schema: format, name: 'response' };
  return undefined;
}

export function parseOllamaChat(body: any, stream: boolean): IRRequest {
  const system: string[] = [];
  const messages: IRMessage[] = [];
  let pending: Array<{ id: string; name: string }> = [];
  for (const m of body.messages || []) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'system') {
      if (content) system.push(content);
    } else if (m.role === 'assistant') {
      const parts: IRPart[] = [];
      if (m.thinking) parts.push({ type: 'thinking', text: m.thinking });
      if (content) parts.push({ type: 'text', text: content });
      pending = [];
      for (const tc of m.tool_calls || []) {
        const id = tc.id || genId('call_');
        const name = tc.function?.name || '';
        pending.push({ id, name });
        const args = tc.function?.arguments;
        parts.push({ type: 'tool_call', id, name, args: typeof args === 'string' ? args : JSON.stringify(args || {}) });
      }
      messages.push({ role: 'assistant', parts });
    } else if (m.role === 'tool') {
      const name = m.tool_name || m.name;
      const idx = name ? pending.findIndex((p) => p.name === name) : 0;
      const match = pending.splice(idx >= 0 ? idx : 0, 1)[0];
      const part: IRPart = { type: 'tool_result', id: m.tool_call_id || match?.id || genId('call_'), name: name || match?.name, content: [{ type: 'text', text: content }] };
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => p.type === 'tool_result')) last.parts.push(part);
      else messages.push({ role: 'user', parts: [part] });
    } else {
      messages.push({ role: 'user', parts: [...(content ? [{ type: 'text' as const, text: content }] : []), ...imagesToParts(m.images)] });
    }
  }
  const tools: IRTool[] | undefined = Array.isArray(body.tools) && body.tools.length
    ? body.tools.map((t: any) => ({ name: t.function?.name || t.name, description: t.function?.description, parameters: t.function?.parameters || { type: 'object', properties: {} } }))
    : undefined;
  return {
    model: body.model || '',
    system: system.length ? system.join('\n\n') : undefined,
    messages,
    tools,
    stream,
    reasoning: thinkToIR(body.think),
    responseFormat: formatToIR(body.format),
    ...optionsToIR(body.options),
  };
}

export function parseOllamaGenerate(body: any, stream: boolean): IRRequest {
  let text = String(body.prompt || '');
  if (body.suffix) text = `Fill in the missing text between PREFIX and SUFFIX. Reply with the missing text only.\n\nPREFIX:\n${text}\n\nSUFFIX:\n${body.suffix}`;
  return {
    model: body.model || '',
    system: body.system || undefined,
    messages: [{ role: 'user', parts: [{ type: 'text', text }, ...imagesToParts(body.images)] }],
    stream,
    reasoning: thinkToIR(body.think),
    responseFormat: formatToIR(body.format),
    ...optionsToIR(body.options),
  };
}

const DONE_REASON: Record<IRStop, string> = {
  end_turn: 'stop', stop_sequence: 'stop', tool_use: 'stop', max_tokens: 'length', content_filter: 'stop', error: 'stop',
};

function stats(u: IRUsage, t0: number) {
  const total = (Date.now() - t0) * 1e6;
  return {
    total_duration: total, load_duration: 0,
    prompt_eval_count: u.input + (u.cacheRead || 0), prompt_eval_duration: Math.floor(total / 4),
    eval_count: u.output, eval_duration: Math.floor((total * 3) / 4),
  };
}

export class OllamaStreamEncoder implements StreamEncoder {
  private t0 = Date.now();
  private finished = false;
  private usage: IRUsage = { input: 0, output: 0 };
  private tools = new Map<number, { name: string; args: string }>();

  constructor(private model: string, private mode: 'chat' | 'generate') {}

  private line(fields: any): string {
    return `${JSON.stringify({ model: this.model, created_at: new Date().toISOString(), ...fields })}\n`;
  }

  private delta(content: string, thinking?: string, toolCalls?: any[]): string {
    if (this.mode === 'generate') return this.line({ response: content, ...(thinking ? { thinking } : {}), done: false });
    return this.line({ message: { role: 'assistant', content, ...(thinking ? { thinking } : {}), ...(toolCalls ? { tool_calls: toolCalls } : {}) }, done: false });
  }

  push(ev: IREvent): string {
    if (this.finished) return '';
    switch (ev.type) {
      case 'text': return this.delta(ev.text);
      case 'thinking': return this.delta('', ev.text);
      case 'tool_start':
        this.tools.set(ev.index, { name: ev.name, args: '' });
        return '';
      case 'tool_args': {
        const t = this.tools.get(ev.index);
        if (t) t.args += ev.delta;
        return '';
      }
      case 'tool_end': {
        const t = this.tools.get(ev.index);
        if (!t) return '';
        this.tools.delete(ev.index);
        if (this.mode === 'generate') return '';
        return this.delta('', undefined, [{ function: { name: t.name, arguments: safeJsonParse(t.args, {}) } }]);
      }
      case 'usage':
        Object.assign(this.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)));
        return '';
      case 'stop':
        return this.finish(ev.reason);
      case 'error':
        this.finished = true;
        return `${JSON.stringify({ error: ev.message })}\n`;
    }
    return '';
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    let out = '';
    for (const idx of [...this.tools.keys()]) out += this.push({ type: 'tool_end', index: idx });
    this.finished = true;
    const body = this.mode === 'generate' ? { response: '' } : { message: { role: 'assistant', content: '' } };
    return out + this.line({ ...body, done: true, done_reason: DONE_REASON[reason] || 'stop', ...stats(this.usage, this.t0) });
  }

  end(): string {
    return this.finish('end_turn');
  }
}

export function buildOllamaResponse(res: IRResponse, model: string, mode: 'chat' | 'generate', t0 = Date.now()): any {
  const text = res.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('');
  const thinking = res.parts.filter((p) => p.type === 'thinking').map((p: any) => p.text).join('');
  const calls = res.parts.filter((p) => p.type === 'tool_call').map((p: any) => ({ function: { name: p.name, arguments: safeJsonParse(p.args, {}) } }));
  const base = { model, created_at: new Date().toISOString(), done: true, done_reason: DONE_REASON[res.stop] || 'stop', ...stats(res.usage, t0) };
  if (mode === 'generate') return { ...base, response: text, ...(thinking ? { thinking } : {}) };
  return { ...base, message: { role: 'assistant', content: text, ...(thinking ? { thinking } : {}), ...(calls.length ? { tool_calls: calls } : {}) } };
}
