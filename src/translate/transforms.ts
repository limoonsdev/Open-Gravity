// Stream transforms applied between the upstream decoder and the client encoder.
import type { IREvent, IRTool } from './ir';
import { normalizeToolArgs } from './json-repair';

export interface StreamTransform {
  push(ev: IREvent): IREvent[];
}

/**
 * Models served through OpenAI-compatible APIs often put their reasoning in
 * <think>...</think> at the start of the content (DeepSeek R1 distills, Qwen3,
 * MiniMax...). Turn it into real thinking events.
 */
export class ThinkTagExtractor implements StreamTransform {
  private state: 'start' | 'thinking' | 'text' = 'start';
  private buf = '';
  private closeTag = '</think>';

  push(ev: IREvent): IREvent[] {
    if (ev.type !== 'text') {
      if ((ev.type === 'stop' || ev.type === 'error') && this.buf) {
        const out: IREvent[] = [{ type: this.state === 'thinking' ? 'thinking' : 'text', text: this.buf }];
        this.buf = '';
        return [...out, ev];
      }
      return [ev];
    }
    if (this.state === 'text') return [ev];
    this.buf += ev.text;
    const out: IREvent[] = [];
    if (this.state === 'start') {
      const lead = this.buf.trimStart();
      if (!lead) return out;
      const m = /^<(think|thinking)>/.exec(lead);
      if (m) {
        this.closeTag = `</${m[1]}>`;
        this.state = 'thinking';
        this.buf = lead.slice(m[0].length);
      } else if ('<thinking>'.startsWith(lead) || '<think>'.startsWith(lead)) {
        return out;
      } else {
        this.state = 'text';
        const text = this.buf;
        this.buf = '';
        return [{ type: 'text', text }];
      }
    }
    // thinking
    const idx = this.buf.indexOf(this.closeTag);
    if (idx >= 0) {
      const thought = this.buf.slice(0, idx);
      const rest = this.buf.slice(idx + this.closeTag.length).replace(/^\s+/, '');
      this.buf = '';
      this.state = 'text';
      if (thought) out.push({ type: 'thinking', text: thought });
      if (rest) out.push({ type: 'text', text: rest });
      return out;
    }
    // Hold back a possible partial closing tag.
    let hold = 0;
    for (let k = Math.min(this.closeTag.length - 1, this.buf.length); k > 0; k--) {
      if (this.closeTag.startsWith(this.buf.slice(-k))) {
        hold = k;
        break;
      }
    }
    const emit = this.buf.slice(0, this.buf.length - hold);
    this.buf = this.buf.slice(this.buf.length - hold);
    if (emit) out.push({ type: 'thinking', text: emit });
    return out;
  }
}

/**
 * Buffers native tool-call arguments and releases them repaired (valid JSON)
 * and coerced to the tool's schema; also fixes tool-name casing.
 */
export class ToolArgsNormalizer implements StreamTransform {
  private byName = new Map<string, IRTool>();
  private pending = new Map<number, { name: string; args: string }>();

  constructor(tools: IRTool[]) {
    for (const t of tools) this.byName.set(t.name.toLowerCase(), t);
  }

  private flush(index: number): IREvent[] {
    const p = this.pending.get(index);
    if (!p) return [];
    this.pending.delete(index);
    const schema = this.byName.get(p.name.toLowerCase())?.parameters;
    return [{ type: 'tool_args', index, delta: normalizeToolArgs(p.args, schema) }, { type: 'tool_end', index }];
  }

  push(ev: IREvent): IREvent[] {
    switch (ev.type) {
      case 'tool_start': {
        const tool = this.byName.get(ev.name.replace(/^functions?\./, '').toLowerCase());
        const name = tool ? tool.name : ev.name;
        this.pending.set(ev.index, { name, args: '' });
        return [{ ...ev, name }];
      }
      case 'tool_args': {
        const p = this.pending.get(ev.index);
        if (!p) return [ev];
        p.args += ev.delta;
        return [];
      }
      case 'tool_end':
        return this.pending.has(ev.index) ? this.flush(ev.index) : [ev];
      case 'stop':
      case 'error': {
        const out: IREvent[] = [];
        for (const idx of [...this.pending.keys()]) out.push(...this.flush(idx));
        return [...out, ev];
      }
      default:
        return [ev];
    }
  }
}

export function runTransforms(transforms: StreamTransform[], evs: IREvent[]): IREvent[] {
  let cur = evs;
  for (const t of transforms) {
    const next: IREvent[] = [];
    for (const ev of cur) next.push(...t.push(ev));
    cur = next;
  }
  return cur;
}
