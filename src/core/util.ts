import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';

declare const __OG_VERSION__: string;
function devVersion(): string {
  try {
    return `${JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version}-dev`;
  } catch {
    return 'dev';
  }
}
export const VERSION: string = typeof __OG_VERSION__ !== 'undefined' ? __OG_VERSION__ : devVersion();

export function dataDir(): string {
  const dir = process.env.OPEN_GRAVITY_HOME || path.join(os.homedir(), '.open-gravity');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function randomId(len = 10): string {
  return crypto.randomBytes(Math.ceil(len * 0.75) + 2).toString('base64url').replace(/[-_]/g, '').slice(0, len).toLowerCase();
}

export function randomKey(prefix = 'sk-og-'): string {
  return prefix + crypto.randomBytes(24).toString('base64url');
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '•'.repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'provider';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Write a file atomically (temp + rename) with restrictive permissions. */
export function writeFileAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function clampStr(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
