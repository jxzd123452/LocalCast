import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { PLAIN_HTTP_WARNING } from '../src/warnings.js';
import { boot, httpCall, postJson, tempDir, writeTree } from './helpers.js';

describe('spec 7.1 homepage', () => {
  test('serves the LocalCast homepage and the plain-HTTP warning', async (t) => {
    const root = await tempDir();
    const running = await boot(t, root);
    const page = await httpCall(`${running.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.match(page.body.toString('utf8'), /LocalCast/);
    const health = await httpCall(`${running.baseUrl}/api/health`);
    const body = JSON.parse(health.body.toString('utf8'));
    assert.equal(body.ok, true);
    assert.equal(body.product, 'LocalCast');
    assert.equal(body.warning, PLAIN_HTTP_WARNING);
    assert.match(body.warning, /not absolutely safe/);
    assert.equal(running.logs.join('\n').includes(running.room.token ?? 'no-token'), false);
  });
});

describe('spec 7.2 listing and download', () => {
  test('lists a folder and downloads the bytes unchanged', async (t) => {
    const root = await tempDir();
    await writeTree(root, {
      'notes/hello.txt': 'hello localcast',
      'notes/other.txt': 'second',
    });
    const running = await boot(t, root);
    const listed = await httpCall(`${running.baseUrl}/api/r/${running.room.token}/list?p=${Buffer.from('notes', 'utf8').toString('base64url')}`);
    const json = JSON.parse(listed.body.toString('utf8'));
    assert.equal(listed.status, 200);
    assert.equal(json.path, 'notes');
    assert.deepEqual(json.entries.map((entry: { name: string }) => entry.name).sort(), ['hello.txt', 'other.txt']);
    assert.equal(JSON.stringify(json).includes(root), false);
    const file = await httpCall(
      `${running.baseUrl}/api/r/${running.room.token}/raw?p=${Buffer.from('notes/hello.txt', 'utf8').toString('base64url')}&download=1`,
    );
    assert.equal(file.status, 200);
    assert.equal(file.body.toString('utf8'), 'hello localcast');
    assert.match(String(file.headers['content-disposition']), /attachment/);
    assert.match(String(file.headers['accept-ranges']), /bytes/);
    const rootList = await httpCall(`${running.baseUrl}/api/r/${running.room.token}/list`);
    const rootJson = JSON.parse(rootList.body.toString('utf8'));
    assert.equal(rootJson.entries.some((entry: { name: string; kind: string }) => entry.name === 'notes' && entry.kind === 'dir'), true);
  });
});

describe('admin folder selection', () => {
  test('localhost can browse and share; the drive root is refused', async (t) => {
    const root = await tempDir();
    await writeTree(root, { 'a.txt': 'a' });
    const running = await boot(t, root, { share: false });
    const places = await httpCall(`${running.baseUrl}/api/admin/browse`);
    assert.equal(places.status, 200);
    const inside = await httpCall(`${running.baseUrl}/api/admin/browse?path=${encodeURIComponent(root)}`);
    const insideJson = JSON.parse(inside.body.toString('utf8'));
    assert.equal(inside.status, 200);
    assert.equal(insideJson.canShare, true);
    const shared = await postJson(`${running.baseUrl}/api/admin/share`, { root, ttl: '1h', uploadEnabled: false });
    assert.equal(shared.status, 200);
    assert.equal(shared.json.sharing, true);
    assert.match(shared.json.guestUrl, /\/r\//);
    const broad = await postJson(`${running.baseUrl}/api/admin/share`, { root: '/' });
    assert.equal(broad.status, 400);
    assert.equal(broad.json.error, 'root_too_broad');
    const fileRoot = pathJoinFile(root);
    await fs.promises.writeFile(fileRoot, 'x');
    const notDir = await postJson(`${running.baseUrl}/api/admin/share`, { root: fileRoot });
    assert.equal(notDir.status, 400);
    assert.equal(notDir.json.error, 'not_a_directory');
  });
});

function pathJoinFile(root: string): string {
  return `${root}/plain.txt`;
}
