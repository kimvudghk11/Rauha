/** 업데이트 진행 모달의 순수 규칙: 단계·퍼센트·받은 양·속도·남은 시간·버튼. 화면은 이 결과를 그대로 그린다. */
import type { InstallPhase, InstallState } from './update-install.js';

const MB = 1024 * 1024;

export type StepId = 'checking' | 'downloading' | 'verifying' | 'preparing' | 'installing';
export type StepState = 'done' | 'active' | 'pending' | 'failed';
export type ModalAction = 'cancel' | 'retry' | 'browser' | 'copy' | 'close';

export interface ModalStep {
  readonly id: StepId;
  readonly label: string;
  readonly state: StepState;
}

export interface ProgressModal {
  readonly title: string;
  /** 지금 하는 일 한 줄 */
  readonly headline: string;
  readonly steps: readonly ModalStep[];
  /** 막대: 없음 / 얼마나 걸릴지 모름(빙글빙글) / 퍼센트 */
  readonly bar: 'none' | 'indeterminate' | 'determinate';
  readonly percent: number | null;
  /** 받은 양 · 속도 · 남은 시간 */
  readonly detail: string | null;
  /** 설치 위치 안내 */
  readonly note: string | null;
  /** 실패 이유 한 줄 */
  readonly reason: string | null;
  readonly actions: readonly ModalAction[];
}

const STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: 'checking', label: '확인' },
  { id: 'downloading', label: '내려받기' },
  { id: 'verifying', label: 'SHA-256 확인' },
  { id: 'preparing', label: '설치 준비' },
  { id: 'installing', label: '설치·다시 켜기' },
];

export function formatMb(bytes: number): string {
  return `${(Math.max(0, bytes) / MB).toFixed(1)} MB`;
}

/** 초당 바이트. 시작한 지 1초가 안 됐거나 받은 게 없으면 아직 모른다(null). */
export function downloadSpeed(receivedBytes: number, elapsedMs: number): number | null {
  if (elapsedMs < 1000 || receivedBytes <= 0) return null;
  return receivedBytes / (elapsedMs / 1000);
}

export function speedText(bytesPerSecond: number): string {
  return bytesPerSecond >= 0.1 * MB ? `${(bytesPerSecond / MB).toFixed(1)} MB/초` : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/초`;
}

/** 남은 시간 글. 전체 크기나 속도를 모르면 null */
export function remainingText(receivedBytes: number, totalBytes: number, bytesPerSecond: number | null): string | null {
  if (bytesPerSecond === null || bytesPerSecond <= 0 || totalBytes <= 0 || receivedBytes >= totalBytes) return null;
  const seconds = Math.ceil((totalBytes - receivedBytes) / bytesPerSecond);
  if (seconds < 60) return `약 ${seconds}초 남음`;
  if (seconds < 3600) return `약 ${Math.floor(seconds / 60)}분 ${seconds % 60}초 남음`;
  return '1시간 넘게 남음';
}

function headlineOf(state: InstallState): string {
  switch (state.phase) {
    case 'checking':
      return '새 버전을 확인하는 중…';
    case 'downloading':
      return state.percent === null ? '내려받는 중…' : `내려받는 중 ${Math.round(state.percent)}%`;
    case 'verifying':
      return 'SHA-256 확인 중…';
    case 'preparing':
      return '설치 준비 중…';
    case 'installing':
      return '앱을 닫고 설치한 뒤 다시 켭니다';
    case 'failed':
      return '설치하지 못했어요';
    case 'idle':
      return '';
  }
}

function stepsOf(state: InstallState): ModalStep[] {
  const at = state.phase === 'failed' ? state.failedAt ?? 'checking' : state.phase;
  const index = STEPS.findIndex((s) => s.id === at);
  return STEPS.map((s, i) => {
    const stepState: StepState = i < index ? 'done' : i > index ? 'pending' : state.phase === 'failed' ? 'failed' : 'active';
    return { ...s, state: stepState };
  });
}

function detailOf(state: InstallState, elapsedMs: number): string | null {
  if (state.phase !== 'downloading' || state.receivedBytes == null) return null;
  const received = state.receivedBytes;
  const total = state.totalBytes ?? 0;
  const speed = downloadSpeed(received, elapsedMs);
  const parts = [total > 0 ? `${formatMb(received)} / ${formatMb(total)}` : formatMb(received)];
  if (speed !== null) parts.push(speedText(speed));
  const left = remainingText(received, total, speed);
  if (left !== null) parts.push(left);
  return parts.join(' · ');
}

/** 설치 상태로 모달을 만든다. 모달을 보일 일이 없으면(쉬는 중) null. elapsedMs는 내려받기를 시작한 뒤 흐른 시간. */
export function progressModal(state: InstallState, elapsedMs: number): ProgressModal | null {
  if (state.phase === 'idle') return null;
  const downloading = state.phase === 'downloading';
  const bar = state.phase === 'failed' ? 'none' : downloading && state.percent !== null ? 'determinate' : 'indeterminate';
  const actions: ModalAction[] = state.phase === 'failed' ? ['retry', 'browser', 'copy', 'close'] : downloading ? ['cancel'] : [];
  return {
    title: '새 버전 설치',
    headline: headlineOf(state),
    steps: stepsOf(state),
    bar,
    percent: bar === 'determinate' ? Math.max(0, Math.min(100, state.percent ?? 0)) : null,
    detail: detailOf(state, elapsedMs),
    note: state.phase === 'installing' || state.phase === 'preparing' ? state.targetNote ?? null : null,
    reason: state.phase === 'failed' ? state.reason ?? '알 수 없는 이유로 멈췄어요' : null,
    actions,
  };
}

/** 이 단계에서 모달을 닫을 수 있는지: 내려받는 중 취소와 실패 뒤 닫기뿐이다 */
export function canDismiss(phase: InstallPhase): boolean {
  return phase === 'downloading' || phase === 'failed';
}
