import fs from 'node:fs';
import { classify, type FileKind, type Playable } from './media.js';
import { PathError, resolveInside } from './safe-path.js';

export interface Entry {
  name: string;
  relPath: string;
  kind: FileKind;
  size: number | null;
  mtimeMs: number;
  playable: Playable;
}

const MAX_LIST = 5000;
const MAX_ALBUM = 2000;

function describe(rootReal: string, parentRel: string, name: string): Entry | null {
  if (!name || name === '.' || name === '..' || name.includes('\0')) return null;
  const relPath = parentRel ? `${parentRel}/${name}` : name;
  try {
    const real = resolveInside(rootReal, relPath);
    const st = fs.statSync(real);
    if (!st.isDirectory() && !st.isFile()) return null;
    const info = classify(name, st.isDirectory());
    return {
      name,
      relPath,
      kind: info.kind,
      size: st.isDirectory() ? null : st.size,
      mtimeMs: Math.round(st.mtimeMs),
      playable: info.playable,
    };
  } catch (err) {
    if (err instanceof PathError) return null;
    return null;
  }
}

export function listDirectory(rootReal: string, rel: string): { path: string; entries: Entry[]; truncated: boolean } {
  const dirReal = resolveInside(rootReal, rel);
  if (!fs.statSync(dirReal).isDirectory()) throw new PathError('not_a_directory', 404);
  const dirents = fs.readdirSync(dirReal, { withFileTypes: true });
  const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const entries: Entry[] = [];
  let truncated = false;
  for (const ent of sorted) {
    if (entries.length >= MAX_LIST) {
      truncated = true;
      break;
    }
    const entry = describe(rootReal, rel, ent.name);
    if (entry) entries.push(entry);
  }
  return { path: rel, entries, truncated };
}

export function listImages(rootReal: string, rel: string): { path: string; images: Entry[]; truncated: boolean } {
  const start = resolveInside(rootReal, rel);
  if (!fs.statSync(start).isDirectory()) throw new PathError('not_a_directory', 404);
  const images: Entry[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const walk = (dirReal: string, dirRel: string) => {
    if (truncated || seen.has(dirReal)) return;
    seen.add(dirReal);
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dirReal, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...dirents].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
    for (const ent of sorted) {
      if (images.length >= MAX_ALBUM) {
        truncated = true;
        return;
      }
      const relPath = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      let real: string;
      try {
        real = resolveInside(rootReal, relPath);
      } catch {
        continue;
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(real);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(real, relPath);
        continue;
      }
      if (!st.isFile()) continue;
      const info = classify(ent.name, false);
      if (info.kind !== 'image') continue;
      images.push({
        name: ent.name,
        relPath,
        kind: 'image',
        size: st.size,
        mtimeMs: Math.round(st.mtimeMs),
        playable: info.playable,
      });
    }
  };

  walk(start, rel);
  return { path: rel, images, truncated };
}
