'use client';
import { Plus, Search, Server, Settings2, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AddProviderDialog, FreeBadge } from '@/components/add-provider';
import { ProviderLogo } from '@/components/logos';
import { ProviderEditor } from '@/components/provider-editor';
import { Badge, Button, Card, Dot, Empty, IconButton, Input, PageHeader, Switch, useConfirm, useRun, useToast } from '@/components/ui';
import { del, enc, post, put } from '@/lib/api';
import { ago, num } from '@/lib/format';
import { clearQuery, useQueryParam } from '@/lib/hooks';
import { useApp, useAppState } from '@/lib/state';
import type { Provider, ProbeResult } from '@/lib/types';

function status(p: Provider): { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!p.enabled) return { tone: 'neutral', label: 'Disabled' };
  const now = Date.now();
  const keys = p.keys.filter((k) => k.enabled);
  if (p.keys.length && !keys.length) return { tone: 'bad', label: 'No enabled key' };
  const paused = keys.filter((k) => k.health.cooldownUntil > now).length;
  if (keys.length && paused === keys.length) return { tone: 'bad', label: 'Paused' };
  if (paused || keys.some((k) => Object.keys(k.health.modelCooldowns || {}).length)) return { tone: 'warn', label: 'Degraded' };
  if (keys.some((k) => k.health.lastErrorAt && (!k.health.lastOkAt || k.health.lastErrorAt > k.health.lastOkAt))) return { tone: 'warn', label: 'Recent errors' };
  if (keys.some((k) => k.health.lastOkAt) || !p.keys.length) return { tone: 'good', label: 'Healthy' };
  return { tone: 'neutral', label: 'Not used yet' };
}

export default function ProvidersPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ id: string; tab?: 'general' | 'models' } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const addParam = useQueryParam('add');
  const editParam = useQueryParam('edit');

  useEffect(() => {
    if (addParam) {
      setAddType(addParam === '1' ? undefined : addParam);
      setAdding(true);
      clearQuery();
    }
  }, [addParam]);
  useEffect(() => {
    if (editParam) {
      setEditing({ id: editParam });
      clearQuery();
    }
  }, [editParam]);

  const list = useMemo(() => state.providers.filter((p) => !q || `${p.name} ${p.id} ${p.type} ${p.models.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [state.providers, q]);

  const test = async (p: Provider) => {
    setTesting(p.id);
    const r = await run(() => post<ProbeResult>(`/providers/${enc(p.id)}/test`, {}));
    setTesting(null);
    if (r) toast(r.ok ? `${p.name} works · ${r.model} in ${Math.round(r.latencyMs)}ms` : `${p.name} failed (${r.status}): ${r.error}`, r.ok ? 'good' : 'bad');
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Providers"
        sub={<>Requests to <span className="font-mono text-fg">provider/model</span> go straight to that provider. Several keys per provider are rotated and paused automatically when they fail.</>}
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { setAddType(undefined); setAdding(true); }}>Add provider</Button>}
      />
      {state.providers.length > 3 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter providers or models…" className="!pl-9" />
        </div>
      )}
      {!state.providers.length ? (
        <Card>
          <Empty
            icon={<Server className="size-5" />}
            title="No provider yet"
            sub="Add an API key from any of 100+ providers (many have free tiers), or a local engine like Ollama or LM Studio."
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add your first provider</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((p) => {
            const s = status(p);
            const calls = p.keys.reduce((a, k) => a + k.stats.requests, 0);
            const errors = p.keys.reduce((a, k) => a + k.stats.errors, 0);
            const last = Math.max(0, ...p.keys.map((k) => k.stats.lastUsed));
            const learned = Object.keys(state.compat).filter((k) => k.startsWith(`${p.id}::`)).length;
            const free = state.catalog.find((c) => c.type === p.type)?.free;
            return (
              <Card key={p.id} className="card-hover flex flex-col p-5">
                <div className="flex items-start gap-3.5">
                  <ProviderLogo type={p.type} name={p.name} color={p.color} size={44} rounded="rounded-[13px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15.5px] font-semibold">{p.name}</h3>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                      <span className="rounded-md bg-surface-2 px-1.5 py-px font-mono text-fg-2 ring-1 ring-line">{p.id}/</span>
                      <span>{p.format}</span>
                    </div>
                  </div>
                  <Switch checked={p.enabled} onChange={async (v) => { await run(() => put(`/providers/${enc(p.id)}`, { enabled: v }), v ? `${p.name} enabled` : `${p.name} disabled`); refresh(); }} />
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Badge tone={s.tone} icon={<Dot tone={s.tone} pulse={s.tone === 'good' && Date.now() - last < 60_000} />}>{s.label}</Badge>
                  <Badge>{num(p.models.length)} models</Badge>
                  <Badge>{p.keys.length ? `${p.keys.filter((k) => k.enabled).length}/${p.keys.length} keys` : 'no key'}</Badge>
                  {p.toolMode === 'emulate' && <Badge tone="accent">tools emulated</Badge>}
                  {learned > 0 && <Badge tone="accent">{learned} fixes learned</Badge>}
                  {free && <FreeBadge kind={free.kind} />}
                </div>
                <p className="mt-3 truncate font-mono text-[12px] text-fg-3" title={p.baseUrl}>{p.baseUrl || 'Antigravity desktop app'}</p>
                <p className="mt-1 text-[12px] text-fg-3">{num(calls)} calls{errors ? ` · ${num(errors)} errors` : ''} · last used {ago(last)}</p>
                <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                  <Button size="sm" loading={testing === p.id} onClick={() => test(p)} icon={<Zap className="size-3.5" />}>Test</Button>
                  <Button size="sm" onClick={() => setEditing({ id: p.id })} icon={<Settings2 className="size-3.5" />}>Configure</Button>
                  <IconButton
                    className="ml-auto"
                    label={`Delete ${p.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${p.name}?`, body: 'Its keys are removed. Combos that use it will skip it.', confirm: 'Delete', danger: true })) {
                        await run(() => del(`/providers/${enc(p.id)}`), `${p.name} deleted`);
                        refresh();
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <AddProviderDialog
        open={adding}
        initialType={addType}
        onClose={() => setAdding(false)}
        onAdded={(id, t) => setEditing({ id, tab: t.category === 'local' || t.category === 'custom' || t.vars?.length ? 'models' : 'general' })}
      />
      <ProviderEditor id={editing?.id || null} initialTab={editing?.tab} onClose={() => setEditing(null)} />
    </>
  );
}
