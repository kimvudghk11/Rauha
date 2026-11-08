import { describe, expect, it } from 'vitest';
import { OpenFile, OpenFiles, tabLabels } from './open-files.js';

const file = (path: string, text = 'a') => OpenFile.opened(path, text, '1:1', 'lf', false);

describe('열어 둔 파일', () => {
  it('저장된 글과 다르면 수정된 것이다', () => {
    const f = file('a.ts', 'abc');
    expect(f.isDirty('abc')).toBe(false);
    expect(f.isDirty('abcd')).toBe(true);
  });

  it('저장하면 새 글·version이 기준이 되고 바뀜 표시가 사라진다', () => {
    const f = file('a.ts', 'abc').markedStale().saved('xyz', '2:3');
    expect(f).toMatchObject({ savedText: 'xyz', version: '2:3', stale: false });
    expect(f.isDirty('xyz')).toBe(false);
  });

  it('디스크에서 바뀐 걸 알면 stale이 된다', () => {
    expect(file('a.ts').markedStale().stale).toBe(true);
  });
});

describe('파일 탭들', () => {
  it('열면 그 탭으로 가고, 이미 열린 파일을 다시 열면 상태를 지키고 그 탭으로만 간다', () => {
    const a = file('a.ts', 'old');
    const tabs = OpenFiles.empty().opened(a).opened(file('b.ts')).opened(file('a.ts', 'new'));
    expect(tabs.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(tabs.active).toBe('a.ts');
    expect(tabs.get('a.ts')?.savedText).toBe('old');
  });

  it('보던 탭을 닫으면 오른쪽 이웃, 없으면 왼쪽, 마지막이면 비어 있다', () => {
    const tabs = OpenFiles.empty().opened(file('a')).opened(file('b')).opened(file('c'));
    expect(tabs.activated('b').closed('b').active).toBe('c');
    expect(tabs.closed('c').active).toBe('b');
    expect(OpenFiles.empty().opened(file('a')).closed('a').active).toBeNull();
  });

  it('보지 않던 탭을 닫아도 보던 탭은 그대로다', () => {
    const tabs = OpenFiles.empty().opened(file('a')).opened(file('b'));
    expect(tabs.closed('a').active).toBe('b');
  });

  it('한 칸 옆 탭으로 돌아간다', () => {
    const tabs = OpenFiles.empty().opened(file('a')).opened(file('b')).activated('a');
    expect(tabs.neighbor(1)).toBe('b');
    expect(tabs.neighbor(-1)).toBe('b');
  });
});

describe('탭 이름', () => {
  it('이름이 겹치지 않으면 파일 이름만 쓴다', () => {
    expect([...tabLabels(['src/a.ts', 'b.ts']).values()]).toEqual(['a.ts', 'b.ts']);
  });

  it('이름이 겹치면 바로 위 폴더를 붙인다', () => {
    const l = tabLabels(['src/index.ts', 'web/index.ts']);
    expect(l.get('src/index.ts')).toBe('index.ts — src');
    expect(l.get('web/index.ts')).toBe('index.ts — web');
  });
});
