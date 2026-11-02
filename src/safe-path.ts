import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'PathError';
    this.code = code;
    this.status = status;
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

export function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const root = path.resolve(rootReal);
  const candidate = path.resolve(candidateReal);
  if (process.platform === 'win32') {
    const r = root.toLowerCase();
    const c = candidate.toLowerCase();
    if (c === r) return true;
    const prefix = r.endsWith('\\') ? r : `${r}\\`;
    return c.startsWith(prefix);
  }
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/** Resolve a relative path and refuse anything whose real path leaves the root. */
export function resolveInside(rootReal: string, rel: string): string {
  const segments = lexicalSegments(rel);
  const candidate = path.resolve(rootReal, ...segments);
  const relCheck = path.relative(rootReal, candidate);
  if (relCheck === '' && segments.length > 0) throw new PathError('bad_path');
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new PathError('bad_path');

  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PathError('not_found', 404);
    throw new PathError('forbidden', 403);
  }
  if (!isInsideRoot(rootReal, real)) throw new PathError('forbidden', 403);
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
    real = fs.realpathSync(inputPath);
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
