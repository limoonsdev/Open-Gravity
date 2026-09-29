'use client';
import { Activity, ArrowRight, CheckCircle2, Coins, Gauge, PiggyBank, Plus, Rocket, Timer, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarList, Sparkline, TimeChart } from '@/components/charts';
import { ProviderLogo } from '@/components/logos';
import { RequestDetail, RequestRow } from '@/components/requests';
import { Badge, Button, Card, CardHeader, Dot, Empty, PageHeader, Segmented, Stat } from '@/components/ui';
import { ago, ms, num, pct, usd } from '@/lib/format';
import { useAnalytics, usePref } from '@/lib/hooks';
import { useApp, useAppState } from '@/lib/state';
import type { Provider, Range, SeriesPoint } from '@/lib/types';
import { LOGOS } from '@/lib/logos';

const RANGES: Array<{ value: Range; label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

function providerStatus(p: Provider): { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!p.enabled) return { tone: 'neutral', label: 'Disabled' };
  const now = Date.now();
  const keys = p.keys.filter((k) => k.enabled);
  if (p.keys.length && !keys.length) return { tone: 'bad', label: 'No enabled key' };
  const cooling = keys.filter((k) => k.health.cooldownUntil > now);
  if (keys.length && cooling.length === keys.length) return { tone: 'bad', label: 'All keys paused' };
  if (cooling.length || keys.some((k) => Object.keys(k.health.modelCooldowns || {}).length)) return { tone: 'warn', label: 'Degraded' };
  if (keys.some((k) => k.health.lastErrorAt && (!k.health.lastOkAt || k.health.lastErrorAt > k.health.lastOkAt))) return { tone: 'warn', label: 'Recent errors' };
  return { tone: 'good', label: 'Healthy' };
}

export default function Overview() {
  const state = useAppState();
  const { live } = useApp();
  const [range, setRange] = usePref<Range>('range', '24h');
  const { data, loading } = useAnalytics(range);
  const [open, setOpen] = useState<string | null>(null);
  const t = data?.totals;
  const series = data?.series || [];
  const spark = useMemo(() => series.map((p) => p.requests), [series]);

  return (
    <>
      <PageHeader
        title="Overview"
        sub={<>Every request, every provider, one place. Default route: <span className="font-mono text-fg">{state.effectiveDefault || 'none'}</span></>}
        actions={<Segmented value={range} onChange={setRange} options={RANGES} />}
      />

      {!state.providers.length && (
        <Card className="og-glow mb-6 flex flex-wrap items-center gap-5 p-6">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Rocket className="size-6" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Let&apos;s get you routing</h2>
            <p className="mt-0.5 text-sm text-fg-2">Add a provider (many are free), build a combo, then connect Claude Code, Codex, Cursor or any tool in one click.</p>
          </div>
          <Link href="/welcome/"><Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>Get started</Button></Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat loading={loading} label="Requests" icon={<Activity className="size-3.5" />} tone="info" value={num(t?.requests)} sub={<Sparkline values={spark} height={22} />} />
        <Stat loading={loading} label="Success rate" icon={<CheckCircle2 className="size-3.5" />} tone={t && t.successRate < 0.9 ? 'warn' : 'good'} value={t?.requests ? pct(t.successRate) : '—'} sub={t?.errors ? `${num(t.errors)} failed · ${num(t.fallbacks)} recovered` : 'no failures'} />
        <Stat loading={loading} label="Tokens" icon={<Zap className="size-3.5" />} tone="accent" value={num(t?.tokens)} sub={`${num(t?.input)} in · ${num(t?.output)} out`} />
        <Stat loading={loading} label="Estimated cost" icon={<Coins className="size-3.5" />} tone="warn" value={usd(t?.cost)} sub={data ? `month projection ${usd(data.projection.projectedMonthCost)}` : ' '} />
        <Stat loading={loading} label="Token saver" icon={<PiggyBank className="size-3.5" />} tone="good" value={num(t?.saved)} sub={t?.savedCost ? `${usd(t.savedCost)} saved` : 'tokens not sent'} />
        <Stat loading={loading} label="Latency p50" icon={<Timer className="size-3.5" />} tone="neutral" value={t?.requests ? ms(t.p50LatencyMs) : '—'} sub={t?.requests ? `p95 ${ms(t.p95LatencyMs)} · first token ${ms(t.p50TtftMs)}` : 'no traffic yet'} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Requests" sub="Succeeded and failed, per period" />
          <div className="p-5">
            <TimeChart<SeriesPoint>
              title="Requests"
              data={series}
              bucketMs={data?.bucketMs || 3600e3}
              empty="No requests in this period"
              series={[
                { key: 'ok', label: 'Succeeded', color: 'var(--status-good)', value: (p) => p.requests - p.errors },
                { key: 'err', label: 'Failed', color: 'var(--status-critical)', value: (p) => p.errors },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Tokens" sub="Prompt, completion and prompt-cache reads" />
          <div className="p-5">
            <TimeChart<SeriesPoint>
              title="Tokens"
              mode="area"
              data={series}
              bucketMs={data?.bucketMs || 3600e3}
              empty="No tokens in this period"
              series={[
                { key: 'in', label: 'Input', color: 'var(--series-1)', value: (p) => p.input },
                { key: 'out', label: 'Output', color: 'var(--series-2)', value: (p) => p.output },
                { key: 'cache', label: 'Cache read', color: 'var(--series-3)', value: (p) => p.cacheRead },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top models" />
          <div className="p-5">
            <BarList items={data?.byModel || []} label={(g) => <span className="font-mono text-[12.5px]">{g.label}</span>} value={(g) => g.requests} sub={(g) => usd(g.cost)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Providers" />
          <div className="p-5">
            <BarList
              items={data?.byProvider || []}
              color="var(--series-7)"
              icon={(g) => {
                const p = state.providers.find((x) => x.id === g.key);
                return <ProviderLogo type={p?.type || g.key} name={g.label} color={p?.color} size={20} rounded="rounded-md" />;
              }}
              label={(g) => g.label}
              value={(g) => g.requests}
              sub={(g) => (g.errors ? `${num(g.errors)} err` : '')}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Clients & tools" sub="Which apps use the router" />
          <div className="p-5">
            <BarList
              items={data?.byClient || []}
              color="var(--series-3)"
              icon={(g) => <ProviderLogo type={LOGOS[`tool-${g.key}`] ? `tool-${g.key}` : ''} name={g.label} color="#6b7280" size={20} rounded="rounded-md" />}
              label={(g) => g.label}
              value={(g) => g.requests}
              sub={(g) => `${num(g.input + g.output)} tok`}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Live requests" sub="Updates in real time" actions={<Link href="/requests/"><Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />}>All requests</Button></Link>} />
          {live.length ? (
            <table className="w-full">
              <tbody>{live.slice(0, 8).map((r) => <RequestRow key={r.id} r={r} compact onOpen={setOpen} />)}</tbody>
            </table>
          ) : (
            <Empty icon={<Activity className="size-5" />} title="Waiting for requests" sub={<>Point a tool at <span className="font-mono text-fg">{state.baseUrl}/v1</span> or try the playground.</>} />
          )}
        </Card>
        <Card>
          <CardHeader title="Provider health" actions={<Link href="/providers/"><Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}>Manage</Button></Link>} />
          <ul className="divide-y divide-line">
            {state.providers.slice(0, 8).map((p) => {
              const s = providerStatus(p);
              const calls = p.keys.reduce((a, k) => a + k.stats.requests, 0);
              return (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <ProviderLogo type={p.type} name={p.name} color={p.color} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{p.name}</div>
                    <div className="text-[12px] text-fg-3">{p.models.length} models · {num(calls)} calls · last used {ago(Math.max(0, ...p.keys.map((k) => k.stats.lastUsed)))}</div>
                  </div>
                  <Badge tone={s.tone} icon={<Dot tone={s.tone} />}>{s.label}</Badge>
                </li>
              );
            })}
            {!state.providers.length && <li className="px-5 py-8 text-center text-sm text-fg-3">No providers yet.</li>}
          </ul>
          {state.providers.length > 8 && <div className="border-t border-line px-5 py-2.5 text-[12.5px] text-fg-3">+{state.providers.length - 8} more</div>}
        </Card>
      </div>

      {data && data.totals.requests > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Today" icon={<Coins className="size-3.5" />} value={usd(data.projection.todayCost)} sub={`${num(data.projection.todayRequests)} requests · ${num(data.projection.todayTokens)} tokens`} />
          <Stat label="This month" icon={<Coins className="size-3.5" />} value={usd(data.projection.monthToDateCost)} sub={`projected ${usd(data.projection.projectedMonthCost)}`} />
          <Stat label="Output speed" icon={<Gauge className="size-3.5" />} value={data.totals.outputTokensPerSec ? `${data.totals.outputTokensPerSec} tok/s` : '—'} sub="after the first token" />
          <Stat label="Prompt cache" icon={<Zap className="size-3.5" />} value={pct(data.totals.promptCacheRatio)} sub="of prompt tokens read from cache" />
        </div>
      )}

      <RequestDetail id={open} onClose={() => setOpen(null)} />
    </>
  );
}
