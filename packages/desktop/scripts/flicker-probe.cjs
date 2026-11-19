// 깜빡임 점검: 탭을 옮기거나 설정을 바꿀 때 화면이 잠깐 비거나(하얗게 깜빡임), 늦게 채워지며 높이가 튀거나,
// 스크롤 자리가 튀는지 잰다. 창을 띄우지 않고 임시 데이터 폴더·가짜 팀으로 돌린다(실제 Claude 를 부르지 않는다).
// 사용: electron scripts/flicker-probe.cjs [결과 json 경로]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.RAUHA_FAKE_TEAM = '1';
process.env.RAUHA_DOCKER_BIN = path.join(__dirname, '..', 'src', 'main', 'docker', 'fake-docker.cjs');
process.env.FAKE_DOCKER_MODE = 'ok';
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-flicker-home-'));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = path.join(fakeHome, 'AppData', 'Local');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-flicker-')));
process.env.RAUHA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-flicker-data-'));
{
  const work = path.join(fakeHome, 'work');
  const repo = path.join(work, 'app');
  fs.mkdirSync(repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, stdio: 'pipe' });
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-m', 'init');
  fs.mkdirSync(path.join(fakeHome, '.rauha', 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.rauha', 'desktop', 'settings.json'), JSON.stringify({ workFolder: work, folderApproved: true, firstRunDone: true }));
}
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};

const out = process.argv.find((a, i) => i > 1 && a.endsWith('.json')) ?? path.join(os.tmpdir(), 'rauha-flicker.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 화면(#screen)을 4ms 마다 본다: 글자 수, 자식 수, 높이, 스크롤 자리. 바뀐 순간만 남긴다.
const PROBE = `window.__probe = (ms) => new Promise((done) => {
  const s = document.getElementById('screen');
  const scroller = () => s.querySelector('.settings') ?? s.firstElementChild ?? s;
  const rows = []; let last = ''; const t0 = performance.now();
  const look = () => {
    const sc = scroller();
    const r = { t: Math.round(performance.now() - t0), text: s.innerText.length, nodes: s.querySelectorAll('*').length, h: sc.scrollHeight, top: Math.round(sc.scrollTop) };
    const k = r.text + '/' + r.nodes + '/' + r.h + '/' + r.top;
    if (k !== last) { rows.push(r); last = k; }
    if (performance.now() - t0 < ms) setTimeout(look, 4); else done(rows);
  };
  look();
}); 0;`;

async function run(win) {
  const wc = win.webContents;
  const ev = (js) => wc.executeJavaScript(js, true);
  const results = [];
  try {
    await sleep(2500);
    await ev(PROBE);
    const tabs = await ev(`[...document.querySelectorAll('#tabs button')].map((b) => b.getAttribute('aria-label') || b.title || b.textContent.trim())`);
    // 1) 탭 옮기기: 채팅으로 갔다가 각 탭으로(두 번째로 여는 것 = 이미 본 탭을 다시 열 때)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < tabs.length; i++) {
        await ev(`document.querySelectorAll('#tabs button')[0].click()`);
        await sleep(400);
        const rows = await ev(`(() => { const p = window.__probe(1500); document.querySelectorAll('#tabs button')[${i}].click(); return p; })()`);
        results.push({ kind: 'tab', pass, name: tabs[i], rows });
      }
    }
    // 2) 설정: 아래로 스크롤한 뒤 캐릭터 테마 바꾸기 · 계정 바꾸기 · 보호 브랜치 바꾸기
    const settingsIndex = tabs.findIndex((t) => /settings/i.test(t));
    await ev(`document.querySelectorAll('#tabs button')[${settingsIndex}].click()`);
    await sleep(1500);
    const scrollTo = `(() => { const s = document.querySelector('.settings'); s.scrollTop = Math.min(1200, s.scrollHeight - s.clientHeight); return s.scrollTop; })()`;
    const change = (sel, pick) => `(() => { const p = window.__probe(1500); const el = ${sel}; ${pick}; el.dispatchEvent(new Event('change', { bubbles: true })); return p; })()`;
    await ev(scrollTo);
    results.push({ kind: 'action', name: 'character theme', rows: await ev(change(`document.querySelector('.theme-select')`, `el.selectedIndex = (el.selectedIndex + 1) % el.options.length`)) });
    await ev(scrollTo);
    const secs = `[...document.querySelectorAll('.settings > .pane')].map((p) => p.querySelector('.ph').textContent + ':' + p.offsetHeight).join(' ')`;
    // 다시 그리기 바로 앞뒤의 스크롤 자리(같아야 한다: 다시 그리기가 스크롤을 옮기지 않는다)
    await ev(`(() => { const s = document.querySelector('.settings'); window.__swap = []; const orig = s.replaceChildren.bind(s); s.replaceChildren = (...a) => { const b = s.scrollTop; orig(...a); queueMicrotask(() => window.__swap.push(b + '→' + s.scrollTop)); }; 0; })()`);
    const before = await ev(secs);
    results.push({ kind: 'action', name: 'protected branches', before, after: await ev(`new Promise((r) => setTimeout(() => r(${secs}), 1600))`), rows: await ev(change(`[...document.querySelectorAll('.settings input')].find((i) => i.value.includes('main'))`, `el.value = 'main, release'`)) });
    console.log('설정 다시 그리기 앞뒤 스크롤:', JSON.stringify(await ev('window.__swap')));
    await ev(`document.querySelector('.settings').scrollTop = 0`);
    results.push({ kind: 'action', name: 'account (settings)', options: await ev(`[...document.querySelectorAll('.settings select')][0].options.length`), rows: await ev(change(`[...document.querySelectorAll('.settings select')][0]`, `el.selectedIndex = (el.selectedIndex + 1) % el.options.length`)) });
  } catch (e) {
    results.push({ error: String(e && e.stack ? e.stack : e) });
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  // 요약: 중간에 화면이 비었나(글자 수가 최종의 30% 아래로 떨어졌다 다시 참), 늦게 바뀐 마지막 순간, 스크롤이 튀었나
  for (const r of results) {
    if (r.error) { console.log('오류', r.error); continue; }
    const rows = r.rows;
    const final = rows[rows.length - 1];
    const firstFull = rows.find((x) => x.text >= final.text * 0.9);
    const blank = rows.filter((x) => x.t > 0 && x.text < final.text * 0.3 && x !== final);
    const tops = new Set(rows.map((x) => x.top));
    const settle = rows.length > 1 ? rows[rows.length - 1].t : 0;
    console.log(`${r.kind}${r.pass !== undefined ? '#' + r.pass : ''} ${r.name}: 바뀜 ${rows.length}번, 다 그려진 때 ${firstFull?.t ?? '-'}ms, 마지막 변화 ${settle}ms, 빈 화면 ${blank.length ? blank[0].t + '~' + blank[blank.length - 1].t + 'ms' : '없음'}, 스크롤 ${[...tops].join('→')}${r.options !== undefined ? ', 계정 수 ' + r.options : ''}`);
  }
  console.log('저장:', out);
  app.quit();
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', () => void run(win));
});
require(path.join(__dirname, '..', 'dist', 'main.cjs'));
