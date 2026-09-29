'use client';
import { ArrowRight, CheckCircle2, Clock, Coins, Database, PiggyBank, Wand2, Wrench, XCircle, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { ago, cn, dateTime, ms, num, time, usd } from '@/lib/format';
import { useApp } from '@/lib/state';
import type { UsageRecord } from '@/lib/types';
import { ProviderLogo } from './logos';
import { Badge, Code, Modal, Spinner } from './ui';

export function StatusBadge({ status, ok }: { status: number; ok: boolean }) {
  return ok ? (
    <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>{status}</Badge>
  ) : (
    <Badge tone={status === 429 ? 'warn' : status === 499 ? 'neutral' : 'bad'} icon={<XCircle className="size-3" />}>{status}</Badge>
  );
}

export function RequestTags({ r }: { r: UsageRecord }) {
  const tries = r.attempts.filter((a) => a.ms > 0 || a.status !== 429).length - (r.adapted?.length || 0);
  const fixes = (r.adapted || []).filter((a) => !/emulated tools/.test(a));
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tries > 1 && <Badge tone="warn" title="Fell back to another key or model">{tries} tries</Badge>}
      {r.emulatedTools && <Badge tone="accent" icon={<Wrench className="size-3" />} title="Tool calls emulated for a model without native function calling">tools emulated</Badge>}
      {fixes.length > 0 && <Badge tone="accent" icon={<Wand2 className="size-3" />} title={fixes.join('\n')}>auto-fixed</Badge>}
      {!!r.saved && <Badge tone="good" icon={<PiggyBank className="size-3" />} title={(r.saverActions || []).join(', ')}>−{num(r.saved)} tok</Badge>}
      {r.cached && <Badge tone="info" icon={<Database className="size-3" />}>cache</Badge>}
    </span>
  );
}

export function RequestRow({ r, onOpen, compact }: { r: UsageRecord; onOpen: (id: string) => void; compact?: boolean }) {
  const { state } = useApp();
  const p = state?.providers.find((x) => x.id === r.provider);
  return (
    <tr onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)} tabIndex={0} className="cursor-pointer border-t border-line transition-colors hover:bg-surface-2/70 focus:bg-surface-2 focus:outline-none">
      <td className="py-2.5 pl-5 pr-3 text-[12.5px] whitespace-nowrap text-fg-3 tabular-nums" title={dateTime(r.ts)}>{compact ? ago(r.ts) : time(r.ts)}</td>
      <td className="px-3 py-2.5">
        <StatusBadge status={r.status} ok={r.ok} />
      </td>
      <td className="max-w-[220px] px-3 py-2.5">
        <div className="truncate font-mono text-[12.5px]" title={r.requestedModel}>{r.requestedModel || '(default)'}</div>
        {!compact && <div className="truncate text-[11.5px] text-fg-3">{r.client || r.endpoint}</div>}
      </td>
      <td className="max-w-[300px] px-3 py-2.5">
        <div className="flex items-center gap-2">
          {r.provider ? <ProviderLogo type={p?.type || r.provider} name={p?.name || r.provider} color={p?.color} size={20} rounded="rounded-md" /> : null}
          <span className="truncate font-mono text-[12.5px]" title={r.provider ? `${r.provider}/${r.model}` : ''}>{r.provider ? `${r.provider}/${r.model}` : <span className="text-fg-3">—</span>}</span>
        </div>
        {!compact && <div className="mt-1"><RequestTags r={r} /></div>}
      </td>
      <td className="px-3 py-2.5 text-right text-[12.5px] whitespace-nowrap tabular-nums">{ms(r.latencyMs)}</td>
      {!compact && <td className="px-3 py-2.5 text-right text-[12.5px] whitespace-nowrap tabular-nums text-fg-2">{num(r.input)} / {num(r.output)}</td>}
      <td className="py-2.5 pr-5 pl-3 text-right text-[12.5px] whitespace-nowrap tabular-nums">{usd(r.cost)}</td>
    </tr>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <span className="w-40 shrink-0 text-fg-3">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export function RequestDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [data, setData] = useState<{ record: UsageRecord; bodies: any } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    setData(null);
    setError('');
    get(`/usage/${encodeURIComponent(id)}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  const r = data?.record;
  return (
    <Modal open={!!id} onClose={onClose} title={`Request ${id || ''}`} sub={r ? dateTime(r.ts) : undefined} size="lg">
      {!r && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {error && <p className="text-sm text-bad">{error}</p>}
      {r && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini icon={<Clock className="size-3.5" />} label="Latency" value={ms(r.latencyMs)} sub={r.ttftMs ? `first token ${ms(r.ttftMs)}` : undefined} />
            <Mini icon={<Zap className="size-3.5" />} label="Tokens" value={`${num(r.input)} → ${num(r.output)}`} sub={r.cacheRead ? `${num(r.cacheRead)} cached` : r.reasoning ? `${num(r.reasoning)} reasoning` : undefined} />
            <Mini icon={<Coins className="size-3.5" />} label="Estimated cost" value={usd(r.cost, { precise: true })} sub={r.estimated ? 'tokens estimated' : undefined} />
            <Mini icon={<PiggyBank className="size-3.5" />} label="Token saver" value={r.saved ? `−${num(r.saved)}` : '—'} sub={r.savedCost ? `${usd(r.savedCost, { precise: true })} saved` : undefined} />
          </div>
          <div>
            <Row label="Status"><StatusBadge status={r.status} ok={r.ok} /> {r.error && <span className="ml-2 text-bad">{r.error}</span>}</Row>
            <Row label="Endpoint">{r.endpoint}{r.stream ? ' · streaming' : ''}</Row>
            <Row label="Requested model"><span className="font-mono">{r.requestedModel || '(default)'}</span>{r.combo && <Badge className="ml-2">combo {r.combo}</Badge>}</Row>
            <Row label="Served by"><span className="font-mono">{r.provider ? `${r.provider}/${r.model}` : '—'}</span>{r.keyId && <span className="text-fg-3"> · key {r.keyId}</span>}</Row>
            <Row label="Client">{r.client || '—'}{r.ua && <span className="block font-mono text-[11.5px] text-fg-3">{r.ua}</span>}</Row>
            {r.apiKeyId && <Row label="Router key">{r.apiKeyId}</Row>}
            {r.emulatedTools && <Row label="Tool calling">Emulated: the model has no native function calling</Row>}
            {!!r.adapted?.length && <Row label="Automatic fixes"><ul className="list-disc space-y-0.5 pl-4">{r.adapted.map((a) => <li key={a}>{a}</li>)}</ul></Row>}
            {!!r.saverActions?.length && <Row label="Token saver">{r.saverActions.join(' · ')}</Row>}
            {r.cached && <Row label="Cache">Served from the response cache</Row>}
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Attempts</h3>
            <ol className="space-y-2">
              {r.attempts.map((a, i) => (
                <li key={i} className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                  <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', a.error ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good')}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[12.5px]">
                      {a.provider}/{a.model}
                      {a.keyId && <span className="text-fg-3">key {a.keyId}</span>}
                    </div>
                    {a.error && <p className="mt-1 text-[12.5px] text-bad">{a.error}</p>}
                  </div>
                  {a.status !== undefined && <StatusBadge status={a.status} ok={!a.error} />}
                  <span className="w-14 shrink-0 text-right text-[12px] text-fg-3 tabular-nums">{ms(a.ms)}</span>
                </li>
              ))}
              {!r.attempts.length && <li className="text-[13px] text-fg-3">No upstream call (rejected before routing).</li>}
            </ol>
          </div>
          {data?.bodies ? (
            <div className="space-y-3">
              <h3 className="text-[12px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Captured bodies</h3>
              {data.bodies.request && <Code lang="client request (json)">{JSON.stringify(data.bodies.request, null, 2).slice(0, 60000)}</Code>}
              {data.bodies.upstreamRequest && <Code lang="sent upstream (json)">{JSON.stringify(data.bodies.upstreamRequest, null, 2).slice(0, 60000)}</Code>}
              {data.bodies.response && <Code lang="response">{String(data.bodies.response).slice(0, 60000)}</Code>}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-fg-3"><ArrowRight className="size-3.5" /> Turn on “Capture request bodies” in Settings to inspect full payloads of new requests.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Mini({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-fg-3">{icon}{label}</div>
      <div className="mt-1.5 text-[17px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-fg-3">{sub}</div>}
    </div>
  );
}
