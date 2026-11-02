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

async function assertFits(page, label, expectedWidth) {
  const result = await page.evaluate((expected) => {
    const limit = expected;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        return box.right > limit + 1 || box.left < -1;
      })
      .slice(0, 8)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return `${el.tagName}.${String(el.className).replace(/\s+/g, '.').slice(0, 48)} ${Math.round(box.left)}-${Math.round(box.right)}`;
      });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders,
    };
  }, expectedWidth);
  console.log(label, result, page.viewportSize());
  if (Math.abs(result.innerWidth - expectedWidth) > 1 || result.scrollWidth > result.innerWidth + 1) {
    throw new Error(`${label} overflows scroll ${result.scrollWidth} inner ${result.innerWidth} expected ${expectedWidth}: ${result.offenders.join(' | ')}`);
  }
}

function phoneOptions(width, height) {
  return {
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
}

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

  const phone = await browser.newPage(phoneOptions(390, 844));
  await phone.emulateMedia({ colorScheme: 'light' });
  const guestRoot = `${base}/r/${encodeURIComponent(token)}`;
  await phone.goto(guestRoot, { waitUntil: 'networkidle' });
  await phone.getByRole('button', { name: /^Photos/ }).click();
  await phone.waitForSelector('.file-grid .thumb');
  await phone.evaluate(() => window.scrollTo(0, 0));
  await assertFits(phone, 'light 390 files', 390);
  await phone.screenshot({ path: path.join(outDir, 'guest-mobile.png') });

  const narrow = await browser.newPage(phoneOptions(375, 812));
  await narrow.emulateMedia({ colorScheme: 'light' });
  await narrow.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}`, { waitUntil: 'networkidle' });
  await narrow.waitForSelector('.file-grid .thumb');
  await assertFits(narrow, 'light 375 files', 375);
  await narrow.close();

  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByRole('button', { name: /北山/ }).click();
  await phone.waitForSelector('.lightbox img');
  await assertFits(phone, 'light 390 preview', 390);
  const contrast = await phone.evaluate(() => {
    const button = document.querySelector('.lightbox .btn');
    if (!button) return null;
    const style = getComputedStyle(button);
    return { color: style.color, background: style.backgroundColor };
  });
  console.log('lightbox button', contrast);
  await phone.screenshot({ path: path.join(outDir, 'guest-preview.png') });
  const narrowPreview = await browser.newPage(phoneOptions(375, 812));
  await narrowPreview.emulateMedia({ colorScheme: 'light' });
  await narrowPreview.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}`, { waitUntil: 'networkidle' });
  await narrowPreview.getByRole('button', { name: /北山/ }).click();
  await narrowPreview.waitForSelector('.lightbox img');
  await assertFits(narrowPreview, 'light 375 preview', 375);
  await narrowPreview.close();
  await phone.keyboard.press('Escape');
  await phone.waitForSelector('.lightbox', { state: 'detached' });

  const dark = await browser.newPage(phoneOptions(390, 844));
  await dark.addInitScript(() => localStorage.setItem('localcast.theme', 'dark'));
  await dark.emulateMedia({ colorScheme: 'dark' });
  await dark.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}`, { waitUntil: 'networkidle' });
  await dark.waitForSelector('.file-grid .thumb');
  await dark.evaluate(() => window.scrollTo(0, 0));
  const themeName = await dark.evaluate(() => document.documentElement.dataset.theme);
  console.log('dark theme attribute', themeName);
  await assertFits(dark, 'dark 390 files', 390);
  await dark.screenshot({ path: path.join(outDir, 'guest-mobile-dark.png') });
  await dark.close();
  const darkNarrow = await browser.newPage(phoneOptions(375, 812));
  await darkNarrow.addInitScript(() => localStorage.setItem('localcast.theme', 'dark'));
  await darkNarrow.emulateMedia({ colorScheme: 'dark' });
  await darkNarrow.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}`, { waitUntil: 'networkidle' });
  await darkNarrow.waitForSelector('.file-grid .thumb');
  await assertFits(darkNarrow, 'dark 375 files', 375);
  await darkNarrow.close();

  const tv = await browser.newPage(phoneOptions(390, 844));
  await tv.addInitScript(() => localStorage.setItem('localcast.theme', 'light'));
  await tv.emulateMedia({ colorScheme: 'light' });
  await tv.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}&tv=1`, { waitUntil: 'networkidle' });
  await tv.waitForSelector('body.tv .file-grid .thumb');
  await tv.evaluate(() => window.scrollTo(0, 0));
  await assertFits(tv, 'tv 390 files', 390);
  await tv.screenshot({ path: path.join(outDir, 'guest-tv.png') });
  await tv.close();
  const tvNarrow = await browser.newPage(phoneOptions(375, 812));
  await tvNarrow.addInitScript(() => localStorage.setItem('localcast.theme', 'light'));
  await tvNarrow.emulateMedia({ colorScheme: 'light' });
  await tvNarrow.goto(`${guestRoot}?dir=${encodeURIComponent('Photos')}&tv=1`, { waitUntil: 'networkidle' });
  await tvNarrow.waitForSelector('body.tv .file-grid .thumb');
  await assertFits(tvNarrow, 'tv 375 files', 375);
  await tvNarrow.close();

  await browser.close();
  console.log('screenshots written');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
}
