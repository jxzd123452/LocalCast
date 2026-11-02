import { randomBytes, timingSafeEqual } from 'node:crypto';

export type TtlPreset = '15m' | '1h' | 'unlimited';
export type RoomStatus = 'idle' | 'open' | 'closed' | 'expired';
export type GuestError = 'invalid_token' | 'closed' | 'expired' | 'not_sharing';
export type RoomEvent = 'presence' | 'files' | 'clipboard' | 'status' | 'token';

export interface DeviceView {
  id: string;
  label: string;
  connectedAt: number;
}

export interface Note {
  id: string;
  text: string;
  createdAt: number;
  author: string;
}

export interface ActiveUpload {
  id: string;
  name: string;
  received: number;
  startedAt: number;
}

interface Device extends DeviceView {
  lastSeen: number;
  sockets: number;
}

const TTL_MS: Record<Exclude<TtlPreset, 'unlimited'>, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

export function tokenMatches(expected: string | null, provided: string): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function ttlDuration(ttl: TtlPreset): number | null {
  return ttl === 'unlimited' ? null : TTL_MS[ttl];
}

export class Room {
  roomId: string | null = null;
  token: string | null = null;
  rootReal: string | null = null;
  status: RoomStatus = 'idle';
  ttl: TtlPreset = 'unlimited';
  expiresAt: number | null = null;
  uploadEnabled = false;
  uploadMaxBytes: number;
  startedAt: number | null = null;
  notes: Note[] = [];
  readonly activeUploads = new Map<string, ActiveUpload>();
  readonly streams = new Set<{ destroy: () => void }>();

  private devices = new Map<string, Device>();
  private listeners = new Set<(event: RoomEvent) => void>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: {
      now: () => number;
      uploadMaxBytes: number;
      deviceGraceMs: number;
    },
  ) {
    this.uploadMaxBytes = opts.uploadMaxBytes;
  }

  get deviceGraceMs(): number {
    return this.opts.deviceGraceMs;
  }

  now(): number {
    return this.opts.now();
  }

  subscribe(listener: (event: RoomEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event: RoomEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  secrets(): string[] {
    return this.token ? [this.token] : [];
  }

  share(input: { rootReal: string; ttl: TtlPreset; uploadEnabled: boolean; uploadMaxBytes?: number }): void {
    this.clearExpiry();
    this.destroyStreams();
    this.roomId = randomBytes(4).toString('hex');
    this.token = randomBytes(32).toString('base64url');
    this.rootReal = input.rootReal;
    this.ttl = input.ttl;
    this.uploadEnabled = input.uploadEnabled;
    if (input.uploadMaxBytes) this.uploadMaxBytes = input.uploadMaxBytes;
    this.startedAt = this.opts.now();
    this.status = 'open';
    this.expiresAt = ttlDuration(input.ttl) == null ? null : this.startedAt + (ttlDuration(input.ttl) as number);
    this.notes = [];
    this.devices.clear();
    this.activeUploads.clear();
    this.scheduleExpiry();
    this.notify('token');
    this.notify('status');
    this.notify('presence');
    this.notify('clipboard');
  }

  configure(input: { ttl?: TtlPreset; uploadEnabled?: boolean; uploadMaxBytes?: number }): void {
    if (typeof input.uploadEnabled === 'boolean') this.uploadEnabled = input.uploadEnabled;
    if (input.uploadMaxBytes) this.uploadMaxBytes = input.uploadMaxBytes;
    if (input.ttl) {
      this.ttl = input.ttl;
      if (this.status === 'open') {
        const duration = ttlDuration(input.ttl);
        this.expiresAt = duration == null ? null : this.opts.now() + duration;
        this.scheduleExpiry();
      }
    }
    this.notify('status');
  }

  regenerate(): boolean {
    if (this.status !== 'open' || !this.rootReal) return false;
    this.token = randomBytes(32).toString('base64url');
    const duration = ttlDuration(this.ttl);
    this.expiresAt = duration == null ? null : this.opts.now() + duration;
    this.scheduleExpiry();
    this.notify('token');
    this.notify('status');
    return true;
  }

  stop(): void {
    if (this.status === 'idle') return;
    this.status = 'closed';
    this.finish();
  }

  expire(): void {
    if (this.status !== 'open') return;
    this.status = 'expired';
    this.finish();
  }

  dispose(): void {
    this.clearExpiry();
    this.destroyStreams();
  }

  authorize(token: string): { ok: true } | { ok: false; error: GuestError } {
    this.refreshExpiry();
    if (!this.token || !tokenMatches(this.token, token)) {
      return { ok: false, error: this.status === 'idle' ? 'not_sharing' : 'invalid_token' };
    }
    if (this.status === 'expired') return { ok: false, error: 'expired' };
    if (this.status !== 'open' || !this.rootReal) return { ok: false, error: 'closed' };
    return { ok: true };
  }

  touchDevice(id: string, label: string): void {
    const now = this.opts.now();
    const existing = this.devices.get(id);
    if (existing) {
      existing.lastSeen = now;
      if (label) existing.label = label;
      return;
    }
    if (this.devices.size >= 200) return;
    this.devices.set(id, {
      id,
      label: label || 'Device · Browser',
      connectedAt: now,
      lastSeen: now,
      sockets: 0,
    });
    this.notify('presence');
  }

  openSocket(id: string, label: string): void {
    this.touchDevice(id, label);
    const device = this.devices.get(id);
    if (!device) return;
    device.sockets += 1;
    device.lastSeen = this.opts.now();
  }

  closeSocket(id: string): void {
    const device = this.devices.get(id);
    if (!device) return;
    device.sockets = Math.max(0, device.sockets - 1);
    device.lastSeen = this.opts.now();
  }

  sweep(): void {
    const now = this.opts.now();
    let changed = false;
    for (const [id, device] of this.devices) {
      if (device.sockets > 0) continue;
      if (now - device.lastSeen > this.opts.deviceGraceMs) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify('presence');
  }

  deviceList(): DeviceView[] {
    return [...this.devices.values()]
      .map(({ id, label, connectedAt }) => ({ id, label, connectedAt }))
      .sort((a, b) => a.connectedAt - b.connectedAt);
  }

  addNote(text: string, author: string): Note {
    const note: Note = {
      id: randomBytes(8).toString('hex'),
      text,
      createdAt: this.opts.now(),
      author,
    };
    this.notes.unshift(note);
    if (this.notes.length > 50) this.notes.length = 50;
    this.notify('clipboard');
    return note;
  }

  private finish(): void {
    this.clearExpiry();
    this.destroyStreams();
    this.activeUploads.clear();
    this.devices.clear();
    this.notes = [];
    this.notify('status');
    this.notify('presence');
    this.notify('clipboard');
  }

  private destroyStreams(): void {
    for (const stream of this.streams) {
      try {
        stream.destroy();
      } catch {
        // The response may already be gone.
      }
    }
    this.streams.clear();
  }

  private refreshExpiry(): void {
    if (this.status === 'open' && this.expiresAt != null && this.opts.now() >= this.expiresAt) this.expire();
  }

  private scheduleExpiry(): void {
    this.clearExpiry();
    if (this.expiresAt == null || this.status !== 'open') return;
    const delay = Math.max(0, this.expiresAt - Date.now());
    this.expiryTimer = setTimeout(() => {
      if (this.expiresAt != null && this.opts.now() >= this.expiresAt) this.expire();
    }, delay);
    this.expiryTimer.unref?.();
  }

  private clearExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}
