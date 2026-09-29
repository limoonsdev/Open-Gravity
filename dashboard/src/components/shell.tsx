'use client';
import {
  Activity, BarChart3, Blocks, Boxes, ChevronsLeft, ChevronsRight, Cog, Command, Copy, Gauge, Gift, KeyRound, LayoutDashboard, Layers, LogIn, Menu, Minus,
  MessageSquare, Moon, Monitor, PiggyBank, RefreshCw, Route, Search, Server, Square, Sun, X, Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { post } from '@/lib/api';
import { desktop, isDesktop, type DesktopInfo } from '@/lib/desktop';
import { cn } from '@/lib/format';
import { useApp } from '@/lib/state';
import { AppLogo, ProviderLogo } from './logos';
import { useTheme } from './theme';
import { Button, CopyButton, Dot, Input, Kbd } from './ui';

// --------------------------------------------------------------- navigation

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  count?: (s: NonNullable<ReturnType<typeof useApp>['state']>) => number | undefined;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: '', items: [{ href: '/', label: 'Overview', icon: LayoutDashboard }] },
  {
    group: 'Route',
    items: [
      { href: '/providers/', label: 'Providers', icon: Server, count: (s) => s.providers.length },
      { href: '/free/', label: 'Free APIs', icon: Gift },
      { href: '/combos/', label: 'Combos', icon: Layers, count: (s) => s.combos.length },
      { href: '/routing/', label: 'Models & routing', icon: Route },
    ],
  },
  {
    group: 'Use',
    items: [
      { href: '/playground/', label: 'Playground', icon: MessageSquare },
      { href: '/integrations/', label: 'Integrations', icon: Blocks },
      { href: '/keys/', label: 'API keys', icon: KeyRound, count: (s) => s.apiKeys.length || undefined },
    ],
  },
  {
    group: 'Observe',
    items: [
      { href: '/requests/', label: 'Requests', icon: Activity },
      { href: '/analytics/', label: 'Analytics', icon: BarChart3 },
      { href: '/quotas/', label: 'Quotas & limits', icon: Gauge },
      { href: '/tokens/', label: 'Token saver', icon: PiggyBank },
    ],
  },
  { group: 'System', items: [{ href: '/settings/', label: 'Settings', icon: Cog }] },
];

const ALL_NAV = NAV.flatMap((g) => g.items);

function isActive(path: string, href: string) {
  const p = path.endsWith('/') ? path : `${path}/`;
  return href === '/' ? p === '/' : p.startsWith(href);
}

// ------------------------------------------------------------------ desktop

function useDesktop(): DesktopInfo | null {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    desktop.info().then(setInfo).catch(() => undefined);
  }, []);
  return info;
}

function WindowControls() {
  return (
    <div className="flex items-center" data-no-drag>
      <button aria-label="Minimize" onClick={() => desktop.minimize()} className="flex h-9 w-11 items-center justify-center text-fg-3 hover:bg-surface-2 hover:text-fg">
        <Minus className="size-4" />
      </button>
      <button aria-label="Maximize" onClick={() => desktop.toggleMaximize()} className="flex h-9 w-11 items-center justify-center text-fg-3 hover:bg-surface-2 hover:text-fg">
        <Square className="size-3.5" />
      </button>
      <button aria-label="Close" onClick={() => desktop.close()} className="flex h-9 w-11 items-center justify-center text-fg-3 hover:bg-[#e11d48] hover:text-white">
        <X className="size-4" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar

function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose, macInset }: {
  collapsed: boolean; onCollapse: (v: boolean) => void; mobileOpen: boolean; onMobileClose: () => void; macInset: boolean;
}) {
  const path = usePathname();
  const { state, connected } = useApp();
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onMobileClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface/80 backdrop-blur-xl transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          collapsed ? 'w-[68px]' : 'w-[248px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {macInset && <div className="h-7 shrink-0" data-tauri-drag-region />}
        <div className={cn('flex h-16 shrink-0 items-center gap-3', collapsed ? 'justify-center px-2' : 'px-5')} data-tauri-drag-region>
          <Link href="/" className="flex items-center gap-3" onClick={onMobileClose}>
            <AppLogo size={34} className="drop-shadow-[0_6px_18px_rgba(139,92,246,0.45)]" />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block text-[15px] font-semibold tracking-tight">Open Gravity</span>
                <span className="block text-[11.5px] text-fg-3">Universal AI router</span>
              </span>
            )}
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {NAV.map((g) => (
            <div key={g.group || 'main'} className="mt-3 first:mt-1">
              {g.group && !collapsed && <p className="px-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-fg-3 uppercase">{g.group}</p>}
              {g.group && collapsed && <div className="mx-3 mb-2 border-t border-line" />}
              {g.items.map((it) => {
                const active = isActive(path, it.href);
                const count = state && it.count ? it.count(state) : undefined;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={onMobileClose}
                    title={collapsed ? it.label : undefined}
                    className={cn(
                      'group relative mb-0.5 flex h-9 items-center gap-3 rounded-xl text-[13.5px] font-medium transition-colors',
                      collapsed ? 'justify-center' : 'px-3',
                      active ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />}
                    <it.icon className={cn('size-[18px] shrink-0', active ? 'text-accent' : 'text-fg-3 group-hover:text-fg-2')} />
                    {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                    {!collapsed && count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-fg-3 tabular-nums">{count}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className={cn('border-t border-line py-3', collapsed ? 'px-2' : 'px-4')}>
          <div className={cn('flex items-center gap-2 text-[12px]', collapsed && 'justify-center')} title={connected ? 'Router online' : 'Reconnecting…'}>
            <Dot tone={connected ? 'good' : 'warn'} pulse={connected} />
            {!collapsed && <span className="text-fg-2">{connected ? 'Router online' : 'Reconnecting…'}</span>}
            {!collapsed && state && <span className="ml-auto font-mono text-[11px] text-fg-3">v{state.version}</span>}
          </div>
          <button
            onClick={() => onCollapse(!collapsed)}
            className={cn('mt-2 hidden h-8 w-full items-center gap-2 rounded-lg text-[12px] text-fg-3 hover:bg-surface-2 hover:text-fg lg:flex', collapsed ? 'justify-center' : 'px-2')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        </div>
      </aside>
    </>
  );
}

// ----------------------------------------------------------------- palette

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp();
  const router = useRouter();
  const { setPref, resolved } = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      window.setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!state) return [];
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };
    return [
      ...ALL_NAV.map((n) => ({ id: `nav:${n.href}`, label: n.label, hint: 'Page', icon: <n.icon className="size-4" />, run: go(n.href) })),
      { id: 'act:add', label: 'Add a provider', hint: 'Action', icon: <Server className="size-4" />, run: go('/providers/?add=1') },
      { id: 'act:combo', label: 'New combo', hint: 'Action', icon: <Layers className="size-4" />, run: go('/combos/?new=1') },
      { id: 'act:free', label: 'Build the free combo', hint: 'Action', icon: <Gift className="size-4" />, run: go('/free/') },
      { id: 'act:welcome', label: 'Get started guide', hint: 'Action', icon: <Zap className="size-4" />, run: go('/welcome/') },
      {
        id: 'act:theme', label: `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`, hint: 'Action', icon: resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => {
          setPref(resolved === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      {
        id: 'act:copy', label: 'Copy the API base URL', hint: `${state.baseUrl}/v1`, icon: <Copy className="size-4" />,
        run: () => {
          navigator.clipboard?.writeText(`${state.baseUrl}/v1`);
          onClose();
        },
      },
      ...state.providers.map((p) => ({
        id: `prov:${p.id}`, label: p.name, hint: `Provider · ${p.models.length} models`, icon: <ProviderLogo type={p.type} name={p.name} color={p.color} size={20} rounded="rounded-md" />,
        run: go(`/providers/?edit=${encodeURIComponent(p.id)}`),
      })),
      ...state.combos.map((c) => ({ id: `combo:${c.id}`, label: c.id, hint: `Combo · ${c.targets.length} targets`, icon: <Layers className="size-4" />, run: go(`/combos/?edit=${encodeURIComponent(c.id)}`) })),
      ...state.models.filter((m) => m.kind === 'model').slice(0, 400).map((m) => ({
        id: `model:${m.id}`, label: m.id, hint: 'Try in playground', icon: <Boxes className="size-4" />, run: go(`/playground/?model=${encodeURIComponent(m.id)}`),
      })),
    ];
  }, [state, router, onClose, setPref, resolved]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.filter((i) => !i.id.startsWith('model:')).slice(0, 40);
    const terms = s.split(/\s+/);
    return items.filter((i) => terms.every((t) => `${i.label} ${i.hint || ''}`.toLowerCase().includes(t))).slice(0, 50);
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="animate-fade fixed inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-in relative w-full max-w-xl overflow-hidden rounded-[20px] border border-line-strong bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-fg-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((v) => Math.min(filtered.length - 1, v + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === 'Enter') filtered[sel]?.run();
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Search pages, providers, combos, models, actions…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.map((i, idx) => (
            <li key={i.id}>
              <button
                onMouseEnter={() => setSel(idx)}
                onClick={i.run}
                className={cn('flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm', idx === sel ? 'bg-accent-soft text-fg' : 'text-fg-2')}
              >
                <span className="text-fg-3">{i.icon}</span>
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {i.hint && <span className="max-w-[45%] truncate text-[12px] text-fg-3">{i.hint}</span>}
              </button>
            </li>
          ))}
          {!filtered.length && <li className="px-3 py-8 text-center text-sm text-fg-3">No results</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- topbar

function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const next = pref === 'dark' ? 'light' : pref === 'light' ? 'system' : 'dark';
  const Icon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor;
  return (
    <button onClick={() => setPref(next)} title={`Theme: ${pref} (click for ${next})`} aria-label="Change theme" className="flex size-9 items-center justify-center rounded-xl text-fg-3 hover:bg-surface-2 hover:text-fg" data-no-drag>
      <Icon className="size-[18px]" />
    </button>
  );
}

function Topbar({ onMenu, onPalette, desktopInfo }: { onMenu: () => void; onPalette: () => void; desktopInfo: DesktopInfo | null }) {
  const { state } = useApp();
  const windows = desktopInfo?.platform === 'windows';
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/75 pl-4 backdrop-blur-xl lg:pl-6" data-tauri-drag-region>
      <button onClick={onMenu} className="flex size-9 items-center justify-center rounded-xl text-fg-2 hover:bg-surface-2 lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <button
        onClick={onPalette}
        className="flex h-9 w-full max-w-[380px] items-center gap-2.5 rounded-xl border border-line bg-surface-2/70 px-3 text-[13px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2"
        data-no-drag
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>{typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-1.5 pr-2" data-no-drag>
        {state && (
          <CopyButton text={`${state.baseUrl}/v1`} label="Copy the OpenAI-compatible base URL" className="hidden h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 font-mono text-[12.5px] text-fg-2 hover:border-line-strong md:flex">
            <span>{state.baseUrl.replace(/^https?:\/\//, '')}/v1</span>
          </CopyButton>
        )}
        <ThemeToggle />
      </div>
      {windows && (
        <div className="self-stretch border-l border-line">
          <WindowControls />
        </div>
      )}
    </header>
  );
}

// -------------------------------------------------------------- gate screens

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="og-glow flex min-h-dvh items-center justify-center p-6" data-tauri-drag-region>
      <div className="animate-in w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

function Login() {
  const { setSession } = useApp();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post('/login', { password: pw });
      const s = await fetch('/admin/api/session', { credentials: 'same-origin' }).then((r) => r.json());
      setSession(s);
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message || 'Wrong password');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <AppLogo size={64} className="mx-auto drop-shadow-[0_12px_40px_rgba(139,92,246,0.5)]" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Open Gravity</h1>
      <p className="mt-1 text-sm text-fg-3">Enter the dashboard password.</p>
      <form onSubmit={submit} className="mt-6 space-y-3 text-left">
        <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
        {err && <p className="text-sm text-bad">{err}</p>}
        <Button variant="primary" size="lg" className="w-full" loading={busy} icon={<LogIn className="size-4" />}>
          Sign in
        </Button>
      </form>
    </Centered>
  );
}

function Unreachable({ message, blocked }: { message: string; blocked?: boolean }) {
  return (
    <Centered>
      <AppLogo size={56} className="mx-auto opacity-80" />
      <h1 className="mt-5 text-xl font-semibold">{blocked ? 'Dashboard locked' : 'Router not reachable'}</h1>
      <p className="mt-2 text-sm text-fg-3">{message}</p>
      {!blocked && (
        <Button className="mt-6" onClick={() => window.location.reload()} icon={<RefreshCw className="size-4" />}>
          Retry
        </Button>
      )}
    </Centered>
  );
}

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" data-tauri-drag-region>
      <div className="relative size-16">
        <AppLogo size={64} />
        <span className="absolute -inset-3 animate-[og-orbit_1.6s_linear_infinite] rounded-full border-2 border-transparent border-t-accent/70" />
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- shell

export function Shell({ children }: { children: ReactNode }) {
  const { state, session, error } = useApp();
  const path = usePathname();
  const router = useRouter();
  const desktopInfo = useDesktop();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('og-sidebar') === 'collapsed');
    } catch { /* ignore */ }
  }, []);
  const collapse = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem('og-sidebar', v ? 'collapsed' : 'open');
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // First run: go to the Get started guide.
  const welcome = path.startsWith('/welcome');
  useEffect(() => {
    if (state && !state.settings.onboarded && !state.providers.length && !welcome && path === '/') router.replace('/welcome/');
  }, [state, welcome, path, router]);

  if (error && !state && !session) return <Unreachable message={error} />;
  if (session && !session.authenticated) {
    if (session.needsLogin) return <Login />;
    return <Unreachable blocked message={session.reason || 'Access denied'} />;
  }
  if (!state) return error ? <Unreachable message={error} /> : <Loading />;

  if (welcome) {
    return (
      <>
        {desktopInfo?.platform === 'windows' && (
          <div className="fixed inset-x-0 top-0 z-50 flex h-9 justify-end" data-tauri-drag-region>
            <WindowControls />
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar collapsed={collapsed} onCollapse={collapse} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} macInset={desktopInfo?.platform === 'macos'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} onPalette={() => setPalette(true)} desktopInfo={desktopInfo} />
        <main className="og-glow flex-1">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

