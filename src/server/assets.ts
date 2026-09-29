// Dashboard assets (Next.js static export in dashboard/out, served under /ui).
// The bundled build embeds them, Brotli-compressed, through an esbuild define;
// from sources (tsx) they are read from dashboard/out on disk.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

declare const __OG_UI_ASSETS__: Record<string, { b: string; br?: 1; t: string; e: string }> | undefined;
declare const __OG_LOGO_SVG__: string;

export interface UiAsset {
  body: Buffer;
  /** Body is Brotli-compressed. */
  br: boolean;
  type: string;
  etag: string;
  immutable: boolean;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.map': 'application/json',
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Referenced once so the bundler inlines the (large) asset table a single time.
const EMBED = typeof __OG_UI_ASSETS__ !== 'undefined' ? __OG_UI_ASSETS__ : undefined;
let embedded: Map<string, UiAsset> | undefined;

function fromEmbed(): Map<string, UiAsset> | undefined {
  if (!EMBED) return undefined;
  if (!embedded) {
    embedded = new Map();
    for (const [p, a] of Object.entries(EMBED)) {
      embedded.set(p, { body: Buffer.from(a.b, 'base64'), br: !!a.br, type: a.t, etag: a.e, immutable: p.startsWith('/_next/static/') });
    }
  }
  return embedded;
}

function diskRoot(): string | undefined {
  for (const c of [path.join(process.cwd(), 'dashboard', 'out'), path.join(__dirname, '..', '..', 'dashboard', 'out')]) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return undefined;
}

const diskCache = new Map<string, UiAsset>();

function fromDisk(p: string): UiAsset | undefined {
  const root = diskRoot();
  if (!root) return undefined;
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root + path.sep)) return undefined;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return undefined;
    const key = `${file}:${st.mtimeMs}`;
    const hit = diskCache.get(key);
    if (hit) return hit;
    const body = fs.readFileSync(file);
    const a: UiAsset = { body, br: false, type: contentType(file), etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`, immutable: p.startsWith('/_next/static/') };
    diskCache.set(key, a);
    return a;
  } catch {
    return undefined;
  }
}

function lookup(p: string): UiAsset | undefined {
  const emb = fromEmbed();
  return emb ? emb.get(p) : fromDisk(p);
}

/** Resolve a request path under /ui to an asset (index.html for folders, .html fallback). */
export function uiAsset(urlPath: string): UiAsset | undefined {
  let p = decodeURIComponent(urlPath.replace(/^\/ui/, '')) || '/';
  if (p.includes('\0') || p.includes('..')) return undefined;
  if (p.endsWith('/')) p += 'index.html';
  return lookup(p) || lookup(`${p}.html`) || lookup(`${p}/index.html`);
}

export function uiNotFound(): UiAsset | undefined {
  return lookup('/404.html') || lookup('/404/index.html');
}

export function hasUi(): boolean {
  return !!(fromEmbed()?.size || diskRoot());
}

export function decompress(a: UiAsset): Buffer {
  return a.br ? zlib.brotliDecompressSync(a.body) : a.body;
}

export function logoSvg(): string {
  if (typeof __OG_LOGO_SVG__ !== 'undefined') return __OG_LOGO_SVG__;
  for (const c of [path.join(__dirname, '..', 'web', 'logo.svg'), path.join(process.cwd(), 'src', 'web', 'logo.svg')]) {
    try {
      return fs.readFileSync(c, 'utf8');
    } catch { /* next */ }
  }
  return '';
}
