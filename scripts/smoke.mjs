// Smoke-tests a built executable: starts it, checks /health, the dashboard and
// an API error path, then stops it. Usage: node scripts/smoke.mjs <path-to-exe>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exe = process.argv[2] && resolve(process.argv[2]);
if (!exe) {
  console.error('usage: node scripts/smoke.mjs <executable>');
  process.exit(2);
}
const home = mkdtempSync(join(tmpdir(), 'og-smoke-'));
const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(exe, ['start', '--port', String(port), '--no-open'], {
  env: { ...process.env, OPEN_GRAVITY_HOME: home, OG_NO_OPEN: '1', OG_NO_PAUSE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

const base = `http://127.0.0.1:${port}`;
const fail = (msg) => {
  console.error(`SMOKE FAILED: ${msg}\n--- output ---\n${output}`);
  child.kill();
  process.exit(1);
};

try {
  let health;
  for (let i = 0; i < 60 && !health; i++) {
    await new Promise((r) => setTimeout(r, 500));
    health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => undefined);
  }
  if (health?.service !== 'open-gravity') fail('health endpoint did not answer');
  const html = await fetch(`${base}/ui/`).then((r) => r.text());
  if (!html.includes('Open Gravity') || !html.includes('/ui/_next/')) fail('dashboard not served');
  const page = await fetch(`${base}/ui/analytics/`);
  if (page.status !== 200) fail(`dashboard page returned ${page.status}`);
  const state = await fetch(`${base}/admin/api/state`).then((r) => r.json());
  if (!Array.isArray(state.catalog) || state.catalog.length < 20) fail('admin state incomplete');
  const api = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }) });
  if (api.status !== 404) fail(`expected 404 without providers, got ${api.status}`);
  console.log(`smoke ok: v${health.version} on ${state.platform}`);
} finally {
  child.kill();
  setTimeout(() => {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* locked on Windows */ }
    process.exit(process.exitCode || 0);
  }, 500);
}
