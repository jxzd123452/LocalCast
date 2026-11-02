import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { makeMp4WithDuration, makePdf, makePng, makeWav, patterned } from './fixtures.js';
import { boot, encodeRel, guestPath, httpCall, listUrl, multipartUpload, rawUrl, readJson, tempDir, writeTree } from './helpers.js';

describe('spec 7.3 names with Chinese, spaces, and special characters', () => {
  test('round-trips awkward filenames', async (t) => {
    const root = await tempDir();
    const special = '报告 (终稿) #1 & notes + more%.txt';
    const spaced = 'my file.txt';
    const chinese = '照片/北山 日出.png';
    await writeTree(root, {
      [special]: 'special-body',
      [spaced]: 'space-body',
      [chinese]: makePng(),
    });
    const running = await boot(t, root);
    const listed = await readJson(listUrl(running));
    const names = listed.json.entries.map((entry: { name: string }) => entry.name);
    assert.ok(names.includes(special));
    assert.ok(names.includes(spaced));
    assert.ok(names.includes('照片'));
    for (const [rel, body] of [
      [special, 'special-body'],
      [spaced, 'space-body'],
    ] as const) {
      const file = await httpCall(rawUrl(running, rel, true));
      assert.equal(file.status, 200, rel);
      assert.equal(file.body.toString('utf8'), body);
      assert.match(String(file.headers['content-disposition']), /filename\*=UTF-8''/);
    }
    const nested = await readJson(listUrl(running, '照片'));
    assert.equal(nested.json.entries[0].name, '北山 日出.png');
    assert.equal(nested.json.entries[0].kind, 'image');
  });
});

describe('spec 7.4 previews', () => {
  test('serves image, video, audio, and PDF with honest playable flags', async (t) => {
    const root = await tempDir();
    const png = makePng(64, 40, [20, 120, 90]);
    const wav = makeWav(0.25, 8000);
    const pdf = makePdf();
    const mp4 = makeMp4WithDuration(2.5, 1000);
    await writeTree(root, {
      'pic.png': png,
      'tone.wav': wav,
      'note.pdf': pdf,
      'clip.mp4': mp4,
      'movie.mkv': Buffer.from('not a real matroska file'),
      'page.html': '<script>alert(1)</script>',
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      'read me.txt': 'plain words',
    });
    const running = await boot(t, root);

    const image = await httpCall(rawUrl(running, 'pic.png'));
    assert.equal(image.status, 200);
    assert.match(String(image.headers['content-type']), /^image\/png/);
    assert.equal(image.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(String(image.headers['content-disposition']), /^inline/);

    const thumb = await httpCall(guestPath(running, `/thumb?p=${encodeURIComponent(encodeRel('pic.png'))}`));
    assert.equal(thumb.status, 200);
    assert.match(String(thumb.headers['content-type']), /image\/webp/);
    assert.ok(thumb.body.length > 16);
    assert.ok(thumb.body.length < png.length * 4);

    const audio = await httpCall(rawUrl(running, 'tone.wav'));
    assert.match(String(audio.headers['content-type']), /^audio\/wav/);
    const audioMeta = await readJson(guestPath(running, `/meta?p=${encodeURIComponent(encodeRel('tone.wav'))}`));
    assert.equal(audioMeta.json.kind, 'audio');
    assert.equal(audioMeta.json.playable, true);
    assert.ok(Math.abs(audioMeta.json.durationSec - 0.25) < 0.02);
    assert.equal(audioMeta.json.size, wav.length);

    const video = await httpCall(rawUrl(running, 'clip.mp4'));
    assert.match(String(video.headers['content-type']), /^video\/mp4/);
    const videoMeta = await readJson(guestPath(running, `/meta?p=${encodeURIComponent(encodeRel('clip.mp4'))}`));
    assert.equal(videoMeta.json.playable, true);
    assert.ok(Math.abs(videoMeta.json.durationSec - 2.5) < 0.01);

    const pdfRes = await httpCall(rawUrl(running, 'note.pdf'));
    assert.match(String(pdfRes.headers['content-type']), /^application\/pdf/);
    assert.equal(pdfRes.body.subarray(0, 5).toString('utf8'), '%PDF-');
    assert.match(String(pdfRes.headers['content-disposition']), /^inline/);

    const listed = await readJson(listUrl(running));
    const mkv = listed.json.entries.find((entry: { name: string }) => entry.name === 'movie.mkv');
    assert.equal(mkv.kind, 'video');
    assert.equal(mkv.playable, false);
    const mkvRaw = await httpCall(rawUrl(running, 'movie.mkv'));
    assert.match(String(mkvRaw.headers['content-disposition']), /^attachment/);
    const mkvMeta = await readJson(guestPath(running, `/meta?p=${encodeURIComponent(encodeRel('movie.mkv'))}`));
    assert.equal(mkvMeta.json.durationSec, null);

    const html = await httpCall(rawUrl(running, 'page.html'));
    assert.match(String(html.headers['content-type']), /application\/octet-stream/);
    assert.match(String(html.headers['content-disposition']), /^attachment/);
    const svg = await httpCall(rawUrl(running, 'icon.svg'));
    assert.match(String(svg.headers['content-type']), /application\/octet-stream/);
  });
});

describe('spec 7.5 large file HTTP Range', () => {
  test('returns exact byte slices for a multi-megabyte file', async (t) => {
    const root = await tempDir();
    const size = 5 * 1024 * 1024;
    const blob = patterned(size);
    await writeTree(root, { 'clip.mp4': blob });
    const running = await boot(t, root);
    const url = rawUrl(running, 'clip.mp4');

    const middle = await httpCall(url, { headers: { range: 'bytes=1000-1999' } });
    assert.equal(middle.status, 206);
    assert.equal(middle.headers['content-range'], `bytes 1000-1999/${size}`);
    assert.equal(Number(middle.headers['content-length']), 1000);
    assert.equal(middle.body.length, 1000);
    assert.equal(middle.body.compare(blob.subarray(1000, 2000)), 0);

    const suffix = await httpCall(url, { headers: { range: 'bytes=-10' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.body.compare(blob.subarray(size - 10)), 0);

    const first = await httpCall(url, { headers: { range: 'bytes=0-0' } });
    assert.equal(first.status, 206);
    assert.equal(first.body.length, 1);
    assert.equal(first.body[0], blob[0]);

    const open = await httpCall(url, { headers: { range: 'bytes=1048576-' } });
    assert.equal(open.status, 206);
    assert.equal(open.body.length, size - 1048576);
    assert.equal(open.body.compare(blob.subarray(1048576)), 0);

    const missing = await httpCall(url, { headers: { range: `bytes=${size}-${size + 10}` } });
    assert.equal(missing.status, 416);
    assert.equal(missing.headers['content-range'], `bytes */${size}`);

    const full = await httpCall(url);
    assert.equal(full.status, 200);
    assert.equal(Number(full.headers['content-length']), size);
    assert.equal(full.body.compare(blob), 0);
  });
});

describe('spec 7.6 concurrency', () => {
  test('serves many overlapping reads', async (t) => {
    const root = await tempDir();
    const blob = patterned(256 * 1024);
    await writeTree(root, { 'a.txt': 'alpha', 'b.txt': 'beta', 'blob.bin': blob });
    const running = await boot(t, root);
    const calls = Array.from({ length: 24 }, (_, index) => {
      if (index % 3 === 0) return readJson(listUrl(running)).then((res) => ({ kind: 'list', status: res.status, ok: res.json.entries.length === 3 }));
      if (index % 3 === 1) return httpCall(rawUrl(running, 'a.txt')).then((res) => ({ kind: 'text', status: res.status, ok: res.body.toString() === 'alpha' }));
      return httpCall(rawUrl(running, 'blob.bin'), { headers: { range: 'bytes=10-99' } }).then((res) => ({
        kind: 'range',
        status: res.status,
        ok: res.status === 206 && res.body.compare(blob.subarray(10, 100)) === 0,
      }));
    });
    const results = await Promise.all(calls);
    assert.equal(results.every((result) => result.ok), true);
  });
});

describe('spec 7.7 upload and progress', () => {
  test('streams progress, avoids overwrite, and leaves originals untouched', async (t) => {
    const root = await tempDir();
    await writeTree(root, { 'keep.txt': 'original-bytes' });
    const running = await boot(t, root, { upload: true, maxUpload: 1024 * 1024 });
    const payload = patterned(384 * 1024);
    let sawPartial = false;
    const upload = multipartUpload(guestPath(running, '/upload'), 'phone shot.png', payload, { chunk: 16 * 1024, delayMs: 25 });
    const watch = (async () => {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const active = await readJson(guestPath(running, '/uploads'));
        const received = active.json.uploads?.[0]?.received ?? 0;
        if (received > 0 && received < payload.length) {
          sawPartial = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    })();
    const [done] = await Promise.all([upload, watch]);
    assert.equal(sawPartial, true, JSON.stringify(done));
    assert.equal(done.status, 200);
    assert.equal(done.json.ok, true);
    assert.equal(done.json.relPath.startsWith('Inbox/'), true);
    const saved = await fs.promises.readFile(path.join(root, ...done.json.relPath.split('/')));
    assert.equal(saved.compare(payload), 0);
    assert.equal(await fs.promises.readFile(path.join(root, 'keep.txt'), 'utf8'), 'original-bytes');

    const first = await multipartUpload(guestPath(running, '/upload'), 'note.txt', Buffer.from('one'));
    const second = await multipartUpload(guestPath(running, '/upload'), 'note.txt', Buffer.from('two'));
    assert.equal(first.json.name, 'note.txt');
    assert.equal(second.json.name, 'note (2).txt');
    assert.equal(await fs.promises.readFile(path.join(root, 'Inbox', 'note.txt'), 'utf8'), 'one');
    assert.equal(await fs.promises.readFile(path.join(root, 'Inbox', 'note (2).txt'), 'utf8'), 'two');

    const sneaky = await multipartUpload(guestPath(running, '/upload'), '../../owned.txt', Buffer.from('nope'));
    assert.equal(sneaky.status, 200);
    assert.equal(sneaky.json.name, 'owned.txt');
    assert.equal(fs.existsSync(path.join(root, '..', 'owned.txt')), false);
    assert.equal(await fs.promises.readFile(path.join(root, 'Inbox', 'owned.txt'), 'utf8'), 'nope');

    const chinese = await multipartUpload(guestPath(running, '/upload'), '假期 照片.png', Buffer.from('img'));
    assert.equal(chinese.status, 200);
    assert.equal(chinese.json.name, '假期 照片.png');
  });

  test('rejects oversized uploads and uploads when the switch is off', async (t) => {
    const root = await tempDir();
    await writeTree(root, { 'seed.txt': 'seed' });
    const running = await boot(t, root, { upload: true, maxUpload: 1024 });
    const tooBig = await multipartUpload(guestPath(running, '/upload'), 'big.bin', patterned(4096));
    assert.equal(tooBig.status, 413, JSON.stringify(tooBig.json));
    assert.equal(tooBig.json.error, 'too_large');
    const inbox = path.join(root, 'Inbox');
    const leftovers = fs.existsSync(inbox) ? await fs.promises.readdir(inbox) : [];
    assert.equal(leftovers.some((name) => name.includes('big')), false);

    await postJsonOff(running);
    const denied = await multipartUpload(guestPath(running, '/upload'), 'later.txt', Buffer.from('x'));
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, 'upload_disabled');
  });
});

async function postJsonOff(running: Awaited<ReturnType<typeof boot>>): Promise<void> {
  const { postJson } = await import('./helpers.js');
  const res = await postJson(`${running.baseUrl}/api/admin/settings`, { uploadEnabled: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.uploadEnabled, false);
}
