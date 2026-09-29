// OpenAI Chat Completions <-> IR
import {
  IRRequest, IRMessage, IRPart, IRTool, IRToolChoice, IREvent, IRResponse, IRStop, IRUsage,
  StreamDecoder, StreamEncoder, genId, parseDataUrl, toolResultText, budgetToEffort, IREffort,
} from './ir';
import { sseData } from './sse';

// ---------------------------------------------------------------- request in

function contentToParts(content: any): IRPart[] {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: IRPart[] = [];
  for (const c of content) {
    if (!c) continue;
    if (typeof c === 'string') parts.push({ type: 'text', text: c });
    else if (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text') {
      if (c.text) parts.push({ type: 'text', text: c.text });
    } else if (c.type === 'refusal' && c.refusal) parts.push({ type: 'text', text: c.refusal });
    else if (c.type === 'image_url') {
      const url = typeof c.image_url === 'string' ? c.image_url : c.image_url?.url;
      if (!url) continue;
      const d = parseDataUrl(url);
      parts.push(d ? { type: 'image', mediaType: d.mediaType, data: d.data } : { type: 'image', url });
    }
  }
  return parts;
}

export function parseOpenAIRequest(body: any): IRRequest {
  const systemTexts: string[] = [];
  const messages: IRMessage[] = [];
  const toolNames = new Map<string, string>();

  for (const m of body.messages || []) {
    if (!m) continue;
    const role = m.role;
    if (role === 'system' || role === 'developer') {
      const t = contentToParts(m.content).map((p: any) => p.text || '').join('\n');
      if (t) systemTexts.push(t);
    } else if (role === 'user') {
      messages.push({ role: 'user', parts: contentToParts(m.content) });
    } else if (role === 'assistant') {
      const parts: IRPart[] = [];
      const reasoning = m.reasoning_content ?? (typeof m.reasoning === 'string' ? m.reasoning : undefined);
      if (reasoning) parts.push({ type: 'thinking', text: reasoning });
      parts.push(...contentToParts(m.content));
      for (const tc of m.tool_calls || []) {
        const id = tc.id || genId('call_');
        toolNames.set(id, tc.function?.name || '');
        parts.push({ type: 'tool_call', id, name: tc.function?.name || '', args: tc.function?.arguments || '{}' });
      }
      if (m.function_call) {
        const id = `call_${m.function_call.name}`;
        toolNames.set(id, m.function_call.name);
        parts.push({ type: 'tool_call', id, name: m.function_call.name, args: m.function_call.arguments || '{}' });
      }
      messages.push({ role: 'assistant', parts });
    } else if (role === 'tool' || role === 'function') {
      const id = role === 'tool' ? m.tool_call_id : `call_${m.name}`;
      const content = contentToParts(m.content).filter((p) => p.type === 'text' || p.type === 'image') as any[];
      const part: IRPart = { type: 'tool_result', id, name: m.name || toolNames.get(id), content };
      const last = messages[messages.length - 1];
      // Consecutive tool results belong to the same user turn.
      if (last && last.role === 'user' && last.parts.length && last.parts.every((p) => p.type === 'tool_result')) last.parts.push(part);
      else messages.push({ role: 'user', parts: [part] });
    }
  }

  let tools: IRTool[] | undefined;
  if (Array.isArray(body.tools) && body.tools.length) {
    tools = body.tools
      .filter((t: any) => t && (t.type === 'function' || t.function))
      .map((t: any) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters || { type: 'object', properties: {} } }));
  } else if (Array.isArray(body.functions) && body.functions.length) {
    tools = body.functions.map((f: any) => ({ name: f.name, description: f.description, parameters: f.parameters || { type: 'object', properties: {} } }));
  }

  let toolChoice: IRToolChoice | undefined;
  const tc = body.tool_choice ?? body.function_call;
  if (tc === 'auto' || tc === 'none' || tc === 'required') toolChoice = tc;
  else if (tc && typeof tc === 'object') toolChoice = { name: tc.function?.name || tc.name };

  let reasoning: IRRequest['reasoning'];
  if (body.reasoning_effort) reasoning = { effort: body.reasoning_effort as IREffort };
  else if (body.reasoning && typeof body.reasoning === 'object' && body.reasoning.enabled !== false) {
    reasoning = { effort: body.reasoning.effort, budget: body.reasoning.max_tokens };
  } else if (body.thinking?.type === 'enabled') reasoning = { budget: body.thinking.budget_tokens };

  let responseFormat: IRRequest['responseFormat'];
  const rf = body.response_format;
  if (rf?.type === 'json_object') responseFormat = { type: 'json_object' };
  else if (rf?.type === 'json_schema') {
    responseFormat = { type: 'json_schema', schema: rf.json_schema?.schema, name: rf.json_schema?.name, strict: rf.json_schema?.strict };
  }

  return {
    model: body.model || '',
    system: systemTexts.length ? systemTexts.join('\n\n') : undefined,
    messages,
    tools,
    toolChoice,
    parallelToolCalls: body.parallel_tool_calls,
    maxTokens: body.max_completion_tokens ?? body.max_tokens ?? undefined,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    stop: typeof body.stop === 'string' ? [body.stop] : Array.isArray(body.stop) ? body.stop : undefined,
    stream: !!body.stream,
    reasoning,
    responseFormat,
    user: body.user,
    includeUsage: !!body.stream_options?.include_usage,
  };
}

// --------------------------------------------------------------- request out

export interface OpenAIBuildOptions {
  model: string;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Send reasoning_effort (OpenAI o-series / gpt-5 style). */
  reasoningEffort?: boolean;
  /** Send OpenRouter's unified `reasoning` object. */
  openrouterReasoning?: boolean;
  /** Drop sampling params not accepted by reasoning models. */
  stripSampling?: boolean;
  /** Send assistant reasoning back as reasoning_content (DeepSeek thinking + tools). */
  echoReasoning?: boolean;
  streamOptions?: boolean;
  toolIdStyle?: 'mistral';
}

function mistralId(id: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  if (/^[a-zA-Z0-9]{9}$/.test(id)) return id;
  let h = 2166136261;
  let out = '';
  for (let round = 0; out.length < 9; round++) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i) ^ round, 16777619) >>> 0;
    out += chars[h % chars.length];
  }
  return out;
}

function imageToOpenAI(p: { mediaType?: string; data?: string; url?: string }) {
  const url = p.data ? `data:${p.mediaType || 'image/png'};base64,${p.data}` : p.url;
  return { type: 'image_url', image_url: { url } };
}

export function buildOpenAIRequest(ir: IRRequest, opts: OpenAIBuildOptions): any {
  const mapId = opts.toolIdStyle === 'mistral' ? mistralId : (id: string) => id;
  const messages: any[] = [];
  if (ir.system) messages.push({ role: 'system', content: ir.system });

  for (const m of ir.messages) {
    if (m.role === 'user') {
      const results = m.parts.filter((p) => p.type === 'tool_result') as any[];
      const rest = m.parts.filter((p) => p.type === 'text' || p.type === 'image');
      const toolImages: any[] = [];
      for (const r of results) {
        messages.push({ role: 'tool', tool_call_id: mapId(r.id), content: toolResultText(r) || (r.isError ? 'error' : '') });
        for (const c of r.content) if (c.type === 'image') toolImages.push(c);
      }
      const content: any[] = [];
      for (const p of [...toolImages, ...rest] as any[]) {
        if (p.type === 'text') content.push({ type: 'text', text: p.text });
        else content.push(imageToOpenAI(p));
      }
      if (content.length) {
        const simple = content.every((c) => c.type === 'text');
        messages.push({ role: 'user', content: simple ? content.map((c) => c.text).join('\n') : content });
      }
    } else {
      const text = m.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('');
      const calls = m.parts.filter((p) => p.type === 'tool_call') as any[];
      const thinking = m.parts.filter((p) => p.type === 'thinking').map((p: any) => p.text).join('');
      const msg: any = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({ id: mapId(c.id), type: 'function', function: { name: c.name, arguments: c.args || '{}' } }));
      }
      if (opts.echoReasoning && thinking) msg.reasoning_content = thinking;
      messages.push(msg);
    }
  }

  const body: any = { model: opts.model, messages, stream: true };
  if (opts.streamOptions !== false) body.stream_options = { include_usage: true };

  if (ir.tools?.length) {
    body.tools = ir.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } },
    }));
    if (ir.parallelToolCalls !== undefined) body.parallel_tool_calls = ir.parallelToolCalls;
  }
  if (ir.toolChoice && ir.tools?.length) {
    body.tool_choice = typeof ir.toolChoice === 'string' ? ir.toolChoice : { type: 'function', function: { name: ir.toolChoice.name } };
  }

  if (ir.maxTokens) body[opts.maxTokensField || 'max_tokens'] = ir.maxTokens;
  if (!opts.stripSampling) {
    if (ir.temperature !== undefined) body.temperature = ir.temperature;
    if (ir.topP !== undefined) body.top_p = ir.topP;
  }
  if (ir.stop?.length) body.stop = ir.stop;
  if (ir.reasoning) {
    if (opts.openrouterReasoning) {
      body.reasoning = ir.reasoning.budget && !ir.reasoning.effort ? { max_tokens: ir.reasoning.budget } : { effort: ir.reasoning.effort || budgetToEffort(ir.reasoning.budget) };
    } else if (opts.reasoningEffort) {
      body.reasoning_effort = ir.reasoning.effort || budgetToEffort(ir.reasoning.budget);
    }
  }
  if (ir.responseFormat) {
    body.response_format = ir.responseFormat.type === 'json_object'
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: ir.responseFormat.name || 'response', schema: ir.responseFormat.schema, strict: ir.responseFormat.strict } };
  }
  if (ir.user) body.user = ir.user;
  return body;
}

// ------------------------------------------------------------ stream decode

const FINISH_MAP: Record<string, IRStop> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'content_filter',
};

export function usageFromOpenAI(u: any): Partial<IRUsage> | undefined {
  if (!u) return undefined;
  const cached = u.prompt_tokens_details?.cached_tokens || u.prompt_cache_hit_tokens || 0;
  return {
    input: Math.max(0, (u.prompt_tokens || 0) - cached),
    output: u.completion_tokens || 0,
    cacheRead: cached || undefined,
    reasoning: u.completion_tokens_details?.reasoning_tokens || undefined,
  };
}

export class OpenAIStreamDecoder implements StreamDecoder {
  private started = false;
  private toolMap = new Map<number, number>();
  private openTools: number[] = [];
  private nextTool = 0;
  private stop?: IRStop;
  private sawTools = false;

  push(_event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    if (!data || typeof data !== 'object') return out;
    if (data.error) {
      out.push({ type: 'error', message: data.error.message || JSON.stringify(data.error), status: data.error.code && Number(data.error.code) || undefined });
      return out;
    }
    if (!this.started) {
      this.started = true;
      out.push({ type: 'start', id: data.id, model: data.model });
    }
    const choice = data.choices?.[0];
    const delta = choice?.delta || choice?.message;
    if (delta) {
      const reasoning = delta.reasoning_content ?? (typeof delta.reasoning === 'string' ? delta.reasoning : undefined);
      if (reasoning) out.push({ type: 'thinking', text: reasoning });
      if (typeof delta.content === 'string' && delta.content) out.push({ type: 'text', text: delta.content });
      if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((tc: any, pos: number) => {
          const key = typeof tc.index === 'number' ? tc.index : pos;
          let idx = this.toolMap.get(key);
          if (idx === undefined) {
            // Tools stream sequentially; a new tool closes the previous one.
            for (const open of this.openTools) out.push({ type: 'tool_end', index: open });
            this.openTools = [];
            idx = this.nextTool++;
            this.toolMap.set(key, idx);
            this.openTools.push(idx);
            this.sawTools = true;
            out.push({ type: 'tool_start', index: idx, id: tc.id || genId('call_'), name: tc.function?.name || '' });
          }
          const args = tc.function?.arguments;
          if (typeof args === 'string' && args) out.push({ type: 'tool_args', index: idx, delta: args });
          else if (args && typeof args === 'object') out.push({ type: 'tool_args', index: idx, delta: JSON.stringify(args) });
        });
      }
    }
    if (choice?.finish_reason) this.stop = FINISH_MAP[choice.finish_reason] || 'end_turn';
    const usage = usageFromOpenAI(data.usage);
    if (usage) out.push({ type: 'usage', usage });
    return out;
  }

  end(): IREvent[] {
    const out: IREvent[] = [];
    for (const open of this.openTools) out.push({ type: 'tool_end', index: open });
    this.openTools = [];
    let stop = this.stop || (this.sawTools ? 'tool_use' : 'end_turn');
    if (this.sawTools && stop === 'end_turn') stop = 'tool_use';
    out.push({ type: 'stop', reason: stop });
    return out;
  }
}

// ------------------------------------------------------------ stream encode

const STOP_TO_FINISH: Record<IRStop, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  content_filter: 'content_filter',
  error: 'stop',
};

function usageToOpenAI(u: IRUsage) {
  const prompt = u.input + (u.cacheRead || 0) + (u.cacheWrite || 0);
  return {
    prompt_tokens: prompt,
    completion_tokens: u.output,
    total_tokens: prompt + u.output,
    prompt_tokens_details: { cached_tokens: u.cacheRead || 0 },
    completion_tokens_details: { reasoning_tokens: u.reasoning || 0 },
  };
}

export class OpenAIStreamEncoder implements StreamEncoder {
  private id = genId('chatcmpl-');
  private created = Math.floor(Date.now() / 1000);
  private started = false;
  private finished = false;
  private usage: IRUsage = { input: 0, output: 0 };

  constructor(private model: string, private includeUsage = false) {}

  private chunk(delta: any, finish: string | null = null): string {
    return sseData({
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
    });
  }

  private ensureStarted(): string {
    if (this.started) return '';
    this.started = true;
    return this.chunk({ role: 'assistant', content: '' });
  }

  push(ev: IREvent): string {
    if (this.finished) return '';
    switch (ev.type) {
      case 'start':
        return this.ensureStarted();
      case 'text':
        return this.ensureStarted() + this.chunk({ content: ev.text });
      case 'thinking':
        return this.ensureStarted() + this.chunk({ reasoning_content: ev.text });
      case 'tool_start':
        return this.ensureStarted() + this.chunk({
          tool_calls: [{ index: ev.index, id: ev.id, type: 'function', function: { name: ev.name, arguments: '' } }],
        });
      case 'tool_args':
        return this.chunk({ tool_calls: [{ index: ev.index, function: { arguments: ev.delta } }] });
      case 'usage':
        Object.assign(this.usage, ev.usage);
        return '';
      case 'stop':
        return this.finish(ev.reason);
      case 'error': {
        this.finished = true;
        return sseData({ error: { message: ev.message, type: ev.errorType || 'api_error', code: ev.status || null } }) + 'data: [DONE]\n\n';
      }
      default:
        return '';
    }
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    this.finished = true;
    let out = this.ensureStarted() + this.chunk({}, STOP_TO_FINISH[reason] || 'stop');
    if (this.includeUsage) {
      out += sseData({ id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [], usage: usageToOpenAI(this.usage) });
    }
    return out + 'data: [DONE]\n\n';
  }

  end(): string {
    return this.finish('end_turn');
  }
}

// ---------------------------------------------------------- non-stream out

export function buildOpenAIResponse(res: IRResponse, model: string): any {
  const text = res.parts.filter((p) => p.type === 'text').map((p: any) => p.text).join('');
  const thinking = res.parts.filter((p) => p.type === 'thinking').map((p: any) => p.text).join('');
  const calls = res.parts.filter((p) => p.type === 'tool_call') as any[];
  const message: any = { role: 'assistant', content: text || (calls.length ? null : '') };
  if (thinking) message.reasoning_content = thinking;
  if (calls.length) message.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }));
  return {
    id: genId('chatcmpl-'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, logprobs: null, finish_reason: STOP_TO_FINISH[res.stop] || 'stop' }],
    usage: usageToOpenAI(res.usage),
  };
}

export function openAIError(message: string, type = 'api_error', code?: string | number) {
  return { error: { message, type, code: code ?? null } };
}

