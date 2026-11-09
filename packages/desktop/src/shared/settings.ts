import { DEFAULT_PROTECTED_BRANCHES } from './approval-summary.js';
import { DEFAULT_CHARACTER_SET, toCharacterSetId, type CharacterSetId } from './character-set-ids.js';

/** 알림을 켜고 끄는 항목. 단계 넘어감은 기본 꺼짐이다. */
export interface NotifySettings {
  /** 내 허락·선택이 필요할 때 */
  readonly choice: boolean;
  /** 작업이 끝났을 때 */
  readonly done: boolean;
  /** 한도가 90%에 닿았을 때 */
  readonly limit: boolean;
  /** 작업 단계가 넘어갈 때 */
  readonly step: boolean;
}

export interface Settings {
  /** 일할 작업 폴더. 아직 안 골랐으면 null(첫 실행) */
  readonly workFolder: string | null;
  /** 이 폴더에서 일해도 된다고 허락했는지 */
  readonly folderApproved: boolean;
  /** 쓸 계정(프로필 이름). null이면 폴더 규칙에 맡긴다 */
  readonly account: string | null;
  readonly layout: 'A' | 'B';
  /** 동시에 돌 작업 수(1~6). 바꾸면 다음 실행부터 적용된다. */
  readonly concurrency: number;
  readonly protectedBranches: readonly string[];
  readonly notify: NotifySettings;
  /** 첫 실행 안내를 마쳤는지 */
  readonly firstRunDone: boolean;
  /** GitHub에서 새 버전이 있는지 자동으로 확인할지(기본 켬) */
  readonly autoUpdateCheck: boolean;
  /** 블로그 글에서 일반 이름으로 바꿀 회사·서비스 이름(공개하면 안 되는 이름) */
  readonly blogNames: readonly string[];
  /** 분석 요청에서 조사 → 방향 비교 → 설계·계획 단계를 쓸지(기본 켬). 끄면 분석은 팀원 한 번 호출이다. */
  readonly analysisFlow: boolean;
  /** 답답한 점을 올릴 내 개인 AWS: 프로필 이름(사용자가 직접 적은 것만, 기본 프로필을 대신 쓰지 않는다)·버킷·리전·개인 계정 번호. 키는 저장하지 않는다. */
  readonly awsProfile: string | null;
  readonly awsBucket: string | null;
  readonly awsRegion: string | null;
  readonly awsAccount: string | null;
  /** 캐릭터 테마(세트) id. 모르는 값은 기본(바다 친구들)이다. */
  readonly characterSet: CharacterSetId;
}

export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 6;
export const DEFAULT_CONCURRENCY = 3;

export const DEFAULT_SETTINGS: Settings = {
  workFolder: null,
  folderApproved: false,
  account: null,
  layout: 'A',
  concurrency: DEFAULT_CONCURRENCY,
  protectedBranches: DEFAULT_PROTECTED_BRANCHES,
  notify: { choice: true, done: true, limit: true, step: false },
  firstRunDone: false,
  autoUpdateCheck: true,
  blogNames: [],
  analysisFlow: true,
  awsProfile: null,
  awsBucket: null,
  awsRegion: null,
  awsAccount: null,
  characterSet: DEFAULT_CHARACTER_SET,
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
export const BLOG_NAMES_MAX = 50;
const BLOG_NAME_LIMIT = 60;
/** 회사·서비스 이름 목록: 글자만, 공백 지우기, 겹침 없애기, 50개·이름당 60자까지 */
const names = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is string => typeof n === 'string').map((n) => n.trim().slice(0, BLOG_NAME_LIMIT)).filter((n) => n !== ''))].slice(0, BLOG_NAMES_MAX) : [];
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * 파일이나 화면에서 온 값을 설정으로 바꾼다. 모르는 값·틀린 모양은 기본값으로 돌리고(깨진 설정 파일로 앱이 못 열리지 않게),
 * 동시 실행 수는 1~6으로 맞추며, 보호 브랜치는 공백을 지우고 겹침을 없앤다(비면 기본 목록).
 */
export function parseSettings(input: unknown): Settings {
  if (!isObject(input)) return DEFAULT_SETTINGS;
  const n = isObject(input['notify']) ? input['notify'] : {};
  const rawConcurrency = typeof input['concurrency'] === 'number' && Number.isFinite(input['concurrency']) ? Math.round(input['concurrency']) : DEFAULT_CONCURRENCY;
  const branches = Array.isArray(input['protectedBranches']) ? [...new Set(input['protectedBranches'].filter((b): b is string => typeof b === 'string').map((b) => b.trim()).filter((b) => b !== ''))] : [];
  return {
    workFolder: text(input['workFolder']),
    folderApproved: bool(input['folderApproved'], false),
    account: text(input['account']),
    layout: input['layout'] === 'B' ? 'B' : 'A',
    concurrency: Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, rawConcurrency)),
    protectedBranches: branches.length > 0 ? branches : DEFAULT_PROTECTED_BRANCHES,
    notify: {
      choice: bool(n['choice'], DEFAULT_SETTINGS.notify.choice),
      done: bool(n['done'], DEFAULT_SETTINGS.notify.done),
      limit: bool(n['limit'], DEFAULT_SETTINGS.notify.limit),
      step: bool(n['step'], DEFAULT_SETTINGS.notify.step),
    },
    firstRunDone: bool(input['firstRunDone'], false),
    autoUpdateCheck: bool(input['autoUpdateCheck'], true),
    blogNames: names(input['blogNames']),
    analysisFlow: bool(input['analysisFlow'], true),
    awsProfile: text(input['awsProfile']),
    awsBucket: text(input['awsBucket']),
    awsRegion: text(input['awsRegion']),
    awsAccount: text(input['awsAccount']),
    characterSet: toCharacterSetId(input['characterSet']),
  };
}

/** 일부만 바꾼다. 합친 뒤 다시 parseSettings를 거쳐 값을 바로잡는다. */
export function updateSettings(current: Settings, patch: Partial<Omit<Settings, 'notify'>> & { notify?: Partial<NotifySettings> }): Settings {
  return parseSettings({ ...current, ...patch, notify: { ...current.notify, ...patch.notify } });
}

/** 한도 막대 색: 70% 노랑, 90% 빨강, 그 아래 초록 */
export function limitTone(percent: number): 'green' | 'yellow' | 'red' {
  return percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green';
}

/** 지금 폴더에서 일해도 되는 상태인지(폴더를 골랐고 허락했다) */
export const canWork = (s: Settings): boolean => s.workFolder !== null && s.folderApproved;
