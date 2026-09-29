'use client';
import { ArrowRight, Plus, Route, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProviderLogo } from '@/components/logos';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, Card, CardHeader, Dot, Field, IconButton, Input, PageHeader, Switch, useRun } from '@/components/ui';
import { enc, get, put } from '@/lib/api';
import { cn } from '@/lib/format';
import { useApp, useAppState } from '@/lib/state';

interface Resolved {
  via?: string;
  combo?: string;
  error?: string;
  candidates: Array<{ target: string; provider: string; model: string; combo?: string; keys: Array<{ id: string; label?: string; enabled: boolean; cooling: boolean }> }>;
}

export default function RoutingPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const [aliases, setAliases] = useState<Array<[string, string]>>([]);
  const [probe, setProbe] = useState('');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => setAliases(Object.entries(state.aliases)), [state.aliases]);

  const saveAliases = async (list: Array<[string, string]>) => {
    const next = Object.fromEntries(list.filter(([k, v]) => k.trim() && v.trim()));
    await run(() => put('/aliases', { aliases: next }), 'Aliases saved');
    refresh();
  };

  const test = async (name: string) => {
    setProbe(name);
    const r = await run(() => get<Resolved>(`/resolve?model=${enc(name)}`));
    if (r) setResolved(r);
  };

  const models = useMemo(() => state.models.filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase())), [state.models, filter]);

  return (
    <>
      <PageHeader title="Models & routing" sub="How a model name becomes a provider call: aliases first, then combos, then provider/model, then any provider listing that model, then the default route." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Default route" sub="Used for empty names, “auto”, and unknown names when enabled." />
          <div className="space-y-4 p-5">
            <Field label="Default model or combo">
              <ModelPicker value={state.settings.defaultModel} onChange={async (v) => { await run(() => put('/settings', { defaultModel: v }), `Default route: ${v}`); refresh(); }} placeholder="None" />
            </Field>
            <p className="text-[12.5px] text-fg-3">Effective now: <span className="font-mono text-fg">{state.effectiveDefault || 'none'}</span></p>
            <Switch
              checked={state.settings.unknownModelFallback}
              onChange={async (v) => { await run(() => put('/settings', { unknownModelFallback: v }), 'Saved'); refresh(); }}
              label="Send unknown model names to the default route"
              sub='Lets tools that insist on names like "gpt-4o" or "claude-sonnet-4" work with any provider.'
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Route tester" sub="See exactly which targets and keys a name resolves to." />
          <div className="space-y-4 p-5">
            <form onSubmit={(e) => { e.preventDefault(); test(probe); }} className="flex gap-2">
              <Input className="font-mono" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="claude-sonnet-4-5, coding, gemini/gemini-2.5-pro…" />
              <Button type="submit" icon={<Route className="size-4" />}>Resolve</Button>
            </form>
            {resolved && (
              <div className="space-y-2">
                {resolved.error ? <p className="text-sm text-bad">{resolved.error}</p> : <p className="text-[12.5px] text-fg-3">Resolved via <b className="text-fg">{resolved.via}</b>{resolved.combo ? <> (combo <span className="font-mono">{resolved.combo}</span>)</> : null}</p>}
                <ol className="space-y-2">
                  {resolved.candidates.map((c, i) => {
                    const p = state.providers.find((x) => x.id === c.provider);
                    return (
                      <li key={`${c.target}:${i}`} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                        <span className="w-4 text-[12px] text-fg-3">{i + 1}</span>
                        {p && <ProviderLogo type={p.type} name={p.name} color={p.color} size={22} rounded="rounded-md" />}
                        <span className="font-mono text-[12.5px]">{c.target}</span>
                        <span className="ml-auto flex flex-wrap gap-1">
                          {c.keys.length ? c.keys.map((k) => (
                            <Badge key={k.id} tone={!k.enabled ? 'neutral' : k.cooling ? 'warn' : 'good'} icon={<Dot tone={!k.enabled ? 'neutral' : k.cooling ? 'warn' : 'good'} />}>{k.label || k.id}</Badge>
                          )) : <Badge>no key needed</Badge>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Aliases" sub="Rename or redirect any model name. Wildcards with *, e.g. claude-*haiku* → fast." actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAliases([...aliases, ['', '']])}>Add alias</Button>} />
        <div className="space-y-2 p-5">
          {aliases.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="font-mono" value={k} onChange={(e) => setAliases(aliases.map((a, j) => (j === i ? [e.target.value, a[1]] : a)))} placeholder="claude-*haiku*" />
              <ArrowRight className="size-4 shrink-0 text-fg-3" />
              <ModelPicker value={v} onChange={(nv) => setAliases(aliases.map((a, j) => (j === i ? [a[0], nv] : a)))} className="flex-1" />
              <IconButton label="Remove alias" onClick={() => setAliases(aliases.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
          {!aliases.length && <p className="text-[13px] text-fg-3">No alias. Tip: map the names your tools use by default (e.g. “gpt-4o”, “claude-3-5-haiku-*”) to your combos.</p>}
          <div className="flex justify-end pt-2"><Button variant="primary" onClick={() => saveAliases(aliases)}>Save aliases</Button></div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Routable models" sub={`${state.models.length} names clients can use (combos, aliases and provider/model).`} actions={
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" /><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="!h-8 w-56 !pl-8 text-[13px]" /></div>
        } />
        <div className="grid max-h-[420px] gap-1.5 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
          {models.slice(0, 600).map((m) => (
            <button key={`${m.kind}:${m.id}`} onClick={() => test(m.id)} className={cn('flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left hover:bg-surface-2')}>
              <Badge tone={m.kind === 'combo' ? 'accent' : m.kind === 'alias' ? 'info' : 'neutral'}>{m.kind}</Badge>
              <span className="min-w-0 truncate font-mono text-[12.5px]">{m.id}</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
