import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { formatLog } from './logger.js';
import { LocationState, isIPv4, pickDefaultAdvertise } from './network.js';
import { assertShareableDirectory } from './safe-path.js';
import { Room, type TtlPreset } from './room.js';
import { DEFAULT_UPLOAD_MAX } from './uploads.js';

export function defaultDistDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '../web/dist');
  return fs.existsSync(path.join(candidate, 'index.html')) ? candidate : null;
}

export interface StartOptions {
  port: number;
  host: string;
  advertiseHost?: string;
  now?: () => number;
  uploadMaxBytes?: number;
  deviceGraceMs?: number;
  shareRoot?: string;
  ttl?: TtlPreset;
  uploadEnabled?: boolean;
  quiet?: boolean;
  distDir?: string | null;
}

export interface Running {
  app: FastifyInstance;
  room: Room;
  location: LocationState;
  port: number;
  baseUrl: string;
  logs: string[];
  close: () => Promise<void>;
}

export async function startLocalcast(opts: StartOptions): Promise<Running> {
  const location = new LocationState(opts.port, opts.host, opts.advertiseHost || pickDefaultAdvertise());
  if (opts.advertiseHost && !isIPv4(opts.advertiseHost) && opts.advertiseHost !== '127.0.0.1') {
    throw new Error('ADVERTISE_HOST must be an IPv4 address');
  }
  const room = new Room({
    now: opts.now ?? (() => Date.now()),
    uploadMaxBytes: opts.uploadMaxBytes ?? DEFAULT_UPLOAD_MAX,
    deviceGraceMs: opts.deviceGraceMs ?? 5000,
  });
  const distDir = opts.distDir === undefined ? defaultDistDir() : opts.distDir;
  const logs: string[] = [];
  const log = (message: string, fields?: Record<string, unknown>) => {
    const line = formatLog(message, fields, room.secrets());
    logs.push(line);
    if (!opts.quiet) console.log(line);
  };

  let current = await buildApp({
    room,
    location,
    distDir,
    onRebind: (port, bindHost) => rebind(port, bindHost),
  });

  async function rebind(port: number, bindHost: string): Promise<void> {
    const next = await buildApp({
      room,
      location,
      distDir,
      onRebind: (nextPort, nextHost) => rebind(nextPort, nextHost),
    });
    try {
      await next.listen({ port, host: bindHost });
    } catch (err) {
      await next.close();
      throw err;
    }
    const address = next.server.address();
    location.port = typeof address === 'object' && address ? address.port : port;
    location.bindHost = bindHost;
    const previous = current;
    current = next;
    setTimeout(() => {
      void previous.close().catch(() => undefined);
    }, 40);
    log('rebound', { port: location.port, bindHost });
  }

  if (opts.shareRoot) {
    const rootReal = assertShareableDirectory(opts.shareRoot);
    room.share({
      rootReal,
      ttl: opts.ttl ?? 'unlimited',
      uploadEnabled: opts.uploadEnabled === true,
    });
  }

  await current.listen({ port: opts.port, host: opts.host });
  const address = current.server.address();
  if (typeof address === 'object' && address) location.port = address.port;
  log('listening', {
    port: location.port,
    bindHost: location.bindHost,
    advertiseHost: location.advertiseHost,
    adminUrl: location.adminUrl(),
    sharing: room.status === 'open',
    roomId: room.roomId,
    ttl: room.ttl,
    uploadEnabled: room.uploadEnabled,
  });

  return {
    get app() {
      return current;
    },
    room,
    location,
    get port() {
      return location.port;
    },
    get baseUrl() {
      const host = location.bindHost === '0.0.0.0' ? '127.0.0.1' : location.bindHost;
      return `http://${host}:${location.port}`;
    },
    logs,
    async close() {
      room.dispose();
      const server = current.server;
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await current.close();
    },
  };
}
