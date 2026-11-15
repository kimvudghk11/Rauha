import { waitingTalk } from '../shared/hiring-banter.js';
import { DB_CHOICES, detectedDbs, HIRING_ROLE_LABEL, HIRING_ROLES, type HiringRole } from '../shared/hiring-input.js';
import { portfolioPrompt, roundMarkdown, salaryFit, type HiringRound } from '../shared/hiring-history.js';
import type { CompanyView, InterviewApi, Line, MarketView, PostingView, StageView, VerdictView, WorkFacts } from '../shared/interview-ipc.js';
import { el, isEnterKey } from './dom.js';
import { drawRecruiter } from './recruiter-sprite.js';

/**
 * 채용 검토실(픽셀 오피스): 가운데 Me 칸(연차·희망 직무·쓰는 DB 입력, 기술 스택은 git 에서), 둘레에 A~E 회사 방.
 * 보낼 때마다 내 연차에 맞춰 회사 다섯 곳의 공고(업종·직무·스택·경쟁률)가 새로 정해지고, 방마다 가상 담당자 3명이 내 작업 요약을 읽는다.
 * 기다리는 동안 셋이 내 커밋 사실로 말풍선 대화를 하고(판정 없음), 회사마다 평가가 끝나는 즉시 그 방에 도장·단계가 뜬다.
 * 방을 누르면 그 회사의 리포트(공고·실제 공고 근거·내 위치·담당자 판단)를 모달로 보고, 담당자들과 대화한다.
 */
type RoomState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'done'; readonly verdict: VerdictView }
  | { readonly kind: 'error'; readonly error: string };

interface Room {
  readonly company: CompanyView;
  readonly index: number;
  posting: PostingView | null;
  state: RoomState;
  /** 지금 틀고 있는 말(기다리는 동안은 사실 대화, 끝나면 실제 토론) */
  script: readonly Line[];
  at: number;
  /** 이번 검토에서 나온 말 전부(리포트에 보인다) */
  log: Line[];
  readonly el: HTMLElement;
  readonly title: HTMLElement;
  readonly post: HTMLElement;
  readonly badge: HTMLElement;
  readonly bubble: HTMLElement;
  readonly faces: readonly HTMLElement[];
}

interface MeInput {
  years: number | null;
  role: HiringRole;
  dbs: string[];
  /** 희망 연봉(만 원), 선택 */
  desiredSalary: number | null;
}

const TICK_MS = 2600;
const LANG_POLICY = { required: 'main language required', preferred: 'main language preferred', any: 'any language' } as const;
const SALARY_FIT = { in: 'within band', below: 'below band', stretch: 'a little above (negotiable)', above: 'well above band (offer risk)' } as const;
const STAMP_TEXT = { pass: 'PASS', hold: 'HOLD', drop: 'DROP' } as const;
const ME_KEY = 'rauha.hiring.me';

function loadMe(): MeInput {
  try {
    const o = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Partial<MeInput> | null;
    return {
      years: typeof o?.years === 'number' ? o.years : null,
      role: HIRING_ROLES.find((r) => r === o?.role) ?? 'any',
      dbs: Array.isArray(o?.dbs) ? o.dbs.filter((d): d is string => typeof d === 'string').slice(0, 12) : [],
      desiredSalary: typeof o?.desiredSalary === 'number' ? o.desiredSalary : null,
    };
  } catch {
    return { years: null, role: 'any', dbs: [], desiredSalary: null };
  }
}
function saveMe(me: MeInput): void {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    /* 저장이 막혀도 이번 화면에서는 쓴다 */
  }
}

export function buildInterview(deps: { readonly api: InterviewApi; readonly openMyWork: () => void; readonly toMain: (text: string) => void }) {
  const root = el('section', 'iv hr');
  let companies: readonly CompanyView[] = [];
  let stages: readonly StageView[] = [];
  let facts: WorkFacts | null = null;
  let market: MarketView = { checkedAt: null, profiles: 0 };
  let running = false;
  let researching = false;
  let error = '';
  const me = loadMe();
  let dbsTouched = me.dbs.length > 0;
  const rooms: Room[] = [];
  const chats = new Map<string, { from: 'me' | 'them'; text: string }[]>();
  let openReport: { readonly id: string; readonly paint: () => void } | null = null;

  const head = el('div', 'rhead');
  const go = el('button', 'btn primary', 'Send my resume');
  go.addEventListener('click', () => void start());
  const myWork = el('button', 'btn', 'Git › My work');
  myWork.addEventListener('click', () => deps.openMyWork());
  const historyBtn = el('button', 'btn', 'Review history');
  historyBtn.addEventListener('click', () => void openHistory());
  head.append(el('b', undefined, 'Hiring review'), el('span', 'hint grow', 'Every send makes five new job postings that fit your years. Three fictional recruiters per company; their yardsticks come from what well-known people have said about hiring (named on each card).'), historyBtn, myWork, go);
  const marketBar = el('div', 'hr-market');
  const summary = el('div', 'hr-sum');
  const office = el('div', 'hr-office');
  const hub = el('div', 'hr-hub');
  root.append(head, marketBar, summary, office);

  const stageLabel = (id: string): string => stages.find((s) => s.id === id)?.label ?? id;
  /** reached 는 멈추는 단계(offer 면 최종 합격) */
  const stopText = (id: string): string => (id === 'offer' ? 'Offer' : `Stops at ${stageLabel(id)}`);
  const factsLine = (f: WorkFacts): string => [`${f.total} commits`, f.langs.slice(0, 3).map((l) => `${l.lang} ${l.share}%`).join(' · '), f.stack.slice(0, 5).join(', ')].filter((x) => x !== '').join(' · ');

  function face(company: string, index: number, scale: number, pose: 'read' | 'idle'): HTMLCanvasElement {
    const cv = el('canvas', 'px');
    drawRecruiter(cv, company, index, scale, pose);
    return cv;
  }

  // ── 실제 공고 시장 정보 ──
  function paintMarket(): void {
    const btn = el('button', 'btn sm', researching ? 'Searching job posts… (a few minutes)' : market.checkedAt === null ? 'Base postings on real job posts' : 'Update from real job posts');
    btn.disabled = researching || running;
    btn.addEventListener('click', () => void refreshMarket());
    const text =
      market.checkedAt === null
        ? 'Postings use built-in patterns of the Korean developer job market. Look up real postings once to base them on actual companies.'
        : `Postings follow real job posts checked on ${market.checkedAt} (${market.profiles} industry × role patterns, sources in each report).`;
    marketBar.replaceChildren(el('span', 'hint grow', text), btn);
  }
  async function refreshMarket(): Promise<void> {
    researching = true;
    error = '';
    paintMarket();
    const r = await deps.api.refreshMarket();
    researching = false;
    if (r.ok) market = r.data;
    else error = r.error;
    paintMarket();
    paintSummary();
  }

  // ── 방 ──
  function buildRoom(c: CompanyView, index: number): Room {
    const box = el('button', `hr-room co-${c.id}`);
    box.type = 'button';
    const top = el('div', 'hr-rt');
    const title = el('b', undefined, `${c.id}사`);
    const badge = el('span', 'hr-badge');
    top.append(title, badge);
    const post = el('div', 'hr-post', 'The posting appears when you send your resume');
    const bubble = el('div', 'hr-bub');
    const crew = el('div', 'hr-crew');
    const faces = c.recruiters.map((r, i) => {
      const who = el('div', 'hr-who');
      who.append(face(c.id, i, 3, 'read'), el('span', undefined, r.name));
      who.title = `${r.name} · ${r.title} · ${r.by}: ${r.rule}`;
      crew.append(who);
      return who;
    });
    box.append(top, post, bubble, crew, el('div', 'hr-desk'));
    const room: Room = { company: c, index, posting: null, state: { kind: 'idle' }, script: [], at: 0, log: [], el: box, title, post, badge, bubble, faces };
    box.addEventListener('click', () => openModal(room));
    return room;
  }

  function paintRoom(r: Room): void {
    const s = r.state;
    const p = r.posting;
    r.el.dataset['state'] = s.kind;
    r.el.title = p === null ? `${r.company.id}사` : `Open ${p.label}'s report`;
    r.title.textContent = p?.label ?? `${r.company.id}사`;
    if (p !== null) {
      r.post.textContent = `${p.role} · ${p.applicants}:1`;
      r.post.title = `${p.size} · wants ${p.wants.join(', ')} · document screening passes the top ${p.passRates['document'] ?? '?'}%`;
    }
    r.badge.className = 'hr-badge';
    if (s.kind === 'idle') r.badge.textContent = 'Waiting for your resume';
    else if (s.kind === 'reviewing') {
      r.badge.classList.add('busy');
      r.badge.textContent = 'Reviewing…';
    } else if (s.kind === 'error') {
      r.badge.classList.add('err');
      r.badge.textContent = 'Could not finish';
    } else r.badge.replaceChildren(el('span', `hr-stamp ${s.verdict.stamp}`, STAMP_TEXT[s.verdict.stamp]), el('span', undefined, `${s.verdict.total}/${p?.rubric.passScore ?? '?'} · ${stopText(s.verdict.reached)}`));
    const line = r.script.length === 0 ? null : r.script[Math.min(r.at, r.script.length - 1)]!;
    r.bubble.hidden = line === null;
    if (line !== null) r.bubble.replaceChildren(el('b', undefined, line.who), el('span', undefined, line.text));
    r.faces.forEach((f, i) => f.classList.toggle('talking', line !== null && r.company.recruiters[i]?.name === line.who));
  }

  function paintSummary(): void {
    const done = rooms.flatMap((r) => (r.state.kind === 'done' && r.posting !== null ? [{ r, p: r.posting, v: r.state.verdict }] : []));
    summary.replaceChildren();
    if (error !== '') {
      summary.append(el('span', 'err', error));
      return;
    }
    if (!running && done.length === 0) {
      summary.append(el('span', 'dim', 'Set your years in My profile (the Me box) and press "Send my resume". Each company decides on its own and shows its stamp the moment it is done. Only commit subjects, counts and stack names are sent, no code.'));
      return;
    }
    const order = stages.map((s) => s.id);
    const best = [...done].sort((a, b) => order.indexOf(b.v.reached) - order.indexOf(a.v.reached))[0];
    const count = (k: 'pass' | 'hold' | 'drop'): number => done.filter((d) => d.v.stamp === k).length;
    summary.append(
      el('b', undefined, `${done.length}/${rooms.length} companies done`),
      el('span', undefined, best === undefined ? 'Still reading…' : `Furthest: ${best.p.label} · ${stopText(best.v.reached)}`),
      el('span', 'hr-stamp pass', `PASS ${count('pass')}`),
      el('span', 'hr-stamp hold', `HOLD ${count('hold')}`),
      el('span', 'hr-stamp drop', `DROP ${count('drop')}`),
    );
  }

  // ── Me 칸: 가운데에는 요약만, 입력은 넓은 "My profile" 창에서(연차 필수·직무·희망 연봉·DB, 스택은 git 에서만) ──
  /** git 에서 찾은 DB 는 처음 한 번 미리 체크 */
  function syncFoundDbs(): string[] {
    const found = facts === null ? [] : detectedDbs(facts.stack);
    if (!dbsTouched && found.length > 0) me.dbs = [...found];
    return found;
  }

  function paintHub(): void {
    syncFoundDbs();
    const lines = el('div', 'hr-me-lines');
    const basics = [me.years === null ? 'Years not set' : `${me.years} yrs`, HIRING_ROLE_LABEL[me.role], me.desiredSalary === null ? '' : `${me.desiredSalary.toLocaleString()}만 원`].filter((x) => x !== '');
    lines.append(el('div', me.years === null ? 'hr-me-need' : 'hr-me-main', basics.join(' · ')));
    lines.append(el('div', 'hr-me-sub', me.dbs.length === 0 ? 'DB: none chosen' : `DB: ${me.dbs.join(', ')}`));
    lines.append(el('div', 'hr-me-sub', facts === null ? 'Stack: read from git' : `Git: ${factsLine(facts)}`));
    const edit = el('button', me.years === null ? 'btn sm primary' : 'btn sm', 'Edit my profile');
    edit.disabled = running;
    edit.addEventListener('click', () => openProfile());
    hub.replaceChildren(face('me', 0, 3, running ? 'read' : 'idle'), el('b', undefined, 'Me'), lines, edit);
  }

  /** My profile 창: 항목 이름 | 입력 두 열, DB 는 체크박스 격자, 레포별 git 스택 목록 */
  function openProfile(focusYears = false): void {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog hr-profile');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'My profile');
    const close = (): void => {
      veil.remove();
      document.removeEventListener('keydown', onKey);
      paintHub();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    veil.addEventListener('click', (e) => {
      if (e.target === veil) close();
    });
    const form = el('div', 'hr-form');
    const row = (label: string, hint: string, control: HTMLElement): void => {
      const l = el('div', 'hr-form-label');
      l.append(el('span', undefined, label));
      if (hint !== '') l.append(el('span', 'hint', hint));
      const c = el('div', 'hr-form-control');
      c.append(control);
      form.append(l, c);
    };
    const years = el('input', 'hr-num');
    years.id = 'hr-years';
    years.type = 'number';
    years.min = '0';
    years.max = '40';
    years.step = '1';
    years.placeholder = '0 if new';
    years.value = me.years === null ? '' : String(me.years);
    years.addEventListener('input', () => {
      const n = Number(years.value);
      me.years = years.value.trim() === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(40, Math.round(n)));
      saveMe(me);
    });
    row('Years of experience', 'Required', years);
    const role = el('select', 'hr-select');
    role.id = 'hr-role';
    for (const r of HIRING_ROLES) {
      const o = el('option', undefined, HIRING_ROLE_LABEL[r]);
      o.value = r;
      o.selected = me.role === r;
      role.append(o);
    }
    role.addEventListener('change', () => {
      me.role = HIRING_ROLES.find((r) => r === role.value) ?? 'any';
      saveMe(me);
    });
    row('Role', 'Mixed = each company may hire a different role', role);
    const pay = el('input', 'hr-num');
    pay.id = 'hr-pay';
    pay.type = 'number';
    pay.min = '1000';
    pay.max = '100000';
    pay.step = '100';
    pay.placeholder = 'e.g. 5500';
    pay.value = me.desiredSalary === null ? '' : String(me.desiredSalary);
    pay.addEventListener('input', () => {
      const n = Number(pay.value);
      me.desiredSalary = pay.value.trim() === '' || !Number.isFinite(n) || n < 1000 ? null : Math.round(n);
      saveMe(me);
    });
    const payWrap = el('div', 'hr-inline');
    payWrap.append(pay, el('span', 'hint', '만 원 / year · used only at the offer stage'));
    row('Desired salary', 'Optional', payWrap);
    // DB: git 에서 찾은 것(표시) + 고르기 + 직접 넣기
    const dbs = el('div', 'hr-dbs');
    const paintDbs = (): void => {
      const found = syncFoundDbs();
      dbs.replaceChildren();
      for (const d of [...new Set([...DB_CHOICES, ...me.dbs])]) {
        // 체크박스 + 이름 + git 표시: 칸 폭이 좁아도 줄 단위로 정렬돼 깨지지 않는다
        const item = el('label', `hr-db${me.dbs.includes(d) ? ' on' : ''}`);
        item.title = found.includes(d) ? 'Found in your repos (git)' : 'Check if you use it';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = me.dbs.includes(d);
        box.addEventListener('change', () => {
          dbsTouched = true;
          me.dbs = me.dbs.includes(d) ? me.dbs.filter((x) => x !== d) : [...me.dbs, d].slice(0, 12);
          saveMe(me);
          paintDbs();
        });
        item.append(box, el('span', 'hr-db-name', d));
        if (found.includes(d)) item.append(el('span', 'hr-db-git', 'git'));
        dbs.append(item);
      }
    };
    paintDbs();
    const other = el('input', 'hr-text');
    other.id = 'hr-db-other';
    other.placeholder = 'Another database';
    const addDb = el('button', 'btn sm', 'Add');
    const add = (): void => {
      const v = other.value.trim();
      if (v === '' || v.length > 40 || me.dbs.includes(v)) return;
      dbsTouched = true;
      me.dbs = [...me.dbs, v].slice(0, 12);
      saveMe(me);
      other.value = '';
      paintDbs();
    };
    addDb.addEventListener('click', add);
    other.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) add();
    });
    const dbCol = el('div', 'hr-col');
    const otherRow = el('div', 'hr-inline');
    otherRow.append(other, addDb);
    dbCol.append(dbs, otherRow);
    row('Databases you use', 'Marked “git” = found in your repos', dbCol);
    // 스택은 입력받지 않는다: git 에서 읽은 것을 레포별로 보여 준다
    const stack = el('div', 'hr-stack-list');
    if (facts === null || facts.scanned.length === 0) stack.append(el('div', 'hint', facts === null ? 'Read from your repos when you send.' : 'No stack found yet. Check Git › My work (accounts, GitHub).'));
    else for (const r of facts.scanned) {
      const line = el('div', 'hr-stack-row');
      line.append(el('b', undefined, r.repo), el('span', undefined, r.stack.join(', ') || '(no stack found)'));
      stack.append(line);
    }
    row('Tech stack', 'From git only', stack);
    const done = el('button', 'btn primary', 'Done');
    done.addEventListener('click', close);
    const foot = el('div', 'btns');
    foot.append(el('span', 'hint grow', 'Saved on this computer.'), done);
    box.append(el('b', undefined, 'My profile'), form, foot);
    veil.append(box);
    document.body.append(veil);
    if (focusYears || me.years === null) queueMicrotask(() => years.focus());
  }

  /** 이력서가 가운데 책상에서 각 방으로 날아간다(움직임을 줄이는 설정이면 생략) */
  function fly(): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = hub.getBoundingClientRect();
    const base = office.getBoundingClientRect();
    rooms.forEach((r, i) => {
      const to = r.el.getBoundingClientRect();
      const p = el('div', 'hr-fly');
      p.style.left = `${from.left - base.left + from.width / 2}px`;
      p.style.top = `${from.top - base.top + 24}px`;
      office.append(p);
      setTimeout(() => {
        p.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - 24}px) rotate(${i % 2 === 0 ? 12 : -12}deg)`;
        p.style.opacity = '0';
      }, 60 + i * 140);
      setTimeout(() => p.remove(), 1400 + i * 140);
    });
  }

  async function start(): Promise<void> {
    if (running) return;
    error = '';
    if (me.years === null) {
      error = 'Enter your years of experience first (0 if you are new).';
      paintSummary();
      openProfile(true);
      return;
    }
    running = true;
    go.disabled = true;
    go.textContent = 'Recruiters are reading…';
    paintHub();
    paintMarket();
    paintSummary();
    const prep = await deps.api.prepare({ years: me.years, role: me.role, dbs: me.dbs, desiredSalary: me.desiredSalary });
    if (!prep.ok) {
      running = false;
      error = prep.error;
      go.disabled = false;
      go.textContent = 'Send my resume';
      paintHub();
      paintMarket();
      paintSummary();
      return;
    }
    facts = prep.data.facts;
    for (const r of rooms) {
      r.posting = prep.data.postings.find((p) => p.id === r.company.id) ?? null;
      r.state = { kind: 'reviewing' };
      r.script = waitingTalk(r.company.recruiters, prep.data.facts, r.index, r.posting?.wants, r.posting?.applicants);
      r.at = 0;
      r.log = [r.script[0]!];
      chats.delete(r.company.id);
      paintRoom(r);
    }
    paintHub();
    fly();
    paintSummary();
    // 회사마다 따로: 먼저 끝난 회사부터 그 방에 바로 도장이 뜬다
    await Promise.all(
      rooms.map(async (r) => {
        const res = await deps.api.evaluate(r.company.id);
        r.state = res.ok ? { kind: 'done', verdict: res.data } : { kind: 'error', error: res.error };
        if (res.ok && res.data.talk.length > 0) {
          r.log.push({ who: '—', text: 'Decision reached' }, ...res.data.talk);
          r.script = res.data.talk;
          r.at = 0;
        }
        paintRoom(r);
        paintSummary();
        if (openReport?.id === r.company.id) openReport.paint();
      }),
    );
    running = false;
    go.disabled = false;
    go.textContent = 'Send again (new postings)';
    paintHub();
    paintMarket();
  }

  // 말풍선: 검토 중이면 대화를 돌려 가며, 끝났으면 실제 토론을 한 번 끝까지
  const timer = setInterval(() => {
    if (!root.isConnected) return void clearInterval(timer);
    if (document.hidden) return;
    for (const r of rooms) {
      if (r.script.length === 0) continue;
      if (r.state.kind === 'reviewing') {
        r.at = (r.at + 1) % r.script.length;
        r.log.push(r.script[r.at]!);
      } else if (r.state.kind === 'done' && r.at < r.script.length - 1) r.at += 1;
      else continue;
      paintRoom(r);
      if (openReport?.id === r.company.id) openReport.paint();
    }
  }, TICK_MS);

  // ── 리포트 모달 ──
  function openModal(r: Room): void {
    const c = r.company;
    const veil = el('div', 'veil');
    const box = el('div', `dialog hr-report co-${c.id}`);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `${r.posting?.label ?? `${c.id}사`} report`);
    const close = (): void => {
      veil.remove();
      openReport = null;
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    veil.addEventListener('click', (e) => {
      if (e.target === veil) close();
    });
    const x = el('button', 'btn sm', 'Close');
    x.addEventListener('click', close);
    const top = el('div', 'hr-rep-top');
    const title = el('div', 'grow');
    const status = el('div', 'hr-rep-status');
    top.append(title, status, x);
    const report = el('div', 'hr-rep-body');
    box.append(top, report);
    if (r.posting !== null) box.append(chatBox(c, r.posting));
    veil.append(box);
    document.body.append(veil);

    const list = (titleText: string, items: readonly string[], cls: string): HTMLElement => {
      const b = el('div', `iv-list ${cls}`);
      b.append(el('b', undefined, titleText));
      const ul = el('ul');
      for (const t of items) ul.append(el('li', undefined, t));
      b.append(ul);
      return b;
    };
    const paint = (): void => {
      const s = r.state;
      const p = r.posting;
      title.replaceChildren(el('b', undefined, p?.label ?? `${c.id}사`), el('div', 'hint', c.lens));
      status.replaceChildren();
      if (s.kind === 'done') status.append(el('span', `hr-stamp big ${s.verdict.stamp}`, STAMP_TEXT[s.verdict.stamp]));
      else status.append(el('span', 'hint', s.kind === 'reviewing' ? 'Reviewing…' : s.kind === 'error' ? 'Could not finish' : 'Not sent yet'));
      const keepTop = report.scrollTop;
      report.replaceChildren();
      if (p === null) report.append(el('div', 'dim', 'Send your resume to see this company’s posting and report.'));
      else {
        // 채용 공고·경쟁률·내 위치: 서류 통과선과 추정 순위를 한 줄 막대로
        const post = el('div', 'hr-posting');
        const cut = p.passRates['document'] ?? 0;
        post.append(el('div', undefined, `${p.size} · ${p.role}`), el('div', 'hint', `About ${p.applicants} applicants per opening. The document screening passes the top ${cut}%.`));
        const chips = el('div', 'hr-wants');
        const have = s.kind === 'done' ? s.verdict.stackHave.map((v) => v.toLowerCase()) : [];
        const miss = s.kind === 'done' ? s.verdict.stackMissing.map((v) => v.toLowerCase()) : [];
        for (const w of p.wants) {
          const k = w.toLowerCase();
          const st = have.some((h) => h.includes(k) || k.includes(h)) ? 'have' : miss.some((m) => m.includes(k) || k.includes(m)) ? 'miss' : '';
          chips.append(el('span', `hr-want ${st}`, `${st === 'have' ? '✓ ' : st === 'miss' ? '✗ ' : ''}${w}`));
        }
        post.append(chips);
        // 실제 공고 근거(웹에서 찾아 저장한 시장 정보로 만든 공고일 때)
        if (p.basis !== null) {
          const basis = el('div', 'hr-basis');
          basis.append(el('span', 'hint', `Based on real postings checked ${p.basis.checkedAt}: ${p.basis.companies.join(', ')}`));
          for (const src of p.basis.sources.slice(0, 4)) {
            const a = el('a', 'hr-src', src.title);
            a.href = src.url;
            a.target = '_blank';
            a.rel = 'noreferrer';
            basis.append(a);
          }
          post.append(basis);
        } else post.append(el('span', 'hint', 'Built from typical Korean job market patterns (not a specific company).'));
        if (s.kind === 'done') {
          const bar = el('div', 'hr-rank');
          const line = el('div', 'hr-rank-cut');
          line.style.left = `${cut}%`;
          line.title = `Pass line: top ${cut}%`;
          const dot = el('div', `hr-rank-me ${s.verdict.stamp}`);
          dot.style.left = `${Math.min(99, s.verdict.percentile)}%`;
          bar.append(line, dot);
          post.append(bar, el('div', 'hint', `Reference: about top ${s.verdict.percentile}% of applicants · document pass rate ${cut}%`));
        }
        report.append(post);
        // 회사 서류 평가표: 항목·배점·점수·근거, 합계와 기준 점수, 언어 정책, 연봉 범위
        const rb = el('div', 'hr-rubric');
        const fitPay = salaryFit(me.desiredSalary, p.salary);
        const langMark = s.kind === 'done' ? (s.verdict.languageMet ? ' ✓' : ' ✗') : '';
        rb.append(el('div', 'hr-rubric-head', `Screening rubric · pass score ${p.rubric.passScore}/100 · ${LANG_POLICY[p.rubric.languagePolicy]} (${p.rubric.mainLanguage})${langMark} · salary ${p.salary.min.toLocaleString()}~${p.salary.max.toLocaleString()}만 원${fitPay === null ? '' : ` · your ask: ${SALARY_FIT[fitPay]}`}`));
        for (const cr of p.rubric.criteria) {
          const sc = s.kind === 'done' ? s.verdict.scores.find((x) => x.key === cr.key) : undefined;
          const row = el('div', 'hr-rubric-row');
          const bar = el('div', 'hr-rubric-bar');
          const fill = el('div', 'hr-rubric-fill');
          fill.style.width = `${sc?.score ?? 0}%`;
          bar.append(fill);
          row.append(el('span', 'hr-rubric-label', `${cr.label} · ${cr.weight}`), bar, el('span', 'hr-rubric-score', sc === undefined ? '—' : String(sc.score)), el('span', 'hr-rubric-ev', sc?.evidence ?? ''));
          rb.append(row);
        }
        if (s.kind === 'done') rb.append(el('div', `hr-rubric-total ${s.verdict.stamp}`, `Total ${s.verdict.total}/100 · pass score ${p.rubric.passScore} → ${STAMP_TEXT[s.verdict.stamp]}`));
        report.append(rb);
        if (s.kind === 'done') {
          const track = el('div', 'iv-track');
          const idx = stages.findIndex((st) => st.id === s.verdict.reached);
          const offer = s.verdict.reached === 'offer';
          stages.forEach((st, i) => track.append(el('span', `iv-stage${i < idx || offer ? ' pass' : i === idx ? ' here' : ''}`, `${st.label} ${p.passRates[st.id] ?? ''}%`)));
          report.append(track, el('div', 'hint', `${stopText(s.verdict.reached)}. Percent = share of people who pass that stage here.`), el('p', 'iv-comment', s.verdict.comment));
        }
      }
      if (s.kind === 'error') report.append(el('div', 'err', s.error));
      // 담당자 셋: 각자 맡은 기준(출처)과 그 기준으로 본 한 줄
      const crew = el('div', 'hr-rep-crew');
      c.recruiters.forEach((rc, i) => {
        const card = el('div', 'hr-rep-person');
        const note = s.kind === 'done' ? (s.verdict.notes.find((n) => n.who === rc.name)?.note ?? '') : '';
        const words = el('div', 'grow');
        words.append(el('b', undefined, `${rc.name} · ${rc.title}`), el('div', 'hr-rule', `${rc.by}: "${rc.rule}"`));
        if (note !== '') words.append(el('div', 'hr-note', note));
        card.append(face(c.id, i, 3, 'read'), words);
        crew.append(card);
      });
      report.append(crew);
      if (s.kind === 'done') {
        const cols = el('div', 'iv-cols');
        cols.append(list('Doing well', s.verdict.strengths, 'good'), list('Missing', s.verdict.gaps, 'gap'));
        report.append(cols);
        if (s.verdict.evidence.length > 0) report.append(list('Based on', s.verdict.evidence, 'next'));
        if (s.verdict.question !== '') report.append(el('div', 'iv-q', `Next question: ${s.verdict.question}`));
      }
      if (r.log.length > 0) {
        const talk = el('div', 'hr-talk');
        talk.append(el('div', 'sub', s.kind === 'reviewing' ? 'In the room right now' : 'How they talked it through'));
        for (const l of r.log.slice(-40)) {
          if (l.who === '—') talk.append(el('div', 'hr-talk-sep', l.text));
          else {
            const row = el('div', 'hr-talk-line');
            row.append(el('b', undefined, l.who), el('span', undefined, l.text));
            talk.append(row);
          }
        }
        report.append(talk);
      }
      report.scrollTop = keepTop;
    };
    openReport = { id: c.id, paint };
    paint();
  }

  /** N차 리뷰 기록: 회차마다 회사 5곳의 판정·점수·중점 목록, Main 에 포트폴리오 문서 부탁 */
  async function openHistory(): Promise<void> {
    const { rounds } = await deps.api.history();
    const veil = el('div', 'veil');
    const box = el('div', 'dialog hr-report hr-history');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Review history');
    const close = (): void => {
      veil.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    veil.addEventListener('click', (e) => {
      if (e.target === veil) close();
    });
    const x = el('button', 'btn sm', 'Close');
    x.addEventListener('click', close);
    const done = rounds.filter((r: HiringRound) => r.results.length > 0);
    const ask = el('button', 'btn primary', 'Ask Main for a portfolio doc');
    ask.disabled = done.length === 0;
    ask.title = 'Fills the Main chat with these reviews and a request. You can edit it before sending.';
    ask.addEventListener('click', () => {
      close();
      deps.toMain(portfolioPrompt(done.slice(-5)));
    });
    const top = el('div', 'hr-rep-top');
    top.append(el('b', 'grow', `Review history · ${done.length} rounds`), ask, x);
    const body = el('div', 'hr-rep-body');
    if (done.length === 0) body.append(el('div', 'dim', 'No reviews yet. Send your resume first.'));
    for (const r of [...done].reverse()) body.append(el('pre', 'hr-round', roundMarkdown(r)));
    box.append(top, body);
    veil.append(box);
    document.body.append(veil);
  }

  /** 회사 담당자들과 대화(모달 아래). 모달이 다시 그려져도 이 칸은 그대로 둔다 */
  function chatBox(c: CompanyView, p: PostingView): HTMLElement {
    const box = el('div', 'iv-chat');
    const log = el('div', 'iv-log');
    const input = el('textarea', 'iv-input');
    input.rows = 2;
    input.placeholder = `Ask ${c.recruiters.map((r) => r.name).join(', ')}… (Enter to send, Shift+Enter for a new line)`;
    let waiting = false;
    const draw = (): void => {
      log.replaceChildren();
      for (const m of chats.get(c.id) ?? []) log.append(el('div', `iv-msg ${m.from}`, m.text));
      if (waiting) log.append(el('div', 'iv-msg them dim', '…'));
      log.scrollTop = log.scrollHeight;
    };
    const send = async (): Promise<void> => {
      const q = input.value.trim();
      if (q === '' || waiting) return;
      const history = chats.get(c.id) ?? [];
      chats.set(c.id, [...history, { from: 'me', text: q }]);
      input.value = '';
      waiting = true;
      draw();
      const r = await deps.api.ask(c.id, history, q);
      waiting = false;
      chats.set(c.id, [...(chats.get(c.id) ?? []), { from: 'them', text: r.ok ? r.data : `(${r.error})` }]);
      draw();
    };
    input.addEventListener('keydown', (e) => {
      if (isEnterKey(e) && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    });
    box.append(el('div', 'sub', `Talk to ${p.label}`), log, input);
    draw();
    return box;
  }

  void Promise.all([deps.api.panel(), deps.api.market(), deps.api.facts()]).then(([p, m, f]) => {
    companies = p.companies;
    stages = p.stages;
    market = m;
    if (f.ok) facts = f.data;
    rooms.splice(0, rooms.length, ...companies.map(buildRoom));
    // 위 줄 A·B·C, 아래 줄 D·나·E
    const [a, b, c, d, e] = rooms.map((r) => r.el);
    office.replaceChildren(...[a, b, c, d, hub, e].filter((x): x is HTMLElement => x !== undefined));
    rooms.forEach(paintRoom);
    paintHub();
    paintMarket();
    paintSummary();
  });
  return { root };
}
