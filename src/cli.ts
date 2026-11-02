#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIPv4 } from './network.js';
import type { TtlPreset } from './room.js';
import { startLocalcast } from './serve.js';
import { DEFAULT_UPLOAD_MAX } from './uploads.js';
import { PLAIN_HTTP_WARNING } from './warnings.js';

function loadEnvFile(cwd = process.cwd()): void {
  const file = path.join(cwd, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function parseSize(input: string): number {
  const match = /^(\d+(?:\.\d+)?)([kmgt]?b)?$/i.exec(input.trim());
  if (!match) throw new Error(`Could not read a size from "${input}". Use 200MB, 10KB, or a byte count.`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const mul = unit === 'gb' || unit === 'g' ? 1024 ** 3 : unit === 'mb' || unit === 'm' ? 1024 ** 2 : unit === 'kb' || unit === 'k' ? 1024 : unit === 'tb' ? 1024 ** 4 : 1;
  return Math.floor(amount * mul);
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export interface CliOptions {
  help: boolean;
  version: boolean;
  port: number;
  bindHost: string;
  advertise: string;
  ttl: TtlPreset;
  upload: boolean;
  maxUpload: number;
  root: string;
  open: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    help: false,
    version: false,
    port: envNum('PORT', 8787),
    bindHost: process.env.BIND_HOST || '0.0.0.0',
    advertise: process.env.ADVERTISE_HOST || '',
    ttl: 'unlimited',
    upload: process.env.UPLOAD_ENABLED === 'true',
    maxUpload: envNum('MAX_UPLOAD_BYTES', DEFAULT_UPLOAD_MAX),
    root: process.env.SHARE_ROOT || '',
    open: false,
  };
  const ttl = process.env.TTL;
  if (ttl === '15m' || ttl === '1h' || ttl === 'unlimited') opts.ttl = ttl;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--port') opts.port = Number(take());
    else if (arg === '--bind') opts.bindHost = take();
    else if (arg === '--advertise') opts.advertise = take();
    else if (arg === '--ttl') {
      const value = take();
      if (value !== '15m' && value !== '1h' && value !== 'unlimited') {
        throw new Error('--ttl must be 15m, 1h, or unlimited');
      }
      opts.ttl = value;
    } else if (arg === '--upload') opts.upload = true;
    else if (arg === '--max-upload') opts.maxUpload = parseSize(take());
    else if (arg === '--open') opts.open = true;
    else if (arg === 'share') opts.root = take();
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (!opts.root && positional[0]) opts.root = positional[0];
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('--port must be 0–65535');
  if (opts.bindHost !== '0.0.0.0' && opts.bindHost !== '127.0.0.1' && !isIPv4(opts.bindHost)) {
    throw new Error('--bind must be 0.0.0.0, 127.0.0.1, or another IPv4 address');
  }
  if (opts.advertise && !isIPv4(opts.advertise)) throw new Error('--advertise must be an IPv4 address');
  return opts;
}

const HELP = `LocalCast — share a folder on your local network.

Usage
  localcast
  localcast share <folder> [--port 8787] [--ttl 15m|1h|unlimited] [--upload]
  npm start -- share <folder>

Options
  --port <n>         TCP port (default 8787, or PORT)
  --bind <ip>        0.0.0.0 (default) or a single IPv4 address
  --advertise <ip>   IPv4 address shown in the QR code
  --ttl <preset>     15m, 1h, or unlimited
  --upload           Allow uploads into the Inbox folder
  --max-upload <n>   Per-file cap, such as 200MB
  --open             Open the admin page in a browser
  --help             Show this text

The guest link and QR code are shown only on the admin page at
http://127.0.0.1:<port>/ so the session token is not written to logs.

${PLAIN_HTTP_WARNING}
`;

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  loadEnvFile();
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    console.log('localcast 0.1.0');
    return;
  }
  const running = await startLocalcast({
    port: opts.port,
    host: opts.bindHost,
    advertiseHost: opts.advertise || undefined,
    uploadMaxBytes: opts.maxUpload,
    shareRoot: opts.root || undefined,
    ttl: opts.ttl,
    uploadEnabled: opts.upload,
  });
  console.log('');
  console.log('  Admin page   ' + running.location.adminUrl());
  console.log('  Listening    ' + running.location.bindHost + ':' + running.port);
  if (running.room.status === 'open') {
    console.log('  Sharing      ' + running.room.rootReal);
    console.log('  Room         ' + running.room.roomId);
    console.log('  Expires      ' + (running.room.expiresAt ? new Date(running.room.expiresAt).toISOString() : 'unlimited'));
    console.log('  Upload       ' + (running.room.uploadEnabled ? 'on' : 'off'));
  } else {
    console.log('  Sharing      not started — choose a folder on the admin page');
  }
  console.log('');
  console.log('  The guest link and QR code stay on the admin page and are not written here.');
  console.log('  ' + PLAIN_HTTP_WARNING);
  console.log('');
  if (opts.open) openBrowser(running.location.adminUrl());

  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && path.resolve(entry) === path.resolve(self)) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'LocalCast failed to start';
    console.error(message);
    process.exit(1);
  });
}
