// 묶고(build) 설치 파일을 만든다. 인자 없으면 지금 OS용, --mac / --win 으로 지정.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedConfigText, signingEnabled } from './signing.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const flag = process.argv.includes('--mac') ? ['--mac'] : process.argv.includes('--win') ? ['--win'] : [];
const run = (cmd, args, signing = false) => {
  // 서명할 때만 인증서 자동 탐색을 켠다(CSC_LINK 인증서를 쓴다). 아니면 끈다
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signing ? 'true' : 'false' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, [join(root, 'scripts', 'build.mjs')]);
const bin = join(dirname(createRequire(import.meta.url).resolve('electron-builder/package.json')), 'cli.js');
// 서명·공증 환경 변수가 다섯 개 다 있을 때만(맥) 서명 설정으로 만든다. 없으면 지금처럼 ad-hoc.
const sign = signingEnabled(process.env) && (flag.length === 0 ? process.platform === 'darwin' : flag[0] === '--mac');
const config = sign ? 'electron-builder.signed.tmp.yml' : 'electron-builder.yml';
if (sign) writeFileSync(join(root, config), signedConfigText(readFileSync(join(root, 'electron-builder.yml'), 'utf8')));
console.log(sign ? '맥 서명·공증을 켭니다' : '서명 없이(ad-hoc) 만듭니다');
try {
  run(process.execPath, [bin, '--config', config, '--publish', 'never', ...flag], sign);
} finally {
  if (sign) rmSync(join(root, config), { force: true });
}
