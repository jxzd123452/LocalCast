import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type SharpFactory = typeof import('sharp').default;

let sharpMod: SharpFactory | null | undefined;

export async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    const mod = await import('sharp');
    sharpMod = mod.default;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

export function thumbCacheDir(): string {
  return path.join(os.tmpdir(), 'localcast-thumbs');
}

export async function renderThumb(realFile: string, mtimeMs: number, size: number): Promise<Buffer | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const key = createHash('sha256').update(`${realFile}\0${mtimeMs}\0${size}`).digest('hex');
  const dir = thumbCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${key}.webp`);
  try {
    return await fs.readFile(dest);
  } catch {
    // Cache miss. Generate below.
  }
  const buf = await sharp(realFile, {
    failOn: 'none',
    limitInputPixels: 40_000_000,
    sequentialRead: true,
    animated: false,
  })
    .rotate()
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
  await fs.writeFile(dest, buf);
  return buf;
}

export async function imageSize(realFile: string): Promise<{ width: number | null; height: number | null }> {
  const sharp = await loadSharp();
  if (!sharp) return { width: null, height: null };
  try {
    const meta = await sharp(realFile, { failOn: 'none', limitInputPixels: 40_000_000 }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}
