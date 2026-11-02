import fs from 'node:fs/promises';

export type FileKind = 'dir' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'file';
export type Playable = boolean | 'try' | null;

const IMAGE_NATIVE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'apng']);
const IMAGE_CONVERT = new Set(['heic', 'heif', 'tif', 'tiff']);
const VIDEO_PLAY = new Set(['mp4', 'm4v', 'webm', 'ogv']);
const VIDEO_NO = new Set(['mkv', 'avi', 'wmv', 'flv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'rmvb', 'vob', 'asf']);
const AUDIO_PLAY = new Set(['mp3', 'wav', 'wave', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'weba', 'opus']);
const AUDIO_NO = new Set(['wma', 'mid', 'midi', 'aiff', 'aif']);
const TEXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'log', 'srt', 'vtt', 'yaml', 'yml']);
const DANGEROUS = new Set(['html', 'htm', 'svg', 'xml', 'xhtml', 'js', 'mjs', 'cjs', 'css']);

export function fileExt(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function classify(name: string, isDir: boolean): { kind: FileKind; playable: Playable } {
  if (isDir) return { kind: 'dir', playable: null };
  const ext = fileExt(name);
  if (IMAGE_NATIVE.has(ext)) return { kind: 'image', playable: true };
  if (IMAGE_CONVERT.has(ext)) return { kind: 'image', playable: 'try' };
  if (VIDEO_NO.has(ext)) return { kind: 'video', playable: false };
  if (ext === 'mov') return { kind: 'video', playable: 'try' };
  if (VIDEO_PLAY.has(ext)) return { kind: 'video', playable: true };
  if (AUDIO_NO.has(ext)) return { kind: 'audio', playable: false };
  if (AUDIO_PLAY.has(ext)) return { kind: 'audio', playable: true };
  if (ext === 'pdf') return { kind: 'pdf', playable: true };
  if (TEXT.has(ext)) return { kind: 'text', playable: true };
  return { kind: 'file', playable: null };
}

export function contentTypeFor(name: string): { type: string; inline: boolean } {
  const ext = fileExt(name);
  if (DANGEROUS.has(ext)) return { type: 'application/octet-stream', inline: false };
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    apng: 'image/apng',
    heic: 'image/heic',
    heif: 'image/heif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    wave: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    weba: 'audio/webm',
    opus: 'audio/ogg',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    markdown: 'text/plain; charset=utf-8',
    json: 'text/plain; charset=utf-8',
    csv: 'text/plain; charset=utf-8',
    log: 'text/plain; charset=utf-8',
    srt: 'text/plain; charset=utf-8',
    vtt: 'text/plain; charset=utf-8',
    yaml: 'text/plain; charset=utf-8',
    yml: 'text/plain; charset=utf-8',
  };
  const type = map[ext] ?? 'application/octet-stream';
  const info = classify(name, false);
  if ((info.kind === 'video' || info.kind === 'audio') && info.playable === false) {
    return { type, inline: false };
  }
  if (IMAGE_CONVERT.has(ext)) return { type, inline: false };
  const inline =
    type.startsWith('image/') ||
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    type === 'application/pdf' ||
    type.startsWith('text/plain');
  return { type, inline };
}

export function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function plausibleSeconds(duration: number, timescale: number): number | null {
  if (!Number.isFinite(duration) || !Number.isFinite(timescale)) return null;
  if (timescale <= 0 || timescale > 1_000_000_000) return null;
  if (duration < 0) return null;
  const sec = duration / timescale;
  if (!Number.isFinite(sec) || sec > 60 * 60 * 24 * 365) return null;
  return sec;
}

export function mp4DurationSeconds(buf: Buffer): number | null {
  const fromBoxes = walkBoxes(buf, 0, buf.length);
  if (fromBoxes != null) return fromBoxes;
  let from = 0;
  while (from < buf.length) {
    const found = buf.indexOf('mvhd', from);
    if (found < 0 || found + 24 > buf.length) return null;
    const version = buf[found + 4];
    if (version === 0 && found + 24 <= buf.length) {
      const timescale = buf.readUInt32BE(found + 16);
      const duration = buf.readUInt32BE(found + 20);
      const sec = plausibleSeconds(duration, timescale);
      if (sec != null) return sec;
    } else if (version === 1 && found + 36 <= buf.length) {
      const timescale = buf.readUInt32BE(found + 24);
      const duration = Number(buf.readBigUInt64BE(found + 28));
      const sec = plausibleSeconds(duration, timescale);
      if (sec != null) return sec;
    }
    from = found + 4;
  }
  return null;
}

function walkBoxes(buf: Buffer, start: number, end: number): number | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = buf.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) return null;
    if (type === 'mvhd') {
      const version = buf[offset + header];
      if (version === 0 && offset + header + 20 <= end) {
        return plausibleSeconds(buf.readUInt32BE(offset + header + 16), buf.readUInt32BE(offset + header + 12));
      }
      if (version === 1 && offset + header + 32 <= end) {
        return plausibleSeconds(
          Number(buf.readBigUInt64BE(offset + header + 24)),
          buf.readUInt32BE(offset + header + 20),
        );
      }
      return null;
    }
    if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
      const nested = walkBoxes(buf, offset + header, offset + size);
      if (nested != null) return nested;
    }
    offset += size;
  }
  return null;
}

export function wavDurationSeconds(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataSize: number | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= buf.length) {
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    if (size > buf.length) break;
    offset = start + size + (size % 2);
  }
  if (!sampleRate || !channels || !bits || dataSize == null) return null;
  const bytesPerSec = sampleRate * channels * (bits / 8);
  if (bytesPerSec <= 0) return null;
  return dataSize / bytesPerSec;
}

export async function probeDuration(realPath: string, name: string, kind: FileKind): Promise<number | null> {
  if (kind !== 'audio' && kind !== 'video') return null;
  const ext = fileExt(name);
  const fh = await fs.open(realPath, 'r');
  try {
    const st = await fh.stat();
    const headLen = Math.min(Number(st.size), 1024 * 1024);
    const head = Buffer.alloc(headLen);
    if (headLen > 0) await fh.read(head, 0, headLen, 0);
    if (ext === 'wav' || ext === 'wave') return wavDurationSeconds(head);
    if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') {
      const fromHead = mp4DurationSeconds(head);
      if (fromHead != null) return fromHead;
      if (st.size > headLen) {
        const tailLen = Math.min(Number(st.size), 1024 * 1024);
        const tail = Buffer.alloc(tailLen);
        await fh.read(tail, 0, tailLen, Number(st.size) - tailLen);
        return mp4DurationSeconds(tail);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
