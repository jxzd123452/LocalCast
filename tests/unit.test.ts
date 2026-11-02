import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deviceLabel } from '../src/device-label.js';
import { sanitizeFilename } from '../src/filenames.js';
import { formatLog, scrub } from '../src/logger.js';
import { mp4DurationSeconds, wavDurationSeconds } from '../src/media.js';
import { isIPv4 } from '../src/network.js';
import { parseSingleRange } from '../src/range.js';
import { isInsideRoot, lexicalSegments } from '../src/safe-path.js';
import { parseArgs, parseSize } from '../src/cli.js';
import { makeMp4WithDuration, makeWav } from './fixtures.js';
import { en, zhCN } from '../web/src/i18n.js';

describe('spec warnings and copy', () => {
  test('English and Chinese warnings refuse to call a LAN absolutely safe', () => {
    assert.match(en.warning, /plain HTTP/);
    assert.match(en.warning, /not absolutely safe/);
    assert.match(zhCN.warning, /并不绝对安全/);
    assert.match(zhCN.warning, /未加密/);
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      assert.equal(typeof zhCN[key], 'string');
      assert.ok(zhCN[key].length > 0);
    }
  });
});

describe('path lexical checks', () => {
  test('rejects traversal, absolute paths, and null bytes on every platform', () => {
    for (const sample of ['../etc/passwd', 'foo/../../etc/passwd', '/etc/passwd', '\\\\server\\share', 'C:\\Windows', 'a\\..\\b', 'ok/%2e%2e/secret', 'bad\0name']) {
      assert.throws(() => lexicalSegments(sample));
    }
    assert.deepEqual(lexicalSegments('Photos/北山 日出.png'), ['Photos', '北山 日出.png']);
    assert.deepEqual(lexicalSegments('报告 (终稿) #1 & notes + more%.txt'), ['报告 (终稿) #1 & notes + more%.txt']);
    assert.equal(isInsideRoot('C:\\share', '\\\\?\\C:\\share\\Inbox\\a.txt', 'win32'), true);
    assert.equal(isInsideRoot('C:\\share', 'C:\\share-extra\\a.txt', 'win32'), false);
    assert.equal(isInsideRoot('/share', '/share/Inbox/a.txt', 'posix'), true);
    assert.equal(isInsideRoot('/share', '/share-extra/a.txt', 'posix'), false);
  });

  test(`runs on ${process.platform}`, () => {
    assert.ok(process.platform);
    assert.ok(process.version.startsWith('v'));
  });
});

describe('filenames', () => {
  test('drops directories and reserved device names', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFilename('..\\..\\Windows\\system32\\config'), 'config');
    assert.equal(sanitizeFilename('con.txt'), '_con.txt');
    assert.equal(sanitizeFilename(''), 'upload');
    assert.equal(sanitizeFilename('..'), 'upload');
    assert.equal(sanitizeFilename('照片 (1).png'), '照片 (1).png');
    assert.equal(sanitizeFilename('a\0b.txt').includes('\0'), false);
  });
});

describe('HTTP ranges', () => {
  test('parses single ranges and rejects unsatisfiable ones', () => {
    assert.deepEqual(parseSingleRange(undefined, 100), { kind: 'none' });
    assert.deepEqual(parseSingleRange('bytes=0-9', 100), { kind: 'partial', start: 0, end: 9 });
    assert.deepEqual(parseSingleRange('bytes=0-', 100), { kind: 'partial', start: 0, end: 99 });
    assert.deepEqual(parseSingleRange('bytes=-10', 100), { kind: 'partial', start: 90, end: 99 });
    assert.deepEqual(parseSingleRange('bytes=100-120', 100), { kind: 'unsatisfiable' });
    assert.deepEqual(parseSingleRange('bytes=5-1', 100), { kind: 'unsatisfiable' });
    assert.equal(parseSingleRange('bytes=0-1,2-3', 100).kind, 'ignore');
  });
});

describe('media duration', () => {
  test('reads wav and mp4 durations only when the headers support it', () => {
    const wav = wavDurationSeconds(makeWav(0.25, 8000));
    assert.ok(wav != null && Math.abs(wav - 0.25) < 0.001);
    const mp4 = mp4DurationSeconds(makeMp4WithDuration(2.5, 1000));
    assert.ok(mp4 != null && Math.abs(mp4 - 2.5) < 0.001);
    assert.equal(mp4DurationSeconds(Buffer.from('not a movie')), null);
    assert.equal(wavDurationSeconds(Buffer.from('hello')), null);
  });
});

describe('log redaction', () => {
  test('removes tokens from structured logs', () => {
    const token = 'abc123456789tokenVALUE';
    const line = formatLog('listening', { guestUrl: `http://127.0.0.1/r/${token}`, port: 8787, note: `see ${token}` }, [token]);
    assert.equal(line.includes(token), false);
    assert.match(line, /redacted/);
    const cleaned = scrub({ authorization: token, ok: true }, [token]) as { authorization: string };
    assert.equal(cleaned.authorization, '[redacted]');
  });
});

describe('cli parsing', () => {
  test('reads flags without printing a token', () => {
    const opts = parseArgs(['share', '/tmp/demo folder', '--port', '9090', '--ttl', '15m', '--upload', '--max-upload', '10MB', '--advertise', '10.0.0.8']);
    assert.equal(opts.root, '/tmp/demo folder');
    assert.equal(opts.port, 9090);
    assert.equal(opts.ttl, '15m');
    assert.equal(opts.upload, true);
    assert.equal(opts.maxUpload, 10 * 1024 * 1024);
    assert.equal(opts.advertise, '10.0.0.8');
    assert.equal(parseSize('512KB'), 512 * 1024);
    assert.equal(isIPv4('10.1.2.3'), true);
    assert.equal(isIPv4('10.1.2.999'), false);
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/605'), 'iPhone · Safari');
  });
});
