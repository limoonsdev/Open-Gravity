'use client';
import { Activity, Download, Pause, Play, Search, Terminal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestDetail, RequestRow } from '@/components/requests';
import { Button, Card, CardHeader, Empty, Input, PageHeader, Segmented, Spinner, useConfirm, useRun } from '@/components/ui';
import { del, get } from '@/lib/api';
import { cn, time } from '@/lib/format';
import { useApp } from '@/lib/state';
import type { UsageRecord } from '@/lib/types';

type Status = 'all' | 'ok' | 'error';

export default function RequestsPage() {
  const { onRequest, logs } = useApp();
  const run = useRun();
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [rows, setRows] = useState<UsageRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const logEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status !== 'all') params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    setRows(await get<UsageRecord[]>(`/usage/recent?${params}`).catch(() => []));
  }, [status, q, limit]);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  // Live: prepend new requests that match the filters.
  useEffect(
    () =>
      onRequest((r) => {
        if (paused) return;
        if (status === 'ok' && !r.ok) return;
        if (status === 'error' && r.ok) return;
        const s = q.trim().toLowerCase();
        if (s && !`${r.requestedModel} ${r.provider} ${r.model} ${r.endpoint} ${r.error || ''}`.toLowerCase().includes(s)) return;
        setRows((prev) => (prev ? [r, ...prev.filter((x) => x.id !== r.id)].slice(0, limit) : prev));
      }),
    [onRequest, paused, status, q, limit],
  );

  useEffect(() => {
    if (showLog) logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [logs, showLog]);

  return (
    <>
      <PageHeader
        title="Requests"
        sub="Every request with the route it took, each attempt, automatic fixes and token savings. Click a row for details."
        actions={
          <>
            <a href="/admin/api/usage/export.csv?range=30d" download><Button icon={<Download className="size-4" />}>Export CSV</Button></a>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: 'Clear the request history?', body: 'Analytics start from zero. This cannot be undone.', confirm: 'Clear history', danger: true })) {
                  await run(() => del('/usage'), 'History cleared');
                  load();
                }
              }}
            >
              Clear history
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Status> value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'ok', label: 'Succeeded' }, { value: 'error', label: 'Failed' }]} />
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model, provider, endpoint, error…" className="!pl-9" />
        </div>
        <Button variant="ghost" className="ml-auto" onClick={() => setPaused((v) => !v)} icon={paused ? <Play className="size-4" /> : <Pause className="size-4" />}>
          {paused ? 'Resume live' : 'Pause live'}
        </Button>
      </div>
      <Card className="overflow-hidden">
        {!rows ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !rows.length ? (
          <Empty icon={<Activity className="size-5" />} title="No request" sub={q || status !== 'all' ? 'Nothing matches these filters.' : 'Requests show up here as soon as a tool uses the router.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="text-left text-[12px] text-fg-3">
                  <th className="py-2.5 pr-3 pl-5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Requested · client</th>
                  <th className="px-3 py-2.5 font-medium">Served by</th>
                  <th className="px-3 py-2.5 text-right font-medium">Latency</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens in / out</th>
                  <th className="py-2.5 pr-5 pl-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>{rows.map((r) => <RequestRow key={r.id} r={r} onOpen={setOpen} />)}</tbody>
            </table>
            {rows.length >= limit && limit < 500 && (
              <div className="border-t border-line p-3 text-center"><Button variant="ghost" onClick={() => setLimit((l) => Math.min(500, l + 100))}>Load more</Button></div>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Router log" sub="Live" icon={<Terminal className="size-4" />} actions={<Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : 'Show'}</Button>} />
        {showLog && (
          <div className="max-h-80 overflow-y-auto bg-surface-2/40 px-5 py-3 font-mono text-[12px] leading-relaxed">
            {logs.slice(-200).map((l) => (
              <div key={l.id} className={cn('whitespace-pre-wrap', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : l.level === 'success' ? 'text-good' : l.level === 'debug' ? 'text-fg-3' : 'text-fg-2')}>
                <span className="text-fg-3">{time(l.ts)}</span> {l.message.replace(/\u001b\[[0-9;]*m/g, '')}
              </div>
            ))}
            {!logs.length && <p className="text-fg-3">No log lines yet.</p>}
            <div ref={logEnd} />
          </div>
        )}
      </Card>
      <RequestDetail id={open} onClose={() => setOpen(null)} />
    </>
  );
}
