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
      return 'The app did not close within 60 seconds, so it was not replaced';
    case 'mount':
      return 'Could not create a temporary folder for the installer';
    case 'attach':
      return 'Could not open the downloaded installer (dmg)';
    case 'no-app':
      return 'Could not find the app inside the installer';
    case 'copy':
      return 'Could not copy the new app (check disk space or permissions)';
    case 'swap':
      return 'Could not replace the old app (check Applications folder permissions)';
    default:
      return 'The installer ended with an error';
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
      ? 'No record that the installer finished. It may not have started or stopped midway'
      : result === 'ok'
        ? 'The install reported success but the old version started. Check that Rauha in Applications is the new app'
        : swapFailureText(result.replace(/^fail\s*/, ''));
  return { kind: 'failed', version: record.to, reason, log: record.log };
}

/** 다시 켜진 앱이 알리는 한 줄 */
export function outcomeText(outcome: AttemptOutcome): string {
  if (outcome.kind === 'updated') return `Updated to v${outcome.version}`;
  return `The update was not applied: ${outcome.reason}`;
}
