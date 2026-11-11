import { describe, expect, it } from 'vitest';
import { canWork, DEFAULT_SETTINGS, forgetRecentFolder, limitTone, parseSettings, updateSettings } from './settings.js';

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

describe('자동 저장 설정', () => {
  it('기본은 끔이고 모르는 값은 끔으로 돌린다', () => {
    expect(DEFAULT_SETTINGS.autoSave).toBe('off');
    expect(parseSettings({ autoSave: 'delay' }).autoSave).toBe('delay');
    expect(parseSettings({ autoSave: 'focus' }).autoSave).toBe('focus');
    expect(parseSettings({ autoSave: 'sometimes' }).autoSave).toBe('off');
    expect(parseSettings({ autoSave: 1 }).autoSave).toBe('off');
  });

  it('일부만 바꿔도 나머지 설정은 그대로다', () => {
    const next = updateSettings(DEFAULT_SETTINGS, { autoSave: 'focus' });
    expect(next.autoSave).toBe('focus');
    expect(next.concurrency).toBe(DEFAULT_SETTINGS.concurrency);
  });
});

describe('최근 작업 폴더', () => {
  it('처음에는 비어 있고 글자가 아닌 값·빈 글·겹침은 걸러 낸다', () => {
    expect(DEFAULT_SETTINGS.recentFolders).toEqual([]);
    expect(parseSettings({ recentFolders: ['/a', ' /b ', '', 3, '/a'] }).recentFolders).toEqual(['/a', '/b']);
    expect(parseSettings({ recentFolders: '/a' }).recentFolders).toEqual([]);
  });

  it('최대 5개까지만 남긴다', () => {
    const many = Array.from({ length: 9 }, (_, i) => `/p${i}`);
    expect(parseSettings({ recentFolders: many }).recentFolders).toEqual(many.slice(0, 5));
  });

  it('작업 폴더를 바꾸면 새 폴더가 맨 앞에 오고 예전 것은 겹치지 않게 뒤로 밀린다', () => {
    const a = updateSettings(DEFAULT_SETTINGS, { workFolder: '/a' });
    expect(a.recentFolders).toEqual(['/a']);
    const b = updateSettings(a, { workFolder: '/b' });
    expect(b.recentFolders).toEqual(['/b', '/a']);
    const again = updateSettings(b, { workFolder: '/a' });
    expect(again.recentFolders).toEqual(['/a', '/b']);
  });

  it('여섯 번째 폴더를 열면 가장 오래된 폴더가 빠진다', () => {
    let s = DEFAULT_SETTINGS;
    for (const p of ['/1', '/2', '/3', '/4', '/5', '/6']) s = updateSettings(s, { workFolder: p });
    expect(s.recentFolders).toEqual(['/6', '/5', '/4', '/3', '/2']);
  });

  it('같은 폴더를 다시 적거나 폴더를 비우는 설정은 목록을 바꾸지 않는다', () => {
    const a = updateSettings(DEFAULT_SETTINGS, { workFolder: '/a' });
    expect(updateSettings(a, { workFolder: '/a' }).recentFolders).toEqual(['/a']);
    expect(updateSettings(a, { workFolder: null }).recentFolders).toEqual(['/a']);
    expect(updateSettings(a, { concurrency: 2 }).recentFolders).toEqual(['/a']);
  });

  it('목록을 직접 바꾸려 하면 정리된 목록이 그대로 쓰인다(꼭 지우는 길은 forgetRecentFolder 하나)', () => {
    const a = updateSettings(updateSettings(DEFAULT_SETTINGS, { workFolder: '/a' }), { workFolder: '/b' });
    expect(forgetRecentFolder(a, '/a').recentFolders).toEqual(['/b']);
    expect(forgetRecentFolder(a, '/nope').recentFolders).toEqual(['/b', '/a']);
  });

  it('지금 작업 폴더는 목록에서 지워도 작업 폴더 자체는 그대로다', () => {
    const a = updateSettings(DEFAULT_SETTINGS, { workFolder: '/a' });
    const next = forgetRecentFolder(a, '/a');
    expect(next.recentFolders).toEqual([]);
    expect(next.workFolder).toBe('/a');
  });
});

describe('모델 이름(models)', () => {
  it('기본은 등급마다 지금 쓰는 모델 ID다', () => {
    expect(DEFAULT_SETTINGS.models).toEqual({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' });
    expect(parseSettings({}).models).toEqual(DEFAULT_SETTINGS.models);
  });

  it('직접 넣은 ID는 받고, 이상한 값은 그 등급만 기본으로 돌린다', () => {
    const s = parseSettings({ models: { opus: 'claude-fable-5-2', sonnet: 'sonnet', haiku: '' } });
    expect(s.models).toEqual({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-fable-5-2' });
  });

  it('설정을 일부만 바꿀 때도 모델 이름이 바로잡힌다', () => {
    const next = updateSettings(DEFAULT_SETTINGS, { models: { haiku: 'claude-haiku-5-5', sonnet: 'x'.repeat(100), opus: 'claude-opus-5' } });
    expect(next.models.sonnet).toBe('claude-sonnet-5-5');
    expect(next.models.opus).toBe('claude-opus-5');
  });
});
