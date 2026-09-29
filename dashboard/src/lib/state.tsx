'use client';
// Global dashboard state: session, router state (polled while visible), and the
// live event stream (logs + finished requests) from /admin/api/events.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, onUnauthorized } from './api';
import type { AppState, LogEntry, Session, UsageRecord } from './types';

interface Ctx {
  state: AppState | null;
  session: Session | null;
  error: string | null;
  refresh: () => Promise<void>;
  logs: LogEntry[];
  live: UsageRecord[];
  /** Subscribe to every finished request (live). */
  onRequest: (fn: (r: UsageRecord) => void) => () => void;
  connected: boolean;
  setSession: (s: Session) => void;
}

const StateContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(StateContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** The router state; pages only render once it is loaded. */
export function useAppState(): AppState {
  const { state } = useApp();
  if (!state) throw new Error('state not loaded');
  return state;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState<UsageRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(r: UsageRecord) => void>());
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const s = await get<AppState>('/state');
        setState(s);
        setError(null);
        setConnected(true);
      } catch (e: any) {
        if (e?.status === 401) return;
        setConnected(false);
        setError(e?.message || 'The router is not reachable');
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  // Session first: decides between the login screen and the app.
  useEffect(() => {
    let alive = true;
    get<Session>('/session')
      .then((s) => {
        if (!alive) return;
        setSession(s);
        if (s.authenticated) refresh();
      })
      .catch((e) => alive && setError(e?.message || 'The router is not reachable'));
    const off = onUnauthorized(() => setSession((s) => (s ? { ...s, authenticated: false, needsLogin: true } : s)));
    return () => {
      alive = false;
      off();
    };
  }, [refresh]);

  // Poll while visible; refresh as soon as the tab comes back.
  useEffect(() => {
    if (!session?.authenticated) return;
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const id = window.setInterval(tick, 5000);
    const onVis = () => tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [session?.authenticated, refresh]);

  // Recent history first, so the live views are not empty after a reload.
  useEffect(() => {
    if (!session?.authenticated) return;
    get<UsageRecord[]>('/usage/recent?limit=50')
      .then((recent) => setLive((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...recent.filter((r) => !seen.has(r.id))].sort((a, b) => b.ts - a.ts).slice(0, 200);
      }))
      .catch(() => undefined);
  }, [session?.authenticated]);

  // Live events (logs + requests), reconnecting with backoff.
  useEffect(() => {
    if (!session?.authenticated) return;
    let es: EventSource | null = null;
    let retry = 1000;
    let timer: number | undefined;
    let closed = false;
    const open = () => {
      es = new EventSource('/admin/api/events');
      es.addEventListener('open', () => {
        retry = 1000;
        setConnected(true);
      });
      es.addEventListener('log', (ev) => {
        const l = JSON.parse((ev as MessageEvent).data) as LogEntry;
        setLogs((prev) => (prev.some((x) => x.id === l.id) ? prev : [...prev.slice(-299), l]));
      });
      es.addEventListener('request', (ev) => {
        const r = JSON.parse((ev as MessageEvent).data) as UsageRecord;
        setLive((prev) => (prev.some((x) => x.id === r.id) ? prev : [r, ...prev].slice(0, 200)));
        listeners.current.forEach((fn) => fn(r));
      });
      es.onerror = () => {
        es?.close();
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
      if (timer) window.clearTimeout(timer);
    };
  }, [session?.authenticated]);

  const onRequest = useCallback((fn: (r: UsageRecord) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({ state, session, error, refresh, logs, live, onRequest, connected, setSession }),
    [state, session, error, refresh, logs, live, onRequest, connected],
  );
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

/** Fetch a JSON resource and refetch on demand; keeps the previous data while reloading. */
export function useResource<T>(path: string | null, deps: unknown[] = []): { data: T | undefined; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, loading, error, reload: load };
}
