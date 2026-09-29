'use client';
import { useEffect, useRef, useState } from 'react';
import { get } from './api';
import { useApp } from './state';
import type { Analytics, Range } from './types';

/** Analytics for a range, refreshed shortly after each new request (debounced). */
export function useAnalytics(range: Range) {
  const { onRequest } = useApp();
  const [data, setData] = useState<Analytics | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      get<Analytics>(`/analytics?range=${range}`)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    };
    load();
    const off = onRequest(() => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(load, 1500);
    });
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => {
      alive = false;
      off();
      window.clearInterval(id);
      window.clearTimeout(timer.current);
    };
  }, [range, onRequest]);

  return { data, loading, error };
}

/** Persisted UI preference (localStorage), falling back to the default. */
export function usePref<T extends string>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(def);
  useEffect(() => {
    try {
      const s = localStorage.getItem(`og-${key}`);
      if (s) setV(s as T);
    } catch { /* ignore */ }
  }, [key]);
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(`og-${key}`, nv);
    } catch { /* ignore */ }
  };
  return [v, set];
}

/** Read a query-string parameter (static export: no server params). */
export function useQueryParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setV(new URLSearchParams(window.location.search).get(name));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [name]);
  return v;
}

export function clearQuery() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState(null, '', url.toString());
}
