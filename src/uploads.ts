import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFilename } from './filenames.js';
import { isInsideRoot, PathError, realpathOf, resolveNewFile } from './safe-path.js';

export const INBOX_NAME = 'Inbox';
export const HARD_UPLOAD_CAP = 2 * 1024 * 1024 * 1024;
export const DEFAULT_UPLOAD_MAX = 200 * 1024 * 1024;

export function clampUploadMax(value: number): number {
  if (!Number.isFinite(value) || value < 1 || value > HARD_UPLOAD_CAP) throw new PathError('bad_limit', 400);
  return Math.floor(value);
}

export async function ensureInbox(rootReal: string): Promise<string> {
  const inbox = path.join(rootReal, INBOX_NAME);
  let listed: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    listed = await fs.lstat(inbox);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new PathError('inbox_blocked', 409);
  }
  if (listed?.isSymbolicLink()) {
    const real = await realpathOf(inbox);
    const st = await fs.stat(real);
    const rootNow = await realpathOf(rootReal);
    if (!st.isDirectory() || !isInsideRoot(rootNow, real)) {
      throw new PathError('inbox_blocked', 409, { root: rootNow, inbox: real });
    }
    return real;
  }
  if (listed && !listed.isDirectory()) throw new PathError('inbox_blocked', 409);
  if (!listed) await fs.mkdir(inbox);
  const real = await realpathOf(inbox);
  const rootNow = await realpathOf(rootReal);
  if (!isInsideRoot(rootNow, real)) throw new PathError('forbidden', 403, { root: rootNow, inbox: real });
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new PathError('inbox_blocked', 409);
  return real;
}

export async function allocateUpload(
  parentReal: string,
  originalName: string,
): Promise<{ full: string; name: string; fh: fs.FileHandle }> {
  const safe = sanitizeFilename(originalName);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const name = attempt === 0 ? safe : `${stem} (${attempt + 1})${ext}`;
    const full = resolveNewFile(parentReal, name);
    try {
      const fh = await fs.open(full, 'wx', 0o644);
      return { full, name, fh };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new PathError('name_exhausted', 409);
}

export async function removeQuiet(file: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(file, { force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM') {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      return;
    }
  }
}
