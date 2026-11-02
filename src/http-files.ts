import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { contentDisposition, contentTypeFor } from './media.js';
import { parseSingleRange } from './range.js';
import { isInsideRoot } from './safe-path.js';
import { PLAIN_HTTP_WARNING } from './warnings.js';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self' ws: wss:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
};

export function fallbackHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>LocalCast</title>
</head>
<body>
<main>
<h1>LocalCast</h1>
<p>The web UI has not been built yet. Run npm run build and start again.</p>
<p>${PLAIN_HTTP_WARNING}</p>
</main>
</body>
</html>`;
}

export function sendIndex(reply: FastifyReply, distDir: string | null): void {
  const index = distDir ? path.join(distDir, 'index.html') : '';
  const html = index && fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : fallbackHtml();
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
}

export function resolveStatic(distDir: string, urlPath: string): string | null {
  if (!urlPath.startsWith('/') || urlPath.includes('\0')) return null;
  let rel = urlPath.slice(1);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0')) return null;
  const root = path.resolve(distDir);
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(file)) return null;
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return null;
  }
  if (!isInsideRoot(root, real) || !fs.statSync(real).isFile()) return null;
  return real;
}

export function sendAsset(reply: FastifyReply, file: string, urlPath: string): void {
  const ext = path.extname(file).toLowerCase();
  const cache = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
  const body = fs.readFileSync(file);
  reply
    .type(STATIC_TYPES[ext] ?? 'application/octet-stream')
    .header('Cache-Control', cache)
    .header('Content-Length', String(body.length))
    .send(body);
}

export function pipeSharedFile(
  req: FastifyRequest,
  reply: FastifyReply,
  realPath: string,
  downloadName: string,
  forceDownload: boolean,
  track: (stream: { destroy: () => void }) => void,
): void {
  const st = fs.statSync(realPath);
  if (!st.isFile()) {
    reply.code(404).send({ error: 'not_a_file' });
    return;
  }
  const meta = contentTypeFor(downloadName);
  const inline = !forceDownload && meta.inline;
  const range = parseSingleRange(req.headers.range, st.size);
  if (range.kind === 'unsatisfiable') {
    reply.hijack();
    reply.raw.writeHead(416, {
      ...SECURITY_HEADERS,
      'Content-Type': meta.type,
      'Content-Range': `bytes */${st.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': '0',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    });
    reply.raw.end();
    return;
  }
  const partial = range.kind === 'partial';
  const start = partial ? range.start : 0;
  const end = partial ? range.end : Math.max(0, st.size - 1);
  const length = st.size === 0 ? 0 : end - start + 1;
  const headers: Record<string, string | number> = {
    ...SECURITY_HEADERS,
    'Content-Type': meta.type,
    'Content-Length': length,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(downloadName, inline),
    'Cache-Control': 'private, max-age=0, must-revalidate',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  reply.hijack();
  reply.raw.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD' || length === 0) {
    reply.raw.end();
    return;
  }
  const stream = fs.createReadStream(realPath, { start, end });
  track(stream);
  const abort = () => stream.destroy();
  req.raw.on('aborted', abort);
  reply.raw.on('close', () => {
    if (!stream.closed) stream.destroy();
  });
  stream.on('error', () => reply.raw.destroy());
  stream.pipe(reply.raw);
}
