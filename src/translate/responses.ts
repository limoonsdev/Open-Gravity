// OpenAI Responses API <-> IR (the protocol Codex CLI speaks)
import {
  IRRequest, IRMessage, IRPart, IRTool, IRToolChoice, IREvent, IRResponse, IRStop, IRUsage,
  StreamDecoder, StreamEncoder, genId, safeJsonParse, parseDataUrl, toolResultText, budgetToEffort, IREffort,
} from './ir';
import { sseData } from './sse';

const CUSTOM_INPUT_SCHEMA = {
  type: 'object',
  properties: { input: { type: 'string', description: 'The raw, freeform input for this tool.' } },
  required: ['input'],
};

// ---------------------------------------------------------------- request in

function responseContentToParts(content: any): IRPart[] {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const parts: IRPart[] = [];
  for (const c of content) {
    if (!c) continue;
    if ((c.type === 'input_text' || c.type === 'output_text' || c.type === 'text') && c.text) parts.push({ type: 'text', text: c.text });
    else if (c.type === 'refusal' && c.refusal) parts.push({ type: 'text', text: c.refusal });
    else if (c.type === 'input_image' && c.image_url) {
      const d = parseDataUrl(c.image_url);
      parts.push(d ? { type: 'image', mediaType: d.mediaType, data: d.data } : { type: 'image', url: c.image_url });
    } else if (c.type === 'input_file' && c.file_data) {
      const d = parseDataUrl(c.file_data);
      if (d) parts.push({ type: 'image', mediaType: d.mediaType, data: d.data });
    }
  }
  return parts;
}

function outputToParts(output: any): Array<{ type: 'text'; text: string } | { type: 'image'; mediaType?: string; data?: string; url?: string }> {
  if (output == null) return [];
  if (typeof output === 'string') return [{ type: 'text', text: output }];
  if (Array.isArray(output)) return responseContentToParts(output) as any;
  return [{ type: 'text', text: JSON.stringify(output) }];
}

export function parseResponsesRequest(body: any): IRRequest {
  const system: string[] = [];
  if (body.instructions) system.push(body.instructions);
  const messages: IRMessage[] = [];
  const push = (role: 'user' | 'assistant', part: IRPart) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else messages.push({ role, parts: [part] });
  };

  const input = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input || [];
  for (const item of input) {
    if (!item) continue;
    const type = item.type || (item.role ? 'message' : undefined);
    switch (type) {
      case 'message': {
        if (item.role === 'system' || item.role === 'developer') {
          const t = responseContentToParts(item.content).map((p: any) => p.text || '').join('\n');
          if (t) system.push(t);
        } else {
          const role = item.role === 'assistant' ? 'assistant' : 'user';
          for (const p of responseContentToParts(item.content)) push(role, p);
        }
        break;
      }
      case 'function_call':
        push('assistant', { type: 'tool_call', id: item.call_id || item.id, name: item.name, args: item.arguments || '{}' });
        break;
      case 'custom_tool_call':
        push('assistant', { type: 'tool_call', id: item.call_id || item.id, name: item.name, args: JSON.stringify({ input: item.input ?? '' }), custom: true });
        break;
      case 'local_shell_call':
        push('assistant', { type: 'tool_call', id: item.call_id || item.id, name: 'local_shell', args: JSON.stringify(item.action || {}) });
        break;
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output':
        push('user', { type: 'tool_result', id: item.call_id, content: outputToParts(item.output), custom: type === 'custom_tool_call_output' });
        break;
      case 'reasoning': {
        const text = (item.summary || []).map((s: any) => s.text || '').join('\n') || (item.content || []).map((c: any) => c.text || '').join('');
        if (text) push('assistant', { type: 'thinking', text });
        break;
      }
      default:
        break;
    }
  }

  const tools: IRTool[] = [];
  for (const t of body.tools || []) {
    if (t.type === 'function') tools.push({ name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } });
    else if (t.type === 'custom') {
      const grammar = t.format?.definition ? `\n\nInput must follow this ${t.format.syntax || ''} grammar:\n${t.format.definition}` : '';
      tools.push({ name: t.name, description: (t.description || '') + grammar, parameters: CUSTOM_INPUT_SCHEMA, custom: true });
    }
  }

  let toolChoice: IRToolChoice | undefined;
  const tc = body.tool_choice;
  if (tc === 'auto' || tc === 'none' || tc === 'required') toolChoice = tc;
  else if (tc && typeof tc === 'object' && tc.name) toolChoice = { name: tc.name };

  let reasoning: IRRequest['reasoning'];
  if (body.reasoning?.effort && body.reasoning.effort !== 'none') {
    reasoning = { effort: body.reasoning.effort as IREffort, summary: !!body.reasoning.summary };
  }

  let responseFormat: IRRequest['responseFormat'];
  const fmt = body.text?.format;
  if (fmt?.type === 'json_object') responseFormat = { type: 'json_object' };
  else if (fmt?.type === 'json_schema') responseFormat = { type: 'json_schema', schema: fmt.schema, name: fmt.name, strict: fmt.strict };

  return {
    model: body.model || '',
    system: system.length ? system.join('\n\n') : undefined,
    messages: messages.filter((m) => m.parts.length),
    tools: tools.length ? tools : undefined,
    toolChoice,
    parallelToolCalls: body.parallel_tool_calls,
    maxTokens: body.max_output_tokens ?? undefined,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    stream: !!body.stream,
    reasoning,
    responseFormat,
    user: body.user,
  };
}

export function customToolNames(ir: IRRequest): Set<string> {
  return new Set((ir.tools || []).filter((t) => t.custom).map((t) => t.name));
}

// --------------------------------------------------------------- request out

export interface ResponsesBuildOptions {
  model: string;
  stripSampling?: boolean;
}

export function buildResponsesRequest(ir: IRRequest, opts: ResponsesBuildOptions): any {
  const input: any[] = [];
  for (const m of ir.messages) {
    if (m.role === 'user') {
      const content: any[] = [];
      for (const p of m.parts) {
        if (p.type === 'tool_result') {
          input.push({ type: 'function_call_output', call_id: p.id, output: toolResultText(p) });
        } else if (p.type === 'text') content.push({ type: 'input_text', text: p.text });
        else if (p.type === 'image') content.push({ type: 'input_image', image_url: p.data ? `data:${p.mediaType || 'image/png'};base64,${p.data}` : p.url });
      }
      if (content.length) input.push({ type: 'message', role: 'user', content });
    } else {
      let text = '';
      const flush = () => {
        if (text) input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
        text = '';
      };
      for (const p of m.parts) {
        if (p.type === 'text') text += p.text;
        else if (p.type === 'tool_call') {
          flush();
          input.push({ type: 'function_call', call_id: p.id, name: p.name, arguments: p.args || '{}' });
        }
      }
      flush();
    }
  }

  const body: any = { model: opts.model, input, stream: true, store: false };
  if (ir.system) body.instructions = ir.system;
  if (ir.tools?.length) {
    body.tools = ir.tools.map((t) => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.parameters, strict: false }));
    if (ir.toolChoice) body.tool_choice = typeof ir.toolChoice === 'string' ? ir.toolChoice : { type: 'function', name: ir.toolChoice.name };
    if (ir.parallelToolCalls !== undefined) body.parallel_tool_calls = ir.parallelToolCalls;
  }
  if (ir.maxTokens) body.max_output_tokens = ir.maxTokens;
  if (!opts.stripSampling) {
    if (ir.temperature !== undefined) body.temperature = ir.temperature;
    if (ir.topP !== undefined) body.top_p = ir.topP;
  }
  if (ir.reasoning) body.reasoning = { effort: ir.reasoning.effort || budgetToEffort(ir.reasoning.budget), summary: 'auto' };
  if (ir.responseFormat) {
    body.text = {
      format: ir.responseFormat.type === 'json_object'
        ? { type: 'json_object' }
        : { type: 'json_schema', name: ir.responseFormat.name || 'response', schema: ir.responseFormat.schema, strict: !!ir.responseFormat.strict },
    };
  }
  return body;
}

// ------------------------------------------------------------ stream decode

export function usageFromResponses(u: any): Partial<IRUsage> | undefined {
  if (!u) return undefined;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  return {
    input: Math.max(0, (u.input_tokens || 0) - cached),
    output: u.output_tokens || 0,
    cacheRead: cached || undefined,
    reasoning: u.output_tokens_details?.reasoning_tokens || undefined,
  };
}

export class ResponsesStreamDecoder implements StreamDecoder {
  private items = new Map<string, { index: number; custom: boolean; input: string }>();
  private nextTool = 0;
  private stop?: IRStop;

  push(event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    const type = data?.type || event;
    switch (type) {
      case 'response.created':
        out.push({ type: 'start', id: data.response?.id, model: data.response?.model });
        break;
      case 'response.output_text.delta':
        if (data.delta) out.push({ type: 'text', text: data.delta });
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (data.delta) out.push({ type: 'thinking', text: data.delta });
        break;
      case 'response.output_item.added': {
        const item = data.item || {};
        if (item.type === 'function_call' || item.type === 'custom_tool_call') {
          const index = this.nextTool++;
          this.items.set(item.id, { index, custom: item.type === 'custom_tool_call', input: '' });
          out.push({ type: 'tool_start', index, id: item.call_id || item.id, name: item.name });
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const it = this.items.get(data.item_id);
        if (it && data.delta) out.push({ type: 'tool_args', index: it.index, delta: data.delta });
        break;
      }
      case 'response.custom_tool_call_input.delta': {
        const it = this.items.get(data.item_id);
        if (it) it.input += data.delta || '';
        break;
      }
      case 'response.output_item.done': {
        const item = data.item || {};
        const it = this.items.get(item.id);
        if (it) {
          if (it.custom) out.push({ type: 'tool_args', index: it.index, delta: JSON.stringify({ input: item.input ?? it.input }) });
          out.push({ type: 'tool_end', index: it.index });
          this.items.delete(item.id);
        }
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        const r = data.response || {};
        const u = usageFromResponses(r.usage);
        if (u) out.push({ type: 'usage', usage: u });
        if (r.status === 'incomplete' && r.incomplete_details?.reason === 'max_output_tokens') this.stop = 'max_tokens';
        else if (r.status === 'incomplete' && r.incomplete_details?.reason === 'content_filter') this.stop = 'content_filter';
        break;
      }
      case 'response.failed':
        out.push({ type: 'error', message: data.response?.error?.message || 'Upstream response failed' });
        break;
      case 'error':
        out.push({ type: 'error', message: data.message || data.error?.message || 'Upstream error' });
        break;
      default:
        break;
    }
    return out;
  }

  end(): IREvent[] {
    const out: IREvent[] = [];
    for (const it of this.items.values()) out.push({ type: 'tool_end', index: it.index });
    this.items.clear();
    out.push({ type: 'stop', reason: this.stop || (this.nextTool > 0 ? 'tool_use' : 'end_turn') });
    return out;
  }
}

// ------------------------------------------------------------ stream encode

function usageToResponses(u: IRUsage) {
  const input = u.input + (u.cacheRead || 0) + (u.cacheWrite || 0);
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: u.cacheRead || 0 },
    output_tokens: u.output,
    output_tokens_details: { reasoning_tokens: u.reasoning || 0 },
    total_tokens: input + u.output,
  };
}

interface OpenItem {
  kind: 'message' | 'reasoning' | 'tool';
  id: string;
  outputIndex: number;
  text: string;
  toolIndex?: number;
  callId?: string;
  name?: string;
  custom?: boolean;
}

export class ResponsesStreamEncoder implements StreamEncoder {
  private id = genId('resp_');
  private createdAt = Math.floor(Date.now() / 1000);
  private seq = 0;
  private started = false;
  private finished = false;
  private open: OpenItem | null = null;
  private tools = new Map<number, OpenItem>();
  private output: any[] = [];
  private usage: IRUsage = { input: 0, output: 0 };

  constructor(private model: string, private customTools: Set<string> = new Set()) {}

  private ev(type: string, data: any): string {
    return sseData({ type, sequence_number: this.seq++, ...data }, type);
  }

  private base(status: string, extra: any = {}) {
    return {
      id: this.id, object: 'response', created_at: this.createdAt, status, error: null, incomplete_details: null,
      instructions: null, max_output_tokens: null, model: this.model, output: [], parallel_tool_calls: true,
      previous_response_id: null, reasoning: { effort: null, summary: null }, store: false, temperature: null,
      text: { format: { type: 'text' } }, tool_choice: 'auto', tools: [], top_p: null, truncation: 'disabled',
      usage: null, user: null, metadata: {}, ...extra,
    };
  }

  private ensureStarted(): string {
    if (this.started) return '';
    this.started = true;
    return this.ev('response.created', { response: this.base('in_progress') }) + this.ev('response.in_progress', { response: this.base('in_progress') });
  }

  private closeItem(item: OpenItem): string {
    let out = '';
    const oi = item.outputIndex;
    if (item.kind === 'message') {
      const part = { type: 'output_text', text: item.text, annotations: [] };
      out += this.ev('response.output_text.done', { item_id: item.id, output_index: oi, content_index: 0, text: item.text, logprobs: [] });
      out += this.ev('response.content_part.done', { item_id: item.id, output_index: oi, content_index: 0, part });
      const done = { id: item.id, type: 'message', status: 'completed', role: 'assistant', content: [part] };
      this.output[oi] = done;
      out += this.ev('response.output_item.done', { output_index: oi, item: done });
    } else if (item.kind === 'reasoning') {
      const part = { type: 'summary_text', text: item.text };
      out += this.ev('response.reasoning_summary_text.done', { item_id: item.id, output_index: oi, summary_index: 0, text: item.text });
      out += this.ev('response.reasoning_summary_part.done', { item_id: item.id, output_index: oi, summary_index: 0, part });
      const done = { id: item.id, type: 'reasoning', summary: [part] };
      this.output[oi] = done;
      out += this.ev('response.output_item.done', { output_index: oi, item: done });
    } else {
      let done: any;
      if (item.custom) {
        const input = safeJsonParse(item.text, {})?.input ?? item.text;
        done = { id: item.id, type: 'custom_tool_call', status: 'completed', call_id: item.callId, name: item.name, input: typeof input === 'string' ? input : JSON.stringify(input) };
      } else {
        const args = item.text || '{}';
        out += this.ev('response.function_call_arguments.done', { item_id: item.id, output_index: oi, arguments: args });
        done = { id: item.id, type: 'function_call', status: 'completed', call_id: item.callId, name: item.name, arguments: args };
      }
      this.output[oi] = done;
      out += this.ev('response.output_item.done', { output_index: oi, item: done });
    }
    return out;
  }

  private closeOpen(): string {
    if (!this.open) return '';
    const item = this.open;
    this.open = null;
    if (item.kind === 'tool') return ''; // tools close on tool_end
    return this.closeItem(item);
  }

  private openItem(kind: 'message' | 'reasoning'): string {
    let out = this.closeOpen();
    const outputIndex = this.output.length;
    const id = genId(kind === 'message' ? 'msg_' : 'rs_');
    this.open = { kind, id, outputIndex, text: '' };
    if (kind === 'message') {
      const item = { id, type: 'message', status: 'in_progress', role: 'assistant', content: [] };
      this.output.push(item);
      out += this.ev('response.output_item.added', { output_index: outputIndex, item });
      out += this.ev('response.content_part.added', { item_id: id, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    } else {
      const item = { id, type: 'reasoning', summary: [] };
      this.output.push(item);
      out += this.ev('response.output_item.added', { output_index: outputIndex, item });
      out += this.ev('response.reasoning_summary_part.added', { item_id: id, output_index: outputIndex, summary_index: 0, part: { type: 'summary_text', text: '' } });
    }
    return out;
  }

  push(ev: IREvent): string {
    if (this.finished) return '';
    let out = '';
    switch (ev.type) {
      case 'start':
        return this.ensureStarted();
      case 'text':
        out += this.ensureStarted();
        if (this.open?.kind !== 'message') out += this.openItem('message');
        this.open!.text += ev.text;
        return out + this.ev('response.output_text.delta', { item_id: this.open!.id, output_index: this.open!.outputIndex, content_index: 0, delta: ev.text, logprobs: [] });
      case 'thinking':
        out += this.ensureStarted();
        if (this.open?.kind !== 'reasoning') out += this.openItem('reasoning');
        this.open!.text += ev.text;
        return out + this.ev('response.reasoning_summary_text.delta', { item_id: this.open!.id, output_index: this.open!.outputIndex, summary_index: 0, delta: ev.text });
      case 'tool_start': {
        out += this.ensureStarted() + this.closeOpen();
        const custom = this.customTools.has(ev.name);
        const outputIndex = this.output.length;
        const item: OpenItem = { kind: 'tool', id: genId(custom ? 'ctc_' : 'fc_'), outputIndex, text: '', toolIndex: ev.index, callId: ev.id, name: ev.name, custom };
        this.tools.set(ev.index, item);
        this.open = item;
        const added = custom
          ? { id: item.id, type: 'custom_tool_call', status: 'in_progress', call_id: ev.id, name: ev.name, input: '' }
          : { id: item.id, type: 'function_call', status: 'in_progress', call_id: ev.id, name: ev.name, arguments: '' };
        this.output.push(added);
        return out + this.ev('response.output_item.added', { output_index: outputIndex, item: added });
      }
      case 'tool_args': {
        const item = this.tools.get(ev.index);
        if (!item) return '';
        item.text += ev.delta;
        if (item.custom) return '';
        return this.ev('response.function_call_arguments.delta', { item_id: item.id, output_index: item.outputIndex, delta: ev.delta });
      }
      case 'tool_end': {
        const item = this.tools.get(ev.index);
        if (!item) return '';
        this.tools.delete(ev.index);
        if (this.open === item) this.open = null;
        return this.closeItem(item);
      }
      case 'usage':
        Object.assign(this.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)));
        return '';
      case 'stop':
        return this.finish(ev.reason);
      case 'error':
        this.finished = true;
        return this.ensureStarted() + this.ev('response.failed', {
          response: this.base('failed', { error: { code: 'server_error', message: ev.message }, output: this.output }),
        });
    }
    return '';
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    let out = this.ensureStarted() + this.closeOpen();
    for (const item of [...this.tools.values()]) out += this.closeItem(item);
    this.tools.clear();
    this.finished = true;
    const incomplete = reason === 'max_tokens' || reason === 'content_filter';
    const response = this.base(incomplete ? 'incomplete' : 'completed', {
      output: this.output,
      usage: usageToResponses(this.usage),
      incomplete_details: incomplete ? { reason: reason === 'max_tokens' ? 'max_output_tokens' : 'content_filter' } : null,
    });
    return out + this.ev(incomplete ? 'response.incomplete' : 'response.completed', { response });
  }

  end(): string {
    return this.finish('end_turn');
  }
}

// ---------------------------------------------------------- non-stream out

export function buildResponsesResponse(res: IRResponse, model: string, customTools: Set<string> = new Set()): any {
  const output: any[] = [];
  const thinking = res.parts.filter((p) => p.type === 'thinking').map((p: any) => p.text).join('');
  if (thinking) output.push({ id: genId('rs_'), type: 'reasoning', summary: [{ type: 'summary_text', text: thinking }] });
  const text = res.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('');
  if (text) {
    output.push({ id: genId('msg_'), type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });
  }
  for (const p of res.parts) {
    if (p.type !== 'tool_call') continue;
    if (customTools.has(p.name)) {
      const input = safeJsonParse(p.args, {})?.input ?? p.args;
      output.push({ id: genId('ctc_'), type: 'custom_tool_call', status: 'completed', call_id: p.id, name: p.name, input: typeof input === 'string' ? input : JSON.stringify(input) });
    } else {
      output.push({ id: genId('fc_'), type: 'function_call', status: 'completed', call_id: p.id, name: p.name, arguments: p.args || '{}' });
    }
  }
  const incomplete = res.stop === 'max_tokens' || res.stop === 'content_filter';
  return {
    id: genId('resp_'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: incomplete ? 'incomplete' : 'completed',
    error: null,
    incomplete_details: incomplete ? { reason: res.stop === 'max_tokens' ? 'max_output_tokens' : 'content_filter' } : null,
    model,
    output,
    output_text: text,
    parallel_tool_calls: true,
    store: false,
    usage: usageToResponses(res.usage),
  };
}
