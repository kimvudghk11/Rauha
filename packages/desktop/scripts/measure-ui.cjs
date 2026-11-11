// 화면 부품의 크기·정렬을 숫자로 잰다. 창을 화면에 띄우지 않고(show 무효화), 새 임시 데이터 폴더·가짜 팀으로 돌려
// 실제 Claude를 부르지 않는다. 사용: electron scripts/measure-ui.cjs <결과 json 경로> [탭,탭,...] [너비,너비,...]
// 결과: 보이는 button·select·input·textarea와 칩·탭 같은 부품의 높이, 안쪽 여백, 줄 높이, 글자 정렬, 색.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.RAUHA_FAKE_TEAM = '1';
// 가짜 팀이 "[edit]" 요청에서 작업 폴더 파일을 실제로 바꾼다(변경 보기·되돌리기 장면용)
process.env.RAUHA_FAKE_EDIT = '1';
// Docker 탭은 진짜 docker 대신 가짜 실행기를 쓴다(엔진이 꺼진 PC에서도 목록·꺼짐 안내를 잰다). 장면에서 FAKE_DOCKER_MODE 로 켜짐/꺼짐을 바꾼다.
process.env.RAUHA_DOCKER_BIN = path.join(__dirname, '..', 'src', 'main', 'docker', 'fake-docker.cjs');
process.env.FAKE_DOCKER_MODE = 'ok';
// 실제 ~/.rauha 설정(작업 폴더·AWS 등)을 건드리지 않게 홈과 앱 데이터 폴더를 임시 폴더로 돌린다(os.homedir()은 USERPROFILE/HOME을 읽는다)
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-home-'));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = path.join(fakeHome, 'AppData', 'Local');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-')));
// 기록·할 일 파일도 임시 폴더에 둔다(내 실제 기록에 시험 기록이 쌓이지 않게)
process.env.RAUHA_DATA_DIR = process.env.RAUHA_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-data-'));
// 최근 작업 폴더 시험: 있는 폴더 둘과 없는 폴더 하나를 설정에 미리 적어 둔다(첫 실행 마법사·설정 화면의 최근 목록을 잰다)
{
  const seedDir = (n) => fs.mkdirSync(path.join(fakeHome, n), { recursive: true }) ?? path.join(fakeHome, n);
  const recent = [seedDir('proj-alpha'), path.join(fakeHome, 'proj-gone'), seedDir('proj-beta-with-a-quite-long-folder-name-to-check-ellipsis')];
  fs.mkdirSync(path.join(fakeHome, '.rauha', 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.rauha', 'desktop', 'settings.json'), JSON.stringify({ recentFolders: recent }));
}
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};

const out = process.argv.find((a, i) => i > 1 && a.endsWith('.json')) ?? path.join(os.tmpdir(), 'rauha-measure.json');
const rest = process.argv.filter((a, i) => i > 1 && !a.endsWith('.json') && !a.startsWith('-') && a !== '.');
const TABS = (rest[0] ?? 'chat,code,todo,records,git,commands,rules,settings').split(',');
const WIDTHS = (rest[1] ?? '1700,1100,720,600').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(() => {
  const sel = 'button, select, input, textarea, .chip, .rtag, .gtab, .tree-row, .act button, .dtabs button, .ltoggle button, [role=button], svg.fi, .sbadge';
  const rows = [];
  const trail = (n) => { const p = []; for (let e = n; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')); return p.join(' > '); };
  for (const n of document.querySelectorAll(sel)) {
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const c = getComputedStyle(n);
    rows.push({
      tag: n.tagName.toLowerCase(), cls: typeof n.className === 'string' ? n.className : '', type: n.type || '', text: (n.textContent || n.value || n.placeholder || '').trim().slice(0, 24),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      pad: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].join(' '), fs: c.fontSize, lh: c.lineHeight, fw: c.fontWeight,
      display: c.display, ai: c.alignItems, jc: c.justifyContent, ta: c.textAlign,
      color: c.color, bg: c.backgroundColor, bd: c.borderTopWidth + ' ' + c.borderTopColor, radius: c.borderTopLeftRadius,
      clipped: n.scrollWidth > n.clientWidth + 1 && c.overflow !== 'visible' ? 1 : 0, path: trail(n),
    });
  }
  const over = [];
  for (const n of document.querySelectorAll('.menu.ctx, .veil .dialog')) { const r = n.getBoundingClientRect(); if (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || r.left < -1) over.push('화면 밖 ' + n.className); }
  for (const n of document.querySelectorAll('.tree-row, .repo-line, .tree-edit')) if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible') { const r = n.getBoundingClientRect(); if (r.right > (document.querySelector('.code-explorer')?.getBoundingClientRect().right ?? 9999) + 1) over.push('탐색기 밖으로 나감 ' + n.className); }
  const clipped = (n) => { for (let e = n.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o !== 'visible') return true; } return false; };
  for (const n of document.querySelectorAll('.main *')) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.right > window.innerWidth + 1 && !clipped(n)) over.push(trail(n)); if (over.length > 8) break; }
  const gt = document.querySelector('.gtool'); const tool = gt ? { sw: gt.scrollWidth, cw: gt.clientWidth, tops: [...gt.querySelectorAll('.gbranch, .gsync .btn')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => Math.round(n.getBoundingClientRect().top)) } : null;
  const topsOf = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getBoundingClientRect().width > 0).map((n) => Math.round(n.getBoundingClientRect().top));
  const rd = document.querySelector('.records .rdbar');
  const rec = document.querySelector('.records') ? {
    bar: rd ? { sw: rd.scrollWidth, cw: rd.clientWidth, tops: topsOf('.records .rdbar > .btn') } : null,
    pickTops: topsOf('.records .rpick > .bar:nth-child(2) > .btn'), pickSw: (document.querySelector('.records .rpick') || {}).scrollWidth || 0, pickCw: (document.querySelector('.records .rpick') || {}).clientWidth || 0,
    primaries: [...document.querySelectorAll('.records .btn.primary')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.textContent.trim()),
    iconOnly: [...document.querySelectorAll('.records .btn.icon')].filter((n) => !n.title || !n.getAttribute('aria-label')).length,
    clippedBtn: [...document.querySelectorAll('.records .btn')].filter((n) => n.getBoundingClientRect().width > 0 && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent.trim()),
    rows: [...document.querySelectorAll('.records .ri')].slice(0, 3).map((n) => n.scrollWidth > n.clientWidth + 1), tier: document.querySelector('.app')?.dataset.tier, cols: getComputedStyle(document.querySelector('.records .rec')).gridTemplateColumns, cls: document.querySelector('.records .rec').className,
  } : null;
  const layout = [...document.querySelector('.app').children].map((n) => n.className + ':' + Math.round(n.getBoundingClientRect().top) + '+' + Math.round(n.getBoundingClientRect().height)).join(' ') + ' scroll=' + document.scrollingElement.scrollTop + '/' + document.body.scrollTop + ' appTop=' + Math.round(document.querySelector('.app').getBoundingClientRect().top); const cm = document.querySelector('.cm-content'); return { layout, big: window.__bigT || null, tool, rec, cm: cm ? (cm.getAttribute('style') || cm.style.cssText || 'no-style') : 'no-editor', innerWidth: window.innerWidth, hscroll: document.scrollingElement.scrollWidth - window.innerWidth, over, rows };
})()`;

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', () => void run(win));
});

// 시험용 작업 폴더: 레포 둘(하나는 변경·앞섬·브랜치가 있고, 하나는 머지 충돌 중)
function sandbox() {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-work-'));
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}' + String.fromCharCode(10));
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, stdio: 'pipe' });
  const w = (cwd, f, t) => fs.writeFileSync(path.join(cwd, f), t);
  const bare = path.join(root, 'origin.git');
  fs.mkdirSync(bare);
  git(bare, 'init', '--bare', '-b', 'main');
  const a = path.join(root, 'app-one');
  fs.mkdirSync(a);
  git(a, 'init', '-b', 'main');
  w(a, 'README.md', '# one\n');
  w(a, 'main.ts', 'export const a = 1;\n');
  git(a, 'add', '.');
  git(a, 'commit', '-m', 'first');
  git(a, 'remote', 'add', 'origin', bare);
  git(a, 'push', '-u', 'origin', 'main');
  git(a, 'checkout', '-b', 'feature/x');
  w(a, 'x.ts', 'export const x = 1;\n');
  git(a, 'add', '.');
  git(a, 'commit', '-m', 'add x');
  git(a, 'checkout', 'main');
  w(a, 'staged.ts', 'export const s = 1;\n');
  git(a, 'add', 'staged.ts');
  git(a, 'commit', '-m', 'local ahead');
  w(a, 'main.ts', 'export const a = 2;\nexport const b = 3;\n');
  w(a, 'new.txt', 'new\n');
  w(a, 'staged2.ts', 'export const s2 = 1;\n');
  git(a, 'add', 'staged2.ts');
  const c = path.join(root, 'app-two');
  fs.mkdirSync(c);
  git(c, 'init', '-b', 'main');
  w(c, 'f.txt', 'base\n');
  git(c, 'add', '.');
  git(c, 'commit', '-m', 'base');
  git(c, 'checkout', '-b', 'other');
  w(c, 'f.txt', 'other\n');
  git(c, 'commit', '-am', 'other');
  git(c, 'checkout', 'main');
  w(c, 'f.txt', 'main\n');
  git(c, 'commit', '-am', 'main');
  try {
    git(c, 'merge', 'other');
  } catch {
    /* 충돌이 나야 한다 */
  }
  // 큰 레포(MEASURE_BIG=1일 때만): 새 파일 3500개 + 2만 줄이 전부 바뀐 파일 하나
  if (process.env.MEASURE_BIG) {
    const g = path.join(root, 'app-big');
    fs.mkdirSync(g);
    git(g, 'init', '-b', 'main');
    w(g, 'aaa-big.txt', Array.from({ length: 20000 }, (_, i) => 'old line ' + i).join(String.fromCharCode(10)) + String.fromCharCode(10));
    git(g, 'add', '.');
    git(g, 'commit', '-m', 'big base');
    w(g, 'aaa-big.txt', Array.from({ length: 20000 }, (_, i) => 'new line ' + i).join(String.fromCharCode(10)) + String.fromCharCode(10));
    for (let d = 0; d < 35; d++) {
      fs.mkdirSync(path.join(g, 'dir' + d));
      for (let i = 0; i < 100; i++) w(g, 'dir' + d + '/f' + i + '.txt', 'x' + i + String.fromCharCode(10));
    }
  }
  // 커밋 그래프 시험용: 병합 커밋 둘, 브랜치 셋, 작성자 둘(app-graph)
  const gr = path.join(root, 'app-graph');
  fs.mkdirSync(gr);
  git(gr, 'init', '-b', 'main');
  const lines = (...t) => t.join(String.fromCharCode(10)) + String.fromCharCode(10);
  w(gr, 'src.ts', lines('line 1', 'line 2', 'line 3', 'line 4', 'line 5'));
  git(gr, 'add', '.');
  git(gr, 'commit', '-m', 'init');
  git(gr, 'checkout', '-b', 'feature/a');
  w(gr, 'src.ts', lines('line 1', 'line 2 from a', 'line 3', 'line 4', 'line 5'));
  git(gr, 'commit', '-am', 'feature a: change line 2');
  git(gr, 'checkout', 'main');
  w(gr, 'src.ts', lines('line 1', 'line 2', 'line 3', 'line 4 from bo', 'line 5'));
  git(gr, '-c', 'user.name=Bo Lee', 'commit', '-am', 'main: change line 4');
  git(gr, 'merge', '--no-ff', '-m', 'Merge feature/a', 'feature/a');
  git(gr, 'checkout', '-b', 'feature/b');
  w(gr, 'b.ts', lines('export const b = 1;'));
  git(gr, 'add', '.');
  git(gr, 'commit', '-m', 'feature b: add b.ts');
  git(gr, 'checkout', 'main');
  w(gr, 'main.ts', lines('export const m = 1;'));
  git(gr, 'add', '.');
  git(gr, 'commit', '-m', 'main: add main.ts');
  git(gr, 'merge', '--no-ff', '-m', 'Merge feature/b', 'feature/b');
  w(gr, 'src.ts', lines('line 1', 'line 2 from a', 'line 3', 'line 4 from bo', 'line 5 latest'));
  git(gr, 'commit', '-am', 'main: tweak line 5');
  // 원격보다 2커밋 뒤처진 레포: 다른 복제본에서 올린 뒤 fetch만 한다
  const d = path.join(root, 'app-three');
  git(root, 'clone', bare, d);
  const e = path.join(root, 'clone-e');
  git(root, 'clone', bare, e);
  w(e, 'e1.txt', '1\n');
  git(e, 'add', '.');
  git(e, 'commit', '-m', 'feat(ui): 가져올 첫 커밋');
  w(e, 'e2.txt', '2\n');
  git(e, 'add', '.');
  git(e, 'commit', '-m', 'fix(ui): 가져올 둘째 커밋');
  git(e, 'push');
  git(d, 'fetch');
  return root;
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click()`;
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((n) => n.textContent.includes(${JSON.stringify(text)}))?.click()`;
const TAB = { chat: 0, code: 1, todo: 2, api: 3, docker: 4, records: 5, git: 6, commands: 7, rules: 8, settings: 9 };
// [이름, 탭, 그 탭에서 먼저 할 클릭들(CSS 선택자 또는 완성된 JS)]
// 레포 이름으로 git 탭의 레포를 고른다(기억된 레포가 장면마다 달라지지 않게 장면마다 먼저 고른다)
const pickRepo = (name) => `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let s = null; for (let i = 0; i < 80 && !(s = document.querySelector('.gselect')); i++) await sleep(100); if (!s) throw new Error('git 탭의 .gselect(레포 고르기)가 8초 안에 나타나지 않았어요'); const o = [...s.options].find((o) => o.text.startsWith(${JSON.stringify(name)})); s.value = o.value; s.dispatchEvent(new Event('change')); await sleep(300); for (let i = 0; i < 80 && !document.querySelector('.gcommit'); i++) await sleep(100); await sleep(400); })() /* querySelector */`;
// 코드 탭 장면 도우미: 열려 있는 메뉴·대화상자·입력칸을 닫고, 레포 정보가 입혀질 때까지 기다리고, 이름으로 줄을 찾아 누른다
const CLEAN = "(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); if (['s', 'xs'].includes(document.querySelector('.app').dataset.tier)) document.querySelector('.code').classList.add('explorer-open'); })() /* querySelector */";
const WAIT = "(() => new Promise((r) => setTimeout(r, 1200)))() /* querySelector */";
// 팀이 일하는 레포의 파일을 바꾸려 하면 뜨는 "작업 중인 레포예요" 경고만 넘긴다(다른 대화상자는 그대로 둔다)
const WARNOK = "(() => { const d = document.querySelector('.dialog'); if (d?.querySelector('b')?.textContent.includes('작업 중인 레포')) d.querySelector('.btn.primary').click(); })() /* querySelector */";
const rowOf = (name) => "[...document.querySelectorAll('.tree-row')].find((n) => n.querySelector('.tree-name')?.textContent === " + JSON.stringify(name) + ")";
const expandByName = (name) => "(() => { const r = " + rowOf(name) + "; if (r?.querySelector('.tree-chev')?.textContent === '▸') r.click(); })() /* querySelector */";
const rowByName = (name) => "(() => { " + rowOf(name) + "?.click(); })()";
const rightClick = (name) => "(() => { const r = " + rowOf(name) + "; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 24, clientY: b.y + 10 })); })()";
const pressKey = (name, key) => "(() => { " + rowOf(name) + "?.dispatchEvent(new KeyboardEvent('keydown', { key: " + JSON.stringify(key) + ", bubbles: true, cancelable: true })); })()";
const typeInto = (sel, text) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const TODO_SEED = "(() => { window.rauha.todo.apply({ kind: 'add', title: '시험 카드', priority: 'high', labels: [{ name: '중요', color: 'blue' }], checklist: [{ id: 'c1', text: '항목', done: true }] }); return new Promise((r) => setTimeout(r, 500)); })() /* querySelector */";
const SELECT_ALL = "(() => { const c = document.querySelector('.cm-content'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); })() /* querySelector */";
// 변경 보기 장면: [edit] 일이 끝나 결과 카드에 변경 칸이 나타날 때까지 기다렸다가 펼친다 / 그 일의 팀 상세를 연다
const CHG_OPEN = "(async () => { for (let i = 0; i < 80 && !document.querySelector('.chg:not([hidden]) .chg-toggle'); i++) await new Promise((r) => setTimeout(r, 200)); const t = document.querySelector('.chg:not([hidden]) .chg-toggle'); if (t?.getAttribute('aria-expanded') === 'false') t.click(); })() /* querySelector */";
const CHG_DETAIL = "(async () => { for (let i = 0; i < 80 && !document.querySelector('.chg:not([hidden]) .chg-toggle'); i++) await new Promise((r) => setTimeout(r, 200)); [...document.querySelectorAll('.hand')].find((h) => h.textContent.includes('[edit]'))?.querySelector('.go')?.click(); await new Promise((r) => setTimeout(r, 600)); })() /* querySelector */";
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// 클립보드에 그림 파일만 있는 붙여넣기(스크린샷)를 흉내 낸다. count 장, 마지막에 글 파일(이미지가 아님)을 하나 더 넣을 수 있다.
const pasteImages = (count, withText) => `(async () => { const i = document.querySelector('.composer textarea'); i.focus(); const dt = new DataTransfer(); const b = Uint8Array.from(atob(${JSON.stringify('${PNG}')}), (c) => c.charCodeAt(0)); for (let n = 0; n < ${count}; n++) dt.items.add(new File([b], 'shot-' + n + '-with-a-quite-long-file-name-to-check-ellipsis.png', { type: 'image/png' })); if (${withText}) dt.items.add(new File([new TextEncoder().encode('console.log(1) console.log(2)')], 'fake.png', { type: 'image/png' })); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 600)); })() /* querySelector */`.replace('${PNG}', PNG_B64);
const DLG = "(async () => { for (let i = 0; i < 60 && !document.querySelector('.veil .dialog'); i++) await new Promise((r) => setTimeout(r, 200)); })() /* querySelector */";
const DLG_OK = "(async () => { for (let i = 0; i < 60 && !document.querySelector('.veil .dialog'); i++) await new Promise((r) => setTimeout(r, 200)); document.querySelector('.veil .dialog .btn.danger, .veil .dialog .btn.primary')?.click(); await new Promise((r) => setTimeout(r, 3000)); })() /* querySelector */";
const SCENES = [
  ['chat', 'chat', []],
  ['chat-detail', 'chat', ['.room']],
  // @ 를 치면 폴더와 파일 후보가 입력칸 위에 뜬다(검색어 없음 / 경로 일부)
  // 작업 결과 변경 보기: 카드(접힘→펼침) · 파일 diff · 전체 되돌리기 확인 창 · 팀 상세의 변경 칸 · 되돌린 뒤 · Undo the undo (되돌리는 장면은 마지막에)
  ['chat-changes', 'chat', [CHG_OPEN]],
  ['chat-changes-diff', 'chat', [CHG_OPEN, q('.chg-file')]],
  ['chat-changes-file-ask', 'chat', [CHG_OPEN, byText('.chg .btn', 'Revert file'), DLG]],
  ['chat-changes-undo-ask', 'chat', [CHG_OPEN, byText('.chg .btn', 'Undo all changes'), DLG]],
  ['chat-changes-detail', 'chat', [CHG_DETAIL]],
  ['chat-changes-detail-diff', 'chat', [CHG_DETAIL, q('.dbody .chg-file')]],
  ['chat-changes-reverted', 'chat', [CHG_OPEN, byText('.chg .btn', 'Undo all changes'), DLG_OK]],
  ['chat-changes-redo', 'chat', [CHG_OPEN, byText('.chg .btn', 'Undo the undo'), DLG_OK]],
  // 이미지 붙여넣기: 1장 / 3장(칩 3개) / 5장(3장까지만, 안내) / 이미지가 아닌 파일(거절 안내)
  // 그림을 붙인 채 보내면 팀에 넘어가고(가짜 팀) 입력칸의 칩이 비워진다. 앱 데이터 폴더의 attachments 에 일이 도는 동안만 그림이 있다.
  ['chat-image-send', 'chat', [pasteImages(2, false), typeInto('.composer textarea', '그림 보내기 시험'), "(async () => { const i = document.querySelector('.composer textarea'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 900)); })() /* querySelector */"]],
  ['chat-image', 'chat', [pasteImages(1, false)]],
  ['chat-image-3', 'chat', [pasteImages(3, false), typeInto('.composer textarea', '이 화면 고쳐줘')]],
  ['chat-image-over', 'chat', [pasteImages(5, false)]],
  ['chat-image-fake', 'chat', [pasteImages(0, true)]],
  ['chat-mention', 'chat', [typeInto('.composer textarea', '@')]],
  ['chat-mention-query', 'chat', [typeInto('.composer textarea', '결제 고쳐줘 @app-one/ma')]],
  ['chat-approval', 'chat', [byText('.room', '허락')]],
  ['code', 'code', []],
  ['code-file', 'code', ['.tree-row:not(.heavy)', '.tree-row:not(.heavy):nth-child(3)']],
  // 편집기를 실제로 조작한다(찾기 패널·입력·Alt 십자 커서·빠른 열기): 화면 콘솔 오류가 나는지 본다
  ['code-edit', 'code', ['.tree-row:not(.heavy)', '.tree-row:not(.heavy):nth-child(3)', `(() => { const c = document.querySelector('.cm-content'); c.focus(); const k = (key, o = {}) => c.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o })); k('f', { ctrlKey: true }); k('Alt', { altKey: true }); k('End'); k('Tab'); document.execCommand('insertText', false, 'x'); k('p', { ctrlKey: true }); k('Escape'); })()`]],
  // 아이콘 갤러리: 문서에 들어 있는 모든 파일 아이콘 심볼을 16px로 그려 크기를 잰다
  ['code-icons', 'code', [`(() => { const g = document.createElement('div'); g.className = 'tree'; for (const sym of document.querySelectorAll('symbol[id^=fi-]')) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'fi fi-blue'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + sym.id); s.append(u); g.append(s); } document.querySelector('.code-explorer').append(g); })()`]],
  ['code-term', 'code', ['.code-termbtn']],
  ['code-search', 'code', ['.code-mode:nth-child(2)']],
  ['todo', 'todo', []],
  // 칸반: 카드 하나를 넣고(체크리스트·라벨·우선순위 포함) 보드 · 새 카드 입력 · 카드 모달 · 우클릭 메뉴 · 칸 메뉴 · 칸 지우기 창
  ['todo-seeded', 'todo', [TODO_SEED]],
  ['todo-adder', 'todo', [TODO_SEED, byText('.tcol .tadd', '+ New')]],
  ['todo-card-modal', 'todo', [TODO_SEED, '.tcard']],
  ['todo-card-menu', 'todo', [TODO_SEED, "(() => { const c = document.querySelector('.tcard'); const b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 24, clientY: b.y + 10 })); })()"]],
  ['todo-col-menu', 'todo', [TODO_SEED, '.tch .btn.icon:last-child']],
  ['todo-col-delete', 'todo', [TODO_SEED, '.tch .btn.icon:last-child', byText('.menu button', 'Delete column')]],
  // Docker 탭(가짜 docker): 목록 · 로그 · 다른 목록 탭 · 삭제 확인 창 · 엔진 꺼짐 안내
  ['docker', 'docker', []],
  ['docker-logs', 'docker', ['.dk-table tbody tr']],
  ['docker-images', 'docker', [byText('.docker .tab', 'Images')]],
  ['docker-volumes', 'docker', [byText('.docker .tab', 'Volumes')]],
  ['docker-networks', 'docker', [byText('.docker .tab', 'Networks')]],
  ['docker-compose', 'docker', [byText('.docker .tab', 'Compose'), byText('.dk-table .btn', 'Status')]],
  ['docker-remove-ask', 'docker', [byText('.dk-table .btn', 'Remove')]],
  ['docker-off', 'docker', [() => { process.env.FAKE_DOCKER_MODE = 'off'; }, byText('.dk-head .btn', 'Refresh')]],
  // API 탭: 빈 화면 · 안 열리는 주소로 보낸 실패 응답 · 왼쪽 목록 열기 · 환경 관리 창 · 가져오기 창
  ['api', 'api', []],
  ['api-failed', 'api', [typeInto('.api-url-input', 'http://127.0.0.1:9/none'), '.api-send']],
  ['api-list', 'api', ['.api-toggle']],
  ['api-env', 'api', [byText('.btn', 'Manage')]],
  ['api-import', 'api', [byText('.btn', 'Import')]],
  ['records', 'records', []],
  ['records-detail', 'records', ['.ri']],
  ['records-picked', 'records', [`(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`]],
  ['records-picked-detail', 'records', ['.ri', `(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`]],
  ['records-delete-ask', 'records', ['.ri', byText('.rdbar .btn', 'Delete')]],
  ['records-picked-delete-ask', 'records', [`(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`, byText('.rpick .btn', 'Delete')]],
  ['records-range', 'records', [`(() => { const b = document.querySelectorAll('.rpickrow input'); b[0].click(); })()`, `(() => { const b = document.querySelectorAll('.rpickrow input'); b[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })); })()`]],
  ['records-tag-menu', 'records', ['.ri', '.rtags .chip.purple']],
  ['records-filtered', 'records', [typeInto('.rsearch input', '결제')]],
  ['records-empty-filter', 'records', [typeInto('.rsearch input', '없는검색어xyz')]],
  ['records-blog', 'records', ['.ri', byText('.rdbar .btn', 'Blog post')]],
  ['records-blog-draft', 'records', ['.ri', byText('.rdbar .btn', 'Blog post'), byText('.rdbar .btn', 'Write draft')]],
  ['git-changes', 'git', [pickRepo('app-one')]],
  // 큰 레포: 탭을 다시 열 때(.gf 줄이 나타날 때까지)와 큰 diff를 열 때(.gl 줄이 나타날 때까지)의 밀리초와 화면 요소 수를 잰다
  ['git-big', 'git', [pickRepo('app-big'), "(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const tabs = document.querySelectorAll('#tabs button'); tabs[9].click(); await sleep(400); const t0 = performance.now(); tabs[6].click(); while (!document.querySelector('.gf') && performance.now() - t0 < 30000) await sleep(10); const open = Math.round(performance.now() - t0); await sleep(300); const t1 = performance.now(); const row = [...document.querySelectorAll('.gf')].find((n) => n.textContent.includes('aaa-big')); row?.click(); while (!document.querySelector('.gl') && performance.now() - t1 < 30000) await sleep(10); const diff = Math.round(performance.now() - t1); await sleep(500); const root = document.querySelector('.gselect').value; const ta = performance.now(); await window.rauha.listRepos(); const listMs = Math.round(performance.now() - ta); const tb = performance.now(); await window.rauha.git.overview(root, undefined); const overviewMs = Math.round(performance.now() - tb); window.__bigT = { listReposMs: listMs, overviewMs, tabOpenMs: open, diffOpenMs: diff, nodes: document.querySelectorAll('*').length, files: document.querySelectorAll('.gf').length, lines: document.querySelectorAll('.gl').length }; })() /* querySelector */"]],
  ['git-branches', 'git', [pickRepo('app-one'), byText('.tabs .tab', 'Branches')]],
  ['git-history', 'git', [pickRepo('app-one'), byText('.tabs .tab', 'History')]],
  ['git-history-graph', 'git', [pickRepo('app-graph'), byText('.tabs .tab', 'History'), "(() => { const b = document.querySelector('.gall input'); b.click(); })() /* querySelector */"]],
  ['git-conflicts', 'git', [pickRepo('app-two'), byText('.tabs .tab', 'Conflicts')]],
  // 동기화 툴바 상태 변형: 커밋이 강조된 상태(app-one) · 뒤처져 pull이 강조된 상태(app-three) · 원격 없음(app-two)
  ['git-toolbar-pull', 'git', [pickRepo('app-three')]],
  ['git-toolbar-noremote', 'git', [pickRepo('app-two')]],
  // 동작 중(Fetch를 누른 직후)과 결과 한 줄
  ['git-fetch-done', 'git', [pickRepo('app-three'), byText('.gsync .btn', 'Fetch')]],
  ['git-branch-menu', 'git', [pickRepo('app-one'), q('.gbranch')]],
  ['git-new-branch', 'git', [pickRepo('app-one'), q('.gbranch'), byText('.menu button', 'New branch')]],
  ['git-new-branch-bad', 'git', [pickRepo('app-one'), q('.gbranch'), byText('.menu button', 'New branch'), typeInto('.gnew input', 'my branch')]],
  ['git-commit-long', 'git', [pickRepo('app-one'), typeInto('.gcommit input', 'feat(ui): ' + '아주 긴 제목 '.repeat(10))]],
  // 코드 탭 탐색기: 레포 노드 줄(브랜치·↑↓·변경 수) · 오른쪽 클릭 메뉴 · 이름 바꾸기 입력 · 삭제 확인(휴지통)
  ['code-repos', 'code', [CLEAN, WAIT]],
  ['code-repo-open', 'code', [CLEAN, WAIT, expandByName('app-one')]],
  // 편집기에서 코드를 고르고 우클릭 → "Send selection to chat" 메뉴 / Ctrl+Shift+E → 채팅 입력칸에 붙는다
  ['code-send-menu', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), WAIT, SELECT_ALL, "(() => { const h = document.querySelector('.code-host'); const b = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 60, clientY: b.y + 30 })); })() /* querySelector */"]],
  ['code-send-chat', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), WAIT, SELECT_ALL, "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); })() /* querySelector */", WAIT]],
  // blame 거터: 켠 모습 / 거터 줄을 누르면 git 탭 History 가 그 커밋을 고른 채 열린다
  ['code-blame', 'code', [CLEAN, WAIT, expandByName('app-graph'), WAIT, rowByName('src.ts'), WAIT, "(() => { const b = document.querySelector('.code-blamebtn'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); })() /* querySelector */", WAIT]],
  ['code-blame-open', 'code', [CLEAN, WAIT, expandByName('app-graph'), WAIT, rowByName('src.ts'), WAIT, "(() => { const b = document.querySelector('.code-blamebtn'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); })() /* querySelector */", WAIT, "(() => { document.querySelectorAll('.cm-blame-line')[3]?.click(); })() /* querySelector */", WAIT]],
  ['code-ctx-menu', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rightClick('main.ts')]],
  ['code-ctx-menu-repo', 'code', [CLEAN, WAIT, rightClick('app-one')]],
  ['code-rename', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), pressKey('main.ts', 'F2'), WARNOK]],
  ['code-rename-bad', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), pressKey('main.ts', 'F2'), WARNOK, typeInto('.tree-edit input', 'x:y')]],
  ['code-rename-exists', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), pressKey('main.ts', 'F2'), WARNOK, typeInto('.tree-edit input', 'README.md')]],
  ['code-create', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), '.code-tools .btn:nth-child(1)', WARNOK, typeInto('.tree-edit input', 'new file.ts')]],
  ['code-delete-confirm', 'code', [CLEAN, WAIT, expandByName('app-one'), WAIT, rowByName('main.ts'), pressKey('main.ts', 'Delete'), WARNOK]],
  // 답답한 점 적기 창: 열기 · 적어 둔 뒤 목록 · 올리기 전 가린 미리보기 · 지우기 확인 · 해결 목록
  ['bug-dialog', 'chat', [q('.bug-open')]],
  ['bug-saved', 'chat', [q('.bug-open'), typeInto('.bug-title', '악메상사 결제 화면에서 저장 버튼이 안 눌려요'), typeInto('.bug-memo-input', '담당 kim@acme-corp.com 에게 물었더니 서버 10.1.2.3 문제라고 해요. 한참 길게 적어도 줄이 넘치지 않아야 해요 '.repeat(2)), byText('.bugs .btn', 'Save note')]],
  ['bug-preview', 'chat', [q('.bug-open'), typeInto('.bug-title', '악메상사 결제 화면에서 저장 버튼이 안 눌려요'), typeInto('.bug-memo-input', '담당 kim@acme-corp.com 서버 10.1.2.3'), byText('.bugs .btn', 'Save note'), byText('.bugs .btn', 'Upload to my AWS')]],
  ['bug-delete-ask', 'chat', [q('.bug-open'), typeInto('.bug-title', '지울 메모'), byText('.bugs .btn', 'Save note'), '.bugs .btn.danger']],
  ['bug-done', 'chat', [q('.bug-open'), typeInto('.bug-title', '해결할 메모'), byText('.bugs .btn', 'Save note'), byText('.bugs .btn', 'Resolve'), byText('.bugs .tab', 'Resolved')]],
  ['commands', 'commands', [byText('button', 'Details')]],
  ['rules', 'rules', []],
  // 내 규칙을 하나 넣고 제자리 고치기 칸을 연다(그 규칙 카드에서 Edit)
  // 고친 글을 넣고 Save를 연달아 두 번 눌러도 한 번만 저장되고 카드에 새 글이 보인다
  ['rules-edit-save', 'rules', ["(async () => { await window.rauha.addRule({ id: 'm1', text: 'git push는 묻지 마', bucket: 'allow', scope: { kind: 'global' }, tools: ['Bash'], includes: ['git push'] }); document.querySelectorAll('#tabs button')[7].click(); await new Promise((r) => setTimeout(r, 300)); document.querySelectorAll('#tabs button')[8].click(); await new Promise((r) => setTimeout(r, 500)); [...document.querySelectorAll('.rule:not(.default) .btn')].find((n) => n.textContent === 'Edit')?.click(); const i = document.querySelector('.rule.editing input'); i.value = '고친 규칙 글'; i.dispatchEvent(new Event('input', { bubbles: true })); const s = [...document.querySelectorAll('.rule.editing .btn')].find((n) => n.textContent === 'Save'); s.click(); s.click(); await new Promise((r) => setTimeout(r, 600)); document.body.dataset.ruleCards = String([...document.querySelectorAll('.rule:not(.default)')].map((n) => n.firstChild.textContent)); })() /* querySelector */"]],
  ['rules-edit', 'rules', ["(async () => { await window.rauha.addRule({ id: 'm1', text: 'git push는 묻지 마', bucket: 'allow', scope: { kind: 'global' }, tools: ['Bash'], includes: ['git push'] }); document.querySelectorAll('#tabs button')[7].click(); await new Promise((r) => setTimeout(r, 300)); document.querySelectorAll('#tabs button')[8].click(); await new Promise((r) => setTimeout(r, 500)); [...document.querySelectorAll('.rule:not(.default) .btn')].find((n) => n.textContent === 'Edit')?.click(); })() /* querySelector */"]],
  // stash: 메시지를 적고 치우면 목록에 나타난다(앞 장면의 레포 상태를 건드리지 않게 마지막 레포 장면들 뒤에 둔다). 같은 레포에서 이어지는 장면들이라 순서를 지킨다.
  ['git-stash', 'git', [pickRepo('app-one'), byText('.tabs .tab', 'Stash'), typeInto('.gstash-tools input.ginput', 'wip: 결제 작업 중'), byText('.gstash-tools .btn', 'Stash changes')]],
  ['git-stash-drop-ask', 'git', [pickRepo('app-one'), byText('.tabs .tab', 'Stash'), byText('.gf .btn', 'Drop')]],
  ['settings', 'settings', [byText('button', '자세히')]],
  // 최근 폴더를 고르면 허락 창이 뜬다(허락 없이 작업 폴더가 바뀌지 않는다)
  ['settings-recent-allow', 'settings', ["(() => { document.querySelector('.recent .item:not(.off) .btn')?.click(); })() /* querySelector */"]],
  ['settings-autosave', 'settings', ["(() => { const s = [...document.querySelectorAll('.srow')].find((r) => r.textContent.includes('Auto save'))?.querySelector('select'); s.value = 'delay'; s.dispatchEvent(new Event('change')); })() /* querySelector */"]],
];
const SCENE_FILTER = process.env.MEASURE_SCENES ? process.env.MEASURE_SCENES.split(',') : null;

/** 같은 종류 부품은 같은 높이·글자 가운데·가로 넘침 없음을 숫자로 확인한다. 한 건이라도 있으면 문장으로 돌려준다. */
function check(results) {
  const bad = [];
  const px = (v) => parseFloat(v);
  for (const s of results.filter((r) => r.rows)) {
    const where = s.name + '@' + s.width;
    if (s.hscroll > 0) bad.push(where + ' 가로 스크롤 ' + s.hscroll + 'px');
    for (const o of s.over) bad.push(where + ' 창 밖으로 나감: ' + o);
    if (s.tool) {
      if (s.tool.sw > s.tool.cw + 1) bad.push(where + ' git 툴바가 넘쳐요 ' + s.tool.sw + '>' + s.tool.cw);
      if (s.tool.tops.length > 1 && Math.max(...s.tool.tops) - Math.min(...s.tool.tops) > 6) bad.push(where + ' git 툴바가 줄바꿈돼요 ' + s.tool.tops.join(','));
    }
    if (s.rec) {
      const rc = s.rec;
      if (rc.bar && (rc.bar.sw > rc.bar.cw + 1 || (rc.bar.tops.length > 1 && Math.max(...rc.bar.tops) - Math.min(...rc.bar.tops) > 6))) bad.push(where + ' 기록 위쪽 단추 줄이 넘치거나 줄바꿈돼요 ' + rc.bar.tops.join(',') + ' ' + rc.bar.sw + '>' + rc.bar.cw);
      if (rc.pickTops.length > 1 && Math.max(...rc.pickTops) - Math.min(...rc.pickTops) > 6) bad.push(where + ' 선택 작업줄 단추가 줄바꿈돼요 ' + rc.pickTops.join(','));
      if (rc.pickSw > rc.pickCw + 1) bad.push(where + ' 선택 작업줄이 넘쳐요');
      if (rc.primaries.length > 1) bad.push(where + ' 강조 버튼이 둘 이상 ' + rc.primaries.join(' / '));
      if (rc.iconOnly > 0) bad.push(where + ' 아이콘만 있는 버튼에 툴팁·접근성 이름이 없어요 ' + rc.iconOnly + '개');
      if (rc.clippedBtn.length > 0) bad.push(where + ' 글자가 잘린 버튼 ' + rc.clippedBtn.join(','));
    }
    for (const r of s.rows) {
      if (r.cls.split(' ').includes('sbadge') && !r.cls.includes('faint') && (parseFloat(r.fs) < 12 || parseInt(r.fw, 10) < 700)) bad.push(where + ' 방향 배지는 12px 이상 굵게여야 해요 ' + r.fs + '/' + r.fw + ' "' + r.text + '"');
      const id = r.tag + '.' + r.cls.replace(/ /g, '.') + ' "' + r.text + '"';
      const [pt, , pb] = r.pad.split(' ').map(px);
      const cls = r.cls.split(' ');
      if (cls.includes('btn')) {
        const want = cls.includes('sm') ? 24 : cls.includes('lg') ? 32 : 28;
        if (Math.abs(r.h - want) > 0.6) bad.push(where + ' 버튼 높이 ' + r.h + ' (기대 ' + want + ') ' + id);
        if (pt !== 0 || pb !== 0) bad.push(where + ' 버튼 위/아래 여백 ' + pt + '/' + pb + ' ' + id);
        if (!['inline-flex', 'flex'].includes(r.display) || r.ai !== 'center') bad.push(where + ' 버튼 글자가 가운데 정렬이 아님 ' + id);
      }
      if (cls.includes('tab') && r.tag === 'button') {
        const want = cls.includes('sm') ? 28 : 32;
        if (Math.abs(r.h - want) > 0.6) bad.push(where + ' 탭 높이 ' + r.h + ' (기대 ' + want + ') ' + id);
      }
      if (r.tag === 'svg' && cls.includes('fi') && (r.w !== 16 || r.h !== 16)) bad.push(where + ' 파일 아이콘 크기 ' + r.w + 'x' + r.h + ' (기대 16x16)');
      if (cls.includes('tree-row') && Math.abs(r.h - 22) > 0.6) bad.push(where + ' 트리 행 높이 ' + r.h + ' (기대 22) ' + id);
      if (cls.includes('chip') && Math.abs(r.h - 20) > 0.6 && r.tag === 'span') bad.push(where + ' 칩 높이 ' + r.h + ' ' + id);
      if ((r.tag === 'select' || (r.tag === 'input' && !['checkbox', 'radio'].includes(r.type) && !r.cls.includes('term-input') && !r.cls.includes('qo-input') && !r.cls.includes('dtitle'))) && ![24, 28].some((h) => Math.abs(r.h - h) < 0.6)) bad.push(where + ' 입력칸 높이 ' + r.h + ' ' + id);
    }
  }
  return bad;
}

async function run(win) {
  const wc = win.webContents;
  wc.setBackgroundThrottling(false); // 숨긴 창에서도 화면 갱신(requestAnimationFrame)이 멈추지 않게
  const consoleErrors = [];
  wc.on('console-message', (e) => { const m = e.message ?? ''; if ((e.level === 'error' || e.level === 3 || /Content Security Policy/.test(m))) consoleErrors.push(m.slice(0, 300) + ' @' + (e.sourceId || '') + ':' + (e.lineNumber || '')); });
  const ev = (js) => wc.executeJavaScript(js);
  const results = [];
  const resize = async (width) => {
    win.setContentSize(width, 760);
    const tier = width >= 1700 ? 'xl' : width >= 1100 ? 'm' : width >= 720 ? 's' : 'xs';
    // 창 크기와 화면의 폭 단계(data-tier)가 둘 다 바뀔 때까지 기다린다
    for (let i = 0; i < 40 && (await ev(`window.innerWidth === ${width} && document.querySelector('.app')?.dataset.tier === '${tier}'`)) !== true; i++) await sleep(100);
    await sleep(300);
  };
  const snap = async (name, width) => results.push({ name, width, ...(await ev(MEASURE)) });
  try {
    await sleep(2500);
    await resize(1100);
    // 대화상자(예전 rauha 지우기 → 첫 실행 마법사)를 한 걸음씩 재면서 넘긴다
    for (let i = 0; i < 6; i++) {
      const step = await ev(`document.querySelector('.dialog b')?.textContent ?? ''`);
      if (step === '') break;
      for (const width of [1100, 600]) {
        await resize(width);
        await snap('dialog:' + step.slice(0, 12), width);
        if (process.env.MEASURE_SHOT_DIR) fs.writeFileSync(path.join(process.env.MEASURE_SHOT_DIR, 'wizard-' + i + '-' + width + '.png'), (await wc.capturePage()).toPNG());
      }
      await resize(1100);
      const next = step.startsWith('1/3')
        ? `(() => { const n = document.querySelector('.dialog .btn:not(.primary)'); n.disabled = false; n.click(); })()`
        : step.startsWith('2/3') || step.startsWith('3/3')
          ? q('.dialog .btn.primary')
          : q('.dialog .btn:not(.primary)');
      await ev(next);
      await sleep(1500);
    }
    if (process.env.MEASURE_PROBE) await ev(process.env.MEASURE_PROBE);
    const work = sandbox();
    await ev(`window.rauha.updateSettings({ workFolder: ${JSON.stringify(work)}, folderApproved: true, firstRunDone: true, awsProfile: 'test-profile', awsBucket: 'example-bucket', awsRegion: 'ap-northeast-2', awsAccount: '000000000000' })`);
    await ev(`window.rauha.submit('README 고치기 [edit]')`);
    for (const t of ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 허락 초안', 'VPC 피어링 정리 문서', '정산 배치 알림'].slice(0, Number(process.env.MEASURE_TASKS ?? 5))) await ev(`window.rauha.submit(${JSON.stringify(t)})`);
    await sleep(6500);
    for (const [name, tab, clicks] of SCENES) {
      if (!TABS.includes(tab) || (SCENE_FILTER && !SCENE_FILTER.includes(name))) continue;
      for (const width of WIDTHS) {
        await resize(width);
        await ev("document.querySelectorAll('.veil, .menu').forEach((n) => n.remove())"); // 앞 장면의 확인 창·메뉴가 남지 않게
        process.env.FAKE_DOCKER_MODE = 'ok';
        await ev(`document.querySelectorAll('#tabs button')[${TAB[tab]}].click()`);
        await sleep(1200);
        for (const c of clicks) {
          if (typeof c === 'function') {
            c();
            continue;
          }
          await ev(c.includes('querySelector') ? c : q(c));
          await sleep(700);
        }
        await snap(name, width);
        if (process.env.MEASURE_SHOT_DIR) fs.writeFileSync(path.join(process.env.MEASURE_SHOT_DIR, name + '-' + width + '.png'), (await wc.capturePage()).toPNG());
      }
    }
  } catch (e) {
    results.push({ error: String(e && e.stack ? e.stack : e) });
  }
  const violations = check(results);
  for (const m of new Set(consoleErrors)) violations.push('화면 콘솔 오류: ' + m);
  results.push({ violations });
  if (violations.length > 0) console.log(['규칙 위반 ' + violations.length + '건:', ...violations.slice(0, 40)].join(String.fromCharCode(10)));
  else console.log('규칙 위반 0건');
  for (const r of results) if (r.big) console.log('큰 레포 ' + r.name + '@' + r.width + ': ' + JSON.stringify(r.big));
  fs.writeFileSync(out, JSON.stringify(results));
  console.log('측정 저장:', out, results.length);
  app.quit();
}

require(path.join(__dirname, '..', 'dist', 'main.cjs'));
