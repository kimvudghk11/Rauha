import type { Verdict } from './gh-actions.js';
import { isLimitStop } from './limit-retry.js';

/** 운영체제 알림 한 건(제목 + 본문, 본문은 두 줄까지) */
export interface Notice {
  readonly title: string;
  readonly body: string;
}

/** 내가 멈춘 작업(코어 JobRunner 가 남기는 이유와 같은 말) */
const STOPPED_BY_USER = '사용자가 멈춤';
const REQUEST_MAX = 60;

/** 요청 첫 줄을 알림 본문 길이로 자른다 */
function short(text: string, max = REQUEST_MAX): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 분 단위 길이를 "1시간 5분" / "12분" 으로 */
export function minutesText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}분` : m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 초 단위 길이를 "3분 12초" / "40초" 로 */
function secondsText(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m === 0 ? `${s}초` : s === 0 ? `${minutesText(m)}` : `${minutesText(m)} ${s}초`;
}

export interface JobOverInput {
  readonly request: string;
  readonly status: 'done' | 'stopped';
  readonly stopReason: string | null;
  readonly queuedAt: string;
  readonly endedAt: string | null;
  readonly deep: boolean;
  readonly knowledgeMissing: boolean;
}

/** 작업이 끝나거나 멈췄을 때. 내가 멈춘 작업은 알리지 않는다(null). */
export function jobOverNotice(j: JobOverInput): Notice | null {
  const request = short(j.request);
  if (j.status === 'stopped') {
    const reason = (j.stopReason ?? '').trim();
    if (reason === STOPPED_BY_USER) return null;
    if (isLimitStop(reason)) return { title: '한도에 걸려 작업이 멈췄어요', body: `${request}\n한도가 풀리면 다시 맡겨 주세요.` };
    if (/log.?in|로그인|auth|unauthori[sz]ed|401/i.test(reason)) return { title: '로그인이 풀려 작업이 멈췄어요', body: `${request}\nSettings › Account 에서 다시 로그인해 주세요.` };
    return { title: '작업이 중간에 멈췄어요', body: reason === '' ? request : `${request}\n이유: ${short(reason, 80)}` };
  }
  const ms = j.endedAt === null ? NaN : Date.parse(j.endedAt) - Date.parse(j.queuedAt);
  const min = Number.isFinite(ms) ? (ms < 60_000 ? 0 : Math.round(ms / 60_000)) : null;
  const took = min === null || min < 1 ? '' : ` · ${minutesText(min)}`;
  const title = j.deep ? `깊게 다시 본 답이 나왔어요${took}` : min !== null && min < 1 ? '금방 끝났어요' : min !== null && min >= 60 ? `오래 걸린 작업이 끝났어요${took}` : `작업이 끝났어요${took}`;
  return { title, body: j.knowledgeMissing ? `${request}\n저장소를 다 읽지 못하고 답했어요. 확인해 주세요.` : request };
}

export interface ApprovalInput {
  /** approval = 파일·명령·push 허락, choice = 분석 방향·질문 카드 */
  readonly kind: 'approval' | 'choice';
  readonly headline: string;
  /** 그 허락이 걸린 작업 요청(모르면 null) */
  readonly request: string | null;
  /** 지금 기다리는 허락·선택 수(이번 것 포함) */
  readonly waiting: number;
}

export function approvalNotice(a: ApprovalInput): Notice {
  const base = a.kind === 'approval' ? '허락이 필요해요' : '팀이 내 선택을 기다려요';
  const title = a.waiting > 1 ? `${base} · ${a.waiting}개 기다리는 중` : base;
  const request = a.request === null ? '' : short(a.request);
  return { title, body: request === '' ? short(a.headline, 80) : `${short(a.headline, 80)}\n작업: ${request}` };
}

export interface LimitWindow {
  readonly percent: number;
  readonly resetsAt: string | null;
}

/** 한도 알림. near = 90% 이상, full = 100%. 90% 아래면 null. */
export function limitNotice(u: { session: LimitWindow | null; weekly: LimitWindow | null; now: Date }): (Notice & { level: 'near' | 'full' }) | null {
  const pick = [
    { name: '이번 세션', w: u.session },
    { name: '이번 주', w: u.weekly },
  ]
    .filter((x): x is { name: string; w: LimitWindow } => x.w !== null)
    .sort((a, b) => b.w.percent - a.w.percent)[0];
  if (pick === undefined || pick.w.percent < 90) return null;
  const left = pick.w.resetsAt === null ? NaN : Math.round((Date.parse(pick.w.resetsAt) - u.now.getTime()) / 60_000);
  const when = Number.isFinite(left) && left > 0 ? `${minutesText(left)} 뒤에 풀려요. ` : '';
  if (pick.w.percent >= 100) return { level: 'full', title: `${pick.name} 한도를 다 썼어요`, body: `${when}그때까지 맡긴 작업은 한도에 걸려 멈춰요.` };
  return { level: 'near', title: `${pick.name} 한도 ${Math.floor(pick.w.percent)}% 썼어요`, body: `${when}새 작업은 꼭 필요한 것만 맡기세요.` };
}

const ACTIONS_WORD: Readonly<Record<Verdict, { title: string; done: string }>> = {
  success: { title: '통과', done: '통과했어요.' },
  failure: { title: '실패', done: '실패했어요. 로그를 확인해 주세요.' },
  cancelled: { title: '취소됨', done: '취소됐어요.' },
  skipped: { title: '건너뜀', done: '건너뛰었어요.' },
  queued: { title: '대기', done: '기다리는 중이에요.' },
  running: { title: '실행 중', done: '도는 중이에요.' },
};

export function actionsNotice(r: { workflow: string; branch: string; verdict: Verdict; durationSec: number | null }): Notice {
  const w = ACTIONS_WORD[r.verdict];
  const took = r.durationSec === null ? '' : ` · ${secondsText(r.durationSec)} 만에`;
  return { title: `GitHub Actions ${w.title} · ${r.branch}`, body: `${r.workflow}${took} ${w.done}` };
}
