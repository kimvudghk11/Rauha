import { describe, expect, it } from 'vitest';
import { AUTO_SAVE_DELAY_MS, autoSaveLabel, autoSaveSkip, parseAutoSaveMode, wantsAutoSave, type AutoSaveFacts } from './auto-save.js';

const ok: AutoSaveFacts = { dirty: true, readOnly: false, stale: false, saving: false, failedText: false };

describe('parseAutoSaveMode', () => {
  it('자동 저장은 기본으로 꺼져 있고 모르는 값도 끈다', () => {
    expect(parseAutoSaveMode(undefined)).toBe('off');
    expect(parseAutoSaveMode('always')).toBe('off');
    expect(parseAutoSaveMode(true)).toBe('off');
    expect(parseAutoSaveMode('toString')).toBe('off');
  });

  it('알려진 방식만 받는다', () => {
    expect(parseAutoSaveMode('delay')).toBe('delay');
    expect(parseAutoSaveMode('focus')).toBe('focus');
    expect(parseAutoSaveMode('off')).toBe('off');
  });
});

describe('wantsAutoSave', () => {
  it('끄면 어떤 때에도 저장하지 않는다', () => {
    expect(wantsAutoSave('off', 'edit')).toBe(false);
    expect(wantsAutoSave('off', 'leave')).toBe(false);
  });

  it('After delay 는 입력이 멈춘 뒤에만, On focus change 는 포커스를 잃을 때만 저장한다', () => {
    expect(wantsAutoSave('delay', 'edit')).toBe(true);
    expect(wantsAutoSave('delay', 'leave')).toBe(false);
    expect(wantsAutoSave('focus', 'leave')).toBe(true);
    expect(wantsAutoSave('focus', 'edit')).toBe(false);
  });

  it('입력이 멈춘 뒤 1초를 기다린다', () => {
    expect(AUTO_SAVE_DELAY_MS).toBe(1000);
  });
});

describe('autoSaveSkip', () => {
  it('바뀐 것이 없고 막힌 곳이 없으면 저장한다', () => {
    expect(autoSaveSkip(ok)).toBeNull();
  });

  it('수정이 없으면 저장하지 않는다', () => {
    expect(autoSaveSkip({ ...ok, dirty: false })).toBe('clean');
  });

  it('읽기 전용 파일은 저장하지 않는다', () => {
    expect(autoSaveSkip({ ...ok, readOnly: true })).toBe('read-only');
  });

  it('디스크에서 바뀐 파일은 덮어쓰지 않는다(충돌은 사람이 고른다)', () => {
    expect(autoSaveSkip({ ...ok, stale: true })).toBe('stale');
  });

  it('이미 저장 중이면 겹쳐 저장하지 않는다', () => {
    expect(autoSaveSkip({ ...ok, saving: true })).toBe('busy');
  });

  it('같은 글로 한 번 실패했으면 글이 바뀔 때까지 다시 시도하지 않는다', () => {
    expect(autoSaveSkip({ ...ok, failedText: true })).toBe('failed');
  });
});

describe('autoSaveLabel', () => {
  it('설정 화면에 보이는 이름은 영어 세 가지다', () => {
    expect(autoSaveLabel('off')).toBe('Off');
    expect(autoSaveLabel('delay')).toBe('After delay (1s)');
    expect(autoSaveLabel('focus')).toBe('On focus change');
  });
});
