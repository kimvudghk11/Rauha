import { describe, expect, it } from 'vitest';
import { canWork, DEFAULT_SETTINGS, limitTone, parseSettings, updateSettings } from './settings.js';

describe('parseSettings', () => {
  it('새 버전 자동 확인은 기본으로 켜져 있고 글자 같은 값은 기본으로 돌린다', () => {
    expect(DEFAULT_SETTINGS.autoUpdateCheck).toBe(true);
    expect(DEFAULT_SETTINGS.analysisFlow).toBe(true);
    expect(parseSettings({ analysisFlow: false }).analysisFlow).toBe(false);
    expect(parseSettings({ analysisFlow: 'no' }).analysisFlow).toBe(true);
    expect(parseSettings({}).analysisFlow).toBe(true);
    expect(parseSettings({ autoUpdateCheck: false }).autoUpdateCheck).toBe(false);
    expect(parseSettings({ autoUpdateCheck: 'no' }).autoUpdateCheck).toBe(true);
  });


  it('블로그에서 가릴 회사 이름은 글자만 남기고 공백·겹침을 없앤다', () => {
    expect(DEFAULT_SETTINGS.blogNames).toEqual([]);
    expect(parseSettings({ blogNames: [' Acme ', 'Acme', '', 3, '브릿지'] }).blogNames).toEqual(['Acme', '브릿지']);
    expect(parseSettings({ blogNames: 'Acme' }).blogNames).toEqual([]);
    expect(parseSettings({ blogNames: Array.from({ length: 80 }, (_, i) => `n${i}`) }).blogNames).toHaveLength(50);
  });

  it('모양이 틀린 입력은 기본값이다', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('글')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('동시 실행 수는 1~6으로 맞추고 숫자가 아니면 기본 3이다', () => {
    expect(parseSettings({ concurrency: 0 }).concurrency).toBe(1);
    expect(parseSettings({ concurrency: 99 }).concurrency).toBe(6);
    expect(parseSettings({ concurrency: 2.6 }).concurrency).toBe(3);
    expect(parseSettings({ concurrency: '4' }).concurrency).toBe(3);
  });

  it('보호 브랜치는 공백을 지우고 겹침을 없애며, 비면 기본 목록이다', () => {
    expect(parseSettings({ protectedBranches: [' main ', 'qa', 'main', ''] }).protectedBranches).toEqual(['main', 'qa']);
    expect(parseSettings({ protectedBranches: [] }).protectedBranches).toEqual(['main', 'qa', 'release']);
  });

  it('알림은 단계 넘어감만 기본 꺼짐이고, 틀린 값은 기본으로 돌린다', () => {
    expect(DEFAULT_SETTINGS.notify).toEqual({ choice: true, done: true, limit: true, step: false });
    expect(parseSettings({ notify: { choice: '예', step: true } }).notify).toEqual({ choice: true, done: true, limit: true, step: true });
  });

  it('배치는 A·B만 받는다', () => {
    expect(parseSettings({ layout: 'B' }).layout).toBe('B');
    expect(parseSettings({ layout: 'C' }).layout).toBe('A');
  });

  it('작업 폴더는 공백을 지우고 빈 글이면 null이다', () => {
    expect(parseSettings({ workFolder: '  C:/work ' }).workFolder).toBe('C:/work');
    expect(parseSettings({ workFolder: '  ' }).workFolder).toBeNull();
  });
});

describe('updateSettings', () => {
  it('일부만 바꾸고 나머지는 그대로이며 알림은 항목별로 합친다', () => {
    const next = updateSettings(DEFAULT_SETTINGS, { layout: 'B', notify: { done: false } });
    expect(next).toMatchObject({ layout: 'B', concurrency: 3, notify: { choice: true, done: false, limit: true, step: false } });
  });

  it('바꾼 값도 바로잡힌다', () => {
    expect(updateSettings(DEFAULT_SETTINGS, { concurrency: 50 }).concurrency).toBe(6);
  });
});

describe('limitTone', () => {
  it('70%부터 노랑, 90%부터 빨강이다', () => {
    expect([0, 69, 70, 89, 90, 100].map(limitTone)).toEqual(['green', 'green', 'yellow', 'yellow', 'red', 'red']);
  });
});

describe('canWork', () => {
  it('폴더를 고르고 허락해야 일할 수 있다', () => {
    expect(canWork(DEFAULT_SETTINGS)).toBe(false);
    expect(canWork({ ...DEFAULT_SETTINGS, workFolder: 'C:/w' })).toBe(false);
    expect(canWork({ ...DEFAULT_SETTINGS, workFolder: 'C:/w', folderApproved: true })).toBe(true);
  });
});

describe('캐릭터 테마(characterSet)', () => {
  it('기본은 바다 친구들(ocean)이고 알려진 id만 받는다', () => {
    expect(DEFAULT_SETTINGS.characterSet).toBe('ocean');
    expect(parseSettings({ characterSet: 'forest' }).characterSet).toBe('forest');
    for (const bad of ['nope', 'constructor', '__proto__', 3, null, undefined]) expect(parseSettings({ characterSet: bad }).characterSet).toBe('ocean');
    expect(parseSettings({}).characterSet).toBe('ocean');
  });
  it('일부만 바꿀 때도 모르는 id는 기본으로 돌아간다', () => {
    expect(updateSettings(DEFAULT_SETTINGS, { characterSet: 'forest' }).characterSet).toBe('forest');
    expect(updateSettings(DEFAULT_SETTINGS, { characterSet: 'zzz' as never }).characterSet).toBe('ocean');
  });
});
