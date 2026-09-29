// Anthropic Messages <-> IR
import {
  IRRequest, IRMessage, IRPart, IRTool, IRToolChoice, IREvent, IRResponse, IRStop, IRUsage,
  StreamDecoder, StreamEncoder, genId, safeJsonParse, mergeConsecutive, effortToBudget, IREffort,
} from './ir';
import { sseData } from './sse';

// ---------------------------------------------------------------- request in

function blocksToParts(content: any, role: 'user' | 'assistant'): IRPart[] {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const parts: IRPart[] = [];
  for (const b of content) {
    if (!b) continue;
    switch (b.type) {
      case 'text':
        if (b.text) parts.push({ type: 'text', text: b.text });
        break;
      case 'image':
      case 'document':
        if (b.source?.type === 'base64') parts.push({ type: 'image', mediaType: b.source.media_type, data: b.source.data });
        else if (b.source?.type === 'url') parts.push({ type: 'image', url: b.source.url, mediaType: b.type === 'document' ? 'application/pdf' : undefined });
        else if (b.source?.type === 'text' && b.source.data) parts.push({ type: 'text', text: b.source.data });
        break;
      case 'thinking':
        if (role === 'assistant') parts.push({ type: 'thinking', text: b.thinking || '', signature: b.signature });
        break;
      case 'redacted_thinking':
        if (role === 'assistant') parts.push({ type: 'thinking', text: '', redacted: b.data });
        break;
      case 'tool_use':
        parts.push({ type: 'tool_call', id: b.id, name: b.name, args: JSON.stringify(b.input ?? {}) });
        break;
      case 'tool_result': {
        const inner: any[] = [];
        if (typeof b.content === 'string') {
          if (b.content) inner.push({ type: 'text', text: b.content });
        } else if (Array.isArray(b.content)) {
          for (const c of b.content) {
            if (c.type === 'text' && c.text) inner.push({ type: 'text', text: c.text });
            else if (c.type === 'image' && c.source?.type === 'base64') inner.push({ type: 'image', mediaType: c.source.media_type, data: c.source.data });
            else if (c.type === 'image' && c.source?.type === 'url') inner.push({ type: 'image', url: c.source.url });
          }
        }
        parts.push({ type: 'tool_result', id: b.tool_use_id, content: inner, isError: !!b.is_error });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

export function parseAnthropicRequest(body: any): IRRequest {
  let system: string | undefined;
  if (typeof body.system === 'string') system = body.system;
  else if (Array.isArray(body.system)) system = body.system.map((s: any) => s.text || '').filter(Boolean).join('\n\n');

  const names = new Map<string, string>();
  const messages: IRMessage[] = [];
  for (const m of body.messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const parts = blocksToParts(m.content, role);
    for (const p of parts) if (p.type === 'tool_call') names.set(p.id, p.name);
    for (const p of parts) if (p.type === 'tool_result' && !p.name) p.name = names.get(p.id);
    messages.push({ role, parts });
  }

  let tools: IRTool[] | undefined;
  if (Array.isArray(body.tools)) {
    tools = body.tools
      .filter((t: any) => t && t.name && (t.input_schema || !t.type || t.type === 'custom'))
      .map((t: any) => ({ name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } }));
    if (!tools!.length) tools = undefined;
  }

  let toolChoice: IRToolChoice | undefined;
  const tc = body.tool_choice;
  if (tc?.type === 'auto') toolChoice = 'auto';
  else if (tc?.type === 'any') toolChoice = 'required';
  else if (tc?.type === 'none') toolChoice = 'none';
  else if (tc?.type === 'tool') toolChoice = { name: tc.name };

  let reasoning: IRRequest['reasoning'];
  if (body.thinking?.type === 'enabled') reasoning = { budget: body.thinking.budget_tokens };
  else if (body.thinking?.type === 'adaptive') reasoning = { effort: 'medium' };
  if (body.output_config?.effort) reasoning = { ...(reasoning || {}), effort: body.output_config.effort as IREffort };

  return {
    model: body.model || '',
    system,
    messages,
    tools,
    toolChoice,
    parallelToolCalls: tc?.disable_parallel_tool_use ? false : undefined,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    topK: body.top_k,
    stop: body.stop_sequences,
    stream: !!body.stream,
    reasoning,
    user: body.metadata?.user_id,
  };
}

// --------------------------------------------------------------- request out

export function sanitizeToolId(id: string): string {
  const clean = (id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || genId('toolu_');
}

/** Thinking blocks are only replayable to Anthropic with a genuine signature. */
function replayableThinking(p: IRPart): boolean {
  return p.type === 'thinking' && (!!p.redacted || (!!p.signature && p.signature.length > 20));
}

export function supportsAnthropicThinking(model: string): boolean {
  const m = model.toLowerCase();
  if (/claude-3-(5|opus|sonnet|haiku)|claude-2|claude-instant/.test(m)) return false;
  return true;
}

function defaultMaxTokens(model: string): number {
  return /claude-3-(5|haiku|opus|sonnet)/i.test(model) ? 8192 : 32000;
}

export interface AnthropicBuildOptions {
  model: string;
  /** Add cache_control breakpoints on system + tools (prompt caching). */
  autoCache?: boolean;
}

function imageBlock(p: { mediaType?: string; data?: string; url?: string }) {
  const isPdf = p.mediaType === 'application/pdf';
  const type = isPdf ? 'document' : 'image';
  if (p.data) return { type, source: { type: 'base64', media_type: p.mediaType || 'image/png', data: p.data } };
  return { type, source: { type: 'url', url: p.url } };
}

export function buildAnthropicRequest(ir: IRRequest, opts: AnthropicBuildOptions): any {
  const msgs: IRMessage[] = [];
  for (const m of ir.messages) {
    const parts = m.parts.filter((p) => {
      if (p.type === 'text') return p.text.length > 0;
      if (p.type === 'thinking') return m.role === 'assistant' && replayableThinking(p);
      return true;
    });
    if (parts.length) msgs.push({ role: m.role, parts });
  }
  const merged = mergeConsecutive(msgs);

  const messages = merged.map((m) => {
    const ordered = m.role === 'user'
      ? [...m.parts.filter((p) => p.type === 'tool_result'), ...m.parts.filter((p) => p.type !== 'tool_result')]
      : [...m.parts.filter((p) => p.type === 'thinking'), ...m.parts.filter((p) => p.type !== 'thinking')];
    const content = ordered.map((p): any => {
      switch (p.type) {
        case 'text': return { type: 'text', text: p.text };
        case 'image': return imageBlock(p);
        case 'thinking': return p.redacted ? { type: 'redacted_thinking', data: p.redacted } : { type: 'thinking', thinking: p.text, signature: p.signature };
        case 'tool_call': return { type: 'tool_use', id: sanitizeToolId(p.id), name: p.name, input: safeJsonParse(p.args, {}) };
        case 'tool_result': {
          const inner = p.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : imageBlock(c))).filter((c: any) => c.type !== 'text' || c.text);
          return { type: 'tool_result', tool_use_id: sanitizeToolId(p.id), content: inner.length ? inner : '', ...(p.isError ? { is_error: true } : {}) };
        }
      }
    });
    return { role: m.role, content };
  });

  // Assistant prefill must not end with whitespace.
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    const lastBlock = last.content[last.content.length - 1];
    if (lastBlock?.type === 'text') lastBlock.text = lastBlock.text.trimEnd() || '...';
  }

  let system = ir.system || '';
  if (ir.responseFormat) {
    system += `${system ? '\n\n' : ''}Respond only with valid JSON${ir.responseFormat.schema ? ` matching this JSON schema: ${JSON.stringify(ir.responseFormat.schema)}` : ''}. Do not wrap it in markdown.`;
  }

  const body: any = {
    model: opts.model,
    messages,
    max_tokens: ir.maxTokens || defaultMaxTokens(opts.model),
    stream: true,
  };
  if (system) body.system = opts.autoCache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;

  if (ir.tools?.length) {
    body.tools = ir.tools.map((t) => {
      const schema = t.parameters && typeof t.parameters === 'object' ? { ...t.parameters } : {};
      if (schema.type !== 'object') schema.type = 'object';
      if (!schema.properties) schema.properties = {};
      return { name: t.name, description: t.description || '', input_schema: schema };
    });
    if (opts.autoCache) body.tools[body.tools.length - 1].cache_control = { type: 'ephemeral' };
    if (ir.toolChoice) {
      const tc = ir.toolChoice;
      body.tool_choice = tc === 'auto' ? { type: 'auto' } : tc === 'required' ? { type: 'any' } : tc === 'none' ? { type: 'none' } : { type: 'tool', name: tc.name };
    }
    if (ir.parallelToolCalls === false) {
      body.tool_choice = { ...(body.tool_choice || { type: 'auto' }), disable_parallel_tool_use: true };
    }
  }

  let thinking = false;
  if (ir.reasoning && supportsAnthropicThinking(opts.model)) {
    // With thinking on, Anthropic requires the in-progress tool loop to start
    // with a signed thinking block. History translated from other providers
    // has none, so only enable thinking when that invariant holds.
    const lastAssistant = [...merged].reverse().find((m) => m.role === 'assistant');
    const midToolLoop = merged[merged.length - 1]?.role === 'user'
      && merged[merged.length - 1].parts.some((p) => p.type === 'tool_result');
    const ok = !midToolLoop || (lastAssistant?.parts.some(replayableThinking) ?? false);
    if (ok) {
      thinking = true;
      const budget = Math.max(1024, ir.reasoning.budget || effortToBudget(ir.reasoning.effort));
      body.thinking = { type: 'enabled', budget_tokens: budget };
      if (body.max_tokens <= budget) body.max_tokens = budget + 8192;
    }
  }

  if (!thinking) {
    if (ir.temperature !== undefined) body.temperature = Math.min(1, Math.max(0, ir.temperature));
    if (ir.topP !== undefined) body.top_p = ir.topP;
    if (ir.topK !== undefined) body.top_k = ir.topK;
  }
  if (ir.stop?.length) body.stop_sequences = ir.stop.slice(0, 4);
  return body;
}

/**
 * Light clean-up applied when a native Anthropic request is forwarded as-is:
 * drops thinking blocks that cannot be replayed (produced by another provider).
 */
export function sanitizeAnthropicPassthrough(body: any): any {
  if (!Array.isArray(body?.messages)) return body;
  for (const m of body.messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const filtered = m.content.filter((b: any) => b?.type !== 'thinking' || (b.signature && b.signature.length > 20));
    m.content = filtered.length ? filtered : [{ type: 'text', text: '...' }];
  }
  return body;
}

// ------------------------------------------------------------ stream decode

const STOP_MAP: Record<string, IRStop> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  pause_turn: 'end_turn',
  refusal: 'content_filter',
  model_context_window_exceeded: 'max_tokens',
};

export function usageFromAnthropic(u: any): Partial<IRUsage> | undefined {
  if (!u) return undefined;
  const out: Partial<IRUsage> = {};
  if (typeof u.input_tokens === 'number') out.input = u.input_tokens;
  if (typeof u.output_tokens === 'number') out.output = u.output_tokens;
  if (u.cache_read_input_tokens) out.cacheRead = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens) out.cacheWrite = u.cache_creation_input_tokens;
  return out;
}

export class AnthropicStreamDecoder implements StreamDecoder {
  private blockTool = new Map<number, number>();
  private nextTool = 0;
  private stop?: IRStop;

  push(event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    const type = data?.type || event;
    switch (type) {
      case 'message_start': {
        out.push({ type: 'start', id: data.message?.id, model: data.message?.model });
        const u = usageFromAnthropic(data.message?.usage);
        if (u) out.push({ type: 'usage', usage: u });
        break;
      }
      case 'content_block_start': {
        const b = data.content_block || {};
        if (b.type === 'text' && b.text) out.push({ type: 'text', text: b.text });
        else if (b.type === 'thinking' && b.thinking) out.push({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') {
          const idx = this.nextTool++;
          this.blockTool.set(data.index, idx);
          out.push({ type: 'tool_start', index: idx, id: b.id || genId('toolu_'), name: b.name || '' });
          if (b.input && Object.keys(b.input).length) out.push({ type: 'tool_args', index: idx, delta: JSON.stringify(b.input) });
        }
        break;
      }
      case 'content_block_delta': {
        const d = data.delta || {};
        if (d.type === 'text_delta' && d.text) out.push({ type: 'text', text: d.text });
        else if (d.type === 'thinking_delta' && d.thinking) out.push({ type: 'thinking', text: d.thinking });
        else if (d.type === 'signature_delta' && d.signature) out.push({ type: 'thinking_signature', signature: d.signature });
        else if (d.type === 'input_json_delta' && d.partial_json) {
          const idx = this.blockTool.get(data.index);
          if (idx !== undefined) out.push({ type: 'tool_args', index: idx, delta: d.partial_json });
        }
        break;
      }
      case 'content_block_stop': {
        const idx = this.blockTool.get(data.index);
        if (idx !== undefined) {
          out.push({ type: 'tool_end', index: idx });
          this.blockTool.delete(data.index);
        }
        break;
      }
      case 'message_delta': {
        if (data.delta?.stop_reason) this.stop = STOP_MAP[data.delta.stop_reason] || 'end_turn';
        const u = usageFromAnthropic(data.usage);
        if (u) out.push({ type: 'usage', usage: u });
        break;
      }
      case 'error':
        out.push({ type: 'error', message: data.error?.message || 'Upstream error', errorType: data.error?.type });
        break;
      default:
        break;
    }
    return out;
  }

  end(): IREvent[] {
    const out: IREvent[] = [];
    for (const idx of this.blockTool.values()) out.push({ type: 'tool_end', index: idx });
    this.blockTool.clear();
    out.push({ type: 'stop', reason: this.stop || (this.nextTool > 0 ? 'tool_use' : 'end_turn') });
    return out;
  }
}

// ------------------------------------------------------------ stream encode

const STOP_TO_ANTHROPIC: Record<IRStop, string> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  content_filter: 'refusal',
  error: 'end_turn',
};

function usageToAnthropic(u: IRUsage) {
  return {
    input_tokens: u.input,
    cache_creation_input_tokens: u.cacheWrite || 0,
    cache_read_input_tokens: u.cacheRead || 0,
    output_tokens: u.output,
  };
}

export class AnthropicStreamEncoder implements StreamEncoder {
  private id = genId('msg_');
  private started = false;
  private finished = false;
  private blockIndex = -1;
  private open: null | { kind: 'text' | 'thinking' | 'tool'; ir?: number } = null;
  private toolBlocks = new Map<number, number>();
  private usage: IRUsage;

  constructor(private model: string, estimatedInput = 0) {
    this.usage = { input: estimatedInput, output: 0 };
  }

  private ev(name: string, data: any): string {
    return sseData(data, name);
  }

  private ensureStarted(): string {
    if (this.started) return '';
    this.started = true;
    return this.ev('message_start', {
      type: 'message_start',
      message: {
        id: this.id, type: 'message', role: 'assistant', content: [], model: this.model,
        stop_reason: null, stop_sequence: null, usage: { ...usageToAnthropic(this.usage), output_tokens: 1 },
      },
    });
  }

  private closeOpen(): string {
    if (!this.open) return '';
    const idx = this.blockIndex;
    this.open = null;
    return this.ev('content_block_stop', { type: 'content_block_stop', index: idx });
  }

  private openBlock(kind: 'text' | 'thinking' | 'tool', block: any, ir?: number): string {
    let out = this.closeOpen();
    this.blockIndex++;
    this.open = { kind, ir };
    out += this.ev('content_block_start', { type: 'content_block_start', index: this.blockIndex, content_block: block });
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
        if (this.open?.kind !== 'text') out += this.openBlock('text', { type: 'text', text: '' });
        return out + this.ev('content_block_delta', { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'text_delta', text: ev.text } });
      case 'thinking':
        out += this.ensureStarted();
        if (this.open?.kind !== 'thinking') out += this.openBlock('thinking', { type: 'thinking', thinking: '', signature: '' });
        return out + this.ev('content_block_delta', { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'thinking_delta', thinking: ev.text } });
      case 'thinking_signature':
        if (this.open?.kind !== 'thinking') return '';
        return this.ev('content_block_delta', { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'signature_delta', signature: ev.signature } });
      case 'tool_start':
        out += this.ensureStarted();
        out += this.openBlock('tool', { type: 'tool_use', id: sanitizeToolId(ev.id), name: ev.name, input: {} }, ev.index);
        this.toolBlocks.set(ev.index, this.blockIndex);
        return out;
      case 'tool_args': {
        const idx = this.toolBlocks.get(ev.index);
        if (idx === undefined) return '';
        return this.ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: ev.delta } });
      }
      case 'tool_end':
        if (this.open?.kind === 'tool' && this.open.ir === ev.index) return this.closeOpen();
        return '';
      case 'usage':
        Object.assign(this.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)));
        return '';
      case 'stop':
        return this.finish(ev.reason);
      case 'error': {
        this.finished = true;
        return this.ev('error', { type: 'error', error: { type: ev.errorType || 'api_error', message: ev.message } });
      }
    }
    return '';
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    this.finished = true;
    let out = this.ensureStarted() + this.closeOpen();
    out += this.ev('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: STOP_TO_ANTHROPIC[reason] || 'end_turn', stop_sequence: null },
      usage: usageToAnthropic(this.usage),
    });
    out += this.ev('message_stop', { type: 'message_stop' });
    return out;
  }

  end(): string {
    return this.finish('end_turn');
  }
}

// ---------------------------------------------------------- non-stream out

export function buildAnthropicResponse(res: IRResponse, model: string): any {
  const content: any[] = [];
  for (const p of res.parts) {
    if (p.type === 'thinking') {
      if (p.redacted) content.push({ type: 'redacted_thinking', data: p.redacted });
      else content.push({ type: 'thinking', thinking: p.text, signature: p.signature || '' });
    } else if (p.type === 'text') content.push({ type: 'text', text: p.text });
    else if (p.type === 'tool_call') content.push({ type: 'tool_use', id: sanitizeToolId(p.id), name: p.name, input: safeJsonParse(p.args, {}) });
  }
  return {
    id: genId('msg_'),
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: STOP_TO_ANTHROPIC[res.stop] || 'end_turn',
    stop_sequence: null,
    usage: usageToAnthropic(res.usage),
  };
}

export function anthropicError(message: string, type = 'api_error') {
  return { type: 'error', error: { type, message } };
}
