// Lightweight connectivity test for a provider key + model (used by the dashboard).
import type { ProviderConfig, Settings } from '../core/config';
import type { IRRequest, IREvent } from '../translate';
import { createDecoder, Aggregator } from '../translate';
import { SSEParser } from '../translate/sse';
import { buildTranslated, upstreamFetch, extractErrorMessage } from '../providers/upstream';
import { antigravityGenerate } from '../providers/antigravity';
import { health } from './health';

export interface ProbeResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  model: string;
  keyId?: string;
  text?: string;
  error?: string;
}

export async function probeProvider(p: ProviderConfig, settings: Settings, opts: { keyId?: string; model?: string } = {}): Promise<ProbeResult> {
  const model = opts.model || p.models[0];
  const key = opts.keyId ? p.keys.find((k) => k.id === opts.keyId) : p.keys.find((k) => k.enabled) || p.keys[0];
  const t0 = Date.now();
  if (!model) return { ok: false, status: 0, latencyMs: 0, model: '', error: 'No model configured for this provider' };

  const ir: IRRequest = {
    model,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
    maxTokens: 256,
    stream: true,
  };
  const agg = new Aggregator();
  const signal = AbortSignal.timeout(45_000);
  try {
    if (p.format === 'antigravity') {
      for await (const ev of antigravityGenerate(ir, model, signal)) agg.push(ev);
    } else {
      const up = buildTranslated(p, key, model, ir);
      const res = await upstreamFetch(up.url, { method: 'POST', headers: up.headers, body: JSON.stringify(up.body), signal },
        { proxy: p.proxy || settings.upstreamProxy, headersTimeout: 45_000, bodyTimeout: 45_000 });
      if (!res.ok) {
        const text = await res.text();
        const error = extractErrorMessage(text);
        if (key) health.fail(p.id, key.id, { status: res.status, error, cooldownMs: 0 });
        return { ok: false, status: res.status, latencyMs: Date.now() - t0, model, keyId: key?.id, error };
      }
      const decoder = createDecoder(p.format);
      const parser = new SSEParser();
      const td = new TextDecoder();
      const handle = (evs: IREvent[]) => evs.forEach((e) => agg.push(e));
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        for (const m of parser.push(td.decode(chunk, { stream: true }))) {
          if (m.data === '[DONE]') continue;
          try { handle(decoder.push(m.event, JSON.parse(m.data))); } catch { /* skip */ }
        }
      }
      for (const m of parser.end()) {
        try { handle(decoder.push(m.event, JSON.parse(m.data))); } catch { /* skip */ }
      }
      handle(decoder.end());
    }
    if (agg.error && !agg.parts.length) {
      return { ok: false, status: agg.error.status || 502, latencyMs: Date.now() - t0, model, keyId: key?.id, error: agg.error.message };
    }
    if (key) health.ok(p.id, key.id, model);
    const text = agg.parts.filter((x) => x.type === 'text').map((x: any) => x.text).join('').trim();
    return { ok: true, status: 200, latencyMs: Date.now() - t0, model, keyId: key?.id, text: text.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, model, keyId: key?.id, error: e?.cause?.message || e.message };
  }
}
