/** 편집기 자동 저장: 끔(기본) / 입력이 멈춘 뒤 1초 / 포커스를 잃을 때 */
export const AUTO_SAVE_MODES = ['off', 'delay', 'focus'] as const;
export type AutoSaveMode = (typeof AUTO_SAVE_MODES)[number];

export const AUTO_SAVE_DELAY_MS = 1000;

const LABELS: Readonly<Record<AutoSaveMode, string>> = { off: 'Off', delay: 'After delay (1s)', focus: 'On focus change' };
export const autoSaveLabel = (mode: AutoSaveMode): string => LABELS[mode];

/** 저장된 값에서 알려진 방식을 고른다. 모르는 값은 끔이다(몰래 파일을 쓰지 않는다). */
export const parseAutoSaveMode = (v: unknown): AutoSaveMode => ((AUTO_SAVE_MODES as readonly unknown[]).includes(v) ? (v as AutoSaveMode) : 'off');

/** 저장하자는 신호가 어디서 왔나: edit 는 글을 친 뒤 멈춤, leave 는 편집기·창·탭을 떠남 */
export type AutoSaveTrigger = 'edit' | 'leave';

/** 이 방식은 이 신호에 저장하고 싶어 하는가 */
export const wantsAutoSave = (mode: AutoSaveMode, trigger: AutoSaveTrigger): boolean => (mode === 'delay' ? trigger === 'edit' : mode === 'focus' ? trigger === 'leave' : false);

export interface AutoSaveFacts {
  readonly dirty: boolean;
  readonly readOnly: boolean;
  /** 디스크에서 이 파일이 바뀌었거나 지워졌다고 이미 알고 있다 */
  readonly stale: boolean;
  /** 지금 저장하는 중이다 */
  readonly saving: boolean;
  /** 지금과 같은 글로 자동 저장이 이미 실패했다 */
  readonly failedText: boolean;
}

export type AutoSaveSkip = 'clean' | 'read-only' | 'stale' | 'busy' | 'failed';

/** 자동 저장을 건너뛰는 까닭. null 이면 저장해도 된다. 충돌·덮어쓰기 질문은 손으로 저장할 때만 한다. */
export function autoSaveSkip(f: AutoSaveFacts): AutoSaveSkip | null {
  if (!f.dirty) return 'clean';
  if (f.readOnly) return 'read-only';
  if (f.stale) return 'stale';
  if (f.saving) return 'busy';
  if (f.failedText) return 'failed';
  return null;
}
