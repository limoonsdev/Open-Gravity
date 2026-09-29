'use client';
import { CheckCircle2, ExternalLink, Gift, Layers, Plus, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AddProviderDialog, FREE_LABEL, FreeBadge } from '@/components/add-provider';
import { ProviderLogo } from '@/components/logos';
import { Badge, Button, Card, CardHeader, PageHeader, Segmented, Spinner, Switch, useRun } from '@/components/ui';
import { get, post } from '@/lib/api';
import { openLink } from '@/lib/desktop';
import { ctx } from '@/lib/format';
import { useApp, useResource } from '@/lib/state';
import type { Combo, FreeKind, FreeView } from '@/lib/types';

type Filter = 'all' | FreeKind;

export default function FreePage() {
  const { refresh } = useApp();
  const run = useRun();
  const { data, loading, reload } = useResource<FreeView>('/free?discover=1');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<string | undefined>();
  const [makeDefault, setMakeDefault] = useState(true);
  const [combo, setCombo] = useState<Combo | null>(null);
  const [building, setBuilding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const offers = useMemo(() => (data?.offers || []).filter((o) => filter === 'all' || o.free.kind === filter), [data, filter]);
  const configuredCount = (data?.offers || []).filter((o) => o.configured.length).length;

  const build = async () => {
    setBuilding(true);
    const r = await run(() => post<Combo>('/free/combo', { makeDefault }), 'Free combo ready');
    setBuilding(false);
    if (r) {
      setCombo(r);
      refresh();
    }
  };

  const rediscover = async () => {
    setRefreshing(true);
    try {
      await get('/free?discover=1&refresh=1');
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Free APIs"
        sub="Official free tiers, free models, free credits, public endpoints and local engines. Add a few, then let Open Gravity chain them into one free model that falls back when a quota runs out."
      />

      <Card className="og-glow mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-5 p-6">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-good-soft text-good"><Sparkles className="size-6" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">One “free” model built from everything free you have</h2>
            <p className="mt-0.5 text-sm text-fg-2">
              {configuredCount ? `${configuredCount} free option${configuredCount > 1 ? 's' : ''} configured.` : 'Add at least one option below.'} The combo tries the best free tiers first, spreads
              across providers so one exhausted quota doesn&apos;t stop you, and ends with your local engines.
            </p>
            <div className="mt-3"><Switch checked={makeDefault} onChange={setMakeDefault} label="Also make it the default route" /></div>
          </div>
          <Button variant="primary" size="lg" loading={building} disabled={!configuredCount} onClick={build} icon={<Layers className="size-4" />}>Build my free combo</Button>
        </div>
        {combo && (
          <div className="border-t border-line bg-surface-2/50 px-6 py-4">
            <p className="flex items-center gap-2 text-[13px] font-medium"><CheckCircle2 className="size-4 text-good" /> Use the model <span className="font-mono">{combo.id}</span> anywhere ({combo.targets.length} targets):</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{combo.targets.map((t, i) => <Badge key={t}>{i + 1}. <span className="font-mono">{t}</span></Badge>)}</div>
          </div>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'free-tier', label: FREE_LABEL['free-tier'] },
            { value: 'free-models', label: FREE_LABEL['free-models'] },
            { value: 'free-credits', label: FREE_LABEL['free-credits'] },
            { value: 'no-key', label: FREE_LABEL['no-key'] },
            { value: 'local', label: FREE_LABEL.local },
          ]}
        />
        <span className="text-[12.5px] text-fg-3">Limits change often: each card links to the provider&apos;s official page.</span>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers.map((o) => (
            <Card key={o.type} className="card-hover flex flex-col p-5">
              <div className="flex items-start gap-3">
                <ProviderLogo type={o.type} name={o.name} color={o.color} size={42} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-semibold">{o.name}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <FreeBadge kind={o.free.kind} />
                    {o.keyOptional && o.free.kind !== 'local' && <Badge tone="info">no signup</Badge>}
                    {o.configured.length > 0 && <Badge tone="accent" icon={<CheckCircle2 className="size-3" />}>added</Badge>}
                  </div>
                </div>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-fg-2">{o.free.summary}</p>
              {o.free.models?.length ? (
                <div className="mt-3 flex flex-wrap gap-1">{o.free.models.slice(0, 4).map((m) => <Badge key={m} className="font-mono">{m}</Badge>)}</div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <Button size="sm" variant={o.configured.length ? 'secondary' : 'primary'} icon={<Plus className="size-3.5" />} onClick={() => setAdding(o.type)}>
                  {o.configured.length ? 'Add another' : 'Add'}
                </Button>
                {o.keyUrl && <Button size="sm" variant="ghost" onClick={() => openLink(o.keyUrl!)} icon={<ExternalLink className="size-3.5" />}>Get a key</Button>}
                {o.free.limitsUrl && <Button size="sm" variant="ghost" onClick={() => openLink(o.free.limitsUrl!)} icon={<ExternalLink className="size-3.5" />}>Limits</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader
          title="OpenRouter free models, live"
          sub="Fetched from OpenRouter's public model list (no key needed to browse). Models with tool calling come first."
          icon={<Gift className="size-4" />}
          actions={<Button size="sm" variant="ghost" loading={refreshing} onClick={rediscover} icon={<RefreshCw className="size-3.5" />}>Refresh</Button>}
        />
        <div className="p-5">
          {data?.openrouter?.error && !data.openrouter.models.length ? (
            <p className="text-[13px] text-fg-3">Could not reach OpenRouter ({data.openrouter.error}). Add OpenRouter as a provider and fetch its models instead.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(data?.openrouter?.models || []).slice(0, 60).map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={m.id}>{m.id}</span>
                  {m.tools && <Badge tone="good" icon={<Wrench className="size-3" />}>tools</Badge>}
                  {m.context > 0 && <Badge>{ctx(m.context)}</Badge>}
                </div>
              ))}
              {!data?.openrouter?.models.length && <p className="text-[13px] text-fg-3">No free models listed right now.</p>}
            </div>
          )}
        </div>
      </Card>

      <AddProviderDialog open={!!adding} initialType={adding} onClose={() => setAdding(undefined)} onAdded={() => reload()} />
    </>
  );
}
