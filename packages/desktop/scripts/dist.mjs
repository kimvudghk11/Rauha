// 묶고(build) 설치 파일을 만든다. 인자 없으면 지금 OS용, --mac / --win 으로 지정.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const flag = process.argv.includes('--mac') ? ['--mac'] : process.argv.includes('--win') ? ['--win'] : [];
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, [join(root, 'scripts', 'build.mjs')]);
const bin = join(dirname(createRequire(import.meta.url).resolve('electron-builder/package.json')), 'cli.js');
run(process.execPath, [bin, '--config', 'electron-builder.yml', '--publish', 'never', ...flag]);
