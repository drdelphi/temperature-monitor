import { API_URL } from './config';
import { errorMessage } from './format';

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(errorMessage({ status, body, message: body }));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${p}`;
}

function redirectIfUnauthorized(status: number) {
  if (status !== 401 || typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !headers.has('Content-Type') && !(init.body instanceof FormData) && !(init.body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  });
  if (res.status === 401) {
    redirectIfUnauthorized(res.status);
    const text = await res.text().catch(() => '');
    throw new ApiError(401, text || 'Please sign in again.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
    return JSON.parse(text) as T;
  }
  return text as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return api<T>(path, { method: 'GET' });
}

export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(apiUrl(path), { method: 'GET', credentials: 'include' });
  if (res.status === 401) {
    redirectIfUnauthorized(401);
    throw new ApiError(401, 'Please sign in again.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return res.blob();
}

export function queryString(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}
