// Number, time and size formatting shared by every page.

export function num(v: number | undefined | null): string {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Math.round(n).toLocaleString();
}

export function full(v: number | undefined | null): string {
  return (Number(v) || 0).toLocaleString();
}

export function usd(v: number | undefined | null, opts: { precise?: boolean } = {}): string {
  const n = Number(v) || 0;
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs < 0.01) return `$${n.toFixed(opts.precise ? 5 : 4).replace(/0+$/, '')}`;
  if (abs < 10) return `$${n.toFixed(2)}`;
  if (abs < 1000) return `$${n.toFixed(opts.precise ? 2 : 1).replace(/\.0$/, '')}`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function money(v: number | undefined, currency = 'USD'): string {
  const n = Number(v) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function ms(v: number | undefined | null): string {
  const n = Number(v) || 0;
  if (n >= 60_000) return `${(n / 60_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}s`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

export function pct(v: number | undefined | null, digits = 1): string {
  const n = (Number(v) || 0) * 100;
  if (n === 0 || n >= 99.95) return `${Math.round(n)}%`;
  return `${n.toFixed(digits)}%`;
}

export function ago(ts: number | undefined): string {
  if (!ts) return 'never';
  const d = (Date.now() - ts) / 1000;
  if (d < 5) return 'just now';
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export function until(ts: number | undefined): string {
  if (!ts) return '';
  const d = (ts - Date.now()) / 1000;
  if (d <= 0) return 'now';
  if (d < 60) return `in ${Math.ceil(d)}s`;
  if (d < 3600) return `in ${Math.ceil(d / 60)}m`;
  if (d < 86400) return `in ${Math.round(d / 3600)}h`;
  return `in ${Math.round(d / 86400)}d`;
}

export function time(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function ctx(n: number | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${num(n)} ${n === 1 ? word : pluralWord}`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
