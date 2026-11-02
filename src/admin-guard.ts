import type { FastifyRequest } from 'fastify';

export function isLoopbackAddress(address: string | undefined | null): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function adminHostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function remoteAddressOf(req: FastifyRequest): string | undefined {
  return req.socket?.remoteAddress || req.raw.socket?.remoteAddress || undefined;
}

export function isAdminRequest(req: FastifyRequest, port: number): boolean {
  if (!isLoopbackAddress(remoteAddressOf(req))) return false;
  if (!adminHostAllowed(req.headers.host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    const allowed = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ]);
    if (!allowed.has(origin)) return false;
  }
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  return true;
}
