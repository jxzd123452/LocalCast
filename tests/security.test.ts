import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { boot, encodeRel, guestPath, httpCall, listUrl, multipartUpload, rawUrl, readJson, tempDir, writeTree } from './helpers.js';

const SECRET = 'UNIQUE_SECRET_OUTSIDE_9f3a';

describe('spec 7.8 traversal and symlink escape', () => {
  test('refuses paths that leave the shared root', async (t) => {
    const root = await tempDir('localcast-root-');
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'localcast-outside-'));
    t.after(() => fs.promises.rm(outside, { recursive: true, force: true }));
    await writeTree(root, {
      'ok.txt': 'inside',
      'sub/nested.txt': 'nested',
    });
    await fs.promises.writeFile(path.join(outside, 'secret.txt'), SECRET);
    try {
      await fs.promises.symlink(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EACCES') {
        t.skip(`symlinks cannot be created on ${process.platform} (${code}). Lexical traversal tests still run.`);
        return;
      }
      throw err;
    }
    await fs.promises.symlink(outside, path.join(root, 'leakdir'));
    await fs.promises.symlink(path.join(outside, 'secret.txt'), path.join(root, 'sub', 'leak.txt'));
    await fs.promises.symlink(path.join(root, 'ok.txt'), path.join(root, 'ok-link.txt'));
    const running = await boot(t, root);

    const attacks = [
      '../secret.txt',
      'sub/../../secret.txt',
      '/etc/passwd',
      '..\\..\\Windows\\system32',
      'sub/../../../etc/passwd',
      'leak.txt',
      'leakdir/secret.txt',
      'sub/leak.txt',
      'ok.txt\0.png',
    ];
    for (const rel of attacks) {
      const res = await httpCall(rawUrl(running, rel));
      assert.ok(res.status === 400 || res.status === 403 || res.status === 404, `${rel} -> ${res.status}`);
      assert.equal(res.body.toString('utf8').includes(SECRET), false, rel);
      assert.equal(res.body.toString('utf8').includes(outside), false, rel);
    }

    const listed = await readJson(listUrl(running));
    const names = listed.json.entries.map((entry: { name: string }) => entry.name);
    assert.equal(names.includes('leak.txt'), false);
    assert.equal(names.includes('leakdir'), false);
    assert.equal(names.includes('ok-link.txt'), true);
    assert.equal(JSON.stringify(listed.json).includes(SECRET), false);
    assert.equal(JSON.stringify(listed.json).includes(outside), false);

    const leakedList = await readJson(listUrl(running, 'leakdir'));
    assert.equal(leakedList.status, 403);
    assert.equal(JSON.stringify(leakedList.json).includes(SECRET), false);

    const ok = await httpCall(rawUrl(running, 'ok-link.txt'));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.toString('utf8'), 'inside');

    const rawQuery = await httpCall(guestPath(running, '/raw?p=../secret.txt'));
    assert.notEqual(rawQuery.status, 200);
    assert.equal(rawQuery.body.toString('utf8').includes(SECRET), false);

    const encoded = encodeRel('..%2f..%2fetc/passwd');
    const once = await httpCall(guestPath(running, `/raw?p=${encodeURIComponent(encoded)}`));
    assert.notEqual(once.status, 200);
  });

  test('upload cannot retarget Inbox through a symlink', async (t) => {
    const root = await tempDir();
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'localcast-inbox-'));
    t.after(() => fs.promises.rm(outside, { recursive: true, force: true }));
    try {
      await fs.promises.symlink(outside, path.join(root, 'Inbox'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EACCES') {
        t.skip(`symlinks cannot be created on ${process.platform} (${code}).`);
        return;
      }
      throw err;
    }
    const running = await boot(t, root, { upload: true });
    const res = await multipartUpload(guestPath(running, '/upload'), 'x.txt', Buffer.from('pwn'));
    assert.equal(res.status, 409);
    assert.equal(fs.existsSync(path.join(outside, 'x.txt')), false);
  });
});

describe('admin surface is local only', () => {
  test('rejects remote addresses, foreign hosts, and cross-site posts', async (t) => {
    const root = await tempDir();
    const running = await boot(t, root);
    const remote = await running.app.inject({
      method: 'GET',
      url: '/api/admin/state',
      remoteAddress: '203.0.113.9',
      headers: { host: '127.0.0.1' },
    });
    assert.equal(remote.statusCode, 403);
    assert.equal(remote.body.includes(running.room.token ?? ''), false);

    const rebinding = await running.app.inject({
      method: 'GET',
      url: '/api/admin/state',
      remoteAddress: '127.0.0.1',
      headers: { host: 'evil.example' },
    });
    assert.equal(rebinding.statusCode, 403);

    const csrf = await running.app.inject({
      method: 'POST',
      url: '/api/admin/stop',
      remoteAddress: '127.0.0.1',
      headers: { host: '127.0.0.1', origin: 'http://evil.example', 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(csrf.statusCode, 403);
    assert.equal(running.room.status, 'open');

    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      await httpCall(rawUrl(running, '../etc/passwd'));
      await httpCall(`${running.baseUrl}/api/r/${running.room.token}/list`);
    } finally {
      console.error = original;
    }
    const logs = `${running.logs.join('\n')}\n${errors.join('\n')}`;
    assert.equal(logs.includes(running.room.token ?? 'missing-token'), false);
  });
});
