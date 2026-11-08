import { limitTone, type Settings } from '../shared/settings.js';
import type { AccountsView, AuthApi, SettingsPatch, UsageView, UsageWindowView } from '../shared/ipc.js';
import { el } from './dom.js';
import type { UpdateView } from '../shared/update-record.js';
import { checkedText } from './update-text.js';
import type { UpdateFeed } from './update-view.js';
import { createLoginControl } from './login-view.js';

export interface SettingsApi {
  get(): Promise<Settings>;
  update(patch: SettingsPatch): Promise<Settings>;
  usage(): Promise<UsageView | null>;
  accounts(): Promise<AccountsView>;
  pickFolder(): Promise<string | null>;
  /** 앱 안 Claude 로그인(없으면 로그인 칸을 그리지 않는다) */
  auth?: AuthApi;
  /** 새 버전 알림(없으면 그 구역을 그리지 않는다) */
  updates?: { readonly feed: UpdateFeed; check(): Promise<unknown> };
  /** 팀 설정(팀원 22명). 없으면 그 구역을 그리지 않는다. */
  team?: { build(): HTMLElement };
}

/** 초기화 시각을 "오늘 오후 3:20" 같은 짧은 글로(모르면 빈 글) */
export function resetText(iso: string | null, now = new Date()): string {
  if (iso === null) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? `오늘 ${time}` : `${at.getMonth() + 1}월 ${at.getDate()}일 ${time}`;
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
    row.append(bar, el('span', 'pct', `${pct}%`), el('span', 'dim', w.resetsAt !== null ? `초기화 ${resetText(w.resetsAt)}` : ''));
  } else {
    row.append(bar, el('span', 'dim', '아직 못 읽었어요'));
  }
  bar.appendChild(fill);
  return row;
}

/** 설정 탭: 계정·한도 / 작업 폴더 / 알림 / 화면 / 권한 / 정보 저장·캐릭터(곧) */
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

  async function render(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    const [s, usage, accounts] = await Promise.all([api.get(), api.usage(), api.accounts()]).catch((error: unknown) => {
      root.replaceChildren(el('div', 'err pad', `설정을 불러오지 못했어요: ${error instanceof Error ? error.message : String(error)}`));
      return [null, null, null] as const;
    });
    if (s === null || accounts === null) return;
    const head = el('div', 'rhead');
    head.appendChild(el('b', undefined, '설정'));
    root.replaceChildren(head);

    // 계정·한도
    const account = el('select');
    account.appendChild(new Option('폴더 규칙에 맡기기', ''));
    for (const n of accounts.names) account.appendChild(new Option(n, n));
    account.value = s.account ?? '';
    account.addEventListener('change', () => void api.update({ account: account.value === '' ? null : account.value }).then(render));
    const limits = el('div', 'limits');
    limits.append(limitBar('지금 세션(5시간)', usage?.session ?? null), limitBar('이번 주', usage?.weekly ?? null));
    const login = api.auth === undefined ? [] : [createLoginControl(api.auth, { onSuccess: () => void api.usage().then(() => undefined) }).root];
    root.appendChild(section('계정·한도', row('계정', account), ...login, limits, el('div', 'hint pad', '계정 하나는 Claude Code 설정 폴더 하나예요. 로그인은 브라우저에서 하고, 토큰은 읽지 않아요.')));

    // 작업 폴더
    const change = el('button', 'btn sec', '바꾸기');
    change.addEventListener('click', () => void api.pickFolder().then((p) => (p === null ? undefined : api.update({ workFolder: p, folderApproved: true }).then(render))));
    root.appendChild(section('작업 폴더', row(s.workFolder ?? '아직 안 골랐어요', change)));

    // 알림
    const toggles = [['choice', '내 허락·선택이 필요할 때'], ['done', '작업이 끝났을 때'], ['limit', '한도가 90%에 닿았을 때'], ['step', '작업 단계가 넘어갈 때(기본 꺼짐)']] as const;
    const notify = toggles.map(([key, label]) => {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.notify[key];
      box.addEventListener('change', () => void api.update({ notify: { [key]: box.checked } }));
      return row(label, box);
    });
    root.appendChild(section('알림', ...notify));

    // 새 버전: 현재 버전 · 확인 · 마지막 확인 · 자동 확인
    if (api.updates !== undefined) {
      const { feed, check } = api.updates;
      const version = el('span', 'lbl');
      const button = el('button', 'btn sec', '업데이트 확인');
      button.addEventListener('click', () => void check());
      const status = el('div', 'dim pad');
      const auto = el('input');
      auto.type = 'checkbox';
      auto.checked = s.autoUpdateCheck;
      auto.addEventListener('change', () => void api.update({ autoUpdateCheck: auto.checked }));
      const head = el('div', 'srow');
      head.append(version, button);
      const paint = (view: UpdateView | null): void => {
        version.textContent = `현재 버전 ${view?.current ?? ''}`;
        button.disabled = view?.checking === true;
        status.textContent = view === null ? '' : checkedText(view, resetText(view.checkedAt));
      };
      paint(feed.current());
      unsubscribe = feed.subscribe(paint);
      root.appendChild(section('새 버전', head, status, row('자동으로 확인(6시간마다)', auto)));
    }

    // 화면
    const layout = el('select');
    layout.append(new Option('나란히(A)', 'A'), new Option('위아래(B)', 'B'));
    layout.value = s.layout;
    layout.addEventListener('change', () => {
      const next = layout.value === 'B' ? 'B' : 'A';
      void api.update({ layout: next });
      onLayout(next);
    });
    root.appendChild(section('화면', row('채팅 배치', layout), el('div', 'hint pad', '창이 좁으면 알아서 위아래나 메인만 보이게 바뀌어요.')));

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
    root.appendChild(section('권한', row('보호 브랜치(쉼표로)', branches), row('동시에 돌 작업 수(다음 실행부터)', concurrency)));

    if (api.team !== undefined) root.appendChild(section('팀 설정', api.team.build()));
    root.appendChild(section('정보 저장', el('div', 'dim pad', '지금은 기록이 이 컴퓨터에만 저장돼요(기록 탭). 내 AWS(S3)로 요약을 보내는 기능은 나중에 열려요.')));
  }

  void render();
  return { root, refresh: render };
}
