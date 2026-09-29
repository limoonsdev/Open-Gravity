// Prompt-based tool calling for models without native function calling.
//
// Request side: tool definitions go into the system prompt with a strict
// <tool_call> protocol (the Hermes/Qwen convention most open models know),
// and the tool-call history is rendered as text.
// Response side: a streaming parser turns <tool_call> blocks (and a few other
// common dialects) back into real tool_start / tool_args / tool_end events, so
// clients like Claude Code or Codex see ordinary native tool calls.
import type { IRRequest, IRMessage, IRPart, IREvent, IRTool } from './ir';
import { genId, toolResultText, mergeConsecutive } from './ir';
import { parseLooseJson, coerceToSchema } from './json-repair';

// ------------------------------------------------------------------ request

function toolPrompt(tools: IRTool[], choice: IRRequest['toolChoice']): string {
  const defs = tools.map((t) => JSON.stringify({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } })).join('\n');
  let rules = [
    'You may call several tools in one reply: use one <tool_call> block per call.',
    'Put tool calls at the end of your reply. After the last </tool_call>, stop and wait: results come back in <tool_response> blocks.',
    'Only call the tools listed above, with arguments matching their JSON schema. Never invent tool results.',
    'If no tool is needed, answer normally without any <tool_call> block.',
  ];
  if (choice === 'required') rules = [...rules, 'You MUST call at least one tool in this reply.'];
  else if (choice && typeof choice === 'object') rules = [...rules, `You MUST call the tool "${choice.name}" in this reply.`];
  return [
    '# Tools',
    '',
    'You can call tools. They are described by these JSON objects:',
    '<tools>',
    defs,
    '</tools>',
    '',
    'To call a tool, write a block containing a JSON object with the tool name and its arguments:',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"param": "value"}}',
    '</tool_call>',
    '',
    ...rules.map((r) => `- ${r}`),
  ].join('\n');
}

function renderCall(p: Extract<IRPart, { type: 'tool_call' }>): string {
  const args = parseLooseJson(p.args || '{}') ?? {};
  return `<tool_call>\n${JSON.stringify({ name: p.name, arguments: args })}\n</tool_call>`;
}

/** Rewrite a request so a model without function calling can still use the tools. */
export function emulateToolsRequest(ir: IRRequest): IRRequest {
  const tools = ir.toolChoice === 'none' ? [] : ir.tools || [];
  const rendered: IRMessage[] = ir.messages.map((m) => {
    const parts: IRPart[] = [];
    for (const p of m.parts) {
      if (p.type === 'tool_call') parts.push({ type: 'text', text: renderCall(p) });
      else if (p.type === 'tool_result') {
        const attrs = `name="${p.name || 'tool'}" id="${p.id}"${p.isError ? ' status="error"' : ''}`;
        parts.push({ type: 'text', text: `<tool_response ${attrs}>\n${toolResultText(p)}\n</tool_response>` });
        for (const c of p.content) if (c.type === 'image') parts.push(c);
      } else parts.push(p);
    }
    return { role: m.role, parts };
  });
  // Tool results become plain user turns: keep roles strictly alternating (many
  // local chat templates reject two user messages in a row), then merge adjacent
  // text parts so the transcript reads naturally.
  const messages: IRMessage[] = mergeConsecutive(rendered).map((m) => {
    const merged: IRPart[] = [];
    for (const p of m.parts) {
      const last = merged[merged.length - 1];
      if (p.type === 'text' && last?.type === 'text') last.text += `\n\n${p.text}`;
      else merged.push(p.type === 'text' ? { ...p } : p);
    }
    return { role: m.role, parts: merged };
  });
  const system = tools.length ? [ir.system, toolPrompt(tools, ir.toolChoice)].filter(Boolean).join('\n\n') : ir.system;
  const stop = tools.length ? [...new Set([...(ir.stop || []), '<tool_response'])].slice(0, 4) : ir.stop;
  return { ...ir, system, messages, tools: undefined, toolChoice: undefined, parallelToolCalls: undefined, stop };
}

// ----------------------------------------------------------------- response

interface Opener {
  re: RegExp;
  close: string;
  kind: 'json' | 'function' | 'invoke' | 'fence';
}

const OPENERS: Opener[] = [
  { re: /<tool_call>/, close: '</tool_call>', kind: 'json' },
  { re: /<function_call>/, close: '</function_call>', kind: 'json' },
  { re: /<tool_calls>/, close: '</tool_calls>', kind: 'json' },
  { re: /<function=([^>\s]+)>/, close: '</function>', kind: 'function' },
  { re: /<invoke name="([^"]+)">/, close: '</invoke>', kind: 'invoke' },
  { re: /```tool_call[^\n]*\n/, close: '```', kind: 'fence' },
];
const OPENER_PREFIXES = ['<tool_call>', '<function_call>', '<tool_calls>', '<function=', '<invoke name="', '```tool_call'];
const ANY_OPENER = new RegExp(OPENERS.map((o) => o.re.source).join('|'));

/** Parameters written as <parameter=name>v</parameter> or <parameter name="n">v</parameter>. */
function parseParamTags(body: string): Record<string, any> {
  const args: Record<string, any> = {};
  const re = /<parameter(?:=([^>\s]+)|\s+name="([^"]+)")>([\s\S]*?)<\/parameter>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const raw = m[3].replace(/^\n/, '').replace(/\n$/, '');
    const parsed = /^\s*[[{]/.test(raw) || /^\s*(-?\d+(\.\d+)?|true|false|null)\s*$/.test(raw) ? parseLooseJson(raw) : undefined;
    args[m[1] || m[2]] = parsed !== undefined ? parsed : raw;
  }
  return args;
}

interface ParsedCall { name: string; args: any }

function normalizeCallObject(o: any): ParsedCall | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const fn = o.function && typeof o.function === 'object' ? o.function : undefined;
  const name = o.name || o.tool || o.tool_name || o.function_name || fn?.name || (typeof o.function === 'string' ? o.function : undefined);
  if (!name || typeof name !== 'string') return undefined;
  let args = o.arguments ?? o.parameters ?? o.args ?? o.input ?? o.params ?? fn?.arguments ?? fn?.parameters ?? {};
  if (typeof args === 'string') args = parseLooseJson(args) ?? { input: args };
  return { name, args };
}

function parseBlock(kind: Opener['kind'], captured: string | undefined, body: string): ParsedCall[] {
  if (kind === 'function') {
    const args = /<parameter[=\s]/.test(body) ? parseParamTags(body) : parseLooseJson(body) ?? {};
    return captured ? [{ name: captured, args }] : [];
  }
  if (kind === 'invoke') return captured ? [{ name: captured, args: parseParamTags(body) }] : [];
  // JSON-style blocks, possibly containing a Qwen3-Coder style <function=...> inside.
  const inner = /<function=([^>\s]+)>([\s\S]*?)(<\/function>|$)/.exec(body);
  if (inner) return [{ name: inner[1], args: /<parameter[=\s]/.test(inner[2]) ? parseParamTags(inner[2]) : parseLooseJson(inner[2]) ?? {} }];
  const parsed = parseLooseJson(body);
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return list.map(normalizeCallObject).filter((x): x is ParsedCall => !!x);
}

/**
 * Streaming transform: extracts tool calls from model text. Text outside tool
 * blocks streams through untouched (a short tail is held back only while it
 * could be the start of a tag).
 */
export class ToolCallStreamParser {
  private buf = '';
  private mode: 'start' | 'text' | 'call' | 'maybe_json' = 'start';
  private opener?: Opener;
  private captured?: string;
  private rawOpen = '';
  private toolIndex = 0;
  private emitted = 0;
  private byName = new Map<string, IRTool>();

  constructor(tools: IRTool[], private idPrefix = 'call_') {
    for (const t of tools) this.byName.set(t.name.toLowerCase(), t);
  }

  get callCount() {
    return this.emitted;
  }

  private resolveTool(name: string): IRTool | undefined {
    const n = name.trim().replace(/^functions?\./, '').toLowerCase();
    return this.byName.get(n);
  }

  private emitCalls(calls: ParsedCall[], rawBlock: string): IREvent[] {
    const out: IREvent[] = [];
    const valid = calls.map((c) => ({ c, tool: this.resolveTool(c.name) })).filter((x) => x.tool);
    if (!valid.length) return rawBlock ? [{ type: 'text', text: rawBlock }] : [];
    for (const { c, tool } of valid) {
      const index = this.toolIndex++;
      const args = coerceToSchema(c.args && typeof c.args === 'object' ? c.args : {}, tool!.parameters);
      out.push({ type: 'tool_start', index, id: genId(this.idPrefix), name: tool!.name });
      out.push({ type: 'tool_args', index, delta: JSON.stringify(args) });
      out.push({ type: 'tool_end', index });
      this.emitted++;
    }
    return out;
  }

  /** Length of a trailing fragment that could be the beginning of an opener. */
  private heldTail(s: string): number {
    const from = Math.max(0, s.length - 64);
    for (let i = from; i < s.length; i++) {
      if (s[i] !== '<' && s[i] !== '`') continue;
      const tail = s.slice(i);
      if (OPENER_PREFIXES.some((o) => o.startsWith(tail) || (tail.startsWith(o) && !/[>\n]/.test(tail.slice(o.length))))) return s.length - i;
    }
    return 0;
  }

  private process(final: boolean): IREvent[] {
    const out: IREvent[] = [];
    for (;;) {
      if (this.mode === 'start') {
        const lead = this.buf.trimStart();
        if (!lead) {
          if (final) this.buf = '';
          return out;
        }
        // A reply that is only a JSON object may be a bare tool call: hold it.
        this.mode = lead.startsWith('{') || lead.startsWith('```json') || lead.startsWith('[{') ? 'maybe_json' : 'text';
        continue;
      }
      if (this.mode === 'maybe_json') {
        if (!final && this.buf.length < 16_000 && !ANY_OPENER.test(this.buf)) return out;
        if (ANY_OPENER.test(this.buf)) {
          this.mode = 'text';
          continue;
        }
        const calls = parseBlock('json', undefined, this.buf);
        const valid = calls.filter((c) => this.resolveTool(c.name));
        const text = this.buf;
        this.buf = '';
        this.mode = 'text';
        if (valid.length && final) out.push(...this.emitCalls(valid, text));
        else if (text) out.push({ type: 'text', text });
        if (final) return out;
        continue;
      }
      if (this.mode === 'text') {
        const m = ANY_OPENER.exec(this.buf);
        if (m) {
          const before = this.buf.slice(0, m.index);
          if (before && (this.emitted === 0 || before.trim())) out.push({ type: 'text', text: before });
          this.opener = OPENERS.find((o) => new RegExp(`^${o.re.source}`).test(this.buf.slice(m.index)))!;
          const om = this.opener.re.exec(this.buf.slice(m.index))!;
          this.captured = om[1];
          this.rawOpen = om[0];
          this.buf = this.buf.slice(m.index + om[0].length);
          this.mode = 'call';
          continue;
        }
        const hold = final ? 0 : this.heldTail(this.buf);
        const emit = this.buf.slice(0, this.buf.length - hold);
        if (emit && (this.emitted === 0 || emit.trim())) out.push({ type: 'text', text: emit });
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      // mode === 'call'
      const close = this.buf.indexOf(this.opener!.close);
      if (close < 0 && !final) return out;
      const body = close < 0 ? this.buf : this.buf.slice(0, close);
      const raw = this.rawOpen + body + (close < 0 ? '' : this.opener!.close);
      out.push(...this.emitCalls(parseBlock(this.opener!.kind, this.captured, body), raw));
      this.buf = close < 0 ? '' : this.buf.slice(close + this.opener!.close.length);
      this.mode = 'text';
      if (close < 0) return out;
    }
  }

  push(ev: IREvent): IREvent[] {
    if (ev.type === 'text') {
      this.buf += ev.text;
      return this.process(false);
    }
    if (ev.type === 'stop') {
      const out = this.process(true);
      const reason = this.emitted > 0 && (ev.reason === 'end_turn' || ev.reason === 'stop_sequence' || ev.reason === 'max_tokens') ? 'tool_use' : ev.reason;
      out.push({ type: 'stop', reason });
      return out;
    }
    if (ev.type === 'error') return [...this.process(true), ev];
    return [ev];
  }
}
