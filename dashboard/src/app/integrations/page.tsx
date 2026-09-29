'use client';
import { BookOpen, Check, Globe, RotateCcw, Search, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppLogo, ProviderLogo } from '@/components/logos';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, Card, Code, Field, Input, PageHeader, Segmented, Select, Spinner, useRun } from '@/components/ui';
import { enc, post } from '@/lib/api';
import { openLink } from '@/lib/desktop';
import { cn } from '@/lib/format';
import { LOGOS } from '@/lib/logos';
import { useAppState, useResource } from '@/lib/state';
import type { ToolCategory, ToolInfo } from '@/lib/types';

type Cat = 'all' | ToolCategory | 'detected';

const CATS: Array<{ value: Cat; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'detected', label: 'Detected' },
  { value: 'cli', label: 'Terminal agents' },
  { value: 'ide', label: 'IDEs & editors' },
  { value: 'chat', label: 'Chat apps' },
  { value: 'framework', label: 'SDKs & frameworks' },
];

function ToolCard({ t, onApply, onRestore, busy }: { t: ToolInfo; onApply: () => void; onRestore: () => void; busy: boolean }) {
  const [show, setShow] = useState(t.category === 'universal');
  const logo = LOGOS[`tool-${t.id}`] ? `tool-${t.id}` : '';
  return (
    <Card className={cn('flex flex-col', t.category === 'universal' && 'og-glow lg:col-span-2')}>
      <div className="flex items-start gap-3.5 p-5 pb-3">
        {t.category === 'universal' ? <AppLogo size={42} /> : <ProviderLogo type={logo} name={t.name} color="#6366f1" size={42} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[15px] font-semibold">{t.name}</h3>
            {t.applied && <Badge tone="good" icon={<Check className="size-3" />}>configured</Badge>}
            {t.detected && !t.applied && t.category !== 'universal' && <Badge tone="info">detected</Badge>}
            {t.canApply && <Badge tone="accent">one-click</Badge>}
          </div>
          <p className="mt-1 text-[13px] leading-snug text-fg-3">{t.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        {t.canApply && <Button size="sm" variant={t.applied ? 'secondary' : 'primary'} loading={busy} onClick={onApply} icon={<Wand2 className="size-3.5" />}>{t.applied ? 'Re-apply' : 'Configure automatically'}</Button>}
        {t.hasBackup && <Button size="sm" variant="ghost" onClick={onRestore} icon={<RotateCcw className="size-3.5" />}>Restore previous</Button>}
        {t.category !== 'universal' && <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>{show ? 'Hide setup' : 'Manual setup'}</Button>}
        {t.docs && <Button size="sm" variant="ghost" onClick={() => openLink(t.docs!)} icon={<BookOpen className="size-3.5" />}>Docs</Button>}
      </div>
      {show && (
        <div className="space-y-2 border-t border-line p-5">
          <Code lang={t.snippetLang}>{t.snippet}</Code>
          {t.notes && <p className="text-[12.5px] text-fg-3">{t.notes}</p>}
          {t.files.length > 0 && <p className="font-mono text-[11.5px] text-fg-3">{t.files.join(' · ')}</p>}
        </div>
      )}
    </Card>
  );
}

export default function IntegrationsPage() {
  const state = useAppState();
  const run = useRun();
  const [model, setModel] = useState('');
  const [smallModel, setSmallModel] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [cat, setCat] = useState<Cat>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const m = model || state.effectiveDefault || '';
  const params = new URLSearchParams({ ...(m ? { model: m } : {}), ...(smallModel ? { smallModel } : {}), ...(apiKeyId ? { apiKeyId } : {}) });
  const { data, reload, loading } = useResource<ToolInfo[]>(`/integrations?${params}`, [m, smallModel, apiKeyId]);

  const tools = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data || []).filter((t) => {
      if (s && !`${t.name} ${t.description}`.toLowerCase().includes(s)) return false;
      if (cat === 'all') return true;
      if (cat === 'detected') return t.detected && t.category !== 'universal';
      return t.category === cat || t.category === 'universal';
    });
  }, [data, cat, q]);

  const apply = async (t: ToolInfo) => {
    setBusy(t.id);
    const r = await run(() => post<{ files: string[] }>(`/integrations/${enc(t.id)}/apply`, { model: m, smallModel: smallModel || m, apiKeyId: apiKeyId || undefined }), `${t.name} now uses Open Gravity`);
    setBusy(null);
    if (r) reload();
  };
  const restore = async (t: ToolInfo) => {
    await run(() => post(`/integrations/${enc(t.id)}/restore`), `${t.name} restored`);
    reload();
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        sub="Connect any IDE, agent, chat app or SDK. Files are backed up before every change and can be restored."
      />
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-3">
        <Field label="Model for these tools" hint="A combo gives fallback; any provider/model works."><ModelPicker value={m} onChange={setModel} /></Field>
        <Field label="Fast model (background tasks)" hint="Claude Code haiku slot, autocomplete…"><ModelPicker value={smallModel} onChange={setSmallModel} placeholder={m || 'Same as main model'} /></Field>
        <Field label="Router API key" hint="Needed for remote access or when keys are required.">
          <Select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
            <option value="">{state.apiKeys.length ? 'First enabled key' : 'No key (local use)'}</option>
            {state.apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.masked})</option>)}
          </Select>
        </Field>
      </Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Cat> size="sm" value={cat} onChange={setCat} options={CATS.map((c) => ({ ...c, label: c.value === 'detected' ? `${c.label} (${(data || []).filter((t) => t.detected && t.category !== 'universal').length})` : c.label }))} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${(data || []).length} integrations…`} className="!pl-9" />
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-fg-3"><Globe className="size-3.5" /> Unknown tool? Use the universal endpoints.</span>
      </div>
      {!data && loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tools.map((t) => <ToolCard key={t.id} t={t} busy={busy === t.id} onApply={() => apply(t)} onRestore={() => restore(t)} />)}
        </div>
      )}
    </>
  );
}
