// Opt-in exact-match response cache (settings.cacheTtlSeconds).
import crypto from 'crypto';
import type { IRRequest, IRResponse, IREvent } from '../translate';

const MAX_ENTRIES = 500;

export class ResponseCache {
  private map = new Map<string, { at: number; res: IRResponse; target: string }>();

  get(key: string, ttlMs: number): { res: IRResponse; target: string } | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, res: IRResponse, target: string) {
    this.map.set(key, { at: Date.now(), res, target });
    while (this.map.size > MAX_ENTRIES) this.map.delete(this.map.keys().next().value!);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export const responseCache = new ResponseCache();

export function cacheKey(model: string, ir: IRRequest): string {
  const material = JSON.stringify({
    model, system: ir.system, messages: ir.messages, tools: ir.tools, toolChoice: ir.toolChoice, maxTokens: ir.maxTokens,
    temperature: ir.temperature, topP: ir.topP, topK: ir.topK, stop: ir.stop, reasoning: ir.reasoning, responseFormat: ir.responseFormat,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** Turn a stored response back into a stream of events. */
export function replayEvents(res: IRResponse): IREvent[] {
  const out: IREvent[] = [{ type: 'start', model: res.model }];
  let tool = 0;
  for (const p of res.parts) {
    if (p.type === 'text') out.push({ type: 'text', text: p.text });
    else if (p.type === 'thinking') {
      out.push({ type: 'thinking', text: p.text });
      if (p.signature) out.push({ type: 'thinking_signature', signature: p.signature });
    } else if (p.type === 'tool_call') {
      const index = tool++;
      out.push({ type: 'tool_start', index, id: p.id, name: p.name }, { type: 'tool_args', index, delta: p.args }, { type: 'tool_end', index });
    }
  }
  out.push({ type: 'usage', usage: res.usage }, { type: 'stop', reason: res.stop });
  return out;
}
