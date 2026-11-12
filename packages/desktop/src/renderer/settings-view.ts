import { limitTone, type Settings } from '../shared/settings.js';
import type { AccountsView, AuthApi, DiagnosticsResult, SettingsPatch, UsageView, UsageWindowView } from '../shared/ipc.js';
import { el } from './dom.js';
import type { UpdateView } from '../shared/update-record.js';
import { installStateText, isInstallBusy } from '../shared/update-install.js';
import { checkedText, GATEKEEPER_NOTE } from './update-text.js';
import type { UpdateFeed } from './update-view.js';
import { createLoginControl } from './login-view.js';
import { usageTooltip, type UsageFeed } from './usage-feed.js';
import { diagnosticsText } from './diagnostics-text.js';
import { CHARACTER_SETS } from './character-sets/index.js';
import { setSprite, type CharacterRole } from './characters.js';
import { AUTO_SAVE_MODES, autoSaveLabel, parseAutoSaveMode } from '../shared/auto-save.js';
import { buildRecentFolders } from './recent-folders-view.js';
import { ask } from './code-dialog.js';
import { paintSpriteFace } from './pixel-art.js';
import { buildModels } from './models-view.js';

/** 테마 카드 미리보기에 보여 줄 역할(팀장 포함 앞 몇 명) */
const PREVIEW_ROLES: readonly CharacterRole[] = ['intake', 'tester', 'implementer', 'reviewer', 'bm'];

export interface SettingsApi {
  get(): Promise<Settings>;
  update(patch: SettingsPatch): Promise<Settings>;
  usage(): Promise<UsageView | null>;
  /** 상태 줄과 같은 한도 값(없으면 설정을 열 때 받은 값만 보인다) */
  usageFeed?: UsageFeed;
  accounts(): Promise<AccountsView>;
  pickFolder(): Promise<string | null>;
  /** 최근 작업 폴더 확인·빼기(없으면 최근 목록을 그리지 않는다) */
  recent?: { status(): Promise<Readonly<Record<string, boolean>>>; forget(path: string): Promise<unknown> };
  /** 앱 안 Claude 로그인(없으면 로그인 칸을 그리지 않는다) */
  auth?: AuthApi;
  /** 새 버전 알림(없으면 그 구역을 그리지 않는다) */
  updates?: { readonly feed: UpdateFeed; check(): Promise<unknown>; install(): Promise<unknown> };
  /** 팀 설정(팀원 22명). 없으면 그 구역을 그리지 않는다. */
  team?: { build(): HTMLElement };
  /** 캐릭터 테마가 바뀌었을 때(화면의 캐릭터에 바로 반영) */
  onCharacterSet?: (id: string) => void;
  /** 진단 정보 복사(없으면 도움말 구역을 그리지 않는다) */
  diagnostics?: () => Promise<DiagnosticsResult>;
}

/** 초기화 시각을 "오늘 오후 3:20" 같은 짧은 글로(모르면 빈 글) */
export function resetText(iso: string | null, now = new Date()): string {
  if (iso === null) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? `Today ${time}` : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

/** 한도 막대 하나(돈은 보이지 않고 %만 보인다). 색은 70% 노랑, 90% 빨강. */
export function limitBar(label: string, w: UsageWindowView | null): HTMLElement {
  const row = el('div', 'limit');
  row.appendChild(el('span', 'lbl', label));
  const bar = el('span', 'bar');
  const fill = el('i');
  if (w !== null) {
    const pct = Math.max(0, Math.min(100, Math.round(w.percent)));
    fill.style.width = `${pct}%`;
    fill.className = limitTone(pct);
    row.append(bar, el('span', 'pct', `${pct}%`), el('span', 'dim', w.resetsAt !== null ? `Resets ${resetText(w.resetsAt)}` : ''));
  } else {
    row.append(bar, el('span', 'dim', 'Not read yet'));
  }
  // 못 읽었으면 빈 막대로 둔다(채우지 않으면 초록 가득이 아니라 빈 회색)
  if (w !== null) bar.appendChild(fill);
  return row;
}

/** Settings 탭: 계정·한도 / 작업 폴더 / 알림 / 화면 / 권한 / 정보 저장·캐릭터(곧) */
export function buildSettings(api: SettingsApi, onLayout: (layout: 'A' | 'B') => void) {
  const root = el('section', 'settings');
  const section = (title: string, ...children: HTMLElement[]) => {
    const pane = el('div', 'pane sec');
    pane.append(el('div', 'ph', title), ...children);
    return pane;
  };
  const row = (label: string, control: HTMLElement) => {
    const r = el('label', 'srow');
    r.append(el('span', 'lbl', label), control);
    return r;
  };

  let unsubscribe: (() => void) | null = null;
  let unsubscribeUsage: (() => void) | null = null;

  async function render(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeUsage?.();
    unsubscribeUsage = null;
    const [s, usage, accounts] = await Promise.all([api.get(), api.usage(), api.accounts()]).catch((error: unknown) => {
      root.replaceChildren(el('div', 'err pad', `Could not load settings: ${error instanceof Error ? error.message : String(error)}`));
      return [null, null, null] as const;
    });
    if (s === null || accounts === null) return;
    const head = el('div', 'rhead');
    head.appendChild(el('b', undefined, 'Settings'));
    root.replaceChildren(head);

    // 계정·한도
    const account = el('select');
    account.appendChild(new Option('Follow folder rules', ''));
    for (const n of accounts.names) account.appendChild(new Option(n, n));
    account.value = s.account ?? '';
    account.addEventListener('change', () => void api.update({ account: account.value === '' ? null : account.value }).then(render));
    const limits = el('div', 'limits');
    const paintLimits = (view: UsageView | null, readAt: number | null): void => {
      limits.replaceChildren(limitBar('Session (5h)', view?.session ?? null), limitBar('This week', view?.weekly ?? null), el('div', 'hint pad', usageTooltip(view === null ? null : { session: view.session, weekly: view.weekly, readAt })));
    };
    paintLimits(usage, api.usageFeed?.current()?.readAt ?? null);
    if (api.usageFeed !== undefined) {
      const stop = api.usageFeed.subscribe((view) => (limits.isConnected ? paintLimits(view, view.readAt) : stop()));
      unsubscribeUsage = stop;
    }
    const login = api.auth === undefined ? [] : [createLoginControl(api.auth, { onSuccess: () => void api.usage().then(() => undefined) }).root];
    root.appendChild(section('Account · Limits', ...login, row('Account to use', account), limits, el('div', 'hint pad', 'One account is one Claude Code config folder. You log in in the browser; tokens are never read.')));

    // 작업 폴더
    const change = el('button', 'btn', 'Change');
    change.addEventListener('click', () => void api.pickFolder().then((p) => (p === null ? undefined : api.update({ workFolder: p, folderApproved: true }).then(render))));
    const recent = api.recent;
    const recentList =
      recent === undefined
        ? []
        : [
            buildRecentFolders({
              folders: s.recentFolders,
              current: s.workFolder,
              status: () => recent.status(),
              forget: (p) => recent.forget(p),
              // 고르면 폴더 고르기 창 뒤와 같은 허락을 묻는다(허락 없이 작업 폴더를 바꾸지 않는다)
              choose: (path) =>
                void ask('Allow work in this folder?', path, [{ id: 'allow', label: 'Allow', kind: 'primary' }, { id: 'cancel', label: 'Cancel' }], ['Teammates can read and edit files inside. Risky actions still ask each time.']).then((answer) =>
                  answer === 'allow' ? api.update({ workFolder: path, folderApproved: true }).then(render) : undefined,
                ),
            }),
          ];
    root.appendChild(section('Work folder', row(s.workFolder ?? 'Not chosen yet', change), ...recentList));

    // 편집기: 자동 저장
    const autoSave = el('select');
    for (const mode of AUTO_SAVE_MODES) autoSave.appendChild(new Option(autoSaveLabel(mode), mode));
    autoSave.value = s.autoSave;
    autoSave.addEventListener('change', () => void api.update({ autoSave: parseAutoSaveMode(autoSave.value) }));
    root.appendChild(section('Editor', row('Auto save', autoSave), el('div', 'hint pad', 'Saves open files in the Repo tab for you. Read-only files and secret files are never saved, and a file that changed on disk is left for you to decide.')));

    // 알림
    const toggles = [['choice', 'When I need to allow or choose'], ['done', 'When a job finishes'], ['limit', 'When a limit reaches 90%'], ['step', 'When a job moves to the next step (off by default)']] as const;
    const notify = toggles.map(([key, label]) => {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.notify[key];
      box.addEventListener('change', () => void api.update({ notify: { [key]: box.checked } }));
      return row(label, box);
    });
    root.appendChild(section('Notifications', ...notify));

    // 새 버전: 현재 버전 · 확인 · 마지막 확인 · 자동 확인
    if (api.updates !== undefined) {
      const { feed, check } = api.updates;
      const version = el('span', 'lbl');
      const button = el('button', 'btn', 'Check for updates');
      button.addEventListener('click', () => void check());
      const status = el('div', 'dim pad');
      const installNow = el('button', 'btn primary', 'Update now');
      installNow.hidden = true;
      installNow.addEventListener('click', () => void api.updates?.install());
      const auto = el('input');
      auto.type = 'checkbox';
      auto.checked = s.autoUpdateCheck;
      auto.addEventListener('change', () => void api.update({ autoUpdateCheck: auto.checked }));
      const head = el('div', 'srow');
      head.append(version, button, installNow);
      const paint = (view: UpdateView | null): void => {
        version.textContent = `Current version ${view?.current ?? ''}`;
        button.disabled = view?.checking === true;
        const busy = view !== null && isInstallBusy(view.install);
        installNow.hidden = !(view?.canInstall === true && view.newer);
        installNow.disabled = busy;
        installNow.textContent = busy && view !== null ? installStateText(view.install) : 'Update now';
        status.replaceChildren(...(view?.checking === true ? [el('span', 'spinner')] : []), view === null ? '' : checkedText(view, resetText(view.checkedAt)));
        status.classList.toggle('err', view?.failed === true);
      };
      paint(feed.current());
      unsubscribe = feed.subscribe(paint);
      root.appendChild(section('New version', head, status, row('Check automatically (every 6 hours)', auto), el('div', 'hint pad', GATEKEEPER_NOTE)));
    }

    // 화면
    const layout = el('select');
    layout.append(new Option('Side by side (A)', 'A'), new Option('Stacked (B)', 'B'));
    layout.value = s.layout;
    layout.addEventListener('change', () => {
      const next = layout.value === 'B' ? 'B' : 'A';
      void api.update({ layout: next });
      onLayout(next);
    });
    root.appendChild(section('Display', row('Chat layout', layout), el('div', 'hint pad', 'When the window is narrow, the layout switches to stacked or main-only automatically.')));

    // 권한
    const branches = el('input');
    branches.value = s.protectedBranches.join(', ');
    branches.addEventListener('change', () => void api.update({ protectedBranches: branches.value.split(',').map((b) => b.trim()) }).then(render));
    const concurrency = el('input');
    concurrency.type = 'number';
    concurrency.min = '1';
    concurrency.max = '6';
    concurrency.value = String(s.concurrency);
    concurrency.addEventListener('change', () => void api.update({ concurrency: Number(concurrency.value) }).then(render));
    root.appendChild(section('Permissions', row('Protected branches (comma-separated)', branches), row('Jobs running at once (from next launch)', concurrency)));

    // 분석: 조사 → 방향 비교 → 설계·계획 단계를 쓸지
    const flow = el('input');
    flow.type = 'checkbox';
    flow.checked = s.analysisFlow;
    flow.addEventListener('change', () => void api.update({ analysisFlow: flow.checked }));
    root.appendChild(section('Analysis', row('Use analysis steps (research → compare → design/plan)', flow), el('div', 'hint pad', 'Used only for requests that ask for causes, risks or approaches. When off, analysis is a single teammate call with no question cards. Applies from the next request.')));

    // 모델 이름: 등급마다 부를 모델 ID(계정마다 쓸 수 있는 모델이 다르다)
    root.appendChild(section('Models', ...buildModels(s.models, (models) => api.update({ models }).then(render))));

    // 캐릭터 테마: 22역할의 그림이 한 번에 바뀐다
    const sets = el('div', 'cset-list');
    for (const set of CHARACTER_SETS) {
      const card = el('button', set.id === s.characterSet ? 'item cset on' : 'item cset');
      card.type = 'button';
      card.setAttribute('aria-pressed', String(set.id === s.characterSet));
      const faces = el('span', 'cset-faces');
      for (const role of PREVIEW_ROLES) {
        const face = el('canvas', 'sp');
        paintSpriteFace(face, setSprite(set, role), 3);
        faces.appendChild(face);
      }
      card.append(faces, el('b', undefined, set.name), el('span', 'hint', set.blurb));
      card.addEventListener('click', () => void api.update({ characterSet: set.id }).then((next) => (api.onCharacterSet?.(next.characterSet), render())));
      sets.appendChild(card);
    }
    root.appendChild(section('Character theme', sets, el('div', 'hint pad', 'Click to change all 22 teammates at once. Characters you picked per teammate in Team settings stay as they are.')));

    if (api.team !== undefined) root.appendChild(section('Team settings', api.team.build()));
    root.appendChild(section('Data storage', el('div', 'dim pad', 'Records are stored only on this computer for now (Records tab). Sending summaries to your AWS (S3) will open later.')));
    if (api.diagnostics !== undefined) {
      const run = api.diagnostics;
      const copy = el('button', 'btn', 'Copy diagnostics');
      const status = el('div', 'hint pad', 'If something goes wrong, press this and paste the copied text to the developer. Emails, home paths and keys are masked. You can also type /진단 in the chat box.');
      copy.addEventListener('click', () => {
        copy.disabled = true;
        status.textContent = 'Collecting diagnostics…';
        void run()
          .catch(() => null)
          .then((result) => {
            status.textContent = diagnosticsText(result);
            copy.disabled = false;
          });
      });
      root.appendChild(section('Help', row('Copy the app state as one block', copy), status));
    }
  }

  void render();
  return { root, refresh: render };
}
