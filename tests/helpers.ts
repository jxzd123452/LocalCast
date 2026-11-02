import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { startLocalcast, type Running, type StartOptions } from '../src/serve.js';

export function encodeRel(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

export async function tempDir(prefix = 'localcast-'): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, body);
  }
}

export async function removeDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

export interface BootOptions {
  ttl?: StartOptions['ttl'];
  upload?: boolean;
  maxUpload?: number;
  now?: () => number;
  grace?: number;
  share?: boolean;
}

export async function boot(t: TestContext, root: string | undefined, opts: BootOptions = {}): Promise<Running> {
  const running = await startLocalcast({
    port: 0,
    host: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    quiet: true,
    distDir: null,
    shareRoot: opts.share === false ? undefined : root,
    ttl: opts.ttl,
    uploadEnabled: opts.upload === true,
    uploadMaxBytes: opts.maxUpload,
    now: opts.now,
    deviceGraceMs: opts.grace,
  });
  t.after(async () => {
    await running.close();
    if (root) await removeDir(root);
  });
  return running;
}

export function guestPath(running: Running, suffix: string): string {
  if (!running.room.token) throw new Error('room has no token');
  return `${running.baseUrl}/api/r/${encodeURIComponent(running.room.token)}${suffix}`;
}

export function httpCall(
  url: string,
  opts: { method?: string; headers?: http.OutgoingHttpHeaders; body?: Buffer | string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: opts.method ?? 'GET',
        agent: false,
        headers: { connection: 'close', ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.end(opts.body);
    else req.end();
  });
}

export async function readJson(url: string, opts?: Parameters<typeof httpCall>[1]): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  const res = await httpCall(url, opts);
  let json: unknown = null;
  try {
    json = JSON.parse(res.body.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

export function rawUrl(running: Running, rel = '', download = false): string {
  const params = new URLSearchParams();
  if (rel) params.set('p', encodeRel(rel));
  if (download) params.set('download', '1');
  const q = params.toString();
  return guestPath(running, `/raw${q ? `?${q}` : ''}`);
}

export function listUrl(running: Running, rel = ''): string {
  return guestPath(running, rel ? `/list?p=${encodeURIComponent(encodeRel(rel))}` : '/list');
}

export async function postJson(url: string, body: unknown, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; json: any }> {
  const payload = JSON.stringify(body);
  const res = await readJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    body: payload,
  });
  return { status: res.status, json: res.json };
}

export function multipartUpload(
  url: string,
  filename: string,
  content: Buffer,
  opts: { chunk?: number; delayMs?: number } = {},
): Promise<{ status: number; json: any }> {
  const boundary = '----localcasttest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const chunk = opts.chunk ?? content.length;
  const delayMs = opts.delayMs ?? 0;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        agent: false,
        headers: { connection: 'close', 'content-type': `multipart/form-data; boundary=${boundary}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (part) => chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.write(head);
    let offset = 0;
    const step = () => {
      if (offset >= content.length) {
        req.end(tail);
        return;
      }
      const end = Math.min(content.length, offset + chunk);
      req.write(content.subarray(offset, end));
      offset = end;
      if (delayMs > 0) setTimeout(step, delayMs);
      else step();
    };
    step();
  });
}
