'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
const KEY = 'og-theme';

const Ctx = createContext<{ pref: ThemePref; resolved: 'dark' | 'light'; setPref: (p: ThemePref) => void }>({ pref: 'dark', resolved: 'dark', setPref: () => {} });

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('dark');
  const [resolved, setResolved] = useState<'dark' | 'light'>('dark');

  const apply = useCallback((p: ThemePref) => {
    const r = p === 'system' ? (systemDark() ? 'dark' : 'light') : p;
    document.documentElement.classList.toggle('dark', r === 'dark');
    setResolved(r);
  }, []);

  useEffect(() => {
    const p = readPref();
    setPrefState(p);
    apply(p);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => readPref() === 'system' && apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [apply]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch { /* private mode */ }
    setPrefState(p);
    apply(p);
  }, [apply]);

  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Inline script run before paint so the saved theme never flashes. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEY}')||'dark';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){document.documentElement.classList.add('dark')}})()`;
