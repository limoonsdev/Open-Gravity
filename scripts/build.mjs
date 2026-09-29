// Bundles the whole app (server, router, CLI and the web panel) into a single
// CommonJS file: build/open-gravity.cjs. That file is what the single
// executable (Node SEA) embeds.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zc } from 'node:zlib';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg']);

/** Collect the dashboard export (dashboard/out), Brotli-compressing text assets. */
export function collectUi() {
  const out = join(root, 'dashboard', 'out');
  if (!existsSync(join(out, 'index.html'))) return null;
  const assets = {};
  let raw = 0;
  let packed = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else {
        const ext = extname(name).toLowerCase();
        if (ext === '.map') continue;
        const body = readFileSync(file);
        const key = '/' + relative(out, file).split(sep).join('/');
        const etag = `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
        raw += body.length;
        if (COMPRESSIBLE.has(ext) && body.length > 512) {
          const br = brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: body.length } });
          assets[key] = { b: br.toString('base64'), br: 1, t: TYPES[ext] || 'application/octet-stream', e: etag };
          packed += br.length;
        } else {
          assets[key] = { b: body.toString('base64'), t: TYPES[ext] || 'application/octet-stream', e: etag };
          packed += body.length;
        }
      }
    }
  };
  walk(out);
  return { assets, count: Object.keys(assets).length, raw, packed };
}

/** Build the Next.js dashboard when its export is missing (or when forced). */
export function ensureUi(force = false) {
  const out = join(root, 'dashboard', 'out', 'index.html');
  if ((existsSync(out) && !force) || process.env.OG_SKIP_UI === '1') return;
  if (!existsSync(join(root, 'node_modules', 'next', 'package.json'))) {
    console.warn('Next.js is not installed (npm ci): cannot build the dashboard.');
    return;
  }
  console.log('Building the dashboard (Next.js static export)...');
  execSync('npm run build -w dashboard', { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
}

export async function bundle({ minify = false } = {}) {
  ensureUi(process.argv.includes('--ui'));
  const ui = collectUi();
  if (!ui) console.warn('dashboard/out not found: run "npm run build:ui" first (the dashboard will be missing).');
  else console.log(`Dashboard: ${ui.count} files, ${(ui.raw / 1024).toFixed(0)} KB -> ${(ui.packed / 1024).toFixed(0)} KB embedded`);
  mkdirSync(join(root, 'build'), { recursive: true });
  const outfile = join(root, 'build', 'open-gravity.cjs');
  await build({
    entryPoints: [join(root, 'src', 'index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify,
    sourcemap: false,
    legalComments: 'none',
    define: {
      __OG_VERSION__: JSON.stringify(pkg.version),
      __OG_UI_ASSETS__: ui ? JSON.stringify(ui.assets) : 'undefined',
      __OG_LOGO_SVG__: JSON.stringify(readFileSync(join(root, 'src', 'web', 'logo.svg'), 'utf8')),
    },
    logLevel: 'warning',
  });
  return outfile;
}

if (/[\\/]build\.mjs$/.test(process.argv[1] || '')) {
  const minify = process.argv.includes('--minify');
  const out = await bundle({ minify });
  console.log(`Bundled -> ${out}`);
}
