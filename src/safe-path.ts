import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const realpathNative = promisify(fs.realpath.native);

export async function realpathOf(target: string): Promise<string> {
  try {
    return await realpathNative(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err;
    return fs.promises.realpath(target);
  }
}

export class PathError extends Error {
  readonly status: number;
  readonly code: string;
  debug?: Record<string, unknown>;

  constructor(code: string, status = 400, debug?: Record<string, unknown>) {
    super(code);
    this.name = 'PathError';
    this.code = code;
    this.status = status;
    if (debug && process.env.LOCALCAST_DEBUG_PATHS === '1') this.debug = debug;
  }
}

/**
 * Turn a user-supplied relative path into safe segments.
 * Absolute paths, drive prefixes, and `..` are rejected before any filesystem call.
 */
export function lexicalSegments(input: string): string[] {
  if (typeof input !== 'string') throw new PathError('bad_path');
  if (input.length > 4096) throw new PathError('bad_path');
  if (input.includes('\0')) throw new PathError('bad_path');

  const normalized = input.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//')) throw new PathError('bad_path');
  if (/^[a-zA-Z]:/.test(normalized)) throw new PathError('bad_path');

  const out: string[] = [];
  for (const part of normalized.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new PathError('bad_path');
    if (/%2e%2e|%2f|%5c|%00/i.test(part)) throw new PathError('bad_path');
    // Alternate data streams and reserved device syntax on Windows.
    if (process.platform === 'win32' && /[:<>"|?*]/.test(part)) throw new PathError('bad_path');
    out.push(part);
  }
  return out;
}

export function encodeRelParam(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

export function decodeRelParam(param: string | undefined): string {
  if (!param) return '';
  if (param.length > 8192) throw new PathError('bad_path');
  const text = Buffer.from(param, 'base64url').toString('utf8');
  if (text.includes('\0')) throw new PathError('bad_path');
  return text;
}

/** Drop the Win32 `\\?\` prefix so a resolved path can be compared with a normal one. */
export function canonicalPath(input: string, platform = process.platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let value = input;
  if (platform === 'win32') {
    if (value.startsWith('\\\\?\\UNC\\')) value = `\\\\${value.slice(8)}`;
    else if (value.startsWith('\\\\?\\')) value = value.slice(4);
  }
  const resolved = pathApi.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isInsideRoot(rootReal: string, candidateReal: string, platform = process.platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const root = canonicalPath(rootReal, platform);
  const candidate = canonicalPath(candidateReal, platform);
  if (candidate === root) return true;
  const rel = pathApi.relative(root, candidate);
  if (!rel || rel.startsWith('..') || pathApi.isAbsolute(rel)) return false;
  const sep = platform === 'win32' ? '\\' : '/';
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate.startsWith(prefix);
}

/** One realpath implementation for every confinement check. Windows short and long paths then match. */
export function realpathSyncOf(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw err;
    return fs.realpathSync(target);
  }
}

/** Resolve a relative path and refuse anything whose real path leaves the root. */
export function resolveInside(rootReal: string, rel: string): string {
  const segments = lexicalSegments(rel);
  const candidate = path.resolve(rootReal, ...segments);
  const relCheck = path.relative(rootReal, candidate);
  if (relCheck === '' && segments.length > 0) throw new PathError('bad_path');
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new PathError('bad_path');

  let real: string;
  let rootNow: string;
  try {
    rootNow = realpathSyncOf(rootReal);
    real = realpathSyncOf(candidate);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PathError('not_found', 404);
    throw new PathError('forbidden', 403);
  }
  if (!isInsideRoot(rootNow, real)) throw new PathError('forbidden', 403);
  return real;
}

/** A new file does not exist yet, so only its parent may be realpath-checked. */
export function resolveNewFile(parentReal: string, filename: string): string {
  if (!filename || filename !== path.basename(filename)) throw new PathError('bad_path');
  if (filename.includes('\0') || filename.includes('/') || filename.includes('\\')) {
    throw new PathError('bad_path');
  }
  const full = path.resolve(parentReal, filename);
  const rel = path.relative(parentReal, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new PathError('bad_path');
  }
  return full;
}

export function assertShareableDirectory(inputPath: string): string {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new PathError('bad_path');
  if (inputPath.includes('\0')) throw new PathError('bad_path');
  let real: string;
  try {
    real = realpathSyncOf(inputPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PathError('not_found', 404);
    throw new PathError('forbidden', 403);
  }
  const parsedRoot = path.parse(real).root;
  if (path.resolve(real) === path.resolve(parsedRoot)) throw new PathError('root_too_broad', 400);
  const st = fs.statSync(real);
  if (!st.isDirectory()) throw new PathError('not_a_directory', 400);
  return real;
}
