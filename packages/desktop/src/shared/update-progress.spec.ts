import { describe, expect, it } from 'vitest';
import type { InstallState } from './update-install.js';
import { canDismiss, downloadSpeed, formatMb, progressModal, remainingText, speedText } from './update-progress.js';

const MB = 1024 * 1024;
const s = (over: Partial<InstallState> & Pick<InstallState, 'phase'>): InstallState => ({ percent: null, ...over });

describe('받은 양·속도·남은 시간', () => {
  it('바이트를 MB 한 자리로 쓴다', () => {
    expect(formatMb(12.34 * MB)).toBe('12.3 MB');
    expect(formatMb(0)).toBe('0.0 MB');
  });

  it('시작한 지 1초가 안 됐거나 받은 게 없으면 속도를 모른다', () => {
    expect(downloadSpeed(5 * MB, 500)).toBeNull();
    expect(downloadSpeed(0, 5000)).toBeNull();
    expect(downloadSpeed(10 * MB, 2000)).toBe(5 * MB);
  });

  it('속도는 MB/초, 아주 느리면 KB/초로 쓴다', () => {
    expect(speedText(3.24 * MB)).toBe('3.2 MB/s');
    expect(speedText(50 * 1024)).toBe('50 KB/s');
  });

  it('남은 시간은 초·분으로 쓰고 모르면 null이다', () => {
    expect(remainingText(50 * MB, 100 * MB, 5 * MB)).toBe('about 10s left');
    expect(remainingText(10 * MB, 100 * MB, 1 * MB)).toBe('about 1m 30s left');
    expect(remainingText(1 * MB, 100000 * MB, 1 * MB)).toBe('over 1 hour left');
    expect(remainingText(10 * MB, 0, 1 * MB)).toBeNull();
    expect(remainingText(10 * MB, 100 * MB, null)).toBeNull();
    expect(remainingText(100 * MB, 100 * MB, 1 * MB)).toBeNull();
  });
});

describe('진행 모달', () => {
  it('쉬는 중에는 모달이 없다', () => {
    expect(progressModal({ phase: 'idle', percent: null }, 0)).toBeNull();
  });

  it('확인 중에는 빙글빙글 막대에 버튼이 없다', () => {
    const m = progressModal(s({ phase: 'checking' }), 0)!;
    expect(m.headline).toBe('Checking for a new version…');
    expect(m.bar).toBe('indeterminate');
    expect(m.actions).toEqual([]);
    expect(m.steps.map((x) => x.state)).toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
  });

  it('내려받는 중에는 퍼센트 막대, 받은 MB/전체 MB·속도·남은 시간, 취소 버튼이 보인다', () => {
    const m = progressModal(s({ phase: 'downloading', percent: 50, receivedBytes: 50 * MB, totalBytes: 100 * MB }), 10_000)!;
    expect(m.headline).toBe('Downloading 50%');
    expect(m.bar).toBe('determinate');
    expect(m.percent).toBe(50);
    expect(m.detail).toBe('50.0 MB / 100.0 MB · 5.0 MB/s · about 10s left');
    expect(m.actions).toEqual(['cancel']);
    expect(m.steps.map((x) => x.state)).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
  });

  it('전체 크기를 모르면 퍼센트 없이 받은 양만 보인다', () => {
    const m = progressModal(s({ phase: 'downloading', receivedBytes: 3 * MB, totalBytes: null }), 500)!;
    expect(m.bar).toBe('indeterminate');
    expect(m.percent).toBeNull();
    expect(m.detail).toBe('3.0 MB');
    expect(m.headline).toBe('Downloading…');
  });

  it('퍼센트는 0~100 안으로 자른다', () => {
    expect(progressModal(s({ phase: 'downloading', percent: 130 }), 0)!.percent).toBe(100);
  });

  it('SHA-256 확인과 설치 준비 단계는 버튼 없이 글만 보인다', () => {
    const v = progressModal(s({ phase: 'verifying' }), 0)!;
    expect(v.headline).toBe('Checking the download…');
    expect(v.actions).toEqual([]);
    expect(v.steps.map((x) => x.state)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(progressModal(s({ phase: 'preparing', targetNote: 'Installs to: /Applications/Rauha.app' }), 0)!.headline).toBe('Preparing to install…');
  });

  it('설치 단계는 닫을 수 없고 앱을 닫고 다시 켠다고 알리며 설치 위치를 보인다', () => {
    const m = progressModal(s({ phase: 'installing', targetNote: '설치 위치: /Applications/Rauha.app (임시 위치에서 열려 있어서)' }), 0)!;
    expect(m.headline).toBe('Restarting to finish the update…');
    expect(m.actions).toEqual([]);
    expect(m.note).toContain('/Applications/Rauha.app');
    expect(m.steps.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'active']);
  });

  it('실패하면 이유 한 줄과 다시 시도·브라우저로 받기·진단 정보 복사·닫기가 보이고 멈춘 단계에 표시한다', () => {
    const m = progressModal(s({ phase: 'failed', reason: 'No data arrived for 30 seconds, so it stopped', failedAt: 'downloading' }), 0)!;
    expect(m.reason).toBe('No data arrived for 30 seconds, so it stopped');
    expect(m.actions).toEqual(['retry', 'browser', 'copy', 'close']);
    expect(m.bar).toBe('none');
    expect(m.steps.map((x) => x.state)).toEqual(['done', 'failed', 'pending', 'pending', 'pending']);
  });

  it('이유를 모르는 실패도 빈 칸 없이 한 줄을 쓴다', () => {
    expect(progressModal(s({ phase: 'failed' }), 0)!.reason).toBe('Stopped for an unknown reason');
  });

  it('닫을 수 있는 건 내려받는 중과 실패 뒤뿐이다', () => {
    expect(canDismiss('downloading')).toBe(true);
    expect(canDismiss('failed')).toBe(true);
    for (const p of ['checking', 'verifying', 'preparing', 'installing'] as const) expect(canDismiss(p)).toBe(false);
  });
});
