import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { isAdminRequest } from './admin-guard.js';
import { browseDirectory } from './browse.js';
import { deviceLabel, sanitizeDeviceId } from './device-label.js';
import { resolveStatic, SECURITY_HEADERS, sendAsset, sendIndex, pipeSharedFile } from './http-files.js';
import { listDirectory, listImages } from './listing.js';
import { scrub } from './logger.js';
import { classify, probeDuration } from './media.js';
import { LocationState, isIPv4, listIPv4 } from './network.js';
import { PathError, assertShareableDirectory, canonicalPath, decodeRelParam, isInsideRoot, realpathOf, resolveInside } from './safe-path.js';
import { Room, type RoomEvent, type TtlPreset } from './room.js';
import { imageSize, renderThumb } from './thumbs.js';
import { HARD_UPLOAD_CAP, allocateUpload, clampUploadMax, ensureInbox, removeQuiet } from './uploads.js';
import { INBOX_NAME } from './uploads.js';
import { PLAIN_HTTP_WARNING } from './warnings.js';

const pipe = promisify(pipeline);

export interface AppDeps {
  room: Room;
  location: LocationState;
  distDir: string | null;
  onRebind?: (port: number, bindHost: string) => Promise<void>;
}

interface SocketClient {
  socket: { send: (data: string) => void; close: (code?: number, reason?: string) => void; terminate?: () => void };
  admin: boolean;
  deviceId?: string;
}

function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function asTtl(value: unknown): TtlPreset | undefined {
  if (value === '15m' || value === '1h' || value === 'unlimited') return value;
  return undefined;
}

function cleanAuthor(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : fallback;
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return clean || fallback;
}

async function qrSvg(url: string | null): Promise<string | null> {
  if (!url) return null;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1b1916', light: '#fffdf8' },
  });
  if (!svg.includes('<svg') || /<script|on\w+=/i.test(svg)) return null;
  return svg;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { room, location } = deps;
  const app = Fastify({
    logger: false,
    trustProxy: false,
    exposeHeadRoutes: false,
    bodyLimit: 1_000_000,
    forceCloseConnections: true,
  });
  const clients = new Set<SocketClient>();

  const sendClients = (event: RoomEvent) => {
    if (event === 'token' || (event === 'status' && room.status !== 'open')) {
      for (const client of clients) {
        if (!client.admin) {
          try {
            client.socket.close(4001, room.status === 'open' ? 'token' : room.status);
          } catch {
            // Socket already closing.
          }
        }
      }
    }
    const guest = JSON.stringify(guestMessage(event));
    const admin = JSON.stringify(adminMessage(event));
    for (const client of clients) {
      try {
        client.socket.send(client.admin ? admin : guest);
      } catch {
        // Ignore a socket that is mid-close.
      }
    }
  };

  const unsubscribe = room.subscribe(sendClients);
  const sweep = setInterval(() => room.sweep(), 1000);
  sweep.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(sweep);
    unsubscribe();
    for (const client of clients) {
      try {
        client.socket.terminate?.();
      } catch {
        try {
          client.socket.close();
        } catch {
          // Already gone.
        }
      }
    }
    clients.clear();
  });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(key)) reply.header(key, value);
    }
    return payload;
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PathError) {
      return reply.code(err.status).send(err.debug ? { error: err.code, debug: err.debug } : { error: err.code });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code = (err as { code?: string }).code || 'bad_request';
      return reply.code(status).send({ error: code === 'FST_REQ_FILE_TOO_LARGE' ? 'too_large' : 'bad_request' });
    }
    const message = scrub((err as Error).message || 'internal', room.secrets());
    console.error(`[localcast] ${JSON.stringify({ message })}`);
    return reply.code(500).send({ error: 'internal' });
  });

  await app.register(multipart, {
    defCharset: 'utf8',
    limits: { files: 1, fileSize: HARD_UPLOAD_CAP, fields: 8, fieldSize: 8 * 1024, parts: 4 },
  });
  await app.register(websocket);

  const guardAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (isAdminRequest(req, location.port)) return true;
    reply.code(403).send({ error: 'admin_only' });
    return false;
  };

  const requireGuest = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const token = (req.params as { token?: string }).token ?? '';
    const auth = room.authorize(token);
    if (auth.ok) return true;
    reply.code(401).send({ error: auth.error });
    return false;
  };

  const relOf = (req: FastifyRequest): string => decodeRelParam(queryString((req.query as { p?: unknown }).p));

  app.get('/api/health', async () => ({
    ok: true,
    product: 'LocalCast',
    transport: 'http',
    warning: PLAIN_HTTP_WARNING,
  }));

  app.get('/api/session', async (req) => ({
    role: isAdminRequest(req, location.port) ? 'admin' : 'visitor',
  }));

  const adminState = async () => {
    const guestUrl = room.status === 'open' ? location.guestUrl(room.token) : null;
    return {
      role: 'admin' as const,
      sharing: room.status === 'open',
      status: room.status,
      roomId: room.roomId,
      root: room.rootReal,
      ttl: room.ttl,
      expiresAt: room.expiresAt,
      uploadEnabled: room.uploadEnabled,
      uploadMaxBytes: room.uploadMaxBytes,
      port: location.port,
      bindHost: location.bindHost,
      advertiseHost: location.advertiseHost,
      adminUrl: location.adminUrl(),
      guestUrl,
      qrSvg: await qrSvg(guestUrl),
      interfaces: listIPv4(),
      devices: room.deviceList(),
      warning: PLAIN_HTTP_WARNING,
      inboxName: INBOX_NAME,
      now: room.now(),
    };
  };

  app.get('/api/admin/state', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    return adminState();
  });

  app.get('/api/admin/browse', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    return browseDirectory(queryString((req.query as { path?: unknown }).path));
  });

  app.post('/api/admin/share', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    const body = (req.body ?? {}) as {
      root?: unknown;
      ttl?: unknown;
      uploadEnabled?: unknown;
      uploadMaxBytes?: unknown;
      advertiseHost?: unknown;
    };
    if (typeof body.root !== 'string') return reply.code(400).send({ error: 'bad_path' });
    const ttl = asTtl(body.ttl) ?? 'unlimited';
    if (body.ttl !== undefined && !asTtl(body.ttl)) return reply.code(400).send({ error: 'bad_ttl' });
    const rootReal = assertShareableDirectory(body.root);
    if (typeof body.advertiseHost === 'string' && body.advertiseHost) {
      if (!isIPv4(body.advertiseHost)) return reply.code(400).send({ error: 'bad_host' });
      location.advertiseHost = body.advertiseHost;
    }
    if (body.uploadMaxBytes !== undefined) room.uploadMaxBytes = clampUploadMax(Number(body.uploadMaxBytes));
    room.share({
      rootReal,
      ttl,
      uploadEnabled: body.uploadEnabled === true,
    });
    return adminState();
  });

  app.post('/api/admin/stop', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    room.stop();
    return { ok: true, status: room.status };
  });

  app.post('/api/admin/regenerate', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    if (!room.regenerate()) return reply.code(409).send({ error: 'not_sharing' });
    const guestUrl = location.guestUrl(room.token);
    return { ok: true, guestUrl, qrSvg: await qrSvg(guestUrl), expiresAt: room.expiresAt, roomId: room.roomId };
  });

  app.post('/api/admin/settings', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    const body = (req.body ?? {}) as {
      ttl?: unknown;
      uploadEnabled?: unknown;
      uploadMaxBytes?: unknown;
      advertiseHost?: unknown;
    };
    if (body.ttl !== undefined && !asTtl(body.ttl)) return reply.code(400).send({ error: 'bad_ttl' });
    if (typeof body.advertiseHost === 'string') {
      if (!isIPv4(body.advertiseHost)) return reply.code(400).send({ error: 'bad_host' });
      location.advertiseHost = body.advertiseHost;
    }
    room.configure({
      ttl: asTtl(body.ttl),
      uploadEnabled: typeof body.uploadEnabled === 'boolean' ? body.uploadEnabled : undefined,
      uploadMaxBytes: body.uploadMaxBytes === undefined ? undefined : clampUploadMax(Number(body.uploadMaxBytes)),
    });
    const guestUrl = room.status === 'open' ? location.guestUrl(room.token) : null;
    return {
      ok: true,
      ttl: room.ttl,
      expiresAt: room.expiresAt,
      uploadEnabled: room.uploadEnabled,
      uploadMaxBytes: room.uploadMaxBytes,
      advertiseHost: location.advertiseHost,
      guestUrl,
      qrSvg: await qrSvg(guestUrl),
    };
  });

  app.post('/api/admin/listen', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    const body = (req.body ?? {}) as { port?: unknown; bindHost?: unknown };
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reply.code(400).send({ error: 'bad_port' });
    const bindHost = typeof body.bindHost === 'string' ? body.bindHost : location.bindHost;
    if (bindHost !== '0.0.0.0' && bindHost !== '127.0.0.1' && !isIPv4(bindHost)) {
      return reply.code(400).send({ error: 'bad_host' });
    }
    if (!deps.onRebind) return reply.code(409).send({ error: 'restart_required' });
    if (port !== location.port || bindHost !== location.bindHost) {
      try {
        await deps.onRebind(port, bindHost);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return reply.code(409).send({ error: code === 'EADDRINUSE' ? 'port_in_use' : 'listen_failed' });
      }
    }
    return { ok: true, port: location.port, bindHost: location.bindHost, adminUrl: location.adminUrl() };
  });

  app.get('/api/admin/clipboard', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    if (room.status !== 'open') return reply.code(409).send({ error: 'not_sharing' });
    return { notes: room.notes };
  });

  app.post('/api/admin/clipboard', async (req, reply) => {
    if (!guardAdmin(req, reply)) return;
    if (room.status !== 'open') return reply.code(409).send({ error: 'not_sharing' });
    const text = (req.body as { text?: unknown } | undefined)?.text;
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'empty' });
    if (text.length > 20_000) return reply.code(413).send({ error: 'too_large' });
    const note = room.addNote(text, 'This computer');
    return { ok: true, note };
  });

  app.get('/api/admin/ws', { websocket: true }, (socket, req) => {
    if (!isAdminRequest(req, location.port)) {
      socket.close(4003, 'admin_only');
      return;
    }
    const client: SocketClient = { socket, admin: true };
    clients.add(client);
    socket.send(JSON.stringify(adminMessage('presence')));
    const finish = () => clients.delete(client);
    socket.on('close', finish);
    socket.on('error', finish);
  });

  app.get('/api/r/:token/state', async (req, reply) => {
    if (!requireGuest(req, reply)) return;
    return {
      sharing: true,
      ttl: room.ttl,
      expiresAt: room.expiresAt,
      uploadEnabled: room.uploadEnabled,
      uploadMaxBytes: room.uploadMaxBytes,
      deviceCount: room.deviceList().length,
      inboxName: INBOX_NAME,
      now: room.now(),
    };
  });

  app.get('/api/r/:token/list', async (req, reply) => {
    if (!requireGuest(req, reply) || !room.rootReal) return;
    return listDirectory(room.rootReal, relOf(req));
  });

  app.get('/api/r/:token/album', async (req, reply) => {
    if (!requireGuest(req, reply) || !room.rootReal) return;
    return listImages(room.rootReal, relOf(req));
  });

  app.get('/api/r/:token/meta', async (req, reply) => {
    if (!requireGuest(req, reply) || !room.rootReal) return;
    const rel = relOf(req);
    const real = resolveInside(room.rootReal, rel);
    const st = fs.statSync(real);
    if (!st.isFile()) return reply.code(404).send({ error: 'not_a_file' });
    const name = rel.split('/').filter(Boolean).pop() ?? path.basename(real);
    const info = classify(name, false);
    const durationSec = await probeDuration(real, name, info.kind);
    const dimensions = info.kind === 'image' ? await imageSize(real) : { width: null, height: null };
    return {
      name,
      relPath: rel,
      kind: info.kind,
      size: st.size,
      mtimeMs: Math.round(st.mtimeMs),
      playable: info.playable,
      durationSec,
      width: dimensions.width,
      height: dimensions.height,
    };
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/r/:token/raw',
    handler: async (req, reply) => {
      if (!requireGuest(req, reply) || !room.rootReal) return;
      const rel = relOf(req);
      const real = resolveInside(room.rootReal, rel);
      const name = rel.split('/').filter(Boolean).pop() ?? path.basename(real);
      const download = queryString((req.query as { download?: unknown }).download) === '1';
      pipeSharedFile(req, reply, real, name, download, (stream) => {
        room.streams.add(stream);
        const done = () => room.streams.delete(stream);
        (stream as fs.ReadStream).on?.('close', done);
      });
    },
  });

  app.get('/api/r/:token/thumb', async (req, reply) => {
    if (!requireGuest(req, reply) || !room.rootReal) return;
    const rel = relOf(req);
    const real = resolveInside(room.rootReal, rel);
    const name = rel.split('/').filter(Boolean).pop() ?? path.basename(real);
    const info = classify(name, false);
    if (info.kind !== 'image') return reply.code(404).send({ error: 'thumb_unavailable' });
    const st = fs.statSync(real);
    if (!st.isFile()) return reply.code(404).send({ error: 'not_a_file' });
    try {
      const buf = await renderThumb(real, st.mtimeMs, st.size);
      if (!buf) return reply.code(404).send({ error: 'thumb_unavailable' });
      return reply
        .type('image/webp')
        .header('Cache-Control', 'private, max-age=86400')
        .header('Content-Length', String(buf.length))
        .send(buf);
    } catch {
      return reply.code(404).send({ error: 'thumb_unavailable' });
    }
  });

  app.get('/api/r/:token/uploads', async (req, reply) => {
    if (!requireGuest(req, reply)) return;
    return { uploads: [...room.activeUploads.values()] };
  });

  app.post('/api/r/:token/upload', async (req, reply) => {
    if (!requireGuest(req, reply) || !room.rootReal) return;
    if (!room.uploadEnabled) return reply.code(403).send({ error: 'upload_disabled' });
    if (room.activeUploads.size >= 4) return reply.code(429).send({ error: 'busy' });
    if (!req.isMultipart()) return reply.code(400).send({ error: 'bad_request' });
    const data = await req.file({ limits: { fileSize: room.uploadMaxBytes } });
    if (!data) return reply.code(400).send({ error: 'no_file' });
    const inboxReal = await ensureInbox(room.rootReal);
    const allocated = await allocateUpload(inboxReal, data.filename || 'upload');
    const id = randomBytes(6).toString('hex');
    const rec = { id, name: allocated.name, received: 0, startedAt: room.now() };
    room.activeUploads.set(id, rec);
    let tooBig = false;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        rec.received += chunk.length;
        if (rec.received > room.uploadMaxBytes && !tooBig) {
          tooBig = true;
          data.file.destroy();
        }
        callback(null, chunk);
      },
    });
    const writer = allocated.fh.createWriteStream();
    try {
      await pipe(data.file, counter, writer);
    } catch (err) {
      await removeQuiet(allocated.full);
      if (tooBig || data.file.truncated) return reply.code(413).send({ error: 'too_large', limit: room.uploadMaxBytes });
      throw err;
    } finally {
      room.activeUploads.delete(id);
    }
    if (tooBig || data.file.truncated) {
      await removeQuiet(allocated.full);
      return reply.code(413).send({ error: 'too_large', limit: room.uploadMaxBytes });
    }
    const real = await realpathOf(allocated.full);
    const parentReal = await realpathOf(path.dirname(real));
    const rootNow = await realpathOf(room.rootReal);
    const inboxNow = await realpathOf(inboxReal);
    const [parentStat, inboxStat] = await Promise.all([fs.promises.stat(parentReal), fs.promises.stat(inboxNow)]);
    const sameFolder = parentStat.dev === inboxStat.dev && parentStat.ino !== 0 && parentStat.ino === inboxStat.ino;
    const parentOk = sameFolder || canonicalPath(parentReal) === canonicalPath(inboxNow) || isInsideRoot(inboxNow, parentReal);
    const rootOk = sameFolder || isInsideRoot(rootNow, parentReal) || isInsideRoot(rootNow, real);
    if (!parentOk || !rootOk) {
      const body: { error: string; debug?: Record<string, unknown> } = { error: 'forbidden' };
      if (process.env.LOCALCAST_DEBUG_PATHS === '1') {
        body.debug = { root: rootNow, inbox: inboxNow, parent: parentReal, file: real, max: room.uploadMaxBytes };
      }
      await removeQuiet(allocated.full);
      return reply.code(403).send(body);
    }
    const relPath = `${INBOX_NAME}/${allocated.name}`;
    const saved = await fs.promises.stat(real);
    room.notify('files');
    return { ok: true, name: allocated.name, size: saved.size, relPath };
  });

  app.get('/api/r/:token/clipboard', async (req, reply) => {
    if (!requireGuest(req, reply)) return;
    return { notes: room.notes };
  });

  app.post('/api/r/:token/clipboard', async (req, reply) => {
    if (!requireGuest(req, reply)) return;
    const body = (req.body ?? {}) as { text?: unknown; author?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) return reply.code(400).send({ error: 'empty' });
    if (body.text.length > 20_000) return reply.code(413).send({ error: 'too_large' });
    const note = room.addNote(body.text, cleanAuthor(body.author, 'Guest'));
    return { ok: true, note };
  });

  app.post('/api/r/:token/heartbeat', async (req, reply) => {
    if (!requireGuest(req, reply)) return;
    const body = (req.body ?? {}) as { deviceId?: unknown };
    const headerId = queryString(req.headers['x-localcast-device']);
    const id = sanitizeDeviceId(body.deviceId) ?? sanitizeDeviceId(headerId) ?? randomBytes(8).toString('hex');
    room.touchDevice(id, deviceLabel(req.headers['user-agent']));
    return { ok: true, deviceId: id, count: room.deviceList().length };
  });

  app.get('/api/r/:token/ws', { websocket: true }, (socket, req) => {
    const token = (req.params as { token: string }).token;
    const auth = room.authorize(token);
    if (!auth.ok) {
      socket.close(4001, auth.error);
      return;
    }
    const deviceId = sanitizeDeviceId(queryString((req.query as { d?: unknown }).d)) ?? randomBytes(8).toString('hex');
    const label = deviceLabel(req.headers['user-agent']);
    const client: SocketClient = { socket, admin: false, deviceId };
    clients.add(client);
    room.openSocket(deviceId, label);
    socket.send(JSON.stringify({ type: 'hello', deviceId, count: room.deviceList().length }));
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      clients.delete(client);
      room.closeSocket(deviceId);
    };
    socket.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      if (text.length > 512) return;
      const again = room.authorize(token);
      if (!again.ok) {
        socket.close(4001, again.error);
        return;
      }
      try {
        const msg = JSON.parse(text) as { type?: string };
        if (msg.type === 'ping') room.touchDevice(deviceId, label);
      } catch {
        // Ignore malformed keepalive frames.
      }
    });
    socket.on('close', finish);
    socket.on('error', finish);
  });

  app.get('/', async (_req, reply) => sendIndex(reply, deps.distDir));
  app.get('/r/:token', async (_req, reply) => sendIndex(reply, deps.distDir));
  app.get('/r/:token/:section', async (_req, reply) => sendIndex(reply, deps.distDir));

  app.setNotFoundHandler((req, reply) => {
    const pathOnly = req.url.split('?')[0] ?? '/';
    if (pathOnly.startsWith('/api') || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (deps.distDir) {
      let decoded = pathOnly;
      try {
        decoded = decodeURIComponent(pathOnly);
      } catch {
        return reply.code(400).send({ error: 'bad_path' });
      }
      const file = resolveStatic(deps.distDir, decoded);
      if (file) return sendAsset(reply, file, decoded);
    }
    if (pathOnly.startsWith('/assets/')) return reply.code(404).send({ error: 'not_found' });
    return sendIndex(reply, deps.distDir);
  });

  return app;

  function guestMessage(event: RoomEvent) {
    if (event === 'presence') return { type: 'presence', count: room.deviceList().length };
    if (event === 'files') return { type: 'files-changed' };
    if (event === 'clipboard') return { type: 'clipboard', notes: room.notes };
    return { type: 'room', status: room.status, expiresAt: room.expiresAt };
  }

  function adminMessage(event: RoomEvent) {
    if (event === 'presence') return { type: 'presence', count: room.deviceList().length, devices: room.deviceList() };
    return guestMessage(event);
  }
}
