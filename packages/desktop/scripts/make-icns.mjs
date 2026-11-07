// build/icon.png(1024)에서 mac용 build/icon.icns를 만든다. png2icons는 어느 OS에서든 돈다.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const png2icons = createRequire(import.meta.url)('png2icons');
const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const icns = png2icons.createICNS(readFileSync(join(build, 'icon.png')), png2icons.BICUBIC, 0);
if (!icns) throw new Error('icns 변환 실패');
writeFileSync(join(build, 'icon.icns'), icns);
console.log(`build/icon.icns ${icns.length} bytes`);
