// Integration with the Open Gravity desktop app (Tauri). When the dashboard runs
// inside the desktop window, window.__TAURI__ is injected (withGlobalTauri).

export interface DesktopInfo {
  version: string;
  platform: 'windows' | 'macos' | 'linux' | string;
  phase: 'starting' | 'ready' | 'error';
  message: string;
  url?: string;
  managed: boolean;
  closeToTray: boolean;
  autostart: boolean;
  embeddedCore: boolean;
}

function tauri(): any {
  return typeof window !== 'undefined' ? (window as any).__TAURI__ : undefined;
}

export function isDesktop(): boolean {
  return !!tauri()?.core?.invoke;
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t?.core?.invoke) throw new Error('Not running in the desktop app');
  return t.core.invoke(cmd, args);
}

export function desktopWindow(): any {
  return tauri()?.window?.getCurrentWindow?.();
}

export const desktop = {
  info: () => invoke<DesktopInfo>('desktop_info'),
  openExternal: (url: string) => invoke('open_external', { url }),
  restartCore: () => invoke('restart_core'),
  setAutostart: (enabled: boolean) => invoke<boolean>('set_autostart', { enabled }),
  setCloseToTray: (enabled: boolean) => invoke('set_close_to_tray', { enabled }),
  quit: () => invoke('quit_app'),
  logs: () => invoke<string>('core_logs'),
  minimize: () => desktopWindow()?.minimize(),
  toggleMaximize: () => desktopWindow()?.toggleMaximize(),
  close: () => desktopWindow()?.close(),
};

/** Open a link: in the desktop app it goes to the system browser. */
export function openLink(url: string) {
  if (isDesktop()) desktop.openExternal(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  else window.open(url, '_blank', 'noopener,noreferrer');
}
