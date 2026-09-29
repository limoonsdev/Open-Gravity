// Smoke-tests the desktop app: starts the single-file app, waits for the
// embedded router core to answer, checks the dashboard, then closes the app and
// verifies the core stops with it. Usage: node scripts/smoke-desktop.mjs <app>
// (on Linux CI run it under xvfb-run).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const app = process.argv[2] && resolve(process.argv[2]);
if (!app) {
  console.error('usage: node scripts/smoke-desktop.mjs <desktop-app>');
  process.exit(2);
}
const home = mkdtempSync(join(tmpdir(), 'og-desk-'));
const port = 19000 + Math.floor(Math.random() * 900);
mkdirSync(join(home, 'router'), { recursive: true });
writeFileSync(join(home, 'router', 'config.json'), JSON.stringify({ settings: { port, openBrowser: false } }));

const child = spawn(app, [], {
  env: { ...process.env, OPEN_GRAVITY_HOME: join(home, 'router'), OG_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
child.on('exit', (code) => (output += `\n[app exited with ${code}]`));

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = () => fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => undefined);
const done = (code, msg) => {
  if (code) console.error(`DESKTOP SMOKE FAILED: ${msg}\n--- output ---\n${output}`);
  else console.log(msg);
  try { child.kill(); } catch { /* already gone */ }
  setTimeout(() => {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* locked on Windows */ }
    process.exit(code);
  }, 500);
};

let h;
const t0 = Date.now();
// First start extracts the embedded core: allow up to 2 minutes on slow CI disks.
while (!h && Date.now() - t0 < 120_000) {
  await sleep(1000);
  h = await health();
}
if (h?.service !== 'open-gravity') done(1, 'the embedded router did not start');
else {
  const firstStart = ((Date.now() - t0) / 1000).toFixed(1);
  const ui = await fetch(`${base}/ui/`).then((r) => r.text()).catch(() => '');
  if (!ui.includes('Open Gravity')) done(1, 'dashboard not served');
  else {
    child.kill();
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      await sleep(500);
      alive = !!(await health());
    }
    if (alive) done(1, 'the router core kept running after the app was closed');
    else done(0, `desktop smoke ok: router v${h.version} ready in ${firstStart}s, stopped with the app`);
  }
}
