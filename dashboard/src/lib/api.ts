// Client for the router's admin API. Same-origin only: the "x-og-admin" header
// is the router's CSRF guard (browsers can't send it cross-origin).

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Called when the API answers 401 (the dashboard password is required). */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T = any>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-og-admin': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/session')) unauthorizedListeners.forEach((fn) => fn());
    const message = (data && typeof data === 'object' && (data.error?.message || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(res.status, String(message));
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T = any>(path: string, body: unknown = {}) => api<T>('PUT', path, body);
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export const enc = encodeURIComponent;
