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
import { syncBlockReason } from '../shared/bug-sync.js';
import { CHARACTER_SETS } from './character-sets/index.js';
import { setSprite, type CharacterRole } from './characters.js';
import { paintSpriteFace } from './pixel-art.js';

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
  let unsubscribeUsage: (() => void) | null = null;

  async function render(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeUsage?.();
    unsubscribeUsage = null;
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
    const paintLimits = (view: UsageView | null, readAt: number | null): void => {
      limits.replaceChildren(limitBar('지금 세션(5시간)', view?.session ?? null), limitBar('이번 주', view?.weekly ?? null), el('div', 'hint pad', usageTooltip(view === null ? null : { session: view.session, weekly: view.weekly, readAt })));
    };
    paintLimits(usage, api.usageFeed?.current()?.readAt ?? null);
    if (api.usageFeed !== undefined) {
      const stop = api.usageFeed.subscribe((view) => (limits.isConnected ? paintLimits(view, view.readAt) : stop()));
      unsubscribeUsage = stop;
    }
    const login = api.auth === undefined ? [] : [createLoginControl(api.auth, { onSuccess: () => void api.usage().then(() => undefined) }).root];
    root.appendChild(section('계정·한도', ...login, row('쓸 계정', account), limits, el('div', 'hint pad', '계정 하나는 Claude Code 설정 폴더 하나예요. 로그인은 브라우저에서 하고, 토큰은 읽지 않아요.')));

    // 작업 폴더
    const change = el('button', 'btn', '바꾸기');
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
      const button = el('button', 'btn', '업데이트 확인');
      button.addEventListener('click', () => void check());
      const status = el('div', 'dim pad');
      const installNow = el('button', 'btn primary', '지금 업데이트');
      installNow.hidden = true;
      installNow.addEventListener('click', () => void api.updates?.install());
      const auto = el('input');
      auto.type = 'checkbox';
      auto.checked = s.autoUpdateCheck;
      auto.addEventListener('change', () => void api.update({ autoUpdateCheck: auto.checked }));
      const head = el('div', 'srow');
      head.append(version, button, installNow);
      const paint = (view: UpdateView | null): void => {
        version.textContent = `현재 버전 ${view?.current ?? ''}`;
        button.disabled = view?.checking === true;
        const busy = view !== null && isInstallBusy(view.install);
        installNow.hidden = !(view?.canInstall === true && view.newer);
        installNow.disabled = busy;
        installNow.textContent = busy && view !== null ? installStateText(view.install) : '지금 업데이트';
        status.replaceChildren(...(view?.checking === true ? [el('span', 'spinner')] : []), view === null ? '' : checkedText(view, resetText(view.checkedAt)));
        status.classList.toggle('err', view?.failed === true);
      };
      paint(feed.current());
      unsubscribe = feed.subscribe(paint);
      root.appendChild(section('새 버전', head, status, row('자동으로 확인(6시간마다)', auto), el('div', 'hint pad', GATEKEEPER_NOTE)));
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

    // 분석: 조사 → 방향 비교 → 설계·계획 단계를 쓸지
    const flow = el('input');
    flow.type = 'checkbox';
    flow.checked = s.analysisFlow;
    flow.addEventListener('change', () => void api.update({ analysisFlow: flow.checked }));
    root.appendChild(section('분석', row('분석 단계 쓰기(조사 → 방향 비교 → 설계·계획)', flow), el('div', 'hint pad', '원인·위험·방법을 분석해 달라는 요청에서만 써요. 끄면 분석은 팀원 한 번 호출이고 질문 카드도 나오지 않아요. 다음 요청부터 적용돼요.')));

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
    root.appendChild(section('캐릭터 테마', sets, el('div', 'hint pad', '누르면 팀원 22명의 그림이 한 번에 바뀌어요. 팀 설정에서 팀원마다 따로 고른 캐릭터는 그대로 남아요.')));

    if (api.team !== undefined) root.appendChild(section('팀 설정', api.team.build()));
    // 내 AWS: 답답한 점 메모를 올리고 받는 곳. 키는 받지도 저장하지도 않고, 터미널에서 등록한 프로필 이름만 적는다.
    const awsField = (key: 'awsProfile' | 'awsBucket' | 'awsRegion' | 'awsAccount', label: string, placeholder: string): HTMLElement => {
      const input = el('input');
      input.placeholder = placeholder;
      input.value = s[key] ?? '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('change', () => void api.update({ [key]: input.value.trim() === '' ? null : input.value.trim() }).then(render));
      return row(label, input);
    };
    const awsHint = syncBlockReason({ profile: s.awsProfile, bucket: s.awsBucket, region: s.awsRegion, account: s.awsAccount });
    root.appendChild(
      section(
        '내 AWS (리포트 올리기)',
        awsField('awsProfile', '프로필 이름', '예: rauha-personal'),
        awsField('awsBucket', '버킷', '예: example-bucket'),
        awsField('awsRegion', '리전', '예: ap-northeast-2'),
        awsField('awsAccount', '개인 계정 번호(12자리)', '000000000000'),
        el('div', awsHint === null ? 'hint pad' : 'err pad', awsHint ?? '준비됐어요. 올리거나 받기 직전에 실제 계정이 이 번호와 같은지 확인하고, 다르면 멈춰요.'),
        el('div', 'hint pad', 'AWS 키는 앱에 적지 않아요. 터미널에서 aws configure --profile 이름 으로 등록한 프로필 이름만 적어요. 프로필 이름을 적기 전에는 올리기·받기가 꺼져 있어요.'),
      ),
    );
    root.appendChild(section('정보 저장', el('div', 'dim pad', '지금은 기록이 이 컴퓨터에만 저장돼요(기록 탭). 내 AWS(S3)로 요약을 보내는 기능은 나중에 열려요.')));
    if (api.diagnostics !== undefined) {
      const run = api.diagnostics;
      const copy = el('button', 'btn', '진단 정보 복사');
      const status = el('div', 'hint pad', '문제가 생기면 이 버튼을 누르고, 복사된 글을 개발자에게 붙여 넣어 주세요. 이메일·홈 경로·키는 가려져요. 입력창에 /진단을 쳐도 돼요.');
      copy.addEventListener('click', () => {
        copy.disabled = true;
        status.textContent = '진단 정보를 모으는 중이에요…';
        void run()
          .catch(() => null)
          .then((result) => {
            status.textContent = diagnosticsText(result);
            copy.disabled = false;
          });
      });
      root.appendChild(section('도움말', row('앱 상태를 한 덩어리로 복사해요', copy), status));
    }
  }

  void render();
  return { root, refresh: render };
}
