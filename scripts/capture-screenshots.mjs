import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const port = 8791;
const base = `http://127.0.0.1:${port}`;
const outDir = path.resolve('docs');
fs.mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [
  'dist/cli.js',
  'share',
  path.resolve('examples/sample-library'),
  '--port',
  String(port),
  '--bind',
  '0.0.0.0',
  '--upload',
  '--ttl',
  '1h',
], { stdio: 'inherit' });

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Server still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('LocalCast did not start');
}

try {
  await waitForHealth();
  const state = await (await fetch(`${base}/api/admin/state`)).json();
  if (!state.guestUrl || !state.qrSvg) throw new Error('admin state missing guest link');
  const token = decodeURIComponent(state.guestUrl.split('/r/')[1]);
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1480 }, deviceScaleFactor: 1 });
  await desktop.emulateMedia({ colorScheme: 'light' });
  await desktop.goto(`${base}/`, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.qr-plate svg');
  await desktop.screenshot({ path: path.join(outDir, 'admin-desktop.png') });

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await phone.emulateMedia({ colorScheme: 'light' });
  await phone.goto(`${base}/r/${encodeURIComponent(token)}`, { waitUntil: 'networkidle' });
  await phone.getByRole('button', { name: /^Photos/ }).click();
  await phone.waitForSelector('.file-grid .thumb');
  await phone.screenshot({ path: path.join(outDir, 'guest-mobile.png') });

  await phone.getByRole('button', { name: /北山/ }).click();
  await phone.waitForSelector('.lightbox img');
  await phone.screenshot({ path: path.join(outDir, 'guest-preview.png') });
  await browser.close();
  console.log('screenshots written');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
}
