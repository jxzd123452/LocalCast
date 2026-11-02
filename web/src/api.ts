import type { Entry } from './types';

export interface AdminState {
  role: 'admin';
  sharing: boolean;
  status: 'idle' | 'open' | 'closed' | 'expired';
  roomId: string | null;
  root: string | null;
  ttl: '15m' | '1h' | 'unlimited';
  expiresAt: number | null;
  uploadEnabled: boolean;
  uploadMaxBytes: number;
  port: number;
  bindHost: string;
  advertiseHost: string;
  adminUrl: string;
  guestUrl: string | null;
  qrSvg: string | null;
  interfaces: { name: string; address: string; internal: boolean }[];
  devices: { id: string; label: string; connectedAt: number }[];
  warning: string;
  inboxName: string;
  now: number;
}

export interface GuestState {
  sharing: boolean;
  ttl: '15m' | '1h' | 'unlimited';
  expiresAt: number | null;
  uploadEnabled: boolean;
  uploadMaxBytes: number;
  deviceCount: number;
  inboxName: string;
  now: number;
}

export interface Note {
  id: string;
  text: string;
  createdAt: number;
  author: string;
}

export interface Meta {
  name: string;
  relPath: string;
  kind: Entry['kind'];
  size: number;
  mtimeMs: number;
  playable: Entry['playable'];
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export function encodeRel(rel: string): string {
  const bytes = new TextEncoder().encode(rel);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function guestApi(token: string, kind: string, rel = '', extra = ''): string {
  const params = new URLSearchParams();
  if (rel) params.set('p', encodeRel(rel));
  if (extra) {
    const more = new URLSearchParams(extra);
    more.forEach((value, key) => params.set(key, value));
  }
  const query = params.toString();
  return `/api/r/${encodeURIComponent(token)}/${kind}${query ? `?${query}` : ''}`;
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || 'bad_request';
  } catch {
    return 'bad_request';
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

export function uploadFile(
  token: string,
  file: File,
  onProgress: (ratio: number) => void,
): Promise<{ name: string; size: number; relPath: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/r/${encodeURIComponent(token)}/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      let body: { error?: string; name?: string; size?: number; relPath?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.name && body.relPath) {
        onProgress(1);
        resolve({ name: body.name, size: body.size ?? file.size, relPath: body.relPath });
        return;
      }
      reject(new Error(body.error || 'upload_failed'));
    };
    xhr.onerror = () => reject(new Error('network'));
    const data = new FormData();
    data.append('file', file, file.name);
    xhr.send(data);
  });
}

export function deviceId(): string {
  const key = 'localcast.device';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID().replaceAll('-', '');
  sessionStorage.setItem(key, created);
  return created;
}

export function wsUrl(path: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${path}`;
}
