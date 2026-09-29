// Bundles the whole app (server, router, CLI and the web panel) into a single
// CommonJS file: build/open-gravity.cjs. That file is what the single
// executable (Node SEA) embeds.
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

export async function bundle({ minify = false } = {}) {
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
      __OG_PANEL_HTML__: JSON.stringify(readFileSync(join(root, 'src', 'web', 'index.html'), 'utf8')),
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
