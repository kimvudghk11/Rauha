// 만든 설치본(압축 푼 폴더)에서 "개발 실행에서만 확인되던 기능"이 실제로 도는지 확인한다.
//  1 코드 탭 TS 언어 도구 worker(정의 이동·진단)  2 전체 찾기 worker(정규식)  3 DB 탭 SQLite 자식 프로세스
//  6 진짜 터미널(PTY): 셸 띄우기 → echo → 출력 받기 → 크기 조절 → 환경 변수 격리 → exit
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
// zsh 는 홈에 .zshrc 가 없으면 새 사용자 안내 질문을 해서 입력을 먹는다. 빈 파일을 둔다.
writeFileSync(join(dirs.home, '.zshrc'), '');
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
const dockerInBase = noDockerPath.split(delimiter).some((d) => existsSync(join(d, process.platform === 'win32' ? 'docker.exe' : 'docker')));
if (dockerInBase) console.log('참고: 기본 PATH 폴더에 docker 가 있어 5a(docker 없음 안내)는 건너뜁니다');
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
  o.pty = await (async () => {
    const t = r.terminal; const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const evs = []; t.onEvent((e) => { evs.push(e); if (e.type === 'data') t.ack(e.id, e.data.length); });
    const op = await t.open({ rootPath: '', cols: 100, rows: 30 });
    if (!op.ok) return { open: op };
    const id = op.id;
    const text = () => evs.filter((e) => e.id === id && e.type === 'data').map((e) => e.data).join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const until = async (re, ms) => { for (let i = 0; i < ms / 100; i++) { if (re.test(text())) return true; await sleep(100); } return false; };
    const started = await until(/[\\s\\S]/, 20000);
    await sleep(1500);
    await t.write(id, 'echo PTYMARK1\\r');
    const echoed = await until(/\\r?\\nPTYMARK1\\r?\\n/, 15000);
    await t.resize(id, 140, 30);
    await t.write(id, ${JSON.stringify(process.platform === 'win32')} ? 'echo "ENV[$env:RAUHA_DATA_DIR]"\\r' : 'echo "ENV[$RAUHA_DATA_DIR]"\\r');
    const envClean = await until(/\\r?\\nENV\\[\\]\\r?\\n/, 15000);
    await t.write(id, 'exit\\r');
    let exit = null; for (let i = 0; i < 100 && exit === null; i++) { exit = evs.find((e) => e.id === id && e.type === 'exit') ?? null; await sleep(100); }
    await t.close(id);
    return { open: op, started, echoed, envClean, exit, head: text().slice(0, 1200), tail: text().slice(-600) };
  })();
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
  check('6a 진짜 터미널: 셸이 뜨고 출력이 온다', v.pty?.open?.ok && v.pty.started, JSON.stringify(v.pty)?.slice(0, 2400));
  check('6b 터미널: echo 가 입력→출력으로 돌아온다', v.pty?.echoed, JSON.stringify(v.pty)?.slice(0, 2400));
  check('6c 터미널: rauha 내부 환경 변수(RAUHA_DATA_DIR)가 셸에 없다', v.pty?.envClean, JSON.stringify(v.pty)?.slice(0, 2400));
  check('6d 터미널: exit 로 셸이 끝나면 종료 이벤트가 온다', v.pty?.exit?.code === 0, JSON.stringify(v.pty)?.slice(0, 2400));
  // GitHub 윈도우 러너처럼 docker 가 시스템 폴더(System32)에 깔린 PC 는 PATH 를 줄여도 docker 가 남는다. 그때는 "없음 안내"를 볼 수 없어 건너뛴다.
  if (!dockerInBase) check('5a docker 없음 안내(PATH 에 없음)', v.docker?.ready === false && v.docker.failure !== null && v.docker.clientVersion === null, JSON.stringify(v.docker)?.slice(0, 300));
}

// 6 터미널은 위 m 식에서 같이 돈다(앱 한 번 띄우는 비용을 아낀다)

// 5b: docker 가 있는 PC 에서만 — PATH 를 넣으면 절대 경로로 찾는지(엔진이 꺼져 있어도 client 버전은 나온다)
const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['docker'], { encoding: 'utf8' });
const dockerDir = found.status === 0 ? dirname(found.stdout.split(/\r?\n/)[0].trim()) : null;
if (dockerDir !== null && existsSync(dockerDir)) {
  const d = await launch('docker', `(async () => window.rauha.docker.status())()`, { PATH: [noDockerPath, dockerDir].join(delimiter) });
  // GitHub 윈도우 러너의 Docker 엔진은 가끔 제시간에 답하지 않는다(v0.2.1 에서 이것만으로 실패). 시간 초과는 docker 를 찾아 실행까지 했다는 뜻이라 "찾음"으로 본다.
  // "설치되지 않음" 같은 다른 실패는 그대로 실패다.
  check('5b docker 있으면 절대 경로로 찾음', d.value !== null && (d.value.clientVersion !== null || d.value.ready === true || d.value.failure?.kind === 'timeout'), JSON.stringify(d.value)?.slice(0, 240));
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
  // CI 로그는 로그인 없이 못 보므로, 실패는 GitHub 주석(annotation)으로도 남긴다(공개 API 로 읽힌다).
  if (!r.ok && process.env.GITHUB_ACTIONS === 'true') {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=${esc(`smoke:features ${process.platform}: ${r.label}`).replace(/[:,]/g, ' ')}::${esc(String(r.detail ?? '').slice(0, 1500))}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
if (failed > 0) {
  console.error(`기능 스모크 실패 ${failed}건`);
  process.exit(1);
}
console.log('기능 스모크 통과');
