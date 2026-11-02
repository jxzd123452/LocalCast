import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { boot, guestPath, httpCall, listUrl, readJson, tempDir, writeTree } from './helpers.js';

function onceMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(data.toString()));
    socket.once('error', reject);
  });
}

function waitOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

describe('spec 7.9 token expiry and room close', () => {
  test('15 minute and 1 hour windows expire, unlimited does not', async (t) => {
    let now = 1_700_000_000_000;
    const root = await tempDir();
    await writeTree(root, { 'a.txt': 'a' });
    const running = await boot(t, root, { ttl: '15m', now: () => now });
    assert.equal(running.room.expiresAt, now + 15 * 60 * 1000);
    const alive = await readJson(listUrl(running));
    assert.equal(alive.status, 200);

    now += 15 * 60 * 1000 + 5;
    const expired = await readJson(listUrl(running));
    assert.equal(expired.status, 401);
    assert.equal(expired.json.error, 'expired');
    const download = await httpCall(`${running.baseUrl}/api/r/${encodeURIComponent(running.room.token ?? '')}/raw?p=${Buffer.from('a.txt').toString('base64url')}`);
    assert.equal(download.status, 401);
    assert.equal(download.body.toString('utf8').includes('a'), false);

    let later = now;
    const hourRoot = await tempDir();
    await writeTree(hourRoot, { 'b.txt': 'b' });
    const hour = await boot(t, hourRoot, { ttl: '1h', now: () => later });
    assert.equal(hour.room.expiresAt, later + 60 * 60 * 1000);
    later += 2 * 60 * 60 * 1000;
    const hourGone = await readJson(`${hour.baseUrl}/api/r/${hour.room.token}/list`);
    assert.equal(hourGone.json.error, 'expired');

    let forever = later;
    const freeRoot = await tempDir();
    await writeTree(freeRoot, { 'c.txt': 'c' });
    const free = await boot(t, freeRoot, { ttl: 'unlimited', now: () => forever });
    forever += 5 * 24 * 60 * 60 * 1000;
    const still = await readJson(`${free.baseUrl}/api/r/${free.room.token}/list`);
    assert.equal(still.status, 200);
    assert.equal(free.room.expiresAt, null);
  });

  test('closing the room and regenerating the token cut off old links', async (t) => {
    const root = await tempDir();
    await writeTree(root, { 'a.txt': 'secret-file' });
    const running = await boot(t, root, { grace: 300 });
    const oldToken = running.room.token ?? '';
    const wsUrl = `ws://127.0.0.1:${running.port}/api/r/${encodeURIComponent(oldToken)}/ws?d=deviceAAAA1111`;
    const otherUrl = `ws://127.0.0.1:${running.port}/api/r/${encodeURIComponent(oldToken)}/ws?d=deviceBBBB2222`;
    const first = new WebSocket(wsUrl);
    const second = new WebSocket(otherUrl);
    t.after(() => {
      first.close();
      second.close();
    });
    await Promise.all([waitOpen(first), waitOpen(second), onceMessage(first), onceMessage(second)]);
    const state = await readJson(`${running.baseUrl}/api/admin/state`);
    assert.equal(state.json.devices.length, 2);

    const regen = await readJson(`${running.baseUrl}/api/admin/regenerate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(regen.status, 200);
    const newToken = running.room.token ?? '';
    assert.notEqual(newToken, oldToken);
    const stale = await readJson(`${running.baseUrl}/api/r/${encodeURIComponent(oldToken)}/list`);
    assert.equal(stale.status, 401);
    assert.equal(stale.json.error, 'invalid_token');
    const fresh = await readJson(`${running.baseUrl}/api/r/${encodeURIComponent(newToken)}/list`);
    assert.equal(fresh.status, 200);

    const stop = await readJson(`${running.baseUrl}/api/admin/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(stop.status, 200);
    const closed = await readJson(`${running.baseUrl}/api/r/${encodeURIComponent(newToken)}/list`);
    assert.equal(closed.status, 401);
    assert.equal(closed.json.error, 'closed');
    const closedFile = await httpCall(`${running.baseUrl}/api/r/${encodeURIComponent(newToken)}/raw?p=${Buffer.from('a.txt').toString('base64url')}`);
    assert.equal(closedFile.status, 401);
    assert.equal(closedFile.body.toString('utf8').includes('secret-file'), false);

    await new Promise((resolve) => setTimeout(resolve, 400));
    running.room.sweep();
    assert.equal(running.room.deviceList().length, 0);
  });

  test('two sockets are counted and a departed device drops off', async (t) => {
    let now = 10_000;
    const root = await tempDir();
    await writeTree(root, { 'a.txt': 'a' });
    const running = await boot(t, root, { now: () => now, grace: 1000 });
    const token = running.room.token ?? '';
    const socket = new WebSocket(`ws://127.0.0.1:${running.port}/api/r/${encodeURIComponent(token)}/ws?d=deviceCCCC3333`);
    const hello = onceMessage(socket);
    await waitOpen(socket);
    await hello;
    assert.equal(running.room.deviceList().length, 1);
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    now += 5000;
    running.room.sweep();
    assert.equal(running.room.deviceList().length, 0);
  });

  test('the listening port can be changed from the admin page', async (t) => {
    const root = await tempDir();
    await writeTree(root, { 'a.txt': 'a' });
    const running = await boot(t, root);
    const nextPort = await freePort();
    const moved = await readJson(`${running.baseUrl}/api/admin/listen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JSON.stringify({ port: nextPort })) },
      body: JSON.stringify({ port: nextPort }),
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.port, nextPort);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const health = await httpCall(`http://127.0.0.1:${nextPort}/api/health`);
    assert.equal(health.status, 200);
    const still = await readJson(`http://127.0.0.1:${nextPort}/api/r/${running.room.token}/list`);
    assert.equal(still.status, 200);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
