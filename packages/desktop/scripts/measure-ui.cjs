// 화면 부품의 크기·정렬을 숫자로 잰다. 창을 화면에 띄우지 않고(show 무효화), 새 임시 데이터 폴더·가짜 팀으로 돌려
// 실제 Claude를 부르지 않는다. 사용: electron scripts/measure-ui.cjs <결과 json 경로> [탭,탭,...] [너비,너비,...]
// 결과: 보이는 button·select·input·textarea와 칩·탭 같은 부품의 높이, 안쪽 여백, 줄 높이, 글자 정렬, 색.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.RAUHA_FAKE_TEAM = '1';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-')));
// 기록·할 일 파일도 임시 폴더에 둔다(내 실제 기록에 시험 기록이 쌓이지 않게)
process.env.RAUHA_DATA_DIR = process.env.RAUHA_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-data-'));
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};

const out = process.argv.find((a, i) => i > 1 && a.endsWith('.json')) ?? path.join(os.tmpdir(), 'rauha-measure.json');
const rest = process.argv.filter((a, i) => i > 1 && !a.endsWith('.json') && !a.startsWith('-') && a !== '.');
const TABS = (rest[0] ?? 'chat,code,todo,records,repos,git,commands,rules,settings').split(',');
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
  const cm = document.querySelector('.cm-content'); return { tool, rec, cm: cm ? (cm.getAttribute('style') || cm.style.cssText || 'no-style') : 'no-editor', innerWidth: window.innerWidth, hscroll: document.scrollingElement.scrollWidth - window.innerWidth, over, rows };
})()`;

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', () => void run(win));
});

// 시험용 작업 폴더: 레포 둘(하나는 변경·앞섬·브랜치가 있고, 하나는 머지 충돌 중)
function sandbox() {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rauha-measure-work-'));
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
const TAB = { chat: 0, code: 1, todo: 2, records: 3, repos: 4, git: 5, commands: 6, rules: 7, settings: 8 };
// [이름, 탭, 그 탭에서 먼저 할 클릭들(CSS 선택자 또는 완성된 JS)]
// 레포 이름으로 git 탭의 레포를 고른다(기억된 레포가 장면마다 달라지지 않게 장면마다 먼저 고른다)
const pickRepo = (name) => `(() => { const s = document.querySelector('.gselect'); const o = [...s.options].find((o) => o.text.startsWith(${JSON.stringify(name)})); s.value = o.value; s.dispatchEvent(new Event('change')); })()`;
const typeInto = (sel, text) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const SCENES = [
  ['chat', 'chat', []],
  ['chat-detail', 'chat', ['.room']],
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
  ['todo-form', 'todo', [byText('button', '새 할 일')]],
  ['records', 'records', []],
  ['records-detail', 'records', ['.ri']],
  ['records-picked', 'records', [`(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`]],
  ['records-picked-detail', 'records', ['.ri', `(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`]],
  ['records-delete-ask', 'records', ['.ri', byText('.rdbar .btn', '지우기')]],
  ['records-picked-delete-ask', 'records', [`(() => { for (const b of [...document.querySelectorAll('.rpickrow input')].slice(0, 2)) b.click(); })()`, byText('.rpick .btn', '삭제')]],
  ['records-range', 'records', [`(() => { const b = document.querySelectorAll('.rpickrow input'); b[0].click(); })()`, `(() => { const b = document.querySelectorAll('.rpickrow input'); b[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })); })()`]],
  ['records-tag-menu', 'records', ['.ri', '.rtags .chip.purple']],
  ['records-filtered', 'records', [typeInto('.rsearch input', '결제')]],
  ['records-empty-filter', 'records', [typeInto('.rsearch input', '없는검색어xyz')]],
  ['records-blog', 'records', ['.ri', byText('.rdbar .btn', '블로그 글')]],
  ['records-blog-draft', 'records', ['.ri', byText('.rdbar .btn', '블로그 글'), byText('.rdbar .btn', '초안 쓰기')]],
  ['repos', 'repos', []],
  ['git-changes', 'git', [pickRepo('app-one')]],
  ['git-branches', 'git', [pickRepo('app-one'), byText('.tabs .tab', '브랜치')]],
  ['git-history', 'git', [pickRepo('app-one'), byText('.tabs .tab', '히스토리')]],
  ['git-conflicts', 'git', [pickRepo('app-two'), byText('.tabs .tab', '충돌')]],
  // 동기화 툴바 상태 변형: 커밋이 강조된 상태(app-one) · 뒤처져 pull이 강조된 상태(app-three) · 원격 없음(app-two)
  ['git-toolbar-pull', 'git', [pickRepo('app-three')]],
  ['git-toolbar-noremote', 'git', [pickRepo('app-two')]],
  // 동작 중(Fetch를 누른 직후)과 결과 한 줄
  ['git-fetch-done', 'git', [pickRepo('app-three'), byText('.gsync .btn', 'Fetch')]],
  ['git-branch-menu', 'git', [pickRepo('app-one'), q('.gbranch')]],
  ['git-new-branch', 'git', [pickRepo('app-one'), q('.gbranch'), byText('.menu button', '새 브랜치')]],
  ['git-new-branch-bad', 'git', [pickRepo('app-one'), q('.gbranch'), byText('.menu button', '새 브랜치'), typeInto('.gnew input', 'my branch')]],
  ['git-commit-long', 'git', [pickRepo('app-one'), typeInto('.gcommit input', 'feat(ui): ' + '아주 긴 제목 '.repeat(10))]],
  ['commands', 'commands', [byText('button', '자세히')]],
  ['rules', 'rules', []],
  ['settings', 'settings', [byText('button', '자세히')]],
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
      if ((r.tag === 'select' || (r.tag === 'input' && !['checkbox', 'radio'].includes(r.type) && !r.cls.includes('term-input') && !r.cls.includes('qo-input'))) && ![24, 28].some((h) => Math.abs(r.h - h) < 0.6)) bad.push(where + ' 입력칸 높이 ' + r.h + ' ' + id);
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
    await ev(`window.rauha.updateSettings({ workFolder: ${JSON.stringify(work)}, folderApproved: true, firstRunDone: true })`);
    for (const t of ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 허락 초안', 'VPC 피어링 정리 문서', '정산 배치 알림']) await ev(`window.rauha.submit(${JSON.stringify(t)})`);
    await sleep(4800);
    for (const [name, tab, clicks] of SCENES) {
      if (!TABS.includes(tab) || (SCENE_FILTER && !SCENE_FILTER.includes(name))) continue;
      for (const width of WIDTHS) {
        await resize(width);
        await ev("document.querySelectorAll('.veil, .menu').forEach((n) => n.remove())"); // 앞 장면의 확인 창·메뉴가 남지 않게
        await ev(`document.querySelectorAll('#tabs button')[${TAB[tab]}].click()`);
        await sleep(1200);
        for (const c of clicks) {
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
  fs.writeFileSync(out, JSON.stringify(results));
  console.log('측정 저장:', out, results.length);
  app.quit();
}

require(path.join(__dirname, '..', 'dist', 'main.cjs'));
