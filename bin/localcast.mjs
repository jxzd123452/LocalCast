#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'cli.js');
const args = existsSync(dist)
  ? [dist, ...process.argv.slice(2)]
  : ['--import', 'tsx', path.join(root, 'src', 'cli.ts'), ...process.argv.slice(2)];

const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
