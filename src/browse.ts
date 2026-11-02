import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PathError } from './safe-path.js';

export interface Place {
  name: string;
  path: string;
}

export function listPlaces(): Place[] {
  const home = os.homedir();
  const candidates: Place[] = [
    { name: 'Home', path: home },
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') },
    { name: 'Pictures', path: path.join(home, 'Pictures') },
  ];
  const places = candidates.filter((place) => {
    try {
      return fs.statSync(place.path).isDirectory();
    } catch {
      return false;
    }
  });
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      try {
        if (fs.statSync(drive).isDirectory()) places.push({ name: drive, path: drive });
      } catch {
        // Drive is not mounted.
      }
    }
  }
  return places;
}

export function browseDirectory(input: string | undefined): {
  path: string;
  parent: string | null;
  directories: Place[];
  canShare: boolean;
} {
  if (!input) {
    return { path: '', parent: null, directories: listPlaces(), canShare: false };
  }
  if (input.includes('\0')) throw new PathError('bad_path');
  let real: string;
  try {
    real = fs.realpathSync(input);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PathError('not_found', 404);
    throw new PathError('forbidden', 403);
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    throw new PathError('forbidden', 403);
  }
  if (!st.isDirectory()) throw new PathError('not_a_directory', 400);
  const parent = path.dirname(real);
  let dirents: fs.Dirent[] = [];
  try {
    dirents = fs.readdirSync(real, { withFileTypes: true });
  } catch {
    throw new PathError('forbidden', 403);
  }
  const directories: Place[] = [];
  for (const ent of dirents) {
    if (directories.length >= 500) break;
    if (!ent.name || ent.name.startsWith('.')) continue;
    const full = path.join(real, ent.name);
    try {
      if (fs.statSync(full).isDirectory()) directories.push({ name: ent.name, path: full });
    } catch {
      // Skip entries the process cannot inspect.
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const root = path.parse(real).root;
  return {
    path: real,
    parent: parent === real ? null : parent,
    directories,
    canShare: path.resolve(real) !== path.resolve(root),
  };
}
