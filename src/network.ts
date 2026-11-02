import os from 'node:os';

export interface Nic {
  name: string;
  address: string;
  internal: boolean;
}

export function listIPv4(): Nic[] {
  const nets = os.networkInterfaces();
  const out: Nic[] = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs ?? []) {
      const family = addr.family as string | number;
      if (family !== 'IPv4' && family !== 4) continue;
      out.push({ name, address: addr.address, internal: Boolean(addr.internal) });
    }
  }
  return out;
}

export function pickDefaultAdvertise(nics: Nic[] = listIPv4()): string {
  return nics.find((n) => !n.internal && isIPv4(n.address))?.address ?? '127.0.0.1';
}

export function isIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
}

export class LocationState {
  port: number;
  bindHost: string;
  advertiseHost: string;

  constructor(port: number, bindHost: string, advertiseHost: string) {
    this.port = port;
    this.bindHost = bindHost;
    this.advertiseHost = advertiseHost;
  }

  adminUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  guestUrl(token: string | null): string | null {
    if (!token) return null;
    return `http://${this.advertiseHost}:${this.port}/r/${encodeURIComponent(token)}`;
  }
}
