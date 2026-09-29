'use client';
// Small design-system primitives used by every page.
import { Check, Copy, Loader2, X } from 'lucide-react';
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/format';

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_6px_20px_-6px_var(--og-accent)] hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line-strong hover:bg-surface-3',
  ghost: 'text-fg-2 hover:text-fg hover:bg-surface-2',
  danger: 'text-bad hover:bg-bad-soft',
  soft: 'bg-accent-soft text-accent hover:brightness-110',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[10px]',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,color,filter,box-shadow] disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn('inline-flex size-8 items-center justify-center rounded-[10px] text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------- layout

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, actions, icon }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
      {icon && <span className="text-fg-3">{icon}</span>}
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-fg-3">{sub}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-fg-2">{sub}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, sub, children, actions }: { title: ReactNode; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end gap-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-3">{title}</h3>
          {sub && <p className="mt-0.5 text-[13px] text-fg-3">{sub}</p>}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------- badges

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge({ tone = 'neutral', children, className, title, icon }: { tone?: Tone; children: ReactNode; className?: string; title?: string; icon?: ReactNode }) {
  return (
    <span title={title} className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone = 'good', pulse }: { tone?: Tone; pulse?: boolean }) {
  const color = { neutral: 'bg-fg-3', accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[tone];
  return (
    <span className="relative inline-flex size-2">
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

// ------------------------------------------------------------------- inputs

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('input', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="label block">
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; sub?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-[22px] w-[38px] shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-line-strong ring-inset')}
      >
        <span className={cn('absolute top-[3px] size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
      </button>
      {(label || sub) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-fg">{label}</span>}
          {sub && <span className="mt-0.5 block text-[12.5px] text-fg-3">{sub}</span>}
        </span>
      )}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[10px] font-medium transition-all',
            size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-3 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; count?: number }> }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'relative -mb-px flex h-10 items-center gap-1.5 px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-fg-3">{t.count}</span>}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------- modal

export function Modal({ open, onClose, title, sub, children, footer, size = 'md', icon }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; icon?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
      first?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh] sm:p-6 sm:pt-[8vh]" role="dialog" aria-modal="true">
      <div className="animate-fade fixed inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={panel} className={cn('animate-in relative w-full overflow-hidden rounded-[22px] border border-line-strong bg-surface shadow-2xl', width)}>
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            {sub && <p className="mt-0.5 text-[13px] text-fg-3">{sub}</p>}
          </div>
          <IconButton label="Close" data-close onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ----------------------------------------------------------- confirmations

type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const done = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={!!req}
        onClose={() => done(false)}
        title={req?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => done(false)}>
              Cancel
            </Button>
            <Button variant={req?.danger ? 'secondary' : 'primary'} className={req?.danger ? '!text-bad' : ''} onClick={() => done(true)}>
              {req?.confirm || 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-fg-2">{req?.body}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);

// ------------------------------------------------------------------- toasts

type Toast = { id: number; tone: 'good' | 'bad' | 'info'; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm shadow-xl">
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-info')} />
            <span className="min-w-0 break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Run an async action with toasts for success and errors. */
export function useRun() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (ok) toast(ok, 'good');
        return r;
      } catch (e: any) {
        toast(e?.message || 'Something went wrong', 'bad');
        return undefined;
      }
    },
    [toast],
  );
}

// ------------------------------------------------------------------- misc

export function CopyButton({ text, label = 'Copy', className, children }: { text: string; label?: string; className?: string; children?: ReactNode }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1400);
  };
  if (children) {
    return (
      <button onClick={copy} className={className} title={label} aria-label={label}>
        {children}
        {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5 opacity-60" />}
      </button>
    );
  }
  return (
    <IconButton label={label} onClick={copy} className={className}>
      {done ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

export function Code({ children, lang, className }: { children: string; lang?: string; className?: string }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl border border-line bg-surface-2', className)}>
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="font-mono text-[11px] text-fg-3">{lang || 'text'}</span>
        <CopyButton text={children} className="!size-7" />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-3 ring-1 ring-line">{icon}</div>}
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        {sub && <p className="mx-auto mt-1 max-w-md text-sm text-fg-3">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone, loading }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; loading?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg-3">
        {icon && <span className={cn('flex size-6 items-center justify-center rounded-lg', tone ? TONES[tone] : 'bg-surface-2 text-fg-2')}>{icon}</span>}
        {label}
      </div>
      <div className={cn('mt-2.5 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums', loading && 'opacity-50')}>{value}</div>
      {sub && <div className="mt-2 truncate text-[12.5px] text-fg-3">{sub}</div>}
    </div>
  );
}

/** A horizontal meter: fill = ratio (clamped); tone by threshold. */
export function Meter({ ratio, className, tone }: { ratio: number; className?: string; tone?: 'auto' | Tone }) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  const t = tone && tone !== 'auto' ? tone : r >= 1 ? 'bad' : r >= 0.8 ? 'warn' : 'good';
  const color = { neutral: 'bg-fg-3', accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[t];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="meter" aria-valuenow={Math.round(r * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(r > 0 ? 3 : 0, r * 100)}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-fg-3', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
