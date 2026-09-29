'use client';
import { Database, Download, Eraser, Info, Laptop, Lock, Network, Power, RefreshCw, Route, Save, ScrollText, Server, Upload, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Compat } from '@/components/provider-editor';
import { Button, Card, CardHeader, Code, Field, Input, Modal, PageHeader, Select, Switch, useConfirm, useRun, useToast } from '@/components/ui';
import { del, post, put } from '@/lib/api';
import { desktop, isDesktop, type DesktopInfo } from '@/lib/desktop';
import { ago, dateTime, num } from '@/lib/format';
import { useApp, useAppState } from '@/lib/state';
import type { Settings } from '@/lib/types';

function Section({ title, icon, sub, children, onSave, dirty }: { title: string; icon: ReactNode; sub?: string; children: ReactNode; onSave?: () => void; dirty?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} sub={sub} icon={icon} actions={onSave ? <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={onSave} icon={<Save className="size-3.5" />}>Save</Button> : undefined} />
      <div className="space-y-4 p-5">{children}</div>
    </Card>
  );
}

function useDraft<T extends object>(source: T): [T, <K extends keyof T>(k: K, v: T[K]) => void, boolean, () => void] {
  const [d, setD] = useState(source);
  const key = JSON.stringify(source);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setD(source), [key]);
  return [d, (k, v) => setD((x) => ({ ...x, [k]: v })), JSON.stringify(d) !== key, () => setD(source)];
}

export default function SettingsPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const toast = useToast();
  const confirm = useConfirm();
  const s = state.settings;
  const save = async (patch: Partial<Settings>, msg = 'Saved') => {
    const r = await run(() => put<{ restartRequired?: boolean }>('/settings', patch), msg);
    if (r?.restartRequired) toast('Restart Open Gravity to apply the new address.', 'info');
    refresh();
  };

  const [server, setServer, serverDirty] = useDraft({ host: s.host, port: s.port, openBrowser: s.openBrowser });
  const [routing, setRouting, routingDirty] = useDraft({
    maxAttempts: s.maxAttempts, cooldownRateLimitMs: s.cooldownRateLimitMs, cooldownAuthMs: s.cooldownAuthMs, cooldownServerMs: s.cooldownServerMs,
    headersTimeoutMs: s.headersTimeoutMs, idleTimeoutMs: s.idleTimeoutMs, passthrough: s.passthrough,
  });
  const [perf, setPerf, perfDirty] = useDraft({ adaptiveCompat: s.adaptiveCompat, cacheTtlSeconds: s.cacheTtlSeconds, modelDbAutoUpdate: s.modelDbAutoUpdate });
  const [logs, setLogs, logsDirty] = useDraft({ logRetentionDays: s.logRetentionDays, captureBodies: s.captureBodies });
  const [proxy, setProxy] = useState(s.upstreamProxy || '');
  const [password, setPassword] = useState('');
  const [mdb, setMdb] = useState(state.modelDb);
  const [updating, setUpdating] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const sec = (v: number) => Math.round(v / 1000);

  return (
    <>
      <PageHeader title="Settings" sub={<>Stored in <span className="font-mono">{state.dataDir}</span>. Edits made to config.json by hand are picked up live.</>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Section title="Server" icon={<Server className="size-4" />} sub="Address changes apply after a restart." dirty={serverDirty} onSave={() => save(server)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Listen address">
                <Select value={server.host} onChange={(e) => setServer('host', e.target.value)}>
                  <option value="127.0.0.1">127.0.0.1 — this computer only (recommended)</option>
                  <option value="0.0.0.0">0.0.0.0 — local network (API key required)</option>
                  {!['127.0.0.1', '0.0.0.0'].includes(server.host) && <option value={server.host}>{server.host}</option>}
                </Select>
              </Field>
              <Field label="Port"><Input type="number" min={1} max={65535} value={server.port} onChange={(e) => setServer('port', Number(e.target.value))} /></Field>
            </div>
            <Switch checked={server.openBrowser} onChange={(v) => setServer('openBrowser', v)} label="Open the dashboard when Open Gravity starts (command-line version)" />
          </Section>

          <Section title="Compatibility & performance" icon={<Zap className="size-4" />} dirty={perfDirty} onSave={() => save(perf)}>
            <Switch checked={perf.adaptiveCompat} onChange={(v) => setPerf('adaptiveCompat', v)} label="Self-healing compatibility"
              sub="When a provider rejects a request (unsupported tools, parameter, system role, images, output limit, context…), fix it, retry and remember the fix." />
            <Field label="Response cache (seconds, 0 = off)" hint={`Identical requests are answered from memory. ${num(state.cacheSize)} cached.`}>
              <div className="flex gap-2">
                <Input type="number" min={0} value={perf.cacheTtlSeconds} onChange={(e) => setPerf('cacheTtlSeconds', Number(e.target.value))} />
                <Button onClick={async () => { await run(() => post('/cache/clear'), 'Cache cleared'); refresh(); }} icon={<Eraser className="size-4" />}>Clear</Button>
              </div>
            </Field>
            <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
              <div className="flex items-center gap-2 text-[13px] font-medium"><Database className="size-4 text-fg-3" /> Model database</div>
              <p className="mt-1 text-[12.5px] text-fg-3">{num(mdb.models)} models from {mdb.providers} provider families (context windows, tool support, prices) · updated {mdb.updated || 'never'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" loading={updating} icon={<RefreshCw className="size-3.5" />} onClick={async () => {
                  setUpdating(true);
                  const r = await run(() => post<typeof mdb>('/modeldb/update'), 'Model database updated');
                  setUpdating(false);
                  if (r) setMdb(r);
                }}>Update now</Button>
                <Switch checked={perf.modelDbAutoUpdate} onChange={(v) => setPerf('modelDbAutoUpdate', v)} label="Update weekly" />
              </div>
            </div>
            <div>
              <p className="label mb-2">Learned fixes</p>
              <Compat />
              {Object.keys(state.compat).length > 0 && (
                <Button className="mt-3" size="sm" variant="danger" onClick={async () => {
                  if (await confirm({ title: 'Forget every learned fix?', confirm: 'Reset all', danger: true })) { await run(() => del('/compat'), 'All fixes removed'); refresh(); }
                }}>Reset all</Button>
              )}
            </div>
          </Section>

          <Section title="Network" icon={<Network className="size-4" />} dirty={proxy !== (s.upstreamProxy || '')} onSave={() => save({ upstreamProxy: proxy.trim() })}>
            <Field label="Upstream HTTP proxy" hint="Applied to every provider unless it defines its own proxy.">
              <Input className="font-mono" value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:7890" />
            </Field>
          </Section>

          <DesktopSection />
        </div>

        <div className="space-y-4">
          <Section title="Routing & resilience" icon={<Route className="size-4" />} dirty={routingDirty} onSave={() => save(routing)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Max attempts per request" hint="Across keys and combo targets."><Input type="number" min={1} max={20} value={routing.maxAttempts} onChange={(e) => setRouting('maxAttempts', Number(e.target.value))} /></Field>
              <Field label="Pause after rate limit (s)" hint="When the provider sends no Retry-After."><Input type="number" min={0} value={sec(routing.cooldownRateLimitMs)} onChange={(e) => setRouting('cooldownRateLimitMs', Number(e.target.value) * 1000)} /></Field>
              <Field label="Pause after auth error (s)"><Input type="number" min={0} value={sec(routing.cooldownAuthMs)} onChange={(e) => setRouting('cooldownAuthMs', Number(e.target.value) * 1000)} /></Field>
              <Field label="Pause after server error (s)"><Input type="number" min={0} value={sec(routing.cooldownServerMs)} onChange={(e) => setRouting('cooldownServerMs', Number(e.target.value) * 1000)} /></Field>
              <Field label="Response timeout (s)" hint="Wait for the first response headers."><Input type="number" min={5} value={sec(routing.headersTimeoutMs)} onChange={(e) => setRouting('headersTimeoutMs', Number(e.target.value) * 1000)} /></Field>
              <Field label="Stream idle timeout (s)"><Input type="number" min={10} value={sec(routing.idleTimeoutMs)} onChange={(e) => setRouting('idleTimeoutMs', Number(e.target.value) * 1000)} /></Field>
            </div>
            <Switch checked={routing.passthrough} onChange={(v) => setRouting('passthrough', v)} label="Pass requests through untouched when client and provider speak the same API" sub="Best fidelity. Disabled automatically for a request when a fix, emulation or the token saver needs to change it." />
          </Section>

          <Section title="Logs & privacy" icon={<ScrollText className="size-4" />} dirty={logsDirty} onSave={() => save(logs)}>
            <Field label="Keep request history for (days)"><Input type="number" min={1} max={365} value={logs.logRetentionDays} onChange={(e) => setLogs('logRetentionDays', Number(e.target.value))} /></Field>
            <Switch checked={logs.captureBodies} onChange={(v) => setLogs('captureBodies', v)} label="Capture request/response bodies of the last 50 requests" sub="In memory only, for debugging and the token saver simulator." />
          </Section>

          <Section title="Dashboard password" icon={<Lock className="size-4" />} sub={s.passwordSet ? 'Enabled' : 'Not set'}>
            <p className="text-[13px] text-fg-3">Protects this dashboard. Required before it can be opened from another machine.</p>
            <div className="flex gap-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={s.passwordSet ? 'New password' : 'At least 6 characters'} autoComplete="new-password" />
              <Button variant="primary" onClick={async () => { await run(() => post('/password', { password }), 'Password saved'); setPassword(''); refresh(); }}>{s.passwordSet ? 'Change' : 'Set'}</Button>
            </div>
            {s.passwordSet && (
              <Button variant="danger" size="sm" onClick={async () => {
                if (await confirm({ title: 'Remove the dashboard password?', confirm: 'Remove', danger: true })) { await run(() => post('/password', { password: '' }), 'Password removed'); refresh(); }
              }}>Remove password</Button>
            )}
          </Section>

          <Section title="Backup" icon={<Download className="size-4" />}>
            <p className="text-[13px] text-fg-3">The export contains your provider API keys: store it safely.</p>
            <div className="flex flex-wrap gap-2">
              <a href="/admin/api/config/export" download="open-gravity-config.json"><Button icon={<Download className="size-4" />}>Export configuration</Button></a>
              <Button icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Import configuration</Button>
              <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const json = JSON.parse(await f.text());
                  if (await confirm({ title: 'Replace the current configuration?', body: 'Providers, keys, combos, aliases and settings are replaced by the file.', confirm: 'Import', danger: true })) {
                    await run(() => post('/config/import', json), 'Configuration imported');
                    refresh();
                  }
                } catch {
                  toast('This file is not a valid configuration', 'bad');
                }
              }} />
            </div>
          </Section>

          <Section title="About" icon={<Info className="size-4" />}>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
              <dt className="text-fg-3">Version</dt><dd className="font-mono">{state.version}</dd>
              <dt className="text-fg-3">Listening on</dt><dd className="font-mono">{state.listening.host}:{state.listening.port}</dd>
              <dt className="text-fg-3">Platform</dt><dd className="font-mono">{state.platform}</dd>
              <dt className="text-fg-3">Running since</dt><dd>{dateTime(state.startedAt)} ({ago(state.startedAt)})</dd>
              <dt className="text-fg-3">Data folder</dt><dd className="font-mono break-all">{state.dataDir}</dd>
            </dl>
            <p className="text-[12.5px] text-fg-3">Open Gravity is MIT-licensed. Provider logos are trademarks of their owners, shown to identify each service.</p>
          </Section>
        </div>
      </div>
    </>
  );
}

function DesktopSection() {
  const run = useRun();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  useEffect(() => {
    if (isDesktop()) desktop.info().then(setInfo).catch(() => undefined);
  }, []);
  if (!info) return null;
  return (
    <Section title="Desktop app" icon={<Laptop className="size-4" />} sub={`Open Gravity desktop ${info.version} · ${info.platform}`}>
      <Switch checked={info.autostart} onChange={async (v) => { const r = await run(() => desktop.setAutostart(v), v ? 'Starts with your computer' : 'Autostart disabled'); setInfo({ ...info, autostart: r ?? info.autostart }); }}
        label="Start with my computer (minimized to the tray)" />
      <Switch checked={info.closeToTray} onChange={async (v) => { await run(() => desktop.setCloseToTray(v)); setInfo({ ...info, closeToTray: v }); }}
        label="Keep running in the tray when the window is closed" sub="The router stays available to your tools. Quit from the tray menu." />
      <div className="flex flex-wrap gap-2">
        <Button icon={<RefreshCw className="size-4" />} onClick={() => run(() => desktop.restartCore(), 'Restarting the router…')}>Restart router</Button>
        <Button icon={<ScrollText className="size-4" />} onClick={async () => setLogs((await run(() => desktop.logs())) || '')}>Router logs</Button>
        <Button variant="danger" icon={<Power className="size-4" />} onClick={() => desktop.quit()}>Quit Open Gravity</Button>
      </div>
      <Modal open={logs !== null} onClose={() => setLogs(null)} title="Router logs" size="lg">
        <Code lang="log">{logs || '(empty)'}</Code>
      </Modal>
    </Section>
  );
}
