'use client';
import { ArrowLeft, ExternalLink, Gift, KeyRound, Laptop, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { post } from '@/lib/api';
import { openLink } from '@/lib/desktop';
import { cn } from '@/lib/format';
import { useApp, useAppState } from '@/lib/state';
import type { CatalogEntry, Category, FreeKind } from '@/lib/types';
import { ProviderLogo } from './logos';
import { Badge, Button, Field, Input, Modal, Textarea, useRun } from './ui';

const GROUPS: Array<{ id: Category | 'free'; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'free', label: 'Free to start' },
  { id: 'cloud', label: 'Cloud & API providers' },
  { id: 'gateway', label: 'Gateways & routers' },
  { id: 'china', label: 'China' },
  { id: 'local', label: 'Local engines' },
  { id: 'custom', label: 'Custom endpoint' },
];

export const FREE_LABEL: Record<FreeKind, string> = {
  'free-tier': 'Free tier',
  'free-models': 'Free models',
  'free-credits': 'Free credits',
  'no-key': 'No key needed',
  local: 'Runs locally',
};

export function FreeBadge({ kind }: { kind: FreeKind }) {
  return (
    <Badge tone={kind === 'local' ? 'info' : 'good'} icon={kind === 'local' ? <Laptop className="size-3" /> : <Gift className="size-3" />}>
      {FREE_LABEL[kind]}
    </Badge>
  );
}

function CatalogCard({ t, onPick, configured }: { t: CatalogEntry; onPick: () => void; configured: number }) {
  return (
    <button onClick={onPick} className="card card-hover group flex items-start gap-3 p-3.5 text-left hover:-translate-y-px">
      <ProviderLogo type={t.type} name={t.name} color={t.color} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold">{t.name}</span>
          {configured > 0 && <Badge tone="accent">added</Badge>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-fg-3">{t.description}</span>
        {t.free && (
          <span className="mt-2 block">
            <FreeBadge kind={t.free.kind} />
          </span>
        )}
      </span>
    </button>
  );
}

/** Catalog browser + the form to add the chosen provider. */
export function AddProviderDialog({ open, onClose, onAdded, initialType }: { open: boolean; onClose: () => void; onAdded?: (id: string, t: CatalogEntry) => void; initialType?: string }) {
  const state = useAppState();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CatalogEntry | null>(null);
  const [lastType, setLastType] = useState<string | undefined>(undefined);
  if (open && initialType && initialType !== lastType) {
    setLastType(initialType);
    setPicked(state.catalog.find((c) => c.type === initialType) || null);
  }
  const close = () => {
    setPicked(null);
    setQ('');
    setLastType(undefined);
    onClose();
  };

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const match = (t: CatalogEntry) => !s || `${t.name} ${t.description} ${t.type} ${t.free ? 'free' : ''}`.toLowerCase().includes(s);
    return GROUPS.map((g) => ({
      ...g,
      items: state.catalog.filter((t) => (g.id === 'free' ? t.free && t.free.kind !== 'local' && t.category !== 'popular' : t.category === g.id) && match(t)),
    })).filter((g) => g.items.length);
  }, [q, state.catalog]);

  return (
    <Modal
      open={open}
      onClose={close}
      size={picked ? 'md' : 'xl'}
      title={picked ? `Add ${picked.name}` : 'Add a provider'}
      sub={picked ? picked.description : `${state.catalog.length} presets · any OpenAI, Anthropic, Gemini or Responses-compatible API works as a custom endpoint`}
      icon={picked ? <ProviderLogo type={picked.type} name={picked.name} color={picked.color} size={40} /> : undefined}
    >
      {picked ? (
        <AddForm t={picked} onBack={() => setPicked(null)} onDone={(id) => { const t = picked; close(); onAdded?.(id, t); }} />
      ) : (
        <div>
          <div className="relative mb-5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 100+ providers (name, model family, “free”…)" className="!pl-9" />
          </div>
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.id}>
                <h3 className="mb-2.5 text-[11.5px] font-semibold tracking-[0.1em] text-fg-3 uppercase">{g.label} <span className="font-normal">· {g.items.length}</span></h3>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((t) => (
                    <CatalogCard key={`${g.id}:${t.type}`} t={t} configured={state.providers.filter((p) => p.type === t.type).length} onPick={() => setPicked(t)} />
                  ))}
                </div>
              </section>
            ))}
            {!groups.length && <p className="py-10 text-center text-sm text-fg-3">No preset matches. Any compatible API works with a “Custom endpoint”.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddForm({ t, onBack, onDone }: { t: CatalogEntry; onBack: () => void; onDone: (id: string) => void }) {
  const { refresh } = useApp();
  const run = useRun();
  const custom = t.category === 'custom';
  const local = t.category === 'local';
  const [name, setName] = useState(custom ? '' : t.name);
  const [baseUrl, setBaseUrl] = useState(custom ? '' : t.baseUrl);
  const [keys, setKeys] = useState('');
  const [models, setModels] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const needsKey = !t.keyOptional && t.type !== 'antigravity';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await run(
      () => post<{ id: string }>('/providers', {
        type: t.type,
        name: custom ? name.trim() || 'custom' : undefined,
        baseUrl: t.vars?.length ? undefined : baseUrl.trim() || undefined,
        vars,
        keys: keys.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
        models: models.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
      }),
      `${t.name} added`,
    );
    setBusy(false);
    if (r) {
      await refresh();
      onDone(r.id);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {t.free && (
        <div className="flex items-start gap-3 rounded-2xl border border-good/20 bg-good-soft px-4 py-3 text-[13px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-good" />
          <div>
            <b className="text-fg">{FREE_LABEL[t.free.kind]}.</b> <span className="text-fg-2">{t.free.summary}</span>
            {t.free.limitsUrl && (
              <button type="button" onClick={() => openLink(t.free!.limitsUrl!)} className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                Current limits <ExternalLink className="size-3" />
              </button>
            )}
          </div>
        </div>
      )}
      {t.type === 'antigravity' && <p className="text-[13px] text-fg-2">Requires the Antigravity desktop app to be running and signed in on this computer. Tool calls are emulated automatically.</p>}
      {custom && <Field label="Name" hint={'Also the model prefix, e.g. "my-endpoint/model".'}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My endpoint" required /></Field>}
      {t.vars?.map((v) => (
        <Field key={v.name} label={v.label}>
          <Input className="font-mono" value={vars[v.name] || ''} onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })} placeholder={v.placeholder} required />
        </Field>
      ))}
      {t.type !== 'antigravity' && !t.vars?.length && (
        <Field label="Base URL" hint={custom ? `${t.format} format, e.g. ${t.baseUrl}` : local ? 'Change it if the server runs on another port or machine.' : undefined}>
          <Input className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t.baseUrl} required={custom} />
        </Field>
      )}
      {t.type !== 'antigravity' && (
        <Field
          label={<span className="flex items-center gap-2">{needsKey ? 'API key' : 'API key (optional)'}<KeyRound className="size-3.5 text-fg-3" /></span>}
          hint={
            <span>
              Several keys (one per line) are rotated and paused automatically on errors.
              {t.keyUrl && (
                <button type="button" onClick={() => openLink(t.keyUrl!)} className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                  Get a key <ExternalLink className="size-3" />
                </button>
              )}
            </span>
          }
        >
          <Textarea className="font-mono" rows={3} value={keys} onChange={(e) => setKeys(e.target.value)} placeholder={needsKey ? 'sk-…' : 'Leave empty if the server needs no key'} required={needsKey} />
        </Field>
      )}
      {(custom || local || t.vars?.length) && (
        <Field label={t.type === 'azure-openai' ? 'Deployments' : 'Models'} hint="Optional: the list is fetched from the provider when it supports it.">
          <Input className="font-mono" value={models} onChange={(e) => setModels(e.target.value)} placeholder="model-a, model-b" />
        </Field>
      )}
      <div className={cn('flex items-center justify-between gap-2 border-t border-line pt-4')}>
        <Button type="button" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Catalog</Button>
        <Button variant="primary" loading={busy}>Add provider</Button>
      </div>
    </form>
  );
}
