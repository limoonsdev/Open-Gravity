// Builds Open Gravity as a single self-contained executable using Node.js
// Single Executable Applications (SEA).
//
//   node scripts/build-exe.mjs                      -> current platform
//   node scripts/build-exe.mjs --target win-x64     -> Windows .exe (works from Linux/macOS too)
//   node scripts/build-exe.mjs --target win-x64,linux-x64,macos-arm64
//
// Cross-compiling works because the SEA blob is platform independent when
// code cache and snapshots are disabled: we download the official Node.js
// binary of the *same version* for the target platform (SHA-256 verified
// against nodejs.org SHASUMS256.txt) and inject the blob into it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bundle } from './build.mjs';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'release');
const cacheDir = path.join(root, 'build', 'node-cache');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`;

function parseTargets() {
  const i = process.argv.indexOf('--target');
  const raw = i >= 0 ? process.argv[i + 1] : hostTarget;
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function targetInfo(target) {
  const [plat, arch] = target.split('-');
  if (!['win', 'linux', 'macos'].includes(plat) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unknown target "${target}". Use win-x64, win-arm64, linux-x64, linux-arm64, macos-x64 or macos-arm64.`);
  }
  const distPlat = plat === 'macos' ? 'darwin' : plat;
  const version = process.version;
  const archive = plat === 'win' ? `node-${version}-win-${arch}.zip` : `node-${version}-${distPlat}-${arch}.tar.gz`;
  const exeName = plat === 'win' ? `open-gravity-${target}.exe` : `open-gravity-${target}`;
  return { plat, arch, version, archive, exeName, innerPath: plat === 'win' ? `node-${version}-win-${arch}/node.exe` : `node-${version}-${distPlat}-${arch}/bin/node` };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Minimal ZIP reader (central directory + deflate) so no unzip tool is needed.
function extractFromZip(zip, wantedName) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70000); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid zip: no end of central directory');
  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Invalid zip central directory');
    const method = zip.readUInt16LE(ptr + 10);
    const compSize = zip.readUInt32LE(ptr + 20);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    if (name === wantedName) {
      const lNameLen = zip.readUInt16LE(localOffset + 26);
      const lExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${method}`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wantedName} not found in archive`);
}

// Minimal tar reader for .tar.gz archives.
function extractFromTarGz(tgz, wantedName) {
  const tar = zlib.gunzipSync(tgz);
  let off = 0;
  let longName = null;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const dataStart = off + 512;
    if (type === 'L') {
      longName = tar.toString('utf8', dataStart, dataStart + size).replace(/\0.*$/s, '');
    } else {
      if (longName) { name = longName; longName = null; }
      if (name === wantedName && (type === '0' || type === '\0')) return Buffer.from(tar.subarray(dataStart, dataStart + size));
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wantedName} not found in archive`);
}

async function getNodeBinary(target) {
  const info = targetInfo(target);
  if (target === hostTarget) return fs.readFileSync(process.execPath);

  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${info.version}-${target}${info.plat === 'win' ? '.exe' : ''}`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);

  const base = `https://nodejs.org/dist/${info.version}`;
  console.log(`  downloading ${base}/${info.archive}`);
  const [archive, sums] = await Promise.all([download(`${base}/${info.archive}`), download(`${base}/SHASUMS256.txt`)]);
  const expected = sums.toString('utf8').split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === info.archive)?.[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${info.archive}`);
  const bin = info.archive.endsWith('.zip') ? extractFromZip(archive, info.innerPath) : extractFromTarGz(archive, info.innerPath);
  fs.writeFileSync(cached, bin);
  return bin;
}

/**
 * Remove the Authenticode signature from a PE file (what `signtool remove /s`
 * does): zero the security data directory and drop the certificate table.
 * Injecting the SEA blob would invalidate the signature anyway, and a stale
 * signature looks more suspicious to antivirus heuristics than none.
 */
function stripAuthenticode(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) return buf;
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) return buf;
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const secEntry = dirs + 4 * 8;
  const offset = buf.readUInt32LE(secEntry);
  const size = buf.readUInt32LE(secEntry + 4);
  if (!offset || !size) return buf;
  buf.writeUInt32LE(0, secEntry);
  buf.writeUInt32LE(0, secEntry + 4);
  return offset + size >= buf.length - 8 ? buf.subarray(0, offset) : buf;
}

function pngToIco(png) {
  // ICO container holding a single PNG image (supported since Windows Vista).
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  header.writeUInt8(w >= 256 ? 0 : w, 6);
  header.writeUInt8(h >= 256 ? 0 : h, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

async function brandWindowsExe(file) {
  // Replace the Node.js icon and version info with Open Gravity's using rcedit
  // (Windows UpdateResource API). Only done on Windows hosts: pure-JS PE
  // rewriters can corrupt node.exe's relocation table. Optional: without it the
  // exe works the same, it just shows the stock Node icon.
  if (process.platform !== 'win32') {
    console.log('  (icon branding skipped: only available when building on Windows)');
    return;
  }
  try {
    const rcedit = require('rcedit');
    const ico = path.join(root, 'build', 'icon.ico');
    fs.writeFileSync(ico, pngToIco(fs.readFileSync(path.join(root, 'assets', 'icon-256.png'))));
    await rcedit(file, {
      icon: ico,
      'file-version': pkg.version,
      'product-version': pkg.version,
      'version-string': {
        FileDescription: 'Open Gravity - Universal AI Router',
        ProductName: 'Open Gravity',
        CompanyName: 'Open Gravity',
        OriginalFilename: 'open-gravity.exe',
        InternalName: 'open-gravity',
        LegalCopyright: 'MIT License',
      },
    });
  } catch (e) {
    console.warn(`  (icon/version branding skipped: ${e.message})`);
  }
}

async function main() {
  const targets = parseTargets();
  console.log(`Open Gravity v${pkg.version} - building single executable(s) with Node ${process.version}`);
  const bundlePath = await bundle({ minify: false });

  // Portable blob for cross-compiled targets; the host target also gets V8's
  // code cache baked in (faster startup), which is only valid for this exact
  // Node version + platform + architecture.
  const makeBlob = (name, useCodeCache) => {
    const seaConfig = path.join(root, 'build', `${name}.json`);
    const blobPath = path.join(root, 'build', `${name}.blob`);
    fs.writeFileSync(seaConfig, JSON.stringify({
      main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache,
    }, null, 2));
    execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
    return fs.readFileSync(blobPath);
  };
  const portableBlob = targets.some((t) => t !== hostTarget) ? makeBlob('sea-prep', false) : null;
  const nativeBlob = targets.includes(hostTarget) ? makeBlob('sea-prep-native', true) : null;

  const { inject } = require('postject');
  fs.mkdirSync(outDir, { recursive: true });

  for (const target of targets) {
    const info = targetInfo(target);
    console.log(`- ${target}`);
    const out = path.join(outDir, info.exeName);
    const nodeBin = await getNodeBinary(target);
    fs.writeFileSync(out, info.plat === 'win' ? stripAuthenticode(Buffer.from(nodeBin)) : nodeBin);
    fs.chmodSync(out, 0o755);

    if (info.plat === 'macos' && process.platform === 'darwin') {
      execFileSync('codesign', ['--remove-signature', out]);
    }
    if (info.plat === 'win') await brandWindowsExe(out);

    await inject(out, 'NODE_SEA_BLOB', target === hostTarget ? nativeBlob : portableBlob, {
      sentinelFuse: SENTINEL,
      machoSegmentName: info.plat === 'macos' ? 'NODE_SEA' : undefined,
    });

    if (info.plat === 'macos') {
      if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', out]);
      else console.warn('  note: sign on macOS before running: codesign --sign - ' + info.exeName);
    }
    const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
    console.log(`  -> release/${info.exeName} (${size} MB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
