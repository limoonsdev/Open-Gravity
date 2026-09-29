'use client';
import { Activity, ArrowDownUp, CheckCircle2, Coins, Download, Gauge, PiggyBank, RefreshCcw, Timer, Wand2, Wrench, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Heatmap, TimeChart } from '@/components/charts';
import { ProviderLogo } from '@/components/logos';
import { Badge, Button, Card, CardHeader, PageHeader, Segmented, Stat, Tabs } from '@/components/ui';
import { ago, cn, ms, num, pct, usd } from '@/lib/format';
import { useAnalytics, usePref } from '@/lib/hooks';
import { LOGOS } from '@/lib/logos';
import { useAppState } from '@/lib/state';
import type { GroupStats, Range, SeriesPoint } from '@/lib/types';

type Dim = 'byModel' | 'byProvider' | 'byKey' | 'byClient' | 'byApiKey' | 'byEndpoint' | 'byCombo';
type SortKey = 'requests' | 'errors' | 'tokens' | 'cost' | 'avgLatencyMs' | 'p95LatencyMs' | 'saved';

const DIMS: Array<{ value: Dim; label: string }> = [
  { value: 'byModel', label: 'Models' },
  { value: 'byProvider', label: 'Providers' },
  { value: 'byKey', label: 'Provider keys' },
  { value: 'byClient', label: 'Clients & tools' },
  { value: 'byApiKey', label: 'Router keys' },
  { value: 'byEndpoint', label: 'Endpoints' },
  { value: 'byCombo', label: 'Combos' },
];

function Breakdown({ rows, dim }: { rows: GroupStats[]; dim: Dim }) {
  const state = useAppState();
  const [sort, setSort] = useState<SortKey>('requests');
  const sorted = useMemo(() => {
    const val = (g: GroupStats) => (sort === 'tokens' ? g.input + g.output : g[sort]);
    return [...rows].sort((a, b) => val(b) - val(a));
  }, [rows, sort]);
  const icon = (g: GroupStats) => {
    if (dim === 'byProvider' || dim === 'byKey') {
      const p = state.providers.find((x) => x.id === g.key.split(':')[0]);
      return <ProviderLogo type={p?.type || g.key} name={p?.name || g.label} color={p?.color} size={22} rounded="rounded-md" />;
    }
    if (dim === 'byModel') {
      const p = state.providers.find((x) => g.key.startsWith(`${x.id}/`));
      return p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={22} rounded="rounded-md" /> : null;
    }
    if (dim === 'byClient') return <ProviderLogo type={LOGOS[`tool-${g.key}`] ? `tool-${g.key}` : ''} name={g.label} color="#6b7280" size={22} rounded="rounded-md" />;
    return null;
  };
  const Th = ({ k, children, right = true }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={cn('px-3 py-2.5 font-medium', right && 'text-right')}>
      <button onClick={() => setSort(k)} className={cn('inline-flex items-center gap-1 hover:text-fg', sort === k && 'text-fg')}>
        {children}
        {sort === k && <ArrowDownUp className="size-3" />}
      </button>
    </th>
  );
  if (!rows.length) return <p className="px-5 py-10 text-center text-[13px] text-fg-3">No data for this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px] tabular-nums">
        <thead>
          <tr className="text-left text-[12px] text-fg-3">
            <th className="py-2.5 pr-3 pl-5 font-medium">Name</th>
            <Th k="requests">Requests</Th>
            <Th k="errors">Errors</Th>
            <Th k="tokens">Tokens</Th>
            <Th k="cost">Cost</Th>
            <Th k="saved">Saved</Th>
            <Th k="avgLatencyMs">Avg latency</Th>
            <Th k="p95LatencyMs">p95</Th>
            <th className="py-2.5 pr-5 pl-3 text-right font-medium">Last</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((g) => (
            <tr key={g.key} className="border-t border-line hover:bg-surface-2/60">
              <td className="max-w-[340px] py-2.5 pr-3 pl-5">
                <span className="flex items-center gap-2.5">
                  {icon(g)}
                  <span className={cn('truncate', dim !== 'byClient' && dim !== 'byKey' && dim !== 'byApiKey' && 'font-mono text-[12.5px]')} title={g.label}>{g.label}</span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-medium">{num(g.requests)}</td>
              <td className={cn('px-3 py-2.5 text-right', g.errors ? 'text-bad' : 'text-fg-3')}>{num(g.errors)}{g.requests ? <span className="text-fg-3"> ({pct(g.errors / g.requests, 0)})</span> : null}</td>
              <td className="px-3 py-2.5 text-right">{num(g.input + g.output)}</td>
              <td className="px-3 py-2.5 text-right">{usd(g.cost)}</td>
              <td className="px-3 py-2.5 text-right text-good">{g.saved ? num(g.saved) : <span className="text-fg-3">—</span>}</td>
              <td className="px-3 py-2.5 text-right">{ms(g.avgLatencyMs)}</td>
              <td className="px-3 py-2.5 text-right text-fg-2">{ms(g.p95LatencyMs)}</td>
              <td className="py-2.5 pr-5 pl-3 text-right text-fg-3">{ago(g.lastAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = usePref<Range>('range', '24h');
  const { data, loading } = useAnalytics(range);
  const [dim, setDim] = useState<Dim>('byModel');
  const t = data?.totals;
  const series = data?.series || [];
  const bucket = data?.bucketMs || 3600e3;
  return (
    <>
      <PageHeader
        title="Analytics"
        sub="Usage, performance, cost and quotas across every provider, key, model and client."
        actions={
          <>
            <Segmented<Range> value={range} onChange={setRange} options={[{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
            <a href={`/admin/api/usage/export.csv?range=${range}`} download><Button icon={<Download className="size-4" />}>CSV</Button></a>
          </>
        }
      />
      <div className={cn('transition-opacity', loading && data && 'opacity-60')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Requests" icon={<Activity className="size-3.5" />} tone="info" value={num(t?.requests)} sub={`${num(t?.ok)} ok · ${num(t?.errors)} failed`} />
          <Stat label="Success rate" icon={<CheckCircle2 className="size-3.5" />} tone="good" value={t?.requests ? pct(t.successRate) : '—'} sub={`${num(t?.fallbacks)} saved by fallback`} />
          <Stat label="Latency" icon={<Timer className="size-3.5" />} value={t?.requests ? ms(t.p50LatencyMs) : '—'} sub={`p95 ${ms(t?.p95LatencyMs)} · avg ${ms(t?.avgLatencyMs)}`} />
          <Stat label="Time to first token" icon={<Zap className="size-3.5" />} value={t?.p50TtftMs ? ms(t.p50TtftMs) : '—'} sub={`p95 ${ms(t?.p95TtftMs)}`} />
          <Stat label="Output speed" icon={<Gauge className="size-3.5" />} value={t?.outputTokensPerSec ? `${t.outputTokensPerSec}` : '—'} sub="tokens per second" />
          <Stat label="Cost" icon={<Coins className="size-3.5" />} tone="warn" value={usd(t?.cost)} sub={data ? `month: ${usd(data.projection.monthToDateCost)} → ${usd(data.projection.projectedMonthCost)}` : ' '} />
          <Stat label="Tokens" icon={<Zap className="size-3.5" />} tone="accent" value={num(t?.tokens)} sub={`${num(t?.input)} in · ${num(t?.output)} out · ${num(t?.reasoning)} reasoning`} />
          <Stat label="Prompt cache" icon={<RefreshCcw className="size-3.5" />} value={pct(t?.promptCacheRatio)} sub={`${num(t?.cacheRead)} read · ${num(t?.cacheWrite)} written`} />
          <Stat label="Token saver" icon={<PiggyBank className="size-3.5" />} tone="good" value={num(t?.saved)} sub={`${usd(t?.savedCost)} saved · ${num(data?.savings.requests)} requests`} />
          <Stat label="Tools emulated" icon={<Wrench className="size-3.5" />} value={num(t?.emulated)} sub="for models without function calling" />
          <Stat label="Auto-fixed" icon={<Wand2 className="size-3.5" />} value={num(t?.adapted)} sub="requests adapted to a provider" />
          <Stat label="Cache hits" icon={<RefreshCcw className="size-3.5" />} value={num(t?.cached)} sub="answered from the response cache" />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card><CardHeader title="Requests" /><div className="p-5">
            <TimeChart<SeriesPoint> title="Requests" data={series} bucketMs={bucket} empty="No requests" series={[
              { key: 'ok', label: 'Succeeded', color: 'var(--status-good)', value: (p) => p.requests - p.errors },
              { key: 'err', label: 'Failed', color: 'var(--status-critical)', value: (p) => p.errors },
            ]} />
          </div></Card>
          <Card><CardHeader title="Tokens" /><div className="p-5">
            <TimeChart<SeriesPoint> title="Tokens" mode="area" data={series} bucketMs={bucket} empty="No tokens" series={[
              { key: 'in', label: 'Input', color: 'var(--series-1)', value: (p) => p.input },
              { key: 'out', label: 'Output', color: 'var(--series-2)', value: (p) => p.output },
              { key: 'cache', label: 'Cache read', color: 'var(--series-3)', value: (p) => p.cacheRead },
            ]} />
          </div></Card>
          <Card><CardHeader title="Estimated cost" sub="List prices from the model database" /><div className="p-5">
            <TimeChart<SeriesPoint> title="Cost" data={series} bucketMs={bucket} format={(v) => usd(v)} empty="No cost" series={[{ key: 'cost', label: 'Cost', color: 'var(--series-7)', value: (p) => p.cost }]} />
          </div></Card>
          <Card><CardHeader title="Tokens saved" sub="Removed by the token saver before sending" /><div className="p-5">
            <TimeChart<SeriesPoint> title="Tokens saved" data={series} bucketMs={bucket} empty="Nothing saved in this period" series={[{ key: 'saved', label: 'Saved', color: 'var(--series-3)', value: (p) => p.saved }]} />
          </div></Card>
        </div>

        <Card className="mt-4 overflow-hidden">
          <div className="px-5 pt-3"><Tabs<Dim> value={dim} onChange={setDim} tabs={DIMS.map((d) => ({ ...d, count: data?.[d.value]?.length }))} /></div>
          <Breakdown rows={data?.[dim] || []} dim={dim} />
        </Card>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="When requests happen" sub="Weekday × hour, local time" />
            <div className="p-5"><Heatmap data={data?.heatmap || Array.from({ length: 7 }, () => new Array(24).fill(0))} /></div>
          </Card>
          <Card>
            <CardHeader title="Status codes & errors" />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-1.5">
                {(data?.statuses || []).map((s) => (
                  <Badge key={s.status} tone={s.status < 400 ? 'good' : s.status === 429 ? 'warn' : 'bad'}>{s.status} · {num(s.count)}</Badge>
                ))}
                {!data?.statuses.length && <span className="text-[13px] text-fg-3">No requests.</span>}
              </div>
              <ul className="space-y-2">
                {(data?.topErrors || []).map((e) => (
                  <li key={e.message} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px]">
                    <div className="flex gap-2"><span className="min-w-0 flex-1 break-words text-bad">{e.message}</span><span className="shrink-0 font-medium tabular-nums">×{num(e.count)}</span></div>
                    <div className="mt-0.5 text-[11.5px] text-fg-3">last {ago(e.lastAt)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>

        {data && (
          <Card className="mt-4">
            <CardHeader title="Spending" sub="Estimates at public list prices; free tiers and discounts are not reflected." />
            <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
              {[
                ['Today', usd(data.projection.todayCost), `${num(data.projection.todayTokens)} tokens`],
                ['This month', usd(data.projection.monthToDateCost), `${num(data.projection.monthToDateTokens)} tokens`],
                ['Projected month', usd(data.projection.projectedMonthCost), `at ${usd(data.projection.avgDailyCost7d)}/day (7-day average)`],
                ['Saved this month', usd(data.projection.savedCostMonthToDate), 'by the token saver'],
              ].map(([label, value, sub]) => (
                <div key={label}>
                  <div className="text-[12.5px] text-fg-3">{label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
                  <div className="mt-0.5 text-[12px] text-fg-3">{sub}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
