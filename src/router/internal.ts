// Requests the router sends to itself (e.g. conversation summaries for the
// token saver) go through the normal HTTP pipeline, so they are routed,
// retried and logged like any other request. They carry a per-process secret
// that is only accepted from the loopback interface.
import crypto from 'crypto';

export const INTERNAL_TOKEN = crypto.randomBytes(24).toString('base64url');
export const INTERNAL_HEADER = 'x-og-internal';

let selfUrl = '';

export function setSelfUrl(url: string) {
  selfUrl = url.replace(/\/+$/, '');
}

export function isInternal(headers: Record<string, string | string[] | undefined>): boolean {
  const v = headers[INTERNAL_HEADER];
  if (typeof v !== 'string' || v.length !== INTERNAL_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(INTERNAL_TOKEN));
}

/** Non-streaming chat completion through this router. */
export async function internalChat(model: string, system: string, user: string, maxTokens: number, timeoutMs = 45_000): Promise<string> {
  if (!selfUrl) throw new Error('router address unknown');
  const res = await fetch(`${selfUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [INTERNAL_HEADER]: INTERNAL_TOKEN, 'user-agent': 'open-gravity/internal' },
    body: JSON.stringify({ model, stream: false, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty summary');
  return text;
}
