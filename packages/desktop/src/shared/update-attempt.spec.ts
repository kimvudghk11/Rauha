import { describe, expect, it } from 'vitest';
import { AppVersion } from './app-update.js';
import { judgeAttempt, outcomeText, parseAttempt, PENDING_MS, type AttemptRecord } from './update-attempt.js';

const record: AttemptRecord = { from: '0.1.4', to: '0.1.5', target: '/Applications/Rauha.app', at: '2026-11-09T00:00:00.000Z', log: '/u/logs/update-swap.log' };
const at = Date.parse(record.at);
const later = new Date(at + PENDING_MS + 1000);
const v = (s: string): AppVersion => AppVersion.parse(s)!;

describe('지난 설치 시도 판정', () => {
  it('기록이 없으면 알릴 게 없다', () => {
    expect(judgeAttempt(null, null, v('0.1.4'), later)).toBeNull();
  });

  it('받으려던 버전 이상으로 켜졌으면 업데이트됐다고 알린다', () => {
    expect(judgeAttempt(record, 'ok', v('0.1.5'), later)).toEqual({ kind: 'updated', version: '0.1.5', target: '/Applications/Rauha.app' });
    expect(judgeAttempt(record, null, v('0.1.6'), later)?.kind).toBe('updated');
  });

  it('버전이 그대로이고 스크립트가 실패 코드를 남겼으면 그 이유를 알린다', () => {
    const o = judgeAttempt(record, 'fail swap', v('0.1.4'), later);
    expect(o).toMatchObject({ kind: 'failed', version: '0.1.5', log: '/u/logs/update-swap.log' });
    expect(outcomeText(o!)).toContain('The update was not applied: Could not replace the old app');
  });

  it('앱이 안 닫혀서 실패한 경우 이유를 알린다', () => {
    expect(outcomeText(judgeAttempt(record, 'fail app-running', v('0.1.4'), later)!)).toContain('did not close within 60 seconds');
  });

  it('스크립트는 ok라는데 버전이 그대로면 옛 앱이 열렸다고 알린다', () => {
    expect(outcomeText(judgeAttempt(record, 'ok\n', v('0.1.4'), later)!)).toContain('old version started');
  });

  it('결과 기록이 없으면 도중에 멈췄을 수 있다고 알린다', () => {
    expect(outcomeText(judgeAttempt(record, null, v('0.1.4'), later)!)).toContain('No record that the installer finished');
  });

  it('시작한 지 얼마 안 됐는데 결과가 없으면 아직 진행 중일 수 있어 판단을 미룬다', () => {
    expect(judgeAttempt(record, null, v('0.1.4'), new Date(at + 5000))).toBeNull();
  });

  it('성공 글은 v 버전으로 업데이트됐다고 한 줄이다', () => {
    expect(outcomeText({ kind: 'updated', version: '0.1.5', target: null })).toBe('Updated to v0.1.5');
  });
});

describe('시도 기록 읽기', () => {
  it('올바른 모양만 읽고 나머지는 버린다', () => {
    expect(parseAttempt({ ...record })).toEqual(record);
    expect(parseAttempt({ ...record, target: undefined })?.target).toBeNull();
    expect(parseAttempt({ ...record, to: 'x' })).toBeNull();
    expect(parseAttempt('x')).toBeNull();
    expect(parseAttempt(null)).toBeNull();
  });
});
