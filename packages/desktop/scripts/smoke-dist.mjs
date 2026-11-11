// 만든 설치본(압축 푼 폴더)을 확인한다: 파일이 asar 밖에 있는지 보고, 가짜 팀으로 띄워 스크린샷이 찍히는지 본다.
// 실제 Claude는 부르지 않는다(RAUHA_FAKE_TEAM=1).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const release = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const arch = process.arch; // arm64 | x64
const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const app = win
  ? { exe: join(release, 'win-unpacked', 'Rauha.exe'), resources: join(release, 'win-unpacked', 'resources'), sdk: `win32-${arch}`, bin: 'claude.exe' }
  : mac
    ? (() => {
        const dir = join(release, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Rauha.app', 'Contents');
        return { exe: join(dir, 'MacOS', 'Rauha'), resources: join(dir, 'Resources'), sdk: `darwin-${arch}`, bin: 'claude' };
      })()
    : null;
if (!app) throw new Error(`지원하지 않는 OS: ${process.platform}`);

const problems = [];
const need = (path, label) => { if (!existsSync(path)) problems.push(`없음: ${label} (${path})`); };
need(app.exe, '실행 파일');
need(join(app.resources, 'app.asar'), 'app.asar');
need(join(app.resources, 'prompts', 'chief.md'), '프롬프트 폴더(resources/prompts)');
const unpacked = join(app.resources, 'app.asar.unpacked', 'node_modules', '@anthropic-ai');
need(join(unpacked, 'claude-agent-sdk', 'sdk.mjs'), 'Agent SDK (asar 밖)');
need(join(unpacked, `claude-agent-sdk-${app.sdk}`, app.bin), 'Agent SDK 실행 파일(asar 밖)');
need(join(app.resources, 'app.asar.unpacked', 'node_modules', '@playwright', 'mcp', 'package.json'), '브라우저 MCP(asar 밖)');
// 코드 탭 TS 언어 도구: worker 파일과 lib 는 asar 밖에서만 띄울 수 있다(scripts/smoke-features.mjs 가 실제로 돌려 본다)
need(join(app.resources, 'app.asar.unpacked', 'dist', 'ts-worker.cjs'), 'TS 언어 도구 worker(asar 밖)');
need(join(app.resources, 'app.asar.unpacked', 'dist', 'ts-lib', 'lib.d.ts'), 'TS lib 파일(asar 밖)');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('파일 배치 확인 완료');

if (mac) {
  const r = spawnSync('codesign', ['-dv', join(release, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Rauha.app')], { encoding: 'utf8' });
  console.log(`codesign: ${(r.stderr || r.stdout).trim().split('\n').join(' | ')}`);
}

const shot = join(process.env.RUNNER_TEMP ?? tmpdir(), 'rauha-smoke.png');
// 실제 사용자 폴더(~/.rauha, 앱 데이터)에 가짜 팀 기록이 남지 않게 임시 홈에서 띄운다.
const home = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'rauha-smoke-home-'));
const env = { ...process.env, RAUHA_FAKE_TEAM: '1', RAUHA_SMOKE_SHOT: shot, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), RAUHA_DATA_DIR: join(home, '.rauha', 'desktop') };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(app.exe, [`--user-data-dir=${join(home, 'electron')}`], { env, timeout: 90_000, encoding: 'utf8', stdio: 'inherit' });
if (run.status !== 0) { console.error(`실행 실패 status=${run.status} signal=${run.signal} error=${run.error?.message ?? ''}`); process.exit(1); }
if (!existsSync(shot) || statSync(shot).size < 10_000) { console.error(`스크린샷이 없거나 너무 작다: ${shot}`); process.exit(1); }
console.log(`스모크 통과: ${shot} ${statSync(shot).size} bytes`);
