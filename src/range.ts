export type ByteRange =
  | { kind: 'none' }
  | { kind: 'ignore' }
  | { kind: 'unsatisfiable' }
  | { kind: 'partial'; start: number; end: number };

function isSafeInt(raw: string): boolean {
  if (!/^\d+$/.test(raw) || raw.length > 15) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value);
}

/** Single `bytes=` range. Multiple ranges are ignored so the caller can send the whole file. */
export function parseSingleRange(header: string | undefined, size: number): ByteRange {
  if (!header) return { kind: 'none' };
  const trimmed = header.trim().toLowerCase();
  if (!trimmed.startsWith('bytes=')) return { kind: 'ignore' };
  const spec = header.trim().slice(6).trim();
  if (!spec || spec.includes(',')) return { kind: 'ignore' };
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return { kind: 'ignore' };
  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return { kind: 'ignore' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (startRaw === '') {
    if (!isSafeInt(endRaw)) return { kind: 'unsatisfiable' };
    const suffix = Number(endRaw);
    if (suffix <= 0) return { kind: 'unsatisfiable' };
    const len = Math.min(suffix, size);
    return { kind: 'partial', start: size - len, end: size - 1 };
  }

  if (!isSafeInt(startRaw) || (endRaw !== '' && !isSafeInt(endRaw))) return { kind: 'unsatisfiable' };
  const start = Number(startRaw);
  const end = endRaw === '' ? size - 1 : Number(endRaw);
  if (start < 0 || start >= size || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
}
