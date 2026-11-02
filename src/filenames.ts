import path from 'node:path';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.[^.]*)?$/i;

/** Keep only a single path segment. Never preserve directories from a client filename. */
export function sanitizeFilename(input: string): string {
  const normalized = String(input ?? '').normalize('NFC').replace(/\\/g, '/');
  let base = path.posix.basename(normalized);
  base = base.replace(/[\u0000-\u001f\u007f]/g, '');
  base = base.replace(/[<>:"/\\|?*]/g, '_');
  base = base.replace(/[. ]+$/g, '');
  base = base.trim();
  if (base === '.' || base === '..' || base === '') base = 'upload';
  if (RESERVED.test(base)) base = `_${base}`;
  if (base.length > 180) {
    const ext = path.posix.extname(base).slice(0, 20);
    const stem = base.slice(0, base.length - path.posix.extname(base).length);
    base = stem.slice(0, Math.max(1, 180 - ext.length)) + ext;
  }
  if (!base || base === '.' || base === '..') base = 'upload';
  return base;
}
