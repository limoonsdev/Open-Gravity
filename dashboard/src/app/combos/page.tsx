'use client';
import { ArrowDown, ArrowRight, ArrowUp, Layers, Pencil, Plus, Star, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProviderLogo } from '@/components/logos';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Modal, PageHeader, Select, Switch, useConfirm, useRun, useToast } from '@/components/ui';
import { del, enc, post, put } from '@/lib/api';
import { cn, ms } from '@/lib/format';
import { clearQuery, useQueryParam } from '@/lib/hooks';
import { useApp, useAppState } from '@/lib/state';
import type { Combo, Strategy } from '@/lib/types';
import { STRATEGIES } from '@/lib/constants';


function TargetChip({ t }: { t: string }) {
  const state = useAppState();
  const p = state.providers.find((x) => t.startsWith(`${x.id}/`));
  const combo = state.combos.find((c) => c.id === t);
  const missing = !p && !combo && !state.models.some((m) => m.id === t);
  const lat = state.latencies[t];
  return (
    <span className={cn('inline-flex h-8 items-center gap-2 rounded-xl border bg-surface-2 px-2.5 text-[12.5px]', missing ? 'border-bad/50' : 'border-line')} title={missing ? 'Not routable: unknown provider or model' : t}>
      {p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={18} rounded="rounded-[5px]" /> : <Layers className="size-3.5 text-accent" />}
      <span className="font-mono">{t}</span>
      {p && !p.enabled && <span className="text-fg-3">(disabled)</span>}
      {lat !== undefined && <span className="text-[11px] text-fg-3 tabular-nums" title="Average time to first token">{ms(lat)}</span>}
    </span>
  );
}

function ComboEditor({ combo, open, onClose }: { combo: Combo | null; open: boolean; onClose: () => void }) {
  const { refresh } = useApp();
  const run = useRun();
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('fallback');
  const [targets, setTargets] = useState<string[]>([]);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setId(combo?.id || '');
    setDescription(combo?.description || '');
    setStrategy(combo?.strategy || 'fallback');
    setTargets(combo?.targets || []);
    setNext('');
  }, [open, combo]);
  const move = (i: number, d: number) => {
    const t = [...targets];
    const [x] = t.splice(i, 1);
    t.splice(i + d, 0, x);
    setTargets(t);
  };
  const save = async () => {
    setBusy(true);
    const body = { id: id.trim(), description, strategy, targets };
    const r = await run(() => (combo ? put(`/combos/${enc(combo.id)}`, body) : post('/combos', body)), combo ? 'Combo saved' : 'Combo created');
    setBusy(false);
    if (r) {
      await refresh();
      onClose();
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={combo ? `Edit ${combo.id}` : 'New combo'}
      sub="A combo is a virtual model: use its name as the model in any tool."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!id.trim() || !targets.length} onClick={save}>{combo ? 'Save' : 'Create combo'}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="Letters, digits, . _ : -"><Input className="font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="coding" /></Field>
          <Field label="Strategy" hint={STRATEGIES[strategy].help}>
            <Select value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}>
              {Object.entries(STRATEGIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Best coding models first, free fallbacks after" /></Field>
        <div>
          <p className="label mb-2">Targets <span className="font-normal text-fg-3">· tried in this order</span></p>
          <ol className="space-y-2">
            {targets.map((t, i) => (
              <li key={`${t}:${i}`} className="flex items-center gap-2">
                <span className="w-5 text-right text-[12px] text-fg-3 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1"><TargetChip t={t} /></div>
                <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconButton>
                <IconButton label="Move down" disabled={i === targets.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconButton>
                <IconButton label="Remove" onClick={() => setTargets(targets.filter((_, j) => j !== i))}><X className="size-4" /></IconButton>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <ModelPicker value={next} onChange={(v) => { setTargets([...targets, v]); setNext(''); }} placeholder="Add a target (provider/model, another combo or an alias)…" className="flex-1" exclude={[...targets, id]} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function CombosPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Combo | null>(null);
  const [open, setOpen] = useState(false);
  const newParam = useQueryParam('new');
  const editParam = useQueryParam('edit');
  useEffect(() => {
    if (newParam) { setEditing(null); setOpen(true); clearQuery(); }
  }, [newParam]);
  useEffect(() => {
    if (editParam) {
      const c = state.combos.find((x) => x.id === editParam);
      if (c) { setEditing(c); setOpen(true); }
      clearQuery();
    }
  }, [editParam, state.combos]);

  const test = async (c: Combo) => {
    const t0 = performance.now();
    try {
      const res = await fetch('/admin/api/playground', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-og-admin': '1' },
        body: JSON.stringify({ model: c.id, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      toast(`${c.id} → ${res.headers.get('x-og-provider')}/${res.headers.get('x-og-model')} in ${Math.round(performance.now() - t0)}ms`, 'good');
    } catch (e: any) {
      toast(`${c.id}: ${e.message}`, 'bad');
    }
  };

  return (
    <>
      <PageHeader
        title="Combos"
        sub="Virtual models that chain several targets. Use the name as the model anywhere; failures, rate limits and quotas fall through to the next target automatically."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setOpen(true); }}>New combo</Button>}
      />
      {!state.combos.length ? (
        <Card>
          <Empty icon={<Layers className="size-5" />} title="No combo yet" sub='For example "coding": Claude first, then Qwen Coder, then Gemini. Or build the free combo from the Free APIs page.'
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setOpen(true); }}>Create a combo</Button>} />
        </Card>
      ) : (
        <div className="space-y-3">
          {state.combos.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-[16px] font-semibold">{c.id}</h3>
                <Badge tone="accent" title={STRATEGIES[c.strategy]?.help}>{STRATEGIES[c.strategy]?.label || c.strategy}</Badge>
                {state.settings.defaultModel === c.id && <Badge tone="good" icon={<Star className="size-3" />}>default route</Badge>}
                <div className="ml-auto flex items-center gap-1.5">
                  <Switch checked={c.enabled} onChange={async (v) => { await run(() => put(`/combos/${enc(c.id)}`, { enabled: v })); refresh(); }} />
                  <Button size="sm" onClick={() => test(c)} icon={<Zap className="size-3.5" />}>Test</Button>
                  {state.settings.defaultModel !== c.id && (
                    <Button size="sm" variant="ghost" onClick={async () => { await run(() => put('/settings', { defaultModel: c.id }), `${c.id} is now the default route`); refresh(); }} icon={<Star className="size-3.5" />}>Make default</Button>
                  )}
                  <Button size="sm" onClick={() => { setEditing(c); setOpen(true); }} icon={<Pencil className="size-3.5" />}>Edit</Button>
                  <IconButton label={`Delete ${c.id}`} onClick={async () => {
                    if (await confirm({ title: `Delete ${c.id}?`, confirm: 'Delete', danger: true })) { await run(() => del(`/combos/${enc(c.id)}`), 'Combo deleted'); refresh(); }
                  }}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
              {c.description && <p className="mt-1 text-[13px] text-fg-3">{c.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {c.targets.map((t, i) => (
                  <span key={`${t}:${i}`} className="inline-flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className={cn('size-3.5 text-fg-3', c.strategy !== 'fallback' && 'opacity-40')} />}
                    <TargetChip t={t} />
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <ComboEditor combo={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
