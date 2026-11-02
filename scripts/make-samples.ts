import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { makePdf, makeWav } from '../tests/fixtures.ts';

const root = path.resolve('examples/sample-library');

async function gradient(file: string, colors: [string, string], label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient></defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <circle cx="280" cy="250" r="120" fill="rgba(255,253,248,0.28)"/>
    <text x="72" y="700" fill="#fffdf8" font-size="54" font-family="Georgia, serif">${label}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toFile(file);
}

async function main() {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(root, 'Photos'), { recursive: true });
  await fs.mkdir(path.join(root, 'Docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'Audio'), { recursive: true });
  await fs.mkdir(path.join(root, '中文 文件夹'), { recursive: true });
  await gradient(path.join(root, 'Photos', '北山 日出.jpg'), ['#d85a2a', '#f2c14e'], 'North ridge');
  await gradient(path.join(root, 'Photos', 'coast-notes (1).jpg'), ['#1f6f78', '#d7efe8'], 'Coast notes');
  await gradient(path.join(root, 'Photos', 'evening window.jpg'), ['#2b2140', '#c46b4a'], 'Evening window');
  await fs.writeFile(path.join(root, 'Docs', '计划.pdf'), makePdf());
  await fs.writeFile(path.join(root, 'Audio', 'tuning-fork.wav'), makeWav(1.2, 8000));
  await fs.writeFile(path.join(root, 'Notes read me & friends #1.txt'), 'LocalCast sample library.\nChinese, spaces, and symbols live in the file names.\n');
  await fs.writeFile(path.join(root, '中文 文件夹', '特殊 字符.txt'), '这是一个用于演示的文本文件。\n');
  console.log(`Wrote ${root}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
