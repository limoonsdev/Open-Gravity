import type { IncomingMessage, ServerResponse } from 'http';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function readBody(req: IncomingMessage, limit = 100 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

export function json(res: ServerResponse, status: number, body: any, headers: Record<string, string> = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', ...headers });
  res.end(data);
}

export function text(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8', headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || '';
}
