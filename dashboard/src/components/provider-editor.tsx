'use client';
import { Download, Plus, RefreshCw, RotateCcw, Trash2, Wallet, Wrench, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { del, enc, get, post, put } from '@/lib/api';
import { ago, cn, ctx, money, ms, num, until } from '@/lib/format';
import { useApp, useAppState } from '@/lib/state';
import type { Balance, CompatFix, Provider, ProbeResult, QuotaView } from '@/lib/types';
import { ProviderLogo } from './logos';
import { Badge, Button, Dot, Empty, Field, IconButton, Input, Meter, Modal, Select, Spinner, Switch, Tabs, Textarea, useConfirm, useRun, useToast } from './ui';

type Tab = 'general' | 'keys' | 'models' | 'compat' | 'quota';

export function ProviderEditor({ id, onClose, initialTab = 'general' }: { id: string | null; onClose: () => void; initialTab?: Tab }) {
  const state = useAppState();
  const p = state.providers.find((x) => x.id === id);
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => setTab(initialTab), [id, initialTab]);
  if (!id) return null;
  const learned = Object.keys(state.compat).filter((k) => k.startsWith(`${id}::`)).length;
  return (
    <Modal
      open={!!p}
      onClose={onClose}
      size="lg"
      title={p?.name || id}
      sub={p ? <span className="font-mono">{p.id}/ · {p.format} · {p.baseUrl || 'local app'}</span> : undefined}
      icon={p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={40} /> : undefined}
    >
      {p && (
        <div className="space-y-5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'general', label: 'General' },
              { value: 'keys', label: 'Keys', count: p.keys.length },
              { value: 'models', label: 'Models', count: p.models.length },
              { value: 'compat', label: 'Compatibility', count: learned || undefined },
              { value: 'quota', label: 'Quota & balance' },
            ]}
          />
          {tab === 'general' && <General p={p} onRenamed={onClose} />}
          {tab === 'keys' && <Keys p={p} />}
          {tab === 'models' && <Models p={p} />}
          {tab === 'compat' && <Compat providerId={p.id} />}
          {tab === 'quota' && <Quota p={p} />}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ general

function General({ p, onRenamed }: { p: Provider; onRenamed: () => void }) {
  const { refresh } = useApp();
  const run = useRun();
  const [f, setF] = useState({
    id: p.id, name: p.name, baseUrl: p.baseUrl, rotation: p.rotation, timeoutMs: p.timeoutMs ? String(p.timeoutMs) : '', proxy: p.proxy || '',
    headers: p.headers ? JSON.stringify(p.headers, null, 2) : '', toolMode: p.toolMode, auth: p.auth, authHeader: p.authHeader || '', authPrefix: p.authPrefix || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    let headers: Record<string, string> | undefined;
    if (f.headers.trim()) {
      try {
        headers = JSON.parse(f.headers);
      } catch {
        run(async () => { throw new Error('Extra headers must be a JSON object'); });
        return;
      }
    }
    setBusy(true);
    const r = await run(
      () => put(`/providers/${enc(p.id)}`, {
        id: f.id.trim(), name: f.name.trim(), baseUrl: f.baseUrl.trim(), rotation: f.rotation, timeoutMs: Number(f.timeoutMs) || 0, proxy: f.proxy.trim(), headers: headers || {},
        toolMode: f.toolMode, auth: f.auth, authHeader: f.authHeader.trim(), authPrefix: f.authPrefix,
      }),
      'Saved',
    );
    setBusy(false);
    await refresh();
    if (r && f.id.trim() !== p.id) onRenamed();
  };
  const antigravity = p.format === 'antigravity';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Prefix (id)" hint={`Models are addressed as "${f.id || p.id}/<model>".`}><Input className="font-mono" value={f.id} onChange={set('id')} /></Field>
      </div>
      {!antigravity && <Field label="Base URL"><Input className="font-mono" value={f.baseUrl} onChange={set('baseUrl')} /></Field>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tool calling" hint="Emulation lets models without function calling use tools (Claude Code, Codex, agents).">
          <Select value={f.toolMode} onChange={set('toolMode')} disabled={antigravity}>
            <option value="auto">Auto — native, emulated if missing</option>
            <option value="native">Native only</option>
            <option value="emulate">Always emulate</option>
          </Select>
        </Field>
        <Field label="Authentication">
          <Select value={f.auth} onChange={set('auth')} disabled={antigravity}>
            <option value="bearer">Authorization: Bearer &lt;key&gt;</option>
            <option value="api-key">api-key: &lt;key&gt; (Azure)</option>
            <option value="anthropic">x-api-key (Anthropic)</option>
            <option value="anthropic-compat">x-api-key + Bearer</option>
            <option value="goog">x-goog-api-key (Google)</option>
            <option value="custom">Custom header…</option>
            <option value="none">No authentication</option>
          </Select>
        </Field>
      </div>
      {f.auth === 'custom' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Header name"><Input className="font-mono" value={f.authHeader} onChange={set('authHeader')} placeholder="x-my-api-key" /></Field>
          <Field label="Value prefix" hint='e.g. "Api-Key " (optional)'><Input className="font-mono" value={f.authPrefix} onChange={set('authPrefix')} /></Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Key rotation">
          <Select value={f.rotation} onChange={set('rotation')}>
            <option value="round-robin">Round-robin (spread load across keys)</option>
            <option value="fill-first">Fill first (use key 1 until it fails)</option>
          </Select>
        </Field>
        <Field label="Response timeout (ms)" hint="Time to wait for response headers."><Input type="number" value={f.timeoutMs} onChange={set('timeoutMs')} placeholder="default" /></Field>
      </div>
      <Field label="HTTP proxy"><Input className="font-mono" value={f.proxy} onChange={set('proxy')} placeholder="http://user:pass@host:port (optional)" /></Field>
      <Field label="Extra headers (JSON)"><Textarea className="font-mono" rows={3} value={f.headers} onChange={set('headers')} placeholder='{"X-Custom": "value"}' /></Field>
      <div className="flex justify-end border-t border-line pt-4">
        <Button variant="primary" loading={busy} onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- keys

function keyState(k: Provider['keys'][number]): { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!k.enabled) return { tone: 'neutral', label: 'Disabled' };
  if (k.health.cooldownUntil > Date.now()) return { tone: 'bad', label: `Paused ${until(k.health.cooldownUntil)}` };
  if (Object.keys(k.health.modelCooldowns || {}).length) return { tone: 'warn', label: 'Some models paused' };
  if (k.health.lastErrorAt && (!k.health.lastOkAt || k.health.lastErrorAt > k.health.lastOkAt)) return { tone: 'warn', label: 'Last call failed' };
  if (k.health.lastOkAt) return { tone: 'good', label: 'Healthy' };
  return { tone: 'neutral', label: 'Not used yet' };
}

function Keys({ p }: { p: Provider }) {
  const { refresh } = useApp();
  const run = useRun();
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const add = async () => {
    if (!adding.trim()) return;
    await run(() => post(`/providers/${enc(p.id)}/keys`, { key: adding }), 'Key added');
    setAdding('');
    refresh();
  };
  const test = async (keyId: string) => {
    setTesting(keyId);
    const r = await run(() => post<ProbeResult>(`/providers/${enc(p.id)}/test`, { keyId }));
    setTesting(null);
    if (r) toast(r.ok ? `OK · ${r.model} answered in ${ms(r.latencyMs)}` : `Failed (${r.status}): ${r.error}`, r.ok ? 'good' : 'bad');
    refresh();
  };
  return (
    <div className="space-y-3">
      {p.keys.map((k, i) => {
        const s = keyState(k);
        return (
          <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2/60 px-4 py-3">
            <Switch checked={k.enabled} onChange={async (v) => { await run(() => put(`/providers/${enc(p.id)}/keys/${enc(k.id)}`, { enabled: v })); refresh(); }} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{k.label || `key ${i + 1}`}</span>
                <span className="font-mono text-[12px] text-fg-3">{k.masked}</span>
                <Badge tone={s.tone} icon={<Dot tone={s.tone === 'neutral' ? 'neutral' : s.tone} />}>{s.label}</Badge>
              </div>
              <div className="mt-1 text-[12px] text-fg-3">
                {num(k.stats.requests)} calls · {num(k.stats.errors)} errors · {num(k.stats.tokens)} tokens · last used {ago(k.stats.lastUsed)}
                {k.health.lastError && <span className="block truncate text-bad" title={k.health.lastError}>Last error: {k.health.lastError}</span>}
              </div>
            </div>
            <Button size="sm" onClick={() => test(k.id)} loading={testing === k.id} icon={<Zap className="size-3.5" />}>Test</Button>
            <IconButton
              label="Delete key"
              onClick={async () => {
                if (await confirm({ title: 'Delete this key?', body: 'It will be removed from the configuration.', confirm: 'Delete', danger: true })) {
                  await run(() => del(`/providers/${enc(p.id)}/keys/${enc(k.id)}`), 'Key deleted');
                  refresh();
                }
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        );
      })}
      {!p.keys.length && <p className="text-[13px] text-fg-3">{p.keyOptional ? 'This provider works without a key.' : 'No key yet.'}</p>}
      <div className="flex gap-2">
        <Input className="font-mono" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Paste one or more keys (space or comma separated)" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button onClick={add} icon={<Plus className="size-4" />}>Add</Button>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={async () => { await run(() => post(`/providers/${enc(p.id)}/reset`), 'Pauses and errors cleared'); refresh(); }}>
          Clear pauses & errors
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- models

function CapsTags({ p, m }: { p: Provider; m: string }) {
  const { state } = useApp();
  const c = p.caps[m];
  const fix = state?.compat[`${p.id}::${m}`];
  const emulated = p.toolMode === 'emulate' || fix?.emulateTools || (c && c[2] === 0 && p.toolMode !== 'native');
  return (
    <span className="flex flex-wrap gap-1">
      {c?.[0] ? <Badge title={`Context window: ${num(c[0])} tokens${c[1] ? `, max output ${num(c[1])}` : ''}`}>{ctx(c[0])}</Badge> : null}
      {emulated ? <Badge tone="accent" icon={<Wrench className="size-3" />}>tools emulated</Badge> : c?.[2] === 1 ? <Badge tone="good">tools</Badge> : null}
      {c?.[3] ? <Badge tone="info">vision</Badge> : null}
      {c?.[4] ? <Badge tone="warn">reasoning</Badge> : null}
    </span>
  );
}

function Models({ p }: { p: Provider }) {
  const { refresh } = useApp();
  const run = useRun();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const shown = useMemo(() => p.models.filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())), [p.models, q]);
  const save = async (models: string[], msg?: string) => {
    await run(() => put(`/providers/${enc(p.id)}`, { models }), msg);
    refresh();
  };
  const fetchModels = async () => {
    setBusy('fetch');
    const r = await run(() => post<{ models: string[] }>(`/providers/${enc(p.id)}/models/fetch`));
    setBusy(null);
    if (!r) return;
    const merged = [...new Set([...p.models, ...r.models])];
    await save(merged, `${r.models.length} models found (${merged.length - p.models.length} new)`);
  };
  const test = async (model: string) => {
    setBusy(model);
    const r = await run(() => post<ProbeResult>(`/providers/${enc(p.id)}/test`, { model }));
    setBusy(null);
    if (r) toast(r.ok ? `${model}: “${(r.text || '').slice(0, 60)}” in ${ms(r.latencyMs)}` : `${model} failed (${r.status}): ${r.error}`, r.ok ? 'good' : 'bad');
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${p.models.length} models…`} className="max-w-xs" />
        <Button onClick={fetchModels} loading={busy === 'fetch'} icon={<Download className="size-4" />}>Fetch from provider</Button>
        {p.models.length > 0 && (
          <Button variant="danger" onClick={async () => (await confirm({ title: 'Remove all models?', confirm: 'Remove all', danger: true })) && save([], 'Models cleared')}>Clear all</Button>
        )}
      </div>
      <ul className="max-h-[340px] divide-y divide-line overflow-y-auto rounded-2xl border border-line">
        {shown.slice(0, 500).map((m) => (
          <li key={m} className="flex items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={`${p.id}/${m}`}>{m}</span>
            <CapsTags p={p} m={m} />
            <IconButton label={`Test ${m}`} onClick={() => test(m)}>{busy === m ? <Spinner /> : <Zap className="size-4" />}</IconButton>
            <IconButton label={`Remove ${m}`} onClick={() => save(p.models.filter((x) => x !== m))}><Trash2 className="size-4" /></IconButton>
          </li>
        ))}
        {!shown.length && <li className="px-4 py-8 text-center text-[13px] text-fg-3">No models{q ? ' match' : ' yet — fetch them or add ids below'}.</li>}
      </ul>
      <div className="flex gap-2">
        <Input className="font-mono" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add model ids (comma or space separated)"
          onKeyDown={(e) => { if (e.key === 'Enter' && add.trim()) { save([...new Set([...p.models, ...add.split(/[\s,]+/).filter(Boolean)])], 'Models added'); setAdd(''); } }} />
        <Button icon={<Plus className="size-4" />} onClick={() => { if (add.trim()) { save([...new Set([...p.models, ...add.split(/[\s,]+/).filter(Boolean)])], 'Models added'); setAdd(''); } }}>Add</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ compatibility

const FIX_TAGS: Array<[keyof CompatFix, (f: CompatFix) => string]> = [
  ['emulateTools', () => 'tools emulated'],
  ['mergeSystem', () => 'system merged'],
  ['stripImages', () => 'no images'],
  ['noReasoning', () => 'no reasoning'],
  ['noResponseFormat', () => 'no JSON mode'],
  ['noStreamOptions', () => 'no stream_options'],
  ['noNativeFim', () => 'autocomplete via chat'],
  ['maxTokensField', (f) => `uses ${f.maxTokensField}`],
  ['maxTokensCap', (f) => `max ${num(f.maxTokensCap)} output tokens`],
  ['contextWindow', (f) => `context ${ctx(f.contextWindow)}`],
];

export function Compat({ providerId }: { providerId?: string }) {
  const { state, refresh } = useApp();
  const run = useRun();
  const entries = Object.entries(state?.compat || {}).filter(([k]) => !providerId || k.startsWith(`${providerId}::`));
  if (!entries.length) {
    return (
      <Empty
        icon={<Wrench className="size-5" />}
        title="Nothing learned yet"
        sub="When a provider rejects a request because of an unsupported feature (tools, a parameter, system role, images, output limit…), Open Gravity fixes the request, retries it and remembers the fix here."
      />
    );
  }
  return (
    <ul className="space-y-2.5">
      {entries.map(([k, fix]) => (
        <li key={k} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] font-medium">{k.replace('::', '/')}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {FIX_TAGS.filter(([key]) => fix[key]).map(([key, label]) => <Badge key={key} tone="accent">{label(fix)}</Badge>)}
              {(fix.dropParams || []).map((d) => <Badge key={d} tone="accent">drop {d}</Badge>)}
            </div>
            {fix.reasons?.length ? <p className="mt-1.5 text-[12px] text-fg-3">{fix.reasons[fix.reasons.length - 1]}{fix.learnedAt ? ` · ${ago(fix.learnedAt)}` : ''}</p> : null}
          </div>
          <Button size="sm" onClick={async () => { await run(() => del(`/compat?key=${enc(k)}`), 'Fix removed'); refresh(); }}>Reset</Button>
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------------- quota

function Quota({ p }: { p: Provider }) {
  const [data, setData] = useState<QuotaView | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRun();
  useEffect(() => {
    get<QuotaView>('/quota').then(setData).catch(() => setData({ snapshots: [], limits: [], rules: [], alerts: [], balanceProviders: [] }));
  }, []);
  const snaps = (data?.snapshots || []).filter((s) => s.provider === p.id);
  const canBalance = data?.balanceProviders.includes(p.id);
  const loadBalance = async (refreshNow = false) => {
    setBusy(true);
    const r = await run(() => post<Balance[]>(`/providers/${enc(p.id)}/balance`, { refresh: refreshNow }));
    setBusy(false);
    if (r) setBalances(r);
  };
  useEffect(() => {
    if (canBalance) loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBalance]);
  if (!data) return <div className="flex justify-center py-8"><Spinner /></div>;
  return (
    <div className="space-y-5">
      {canBalance && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Balance</h3>
            <Button size="sm" variant="ghost" className="ml-auto" loading={busy} icon={<RefreshCw className="size-3.5" />} onClick={() => loadBalance(true)}>Refresh</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(balances || []).map((b) => (
              <div key={b.keyId} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Wallet className="size-3.5" />{b.keyLabel}</div>
                {b.ok ? (
                  <>
                    <div className="mt-1.5 text-xl font-semibold tabular-nums">{b.remaining !== undefined ? money(b.remaining, b.currency) : '—'}</div>
                    <div className="mt-1 text-[12px] text-fg-3">
                      {b.limit !== undefined && `of ${money(b.limit, b.currency)} · `}{b.used !== undefined && `${money(b.used, b.currency)} used`}{b.freeTier ? ' · free tier' : ''}{b.note ? ` · ${b.note}` : ''}
                    </div>
                    {b.limit ? <Meter className="mt-2" ratio={(b.used || 0) / b.limit} /> : null}
                  </>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-bad">{b.error}</p>
                )}
              </div>
            ))}
            {!balances && <Spinner />}
          </div>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Rate limits reported by {p.name}</h3>
        {snaps.length ? <RateLimitList snaps={snaps} /> : <p className="text-[13px] text-fg-3">No rate-limit headers seen yet. They appear after the next request to this provider (OpenAI, Anthropic, Groq, Cerebras, OpenRouter… send them).</p>}
      </section>
    </div>
  );
}

export function RateLimitList({ snaps }: { snaps: QuotaView['snapshots'] }) {
  return (
    <ul className="space-y-2.5">
      {snaps.map((s) => (
        <li key={`${s.provider}:${s.keyId}:${s.model || ''}`} className="rounded-2xl border border-line bg-surface-2/60 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">{s.providerName}</span>
            <span className="text-fg-3">· {s.keyLabel}</span>
            {s.model && <span className="font-mono text-[12px] text-fg-3">· {s.model}</span>}
            <span className="ml-auto text-[12px] text-fg-3">{ago(s.at)}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries(s.buckets).map(([name, b]) => {
              const ratio = b.limit ? 1 - (b.remaining ?? b.limit) / b.limit : b.remaining === 0 ? 1 : 0;
              return (
                <div key={name}>
                  <div className="mb-1 flex items-baseline gap-2 text-[12.5px]">
                    <span className="text-fg-2 capitalize">{name.replace(/-/g, ' ')}</span>
                    <span className={cn('ml-auto font-medium tabular-nums', b.remaining === 0 && 'text-bad')}>
                      {b.remaining !== undefined ? num(b.remaining) : '?'}{b.limit !== undefined ? ` / ${num(b.limit)}` : ''} left
                    </span>
                  </div>
                  <Meter ratio={ratio} />
                  {b.resetAt && <div className="mt-1 text-[11.5px] text-fg-3">resets {until(b.resetAt)}</div>}
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

