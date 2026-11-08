/** 답답한 점 적기 단축키: Ctrl+Shift+B(맥은 Cmd+Shift+B). 한글 자판에서도 되도록 글자가 아니라 물리 키(KeyB)로 본다. */
export interface KeyLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
}

export const isBugShortcut = (e: KeyLike): boolean => e.code === 'KeyB' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.isComposing !== true;
