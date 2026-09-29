'use client';
// Lightweight SVG charts: stacked bars / areas over time, horizontal bar lists,
// a weekday x hour heatmap and sparklines. Colours come from the validated
// palette (CSS variables), every chart has a hover/focus readout and a table view.
import { Table2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, num } from '@/lib/format';

export interface SeriesDef<P> {
  key: string;
  label: string;
  /** CSS colour, e.g. "var(--series-1)". */
  color: string;
  value: (p: P) => number;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** "Nice" axis maximum and tick step. */
function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * Math.ceil(max / step), step };
}

export function Legend({ items, className }: { items: Array<{ label: string; color: string; shape?: 'rect' | 'line' }>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
          {i.shape === 'line' ? (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: i.color }} />
          ) : (
            <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const W = 190;
  const left = x + 14 + W <= width ? x + 14 : Math.max(0, x - 14 - W);
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[170px] rounded-xl border border-line-strong bg-surface/95 px-3 py-2 text-[12.5px] shadow-xl backdrop-blur"
      style={{ left, top: Math.max(0, y) }}
    >
      {children}
    </div>
  );
}

export function TimeChart<P extends { t: number }>({
  data, series, mode = 'bars', height = 220, format = num, bucketMs, title, empty,
}: {
  data: P[];
  series: SeriesDef<P>[];
  mode?: 'bars' | 'area';
  height?: number;
  format?: (v: number) => string;
  bucketMs: number;
  title: string;
  empty?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const innerW = Math.max(0, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;
  const totals = data.map((p) => series.reduce((s, d) => s + Math.max(0, d.value(p)), 0));
  const { max, step } = niceScale(Math.max(0, ...totals));
  const n = data.length;
  const slot = n ? innerW / n : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.68));
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const xCenter = (i: number) => pad.l + slot * i + slot / 2;
  const allZero = totals.every((t) => t === 0);

  const fmtTime = (t: number) => {
    const d = new Date(t);
    if (bucketMs >= 86400e3) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - pad.l) / slot);
    setHover(i >= 0 && i < n ? i : null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'Escape') setHover(null);
  };

  const areaPaths = useMemo(() => {
    if (mode !== 'area' || !n) return [];
    const acc = new Array(n).fill(0);
    return series.map((s) => {
      const lower = [...acc];
      data.forEach((p, i) => (acc[i] += Math.max(0, s.value(p))));
      const upper = [...acc];
      const top = upper.map((v, i) => `${i ? 'L' : 'M'}${xCenter(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const bottom = lower.map((v, i) => `L${xCenter(n - 1 - i).toFixed(1)},${y(lower[n - 1 - i]).toFixed(1)}`).join('');
      const line = upper.map((v, i) => `${i ? 'L' : 'M'}${xCenter(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return { key: s.key, color: s.color, area: `${top}${bottom}Z`, line };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, series, mode, width, max]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: mode === 'area' ? 'line' : 'rect' }))} />}
        <button
          onClick={() => setTable((v) => !v)}
          className={cn('ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium', table ? 'bg-accent-soft text-accent' : 'text-fg-3 hover:bg-surface-2 hover:text-fg')}
          aria-pressed={table}
        >
          <Table2 className="size-3.5" /> Table
        </button>
      </div>
      {table ? (
        <div className="max-h-[260px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="sticky top-0 bg-surface-2 text-fg-3">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.t} className="border-t border-line">
                  <td className="px-3 py-1.5 text-fg-2">{fmtTime(p.t)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right">{format(s.value(p))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative outline-none"
          style={{ height }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={onKey}
          role="img"
          aria-label={`${title}: ${series.map((s) => s.label).join(', ')} over time`}
        >
          {width > 0 && (
            <svg width={width} height={height} className="block overflow-visible">
              {Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((v) => (
                <g key={v}>
                  <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
                  <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px] tabular-nums">
                    {format(v)}
                  </text>
                </g>
              ))}
              {data.map((p, i) =>
                i % labelEvery === 0 ? (
                  <text key={p.t} x={xCenter(i)} y={height - 6} textAnchor="middle" className="fill-fg-3 text-[11px]">
                    {fmtTime(p.t)}
                  </text>
                ) : null,
              )}
              {mode === 'bars' &&
                data.map((p, i) => {
                  let base = 0;
                  const segs = series
                    .map((s) => ({ s, v: Math.max(0, s.value(p)) }))
                    .filter((x) => x.v > 0);
                  return (
                    <g key={p.t} opacity={hover === null || hover === i ? 1 : 0.45}>
                      {segs.map(({ s, v }, si) => {
                        const y0 = y(base);
                        base += v;
                        const y1 = y(base);
                        const top = si === segs.length - 1;
                        const h = Math.max(1, y0 - y1 - (si > 0 ? 2 : 0));
                        const x = xCenter(i) - barW / 2;
                        const r = top ? Math.min(4, barW / 2, h) : 0;
                        return (
                          <path
                            key={s.key}
                            fill={s.color}
                            d={`M${x},${y0 - (si > 0 ? 2 : 0)}V${y0 - h + r}${r ? `Q${x},${y0 - h} ${x + r},${y0 - h}` : ''}H${x + barW - r}${r ? `Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r}` : ''}V${y0 - (si > 0 ? 2 : 0)}Z`}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              {mode === 'area' &&
                areaPaths.map((a) => (
                  <g key={a.key}>
                    <path d={a.area} fill={a.color} opacity={0.18} />
                    <path d={a.line} fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" />
                  </g>
                ))}
              {hover !== null && mode === 'area' && <line x1={xCenter(hover)} x2={xCenter(hover)} y1={pad.t} y2={pad.t + innerH} stroke="var(--og-line-strong)" strokeWidth={1} />}
              <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--og-line-strong)" strokeWidth={1} />
            </svg>
          )}
          {allZero && empty && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-fg-3">{empty}</div>}
          {hover !== null && data[hover] && (
            <Tooltip x={xCenter(hover)} y={20} width={width}>
              <div className="mb-1 text-[11.5px] text-fg-3">{fmtTime(data[hover].t)}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-2 py-0.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold tabular-nums">{format(s.value(data[hover]))}</span>
                  <span className="text-fg-3">{s.label}</span>
                </div>
              ))}
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (one series): label, bar, value. */
export function BarList<T>({ items, label, value, format = num, sub, color = 'var(--series-1)', icon, max: maxItems = 8, onSelect }: {
  items: T[];
  label: (t: T) => ReactNode;
  value: (t: T) => number;
  format?: (v: number) => string;
  sub?: (t: T) => ReactNode;
  color?: string;
  icon?: (t: T) => ReactNode;
  max?: number;
  onSelect?: (t: T) => void;
}) {
  const shown = items.slice(0, maxItems);
  const top = Math.max(1, ...shown.map(value));
  if (!shown.length) return <p className="py-6 text-center text-[13px] text-fg-3">No data for this period.</p>;
  return (
    <ul className="space-y-2.5">
      {shown.map((it, i) => {
        const v = value(it);
        return (
          <li key={i}>
            <button className={cn('block w-full text-left', onSelect ? 'group' : 'cursor-default')} onClick={() => onSelect?.(it)} title={`${format(v)}`}>
              <div className="flex items-center gap-2 text-[13px]">
                {icon?.(it)}
                <span className="min-w-0 flex-1 truncate">{label(it)}</span>
                {sub && <span className="shrink-0 text-[12px] text-fg-3">{sub(it)}</span>}
                <span className="w-16 shrink-0 text-right font-medium tabular-nums">{format(v)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full transition-[width] duration-500 group-hover:brightness-110" style={{ width: `${Math.max(2, (v / top) * 100)}%`, background: color }} />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekday x hour activity (sequential single-hue ramp). */
export function Heatmap({ data }: { data: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...data.flat());
  const step = (v: number) => (v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999)));
  return (
    <div className="relative">
      <div className="grid grid-cols-[34px_repeat(24,minmax(0,1fr))] gap-[3px]">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] text-fg-3">{h % 3 === 0 ? h : ''}</span>
        ))}
        {data.map((row, d) => (
          <div key={d} className="contents">
            <span className="pr-1 text-right text-[11px] leading-[18px] text-fg-3">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                tabIndex={0}
                onPointerEnter={() => setHover({ d, h })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ d, h })}
                onBlur={() => setHover(null)}
                className={cn('h-[18px] rounded-[4px] outline-none transition-transform', hover?.d === d && hover?.h === h && 'ring-2 ring-fg/40')}
                style={{ background: `var(--seq-${step(v)})` }}
                aria-label={`${DAYS[d]} ${h}:00, ${v} requests`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11.5px] text-fg-3">
        <span>{hover ? `${DAYS[hover.d]} ${String(hover.h).padStart(2, '0')}:00 — ` : ''}{hover ? <b className="text-fg">{num(data[hover.d][hover.h])} requests</b> : 'Less'}</span>
        {!hover && (
          <>
            {[0, 1, 2, 3, 4, 5, 6].map((s) => (
              <span key={s} className="size-3 rounded-[3px]" style={{ background: `var(--seq-${s})` }} />
            ))}
            <span>More</span>
          </>
        )}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = 'var(--series-1)', height = 32 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => `${n > 1 ? (i / (n - 1)) * width : 0},${height - 2 - (v / max) * (height - 4)}`);
  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {width > 0 && n > 1 && (
        <svg width={width} height={height}>
          <path d={`M${pts.join('L')}L${width},${height}L0,${height}Z`} fill={color} opacity={0.12} />
          <path d={`M${pts.join('L')}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
