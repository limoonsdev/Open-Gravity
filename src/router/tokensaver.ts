// Token saver: shrink prompts before they leave the machine.
//
// Stage 1 (every request, model-independent) only touches the *older* part of
// the conversation, never the last `keepRecentTurns` turns:
//   - long tool outputs keep their head and tail
//   - identical tool outputs repeated later are replaced by a reference
//   - pretty-printed JSON outputs are minified
//   - trailing spaces / runs of blank lines are collapsed
//   - old images and old reasoning blocks are dropped
// Stage 2 (per target model) compacts the conversation when it gets close to
// the model's context window: aggressive trimming first, then the oldest turns
// are replaced by a summary (instant built-in digest, or an LLM summary cached
// by content so agent loops reuse it).
import crypto from 'crypto';
import type { IRRequest, IRMessage, IRPart, IRToolResult } from '../translate';
import { mergeConsecutive } from '../translate/ir';
import type { TokenSaverSettings } from '../core/config';
import { TOKEN_SAVER_PRESETS } from '../core/config';

export interface SaverResult {
  ir: IRRequest;
  before: number;
  after: number;
  saved: number;
  actions: string[];
}

const TAG = 'Open Gravity';
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Rough token count: ~4 chars per token for Latin text/code, ~1 per CJK char. */
export function countTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length || 0;
  return Math.ceil((text.length - cjk) / 3.8 + cjk * 0.9);
}

function partTokens(p: IRPart): number {
  switch (p.type) {
    case 'text': return countTokens(p.text);
    case 'thinking': return countTokens(p.text);
    case 'image': return 800;
    case 'tool_call': return countTokens(p.args) + countTokens(p.name) + 4;
    case 'tool_result': return p.content.reduce((s, c) => s + (c.type === 'text' ? countTokens(c.text) : 800), 4);
  }
}

export function requestTokens(ir: IRRequest): number {
  let n = countTokens(ir.system || '');
  for (const m of ir.messages) {
    n += 4;
    for (const p of m.parts) n += partTokens(p);
  }
  if (ir.tools?.length) n += countTokens(JSON.stringify(ir.tools));
  return n;
}

// ------------------------------------------------------------ text helpers

export function trimMiddle(text: string, maxTokens: number): string | undefined {
  if (maxTokens <= 0 || countTokens(text) <= maxTokens) return undefined;
  const budget = Math.max(200, Math.floor(maxTokens * 3.8));
  const headLen = Math.floor(budget * 0.6);
  const tailLen = budget - headLen;
  let head = text.slice(0, headLen);
  const hn = head.lastIndexOf('\n');
  if (hn > headLen * 0.5) head = head.slice(0, hn);
  let tail = text.slice(text.length - tailLen);
  const tn = tail.indexOf('\n');
  if (tn >= 0 && tn < tailLen * 0.5) tail = tail.slice(tn + 1);
  const middle = text.slice(head.length, text.length - tail.length);
  if (middle.length < 200) return undefined;
  const lines = (middle.match(/\n/g) || []).length;
  return `${head}\n[… ${lines} lines (~${countTokens(middle)} tokens) omitted by ${TAG} to save tokens …]\n${tail}`;
}

export function compactWhitespace(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

export function minifyJson(text: string): string | undefined {
  const s = text.trim();
  if (s.length < 200 || (s[0] !== '{' && s[0] !== '[')) return undefined;
  try {
    const min = JSON.stringify(JSON.parse(s));
    return min.length < s.length * 0.9 ? min : undefined;
  } catch {
    return undefined;
  }
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
const resultText = (r: IRToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n');

// ------------------------------------------------------------------ stage 1

export function applyTokenSaver(ir: IRRequest, s: TokenSaverSettings): SaverResult {
  const before = requestTokens(ir);
  if (s.mode === 'off' || !ir.messages.length) return { ir, before, after: before, saved: 0, actions: [] };
  const n = ir.messages.length;
  // The boundary moves in steps of 8 messages: older turns change rarely, so
  // providers' prompt caches (Anthropic, OpenAI) keep hitting between steps.
  const protectFrom = Math.floor(Math.max(0, n - Math.max(0, s.keepRecentTurns) * 2) / 8) * 8;
  const actions = new Map<string, number>();
  const note = (a: string) => actions.set(a, (actions.get(a) || 0) + 1);

  // Latest occurrence of each large tool output (for dedupe).
  const latest = new Map<string, number>();
  if (s.dedupeToolResults) {
    ir.messages.forEach((m, mi) => m.parts.forEach((p, pi) => {
      if (p.type !== 'tool_result') return;
      const t = resultText(p);
      if (countTokens(t) >= 150) latest.set(hash(t), mi * 10_000 + pi);
    }));
  }

  let changed = false;
  let messages: IRMessage[] = ir.messages.map((m, mi) => {
    if (mi >= protectFrom) return m;
    let parts: IRPart[] = [];
    let touched = false;
    m.parts.forEach((p, pi) => {
      if (p.type === 'thinking' && s.dropOldThinking && m.role === 'assistant') {
        touched = true;
        note('drop-old-reasoning');
        return;
      }
      if (p.type === 'image' && s.dropOldImages && mi > 0) {
        touched = true;
        note('drop-old-image');
        parts.push({ type: 'text', text: `[image omitted by ${TAG}]` });
        return;
      }
      if (p.type === 'text' && s.compactWhitespace) {
        const t = compactWhitespace(p.text);
        if (t !== p.text) {
          touched = true;
          note('whitespace');
          parts.push({ ...p, text: t });
          return;
        }
      }
      if (p.type === 'tool_result') {
        const full = resultText(p);
        if (s.dedupeToolResults && countTokens(full) >= 150) {
          const pos = latest.get(hash(full));
          if (pos !== undefined && pos !== mi * 10_000 + pi) {
            touched = true;
            note('dedupe-tool-output');
            parts.push({ ...p, content: [{ type: 'text', text: `[Same output as a later ${p.name || 'tool'} call; omitted by ${TAG}]` }] });
            return;
          }
        }
        let resultChanged = false;
        const content = p.content.flatMap((c): IRToolResult['content'] => {
          if (c.type === 'image') {
            if (!s.dropOldImages) return [c];
            resultChanged = true;
            note('drop-old-image');
            return [{ type: 'text', text: `[image omitted by ${TAG}]` }];
          }
          let t = c.text;
          if (s.minifyJson) {
            const mj = minifyJson(t);
            if (mj) {
              t = mj;
              note('minify-json');
            }
          }
          if (s.compactWhitespace) {
            const w = compactWhitespace(t);
            if (w !== t) {
              t = w;
              note('whitespace');
            }
          }
          const trimmed = trimMiddle(t, s.toolResultMaxTokens);
          if (trimmed) {
            t = trimmed;
            note('trim-tool-output');
          }
          if (t !== c.text) resultChanged = true;
          return [{ type: 'text', text: t }];
        });
        if (resultChanged) {
          touched = true;
          parts.push({ ...p, content });
          return;
        }
      }
      parts.push(p);
    });
    if (!touched) return m;
    changed = true;
    if (!parts.length) parts = [{ type: 'text', text: '…' }];
    return { ...m, parts };
  });
  if (!changed) return { ir, before, after: before, saved: 0, actions: [] };
  messages = mergeConsecutive(messages);
  const out = { ...ir, messages };
  const after = requestTokens(out);
  return { ir: out, before, after, saved: Math.max(0, before - after), actions: [...actions.keys()] };
}

// ------------------------------------------------------------------ stage 2

/** Should this request be compacted for a model with `context` tokens? */
export function compactionNeeded(tokens: number, context: number | undefined, s: TokenSaverSettings, maxOutput = 4096): boolean {
  if (!context || s.mode === 'off' || s.compactAt <= 0) return false;
  return tokens > context * s.compactAt || tokens + maxOutput > context;
}

/** One-line digest of a tool call for the built-in summary. */
function describeCall(name: string, args: string): string {
  let a: any;
  try { a = JSON.parse(args); } catch { /* raw */ }
  const pick = a && typeof a === 'object'
    ? a.file_path || a.path || a.filePath || a.target_file || a.command || a.cmd || a.pattern || a.query || a.url || Object.values(a).find((v) => typeof v === 'string')
    : args;
  const s = Array.isArray(pick) ? pick.join(' ') : String(pick ?? '');
  return s ? `${name}(${s.replace(/\s+/g, ' ').slice(0, 80)})` : name;
}

/** Instant, deterministic summary of removed turns. */
export function digest(removed: IRMessage[]): string {
  const calls: string[] = [];
  const asks: string[] = [];
  const notes: string[] = [];
  for (const m of removed) {
    for (const p of m.parts) {
      if (p.type === 'tool_call') calls.push(describeCall(p.name, p.args));
      else if (p.type === 'text' && p.text.trim()) {
        const t = p.text.replace(/\s+/g, ' ').trim();
        if (m.role === 'user' && !t.startsWith('[')) asks.push(t.slice(0, 240));
        else if (m.role === 'assistant') notes.push(t.slice(0, 200));
      }
    }
  }
  const lines = [`[Earlier conversation compacted by ${TAG}: ${removed.length} messages removed to fit the context window.]`];
  if (asks.length) lines.push('User requests in that part:', ...asks.slice(-6).map((a) => `- ${a}`));
  if (calls.length) {
    const uniq = [...new Set(calls)];
    lines.push(`Tool calls made (${calls.length}):`, ...uniq.slice(-30).map((c) => `- ${c}`));
  }
  if (notes.length) lines.push('Assistant notes:', ...notes.slice(-4).map((x) => `- ${x}`));
  return lines.join('\n');
}

/** Transcript of removed turns for an LLM summariser (bounded size). */
export function transcript(removed: IRMessage[], maxChars = 60_000): string {
  const out: string[] = [];
  for (const m of removed) {
    for (const p of m.parts) {
      if (p.type === 'text') out.push(`${m.role.toUpperCase()}: ${p.text}`);
      else if (p.type === 'tool_call') out.push(`ASSISTANT called ${describeCall(p.name, p.args)}`);
      else if (p.type === 'tool_result') out.push(`TOOL RESULT (${p.name || 'tool'}): ${resultText(p).slice(0, 600)}`);
    }
  }
  const s = out.join('\n');
  return s.length <= maxChars ? s : `${s.slice(0, maxChars * 0.4)}\n[…]\n${s.slice(s.length - maxChars * 0.6)}`;
}

/** Turn tool results whose call was removed into plain text (keeps the history valid). */
function fixOrphans(messages: IRMessage[]): IRMessage[] {
  const calls = new Set<string>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool_call') calls.add(p.id);
  return messages.map((m) => {
    if (!m.parts.some((p) => p.type === 'tool_result' && !calls.has(p.id))) return m;
    return {
      ...m,
      parts: m.parts.map((p) => (p.type === 'tool_result' && !calls.has(p.id)
        ? { type: 'text' as const, text: `[Result of an earlier ${p.name || 'tool'} call]\n${resultText(p)}` }
        : p)),
    };
  });
}

export interface CompactionPlan {
  /** Index of the first kept message after the head. */
  cut: number;
  removed: IRMessage[];
}

export type Summarize = (removed: IRMessage[]) => Promise<string | undefined>;

/**
 * Compact a conversation to fit `context` tokens. With `summarize`, the removed
 * turns are replaced by an LLM summary (falls back to the built-in digest).
 */
export async function compactConversation(ir: IRRequest, context: number, s: TokenSaverSettings, summarize?: Summarize): Promise<SaverResult> {
  const before = requestTokens(ir);
  const reserve = Math.min(ir.maxTokens || 4096, Math.floor(context * 0.25));
  const target = Math.min(Math.floor(context * s.compactTarget), context - reserve);
  const actions: string[] = [];

  // 1. Aggressive trimming of everything but the last turns.
  const hard: TokenSaverSettings = {
    ...TOKEN_SAVER_PRESETS.aggressive, mode: 'custom', keepRecentTurns: Math.max(1, Math.min(s.keepRecentTurns, 2)), toolResultMaxTokens: 400,
  };
  let cur = applyTokenSaver(ir, hard).ir;
  if (cur !== ir) actions.push('compact-trim');
  if (requestTokens(cur) <= target) return done(ir, cur, before, actions);

  // 2. Replace the oldest turns (after the first user message) by a summary.
  const p = planCompaction(cur, context, s);
  if (p) {
    let summary: string | undefined;
    if (summarize) {
      try {
        summary = (await summarize(p.removed))?.trim() || undefined;
      } catch { /* built-in digest */ }
    }
    const head = cur.messages[0];
    const stub = summary ? `[Summary of the earlier conversation (compacted by ${TAG})]\n${summary}` : digest(p.removed);
    const kept = fixOrphans(cur.messages.slice(p.cut));
    const messages = mergeConsecutive([{ role: head.role, parts: [...head.parts, { type: 'text', text: stub }] }, ...kept]);
    // Keep the conversation starting with a user turn and alternating.
    cur = { ...cur, messages: messages[0].role === 'user' ? messages : [{ role: 'user', parts: [{ type: 'text', text: stub }] }, ...messages] };
    actions.push(summary ? 'compact-summary' : 'compact-digest');
  }

  // 3. Last resort: shrink the recent tool outputs too.
  if (requestTokens(cur) > target) {
    const last = applyTokenSaver(cur, { ...hard, keepRecentTurns: 0, toolResultMaxTokens: 250 }).ir;
    if (last !== cur) {
      cur = last;
      actions.push('compact-recent');
    }
  }
  return done(ir, cur, before, actions);
}

function done(orig: IRRequest, ir: IRRequest, before: number, actions: string[]): SaverResult {
  const after = requestTokens(ir);
  return { ir: after < before ? ir : orig, before, after: Math.min(after, before), saved: Math.max(0, before - after), actions: after < before ? actions : [] };
}

/**
 * Choose which turns to remove. The cut is snapped to steps of 8 messages so
 * consecutive requests of an agent loop share the same cut (and summary).
 */
export function planCompaction(ir: IRRequest, context: number, s: TokenSaverSettings): CompactionPlan | undefined {
  const msgs = ir.messages;
  if (msgs.length < 4) return undefined;
  const reserve = Math.min(ir.maxTokens || 4096, Math.floor(context * 0.25));
  const target = Math.min(Math.floor(context * s.compactTarget), context - reserve);
  const fixed = countTokens(ir.system || '') + (ir.tools?.length ? countTokens(JSON.stringify(ir.tools)) : 0) + 400;
  const sizes = msgs.map((m) => m.parts.reduce((a, p) => a + partTokens(p), 4));
  const minKeep = Math.max(2, Math.min(s.keepRecentTurns * 2, msgs.length - 2));
  let cut = 1;
  let total = fixed + sizes.reduce((a, b) => a + b, 0);
  while (cut < msgs.length - minKeep && total > target) {
    total -= sizes[cut];
    cut++;
  }
  if (cut <= 1) return undefined;
  const snapped = Math.min(msgs.length - minKeep, Math.ceil((cut - 1) / 8) * 8 + 1);
  // Prefer to resume at a user turn with real text or at an assistant turn.
  let c = snapped;
  while (c < msgs.length - minKeep && msgs[c].role === 'user' && msgs[c].parts.every((p) => p.type === 'tool_result')) c++;
  return { cut: c, removed: msgs.slice(1, c) };
}

// ---------------------------------------------------------- LLM summaries

const summaries = new Map<string, string>();

export function summaryCacheKey(model: string, removed: IRMessage[]): string {
  return hash(model + '\n' + transcript(removed));
}

export function cachedSummary(key: string): string | undefined {
  return summaries.get(key);
}

export function storeSummary(key: string, summary: string) {
  summaries.set(key, summary);
  while (summaries.size > 200) summaries.delete(summaries.keys().next().value!);
}

export const SUMMARY_PROMPT = [
  'You compress the earlier part of a conversation between a user and an AI coding assistant so the assistant can continue the task with less context.',
  'Write a dense summary (at most 400 words) that keeps: the user\'s goals and constraints, decisions made, files and functions touched,',
  'commands run and their key results, errors met and how they were solved, and anything still pending. No preamble.',
].join(' ');

// ------------------------------------------------------------- calculator

/** Tokens saved by each preset on a given request (for the dashboard calculator). */
export async function simulate(ir: IRRequest, context?: number): Promise<Array<{ mode: string; before: number; after: number; saved: number; actions: string[] }>> {
  const out: Array<{ mode: string; before: number; after: number; saved: number; actions: string[] }> = [];
  for (const mode of ['safe', 'balanced', 'aggressive'] as const) {
    const s = TOKEN_SAVER_PRESETS[mode];
    let r = applyTokenSaver(ir, s);
    if (context && compactionNeeded(r.after, context, s, ir.maxTokens)) {
      const c = await compactConversation(r.ir, context, s);
      r = { ...c, before: r.before, saved: Math.max(0, r.before - c.after), actions: [...r.actions, ...c.actions] };
    }
    out.push({ mode, before: r.before, after: r.after, saved: r.saved, actions: r.actions });
  }
  return out;
}
