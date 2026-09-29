// Builds the Open Gravity desktop app (Tauri) as ONE executable file that
// embeds the router core (the Node.js single executable, gzip-compressed).
//
//   node scripts/build-desktop.mjs                 -> release/OpenGravity-<host>(.exe)
//   node scripts/build-desktop.mjs --bundle        -> also installers (NSIS / deb / AppImage / dmg)
//   node scripts/build-desktop.mjs --skip-core     -> reuse release/open-gravity-<host> if present
//   node scripts/build-desktop.mjs --rust-target x86_64-pc-windows-msvc --target win-x64
//
// Requirements: Rust (stable) and the platform's WebView toolchain
// (Windows: MSVC build tools; Linux: libwebkit2gtk-4.1-dev, libayatana-appindicator3-dev,
// librsvg2-dev; macOS: Xcode command line tools).
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(name);

const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`;
const target = arg('--target') || hostTarget;
const rustTarget = arg('--rust-target');
const isWin = target.startsWith('win');
const coreName = `open-gravity-${target}${isWin ? '.exe' : ''}`;
const corePath = path.join(root, 'release', coreName);

function step(msg) {
  console.log(`\n▸ ${msg}`);
}

// 1. Router core (Node SEA) for the target platform.
if (!flag('--skip-core') || !fs.existsSync(corePath)) {
  step(`Building the router core (${target})`);
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-exe.mjs'), '--target', target], { stdio: 'inherit', cwd: root });
}
if (!fs.existsSync(corePath)) throw new Error(`Core executable not found: ${corePath}`);

// 2. Compress it: the desktop binary embeds this payload and extracts it on first run.
step('Compressing the core payload');
const raw = fs.readFileSync(corePath);
const gz = zlib.gzipSync(raw, { level: 9, memLevel: 9 });
const payloadDir = path.join(root, 'build', 'desktop');
fs.mkdirSync(payloadDir, { recursive: true });
const payload = path.join(payloadDir, `core-${target}.gz`);
fs.writeFileSync(payload, gz);
console.log(`  ${(raw.length / 1048576).toFixed(1)} MB -> ${(gz.length / 1048576).toFixed(1)} MB`);

// 3. Tauri build (the CLI enables the custom protocol that serves the splash screen).
step(`Building the desktop app${rustTarget ? ` (${rustTarget})` : ''}`);
const desktop = path.join(root, 'desktop');
const cliArgs = ['build', ...(flag('--bundle') ? [] : ['--no-bundle']), ...(rustTarget ? ['--target', rustTarget] : []), ...(flag('--debug') ? ['--debug'] : [])];
const tauriBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const env = { ...process.env, OG_CORE_PAYLOAD: payload };
if (fs.existsSync(tauriBin)) execSync(`"${tauriBin}" ${cliArgs.join(' ')}`, { stdio: 'inherit', cwd: desktop, env });
else execSync(`npx --yes @tauri-apps/cli@2 ${cliArgs.join(' ')}`, { stdio: 'inherit', cwd: desktop, env });

// 4. Collect the single-file app (and installers when bundling).
const profile = flag('--debug') ? 'debug' : 'release';
const targetDir = path.join(desktop, 'src-tauri', 'target', ...(rustTarget ? [rustTarget] : []), profile);
const exeSuffix = isWin ? '.exe' : '';
const built = ['OpenGravity', 'open-gravity-desktop'].map((n) => path.join(targetDir, n + exeSuffix)).find((f) => fs.existsSync(f));
if (!built) throw new Error(`Desktop binary not found in ${targetDir}`);
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `OpenGravity-${target}${exeSuffix}`);
fs.copyFileSync(built, out);
fs.chmodSync(out, 0o755);
console.log(`\n✓ ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB) — one file, router + dashboard + desktop app`);

if (flag('--bundle')) {
  const bundleDir = path.join(targetDir, 'bundle');
  const wanted = /\.(exe|msi|deb|rpm|AppImage|dmg)$/;
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
  for (const f of walk(bundleDir).filter((f) => wanted.test(f))) {
    const dest = path.join(outDir, path.basename(f).replace(/\s+/g, '-'));
    fs.copyFileSync(f, dest);
    console.log(`✓ ${path.relative(root, dest)} (installer)`);
  }
}
