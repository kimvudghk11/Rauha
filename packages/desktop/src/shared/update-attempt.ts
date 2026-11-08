/**
 * 앱 안 설치는 앱이 꺼진 뒤에 다른 프로세스가 하니, 결과를 그 자리에서 알 수 없다.
 * 그래서 설치 전에 "시도 기록"을 남기고, 다시 켜진 앱이 기록·스크립트 결과·지금 버전을 맞춰 보고 알린다. 바깥(파일)을 모른다.
 */
import { AppVersion } from './app-update.js';

export interface AttemptRecord {
  /** 설치를 시작할 때의 버전과 받으려던 버전 */
  readonly from: string;
  readonly to: string;
  /** 새 앱을 둘 위치(맥은 .app 폴더, Windows는 null) */
  readonly target: string | null;
  /** 시작 시각(ISO) */
  readonly at: string;
  /** 설치 스크립트 기록 파일 */
  readonly log: string;
}

export function parseAttempt(input: unknown): AttemptRecord | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  const from = AppVersion.parse(o['from']);
  const to = AppVersion.parse(o['to']);
  if (from === null || to === null || typeof o['at'] !== 'string' || typeof o['log'] !== 'string') return null;
  return { from: from.toString(), to: to.toString(), target: typeof o['target'] === 'string' ? o['target'] : null, at: o['at'], log: o['log'] };
}

/** 지난 설치 시도의 결과(화면에 한 번 알린다) */
export type AttemptOutcome =
  | { readonly kind: 'updated'; readonly version: string; readonly target: string | null }
  | { readonly kind: 'failed'; readonly version: string; readonly reason: string; readonly log: string };

/** 스크립트가 아직 끝나지 않았을 수 있는 시간(이 안에 결과가 없으면 판단을 미룬다) */
export const PENDING_MS = 90_000;

export function swapFailureText(code: string): string {
  switch (code) {
    case 'app-running':
      return '앱이 60초 안에 닫히지 않아서 바꾸지 못했어요';
    case 'mount':
      return '설치 파일을 풀 임시 폴더를 만들지 못했어요';
    case 'attach':
      return '내려받은 설치 파일(dmg)을 열지 못했어요';
    case 'no-app':
      return '설치 파일 안에서 앱을 찾지 못했어요';
    case 'copy':
      return '새 앱을 복사하지 못했어요(디스크 공간이나 권한을 확인해 주세요)';
    case 'swap':
      return '옛 앱을 새 앱으로 바꾸지 못했어요(Applications 폴더 권한을 확인해 주세요)';
    default:
      return '설치 프로그램이 오류로 끝났어요';
  }
}

/**
 * 시도 기록 + 스크립트 결과 글("ok" / "fail 코드" / 없으면 null) + 지금 버전 + 지금 시각으로 결과를 정한다.
 * 알릴 게 없으면 null: 기록이 없거나, 설치가 아직 진행 중일 수 있을 때.
 */
export function judgeAttempt(record: AttemptRecord | null, scriptResult: string | null, current: AppVersion, now: Date): AttemptOutcome | null {
  if (record === null) return null;
  const to = AppVersion.parse(record.to);
  if (to === null) return null;
  if (!to.isNewerThan(current)) return { kind: 'updated', version: record.to, target: record.target };
  const result = scriptResult?.trim() ?? '';
  if (result === '' && now.getTime() - Date.parse(record.at) < PENDING_MS) return null;
  const reason =
    result === ''
      ? '설치 프로그램이 끝났다는 기록이 없어요. 시작하지 못했거나 도중에 멈췄을 수 있어요'
      : result === 'ok'
        ? '설치는 끝났다고 했는데 이전 버전이 그대로 켜졌어요. Applications의 Rauha가 새 앱인지 확인해 주세요'
        : swapFailureText(result.replace(/^fail\s*/, ''));
  return { kind: 'failed', version: record.to, reason, log: record.log };
}

/** 다시 켜진 앱이 알리는 한 줄 */
export function outcomeText(outcome: AttemptOutcome): string {
  if (outcome.kind === 'updated') return `v${outcome.version}로 업데이트됐어요`;
  return `업데이트가 적용되지 않았어요: ${outcome.reason}`;
}
