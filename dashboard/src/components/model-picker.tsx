'use client';
import { Check, ChevronDown, Layers, Link2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/format';
import { useAppState } from '@/lib/state';
import { ProviderLogo } from './logos';

/** Searchable picker over every routable id (combos, aliases, provider/model). */
export function ModelPicker({ value, onChange, placeholder = 'Choose a model…', allowCustom = true, exclude = [], className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  exclude?: string[];
  className?: string;
}) {
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = state.models.filter((m) => !exclude.includes(m.id));
    const terms = s.split(/\s+/).filter(Boolean);
    const matched = terms.length ? all.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t))) : all;
    const out = matched.slice(0, 200);
    if (allowCustom && s && !all.some((m) => m.id === q.trim())) out.unshift({ id: q.trim(), owned_by: 'custom', kind: 'model' as const });
    return out;
  }, [state.models, q, exclude, allowCustom]);

  useEffect(() => setSel(0), [q]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };
  const provider = (id: string) => state.providers.find((p) => id.startsWith(`${p.id}/`));
  const current = provider(value);

  return (
    <div ref={root} className={cn('relative', className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="input flex items-center gap-2 text-left">
        {value ? (
          current ? <ProviderLogo type={current.type} name={current.name} color={current.color} size={18} rounded="rounded-[5px]" /> : <Layers className="size-4 text-fg-3" />
        ) : null}
        <span className={cn('min-w-0 flex-1 truncate', value ? 'font-mono text-[13px]' : 'text-fg-3')}>{value || placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-fg-3" />
      </button>
      {open && (
        <div className="animate-in absolute z-40 mt-1.5 w-full min-w-[300px] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-fg-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(items.length - 1, v + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) pick(items[sel].id); }
                else if (e.key === 'Escape') setOpen(false);
              }}
              placeholder={`Search ${state.models.length} models, combos and aliases…`}
              className="h-10 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-3"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {items.map((m, i) => {
              const p = provider(m.id);
              return (
                <li key={`${m.kind}:${m.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => pick(m.id)}
                    className={cn('flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px]', i === sel ? 'bg-accent-soft' : '')}
                  >
                    {p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={20} rounded="rounded-md" /> : m.kind === 'combo' ? <Layers className="size-4 text-accent" /> : <Link2 className="size-4 text-fg-3" />}
                    <span className="min-w-0 flex-1 truncate font-mono">{m.id}</span>
                    <span className="text-[11px] text-fg-3">{m.owned_by === 'custom' ? 'use as typed' : m.kind}</span>
                    {m.id === value && <Check className="size-4 text-accent" />}
                  </button>
                </li>
              );
            })}
            {!items.length && <li className="px-3 py-6 text-center text-[13px] text-fg-3">No match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
