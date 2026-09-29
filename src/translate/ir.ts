// Intermediate representation shared by every protocol translator.
//
// Every inbound request (OpenAI Chat, Anthropic Messages, OpenAI Responses,
// Gemini generateContent) is parsed into an IRRequest, and every upstream
// stream is decoded into IREvents. Encoders then turn IREvents back into the
// wire format the client speaks. N formats => 2N translators instead of N².

export type ApiFormat = 'openai' | 'anthropic' | 'gemini' | 'responses' | 'ollama' | 'ollama-generate' | 'completions';

export interface IRText { type: 'text'; text: string }
export interface IRImage { type: 'image'; mediaType?: string; data?: string; url?: string }
export interface IRThinking { type: 'thinking'; text: string; signature?: string; redacted?: string }
export interface IRToolCall { type: 'tool_call'; id: string; name: string; args: string; custom?: boolean }
export interface IRToolResult {
  type: 'tool_result';
  id: string;
  name?: string;
  content: Array<IRText | IRImage>;
  isError?: boolean;
  custom?: boolean;
}
export type IRPart = IRText | IRImage | IRThinking | IRToolCall | IRToolResult;

export interface IRMessage { role: 'user' | 'assistant'; parts: IRPart[] }

export interface IRTool {
  name: string;
  description?: string;
  parameters: any;
  /** OpenAI Responses "custom" (freeform) tool, exposed upstream as a function with one string arg. */
  custom?: boolean;
}

export type IRToolChoice = 'auto' | 'none' | 'required' | { name: string };
export type IREffort = 'minimal' | 'low' | 'medium' | 'high';

export interface IRRequest {
  model: string;
  system?: string;
  messages: IRMessage[];
  tools?: IRTool[];
  toolChoice?: IRToolChoice;
  parallelToolCalls?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  stream: boolean;
  reasoning?: { effort?: IREffort; budget?: number; summary?: boolean };
  responseFormat?: { type: 'json_object' | 'json_schema'; schema?: any; name?: string; strict?: boolean };
  user?: string;
  /** OpenAI stream_options.include_usage */
  includeUsage?: boolean;
}

export interface IRUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

export type IRStop = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'content_filter' | 'error';

export interface IRResponse {
  id: string;
  model: string;
  parts: IRPart[];
  stop: IRStop;
  usage: IRUsage;
}

export type IREvent =
  | { type: 'start'; id?: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'thinking_signature'; signature: string }
  | { type: 'tool_start'; index: number; id: string; name: string }
  | { type: 'tool_args'; index: number; delta: string }
  | { type: 'tool_end'; index: number }
  | { type: 'usage'; usage: Partial<IRUsage> }
  | { type: 'stop'; reason: IRStop }
  | { type: 'error'; message: string; status?: number; errorType?: string };

/** Stateful decoder: raw upstream JSON events -> IR events. */
export interface StreamDecoder {
  /** Feed one parsed SSE event (event name + parsed JSON data). */
  push(event: string | undefined, data: any): IREvent[];
  /** Called when upstream closes; flushes pending state (open tools, stop reason). */
  end(): IREvent[];
}

/** Stateful encoder: IR events -> client wire format text chunks. */
export interface StreamEncoder {
  push(ev: IREvent): string;
  /** Finalize the stream (emit terminal events). Idempotent. */
  end(): string;
}

export function emptyUsage(): IRUsage {
  return { input: 0, output: 0 };
}

export function mergeUsage(target: IRUsage, u: Partial<IRUsage>): IRUsage {
  if (u.input !== undefined) target.input = u.input;
  if (u.output !== undefined) target.output = u.output;
  if (u.cacheRead !== undefined) target.cacheRead = u.cacheRead;
  if (u.cacheWrite !== undefined) target.cacheWrite = u.cacheWrite;
  if (u.reasoning !== undefined) target.reasoning = u.reasoning;
  return target;
}

export function genId(prefix: string, len = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${s}`;
}

export function safeJsonParse(s: string | undefined | null, fallback: any = {}): any {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/** Rough token estimate (~4 chars/token) used when upstream reports nothing. */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

export function estimateRequestTokens(req: IRRequest): number {
  let chars = (req.system || '').length;
  for (const m of req.messages) {
    for (const p of m.parts) {
      if (p.type === 'text') chars += p.text.length;
      else if (p.type === 'thinking') chars += p.text.length;
      else if (p.type === 'tool_call') chars += p.args.length + p.name.length;
      else if (p.type === 'tool_result') for (const c of p.content) chars += c.type === 'text' ? c.text.length : 1000;
      else if (p.type === 'image') chars += 1000;
    }
  }
  if (req.tools) chars += JSON.stringify(req.tools).length;
  return Math.ceil(chars / 4);
}

export function effortToBudget(effort?: IREffort): number {
  switch (effort) {
    case 'minimal': return 1024;
    case 'low': return 4096;
    case 'high': return 24576;
    default: return 12288;
  }
}

export function budgetToEffort(budget?: number): IREffort {
  if (budget === undefined) return 'medium';
  if (budget <= 1024) return 'minimal';
  if (budget <= 6000) return 'low';
  if (budget <= 16000) return 'medium';
  return 'high';
}

/** Collapse IR tool-result content into plain text (for formats that only accept strings). */
export function toolResultText(r: IRToolResult): string {
  return r.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n');
}

export function textOf(parts: IRPart[]): string {
  return parts.filter((p): p is IRText => p.type === 'text').map((p) => p.text).join('');
}

/** Merge consecutive messages of the same role (required by Anthropic/Gemini). */
export function mergeConsecutive(messages: IRMessage[]): IRMessage[] {
  const out: IRMessage[] = [];
  for (const m of messages) {
    if (!m.parts.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.parts.push(...m.parts);
    else out.push({ role: m.role, parts: [...m.parts] });
  }
  return out;
}

/** Parse a data: URL into media type + base64 payload. */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mediaType: m[1] || 'application/octet-stream', data: m[2] };
}
