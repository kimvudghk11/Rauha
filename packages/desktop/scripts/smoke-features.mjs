// 만든 설치본(압축 푼 폴더)에서 "개발 실행에서만 확인되던 기능"이 실제로 도는지 확인한다.
//  1 코드 탭 TS 언어 도구 worker(정의 이동·진단)  2 전체 찾기 worker(정규식)  3 DB 탭 SQLite 자식 프로세스
//  4 채팅 이미지 첨부 임시 폴더(만들어짐·읽을 수 있음·일이 끝나면 지워짐)  5 docker 없음 안내 / 있으면 찾음
// 실제 Claude는 부르지 않는다(RAUHA_FAKE_TEAM=1). 홈·앱 데이터·사용자 데이터는 임시 폴더로 바꾸고, 자기가 띄운 프로세스만 다룬다.
// 창은 시험 실행 규칙대로 2번 모니터(없으면 숨김). 사용: node scripts/smoke-features.mjs  (먼저 yarn dist --dir 같은 빌드가 필요)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const release = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const arch = process.arch;
const exe =
  process.platform === 'win32'
    ? join(release, 'win-unpacked', 'Rauha.exe')
    : process.platform === 'darwin'
      ? join(release, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Rauha.app', 'Contents', 'MacOS', 'Rauha')
      : null;
if (exe === null || !existsSync(exe)) {
  console.error(`실행 파일이 없다: ${exe}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'rauha-feat-'));
const dirs = Object.fromEntries(['home', 'appdata', 'local', 'data', 'user', 'work', 'temp', 'bin'].map((n) => [n, join(tmp, n)]));
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

// ── 임시 작업 폴더: TS 프로젝트(b.ts 에 타입 오류 하나) + 찾을 글 ──
mkdirSync(join(dirs.work, 'src'));
writeFileSync(join(dirs.work, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020', module: 'commonjs' }, include: ['src'] }));
writeFileSync(join(dirs.work, 'src', 'a.ts'), "export function greet(name: string): string {\n  return 'hi ' + name;\n}\n");
const bText = "import { greet } from './a';\nexport const x: number = greet('a');\n";
writeFileSync(join(dirs.work, 'src', 'b.ts'), bText);
writeFileSync(join(dirs.work, 'notes.txt'), 'alpha-123\nbeta\nalpha-45\n');
const greetColumn = bText.split('\n')[1].indexOf('greet(') + 2; // 1부터, 이름 안쪽

// ── 임시 sqlite 파일: 설치본 자신(ELECTRON_RUN_AS_NODE)의 node:sqlite 로 만든다 ──
const dbFile = join(dirs.work, 'sample.sqlite');
const baseEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('RAUHA_')) delete env[k];
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    ...env,
    USERPROFILE: dirs.home,
    HOME: dirs.home,
    APPDATA: dirs.appdata,
    LOCALAPPDATA: dirs.local,
    TEMP: dirs.temp,
    TMP: dirs.temp,
    TMPDIR: dirs.temp,
    RAUHA_DATA_DIR: dirs.data,
    RAUHA_WORK_DIR: dirs.work,
    RAUHA_FAKE_TEAM: '1',
    RAUHA_DISPLAY: process.env.RAUHA_DISPLAY ?? '2',
  };
};
const make = spawnSync(
  exe,
  ['-e', `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(dbFile)});d.exec("create table pets(id integer primary key,name text);insert into pets(name) values('rauha'),('delfi');");d.close();`],
  { env: { ...baseEnv(), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 },
);
if (make.status !== 0 || !existsSync(dbFile)) {
  console.error(`임시 sqlite 파일을 못 만들었다 (설치본에서 node:sqlite 가 안 된다): status=${make.status} ${make.stderr}`);
  process.exit(1);
}

// ── 한 번 띄워서 화면에서 식을 돌린다 ──
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function launch(name, expr, extraEnv, { onTick } = {}) {
  return new Promise((resolve) => {
    const shot = join(tmp, `${name}.png`);
    const env = { ...baseEnv(), ...extraEnv, RAUHA_SMOKE_SHOT: shot, RAUHA_SMOKE_WAIT: '300', RAUHA_SMOKE_EVAL: expr, RAUHA_SMOKE_EVAL_WAIT: '300' };
    const child = spawn(exe, [`--user-data-dir=${dirs.user}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const tick = onTick ? setInterval(onTick, 100) : null;
    const timer = setTimeout(() => child.kill(), 120_000); // 자기가 띄운 프로세스만 끝낸다
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (tick) clearInterval(tick);
      const line = out.split(/\r?\n/).find((l) => l.startsWith('EVAL '));
      let value = null;
      try {
        value = line ? JSON.parse(line.slice(5)) : null;
      } catch {
        /* 아래에서 실패로 보고한다 */
      }
      resolve({ code, value, out, err });
    });
  });
}

const results = [];
const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail });

// 1·2·3·5(docker 없음): PATH 에서 docker 를 뺀다
const noDockerPath = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin';
const main = `(async () => {
  const r = window.rauha; const o = {};
  const t0 = Date.now();
  o.def = await r.code.definition({ path: 'src/b.ts', text: ${JSON.stringify(bText)}, line: 2, column: ${greetColumn} });
  o.defMs = Date.now() - t0;
  o.diag = await r.code.diagnostics({ path: 'src/b.ts', text: ${JSON.stringify(bText)}, line: 1, column: 1 });
  o.search = await r.code.search({ query: 'alpha-\\\\d+', caseSensitive: false, regex: true });
  o.badRegex = await r.code.search({ query: '(', caseSensitive: false, regex: true });
  o.dbAdd = await r.db.addPath({ path: ${JSON.stringify(dbFile)} });
  if (o.dbAdd.ok) {
    const id = o.dbAdd.data.id;
    o.dbTables = await r.db.tables(id);
    o.dbQuery = await r.db.query({ id, sql: 'select name from pets order by id', writeMode: false, confirm: false });
  }
  o.docker = await r.docker.status();
  return o;
})()`;
const m = await launch('main', main, { PATH: noDockerPath });
const v = m.value;
if (v === null) {
  check('앱이 식을 돌려 결과를 냈다', false, `exit=${m.code} out=${m.out.slice(-400)} err=${m.err.slice(-400)}`);
} else {
  check('1a TS 정의 이동(worker)', v.def?.ok && v.def.locations?.[0]?.path === 'src/a.ts' && v.def.locations[0].line === 1, JSON.stringify(v.def)?.slice(0, 200) + ` (${v.defMs}ms)`);
  check('1b TS 진단: 타입 오류(lib 파일 읽기)', v.diag?.ok && v.diag.semantic === true && v.diag.items.some((d) => /number/.test(d.message ?? '')), JSON.stringify(v.diag)?.slice(0, 240));
  const hits = v.search?.ok ? v.search.files.flatMap((f) => f.hits) : [];
  check('2a 정규식 전체 찾기(worker)', v.search?.ok && v.search.stopped === null && hits.length === 2, JSON.stringify(v.search)?.slice(0, 240));
  check('2b 잘못된 정규식은 안내로', v.badRegex?.ok === false && v.badRegex.reason === 'bad-regex', JSON.stringify(v.badRegex));
  check('3a SQLite 파일 열기', v.dbAdd?.ok, JSON.stringify(v.dbAdd)?.slice(0, 200));
  check('3b 표 목록', v.dbTables?.ok && v.dbTables.data.some((t) => t.name === 'pets'), JSON.stringify(v.dbTables)?.slice(0, 200));
  check('3c 쿼리 결과', v.dbQuery?.ok && JSON.stringify(v.dbQuery.data).includes('delfi'), JSON.stringify(v.dbQuery)?.slice(0, 300));
  check('5a docker 없음 안내(PATH 에 없음)', v.docker?.ready === false && v.docker.failure !== null && v.docker.clientVersion === null, JSON.stringify(v.docker)?.slice(0, 300));
}

// 5b: docker 가 있는 PC 에서만 — PATH 를 넣으면 절대 경로로 찾는지(엔진이 꺼져 있어도 client 버전은 나온다)
const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['docker'], { encoding: 'utf8' });
const dockerDir = found.status === 0 ? dirname(found.stdout.split(/\r?\n/)[0].trim()) : null;
if (dockerDir !== null && existsSync(dockerDir)) {
  const d = await launch('docker', `(async () => window.rauha.docker.status())()`, { PATH: [noDockerPath, dockerDir].join(delimiter) });
  check('5b docker 있으면 절대 경로로 찾음', d.value !== null && (d.value.clientVersion !== null || d.value.ready === true), JSON.stringify(d.value)?.slice(0, 240));
}

// 4: 이미지 첨부 — 허락을 기다리는 일에 이미지를 붙이고, 임시 폴더가 생기는지·읽히는지·일이 멈추면 지워지는지 본다
const attachRoot = join(dirs.data, 'attachments');
let staged = null;
const watch = () => {
  if (staged !== null || !existsSync(attachRoot)) return;
  for (const d of readdirSync(attachRoot)) {
    const files = readdirSync(join(attachRoot, d));
    if (files.length > 0) staged = { dir: join(attachRoot, d), files };
  }
};
const imageExpr = `(async () => {
  const bytes = Uint8Array.from(atob('${PNG_1X1}'), (c) => c.charCodeAt(0));
  const job = await window.rauha.submit('이미지 허락 확인', [bytes]);
  await new Promise((r) => setTimeout(r, 1500));
  window.rauha.stop(job.id);
  await new Promise((r) => setTimeout(r, 1500));
  return { job: job && job.id };
})()`;
const img = await launch('image', imageExpr, { PATH: noDockerPath, RAUHA_SMOKE_REQUEST: '이미지 시험 허락' }, { onTick: watch });
watch();
check('4a 이미지 첨부 일 접수', img.value?.job, JSON.stringify(img.value));
check('4b 임시 폴더가 앱 데이터 폴더 아래(app.asar 밖)에 생김', staged !== null && !staged.dir.includes('app.asar') && staged.files[0].endsWith('.png'), staged === null ? '폴더 못 봄' : `${staged.dir} ${staged.files}`);
check('4c 일이 멈추면 임시 폴더를 지움', staged !== null && !existsSync(staged.dir), staged?.dir);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : `\n      ${r.detail}`}`);
}
rmSync(tmp, { recursive: true, force: true });
if (failed > 0) {
  console.error(`기능 스모크 실패 ${failed}건`);
  process.exit(1);
}
console.log('기능 스모크 통과');
