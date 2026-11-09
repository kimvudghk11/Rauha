import { describe, expect, it } from 'vitest';
import { RepoPaths } from './repo-paths.js';

const repos = [
  { name: 'shop-api', root: 'E:/w/shop-api' },
  { name: 'shop-web', root: 'E:/w/shop-web' },
];

describe('RepoPaths.ownersOf — 인용 경로가 어느 레포 소속인지', () => {
  it('레포 루트 아래의 절대 경로는 그 레포 소속이고 루트 기준 경로로 돌려준다', () => {
    expect(RepoPaths.ownersOf('E:/w/shop-web/src/cart.ts', repos)).toEqual([{ name: 'shop-web', path: 'E:/w/shop-web/src/cart.ts' }]);
  });

  it('윈도우 역슬래시와 드라이브 글자 대소문자가 달라도 같은 레포로 본다', () => {
    expect(RepoPaths.ownersOf('e:\\w\\shop-web\\src\\cart.ts', repos).map((h) => h.name)).toEqual(['shop-web']);
  });

  it('레포 이름으로 시작하는 상대 경로는 그 레포 안의 경로로 풀고, 이름 없는 상대 경로는 모든 레포를 후보로 둔다', () => {
    expect(RepoPaths.ownersOf('shop-web/src/cart.ts', repos)).toEqual([
      { name: 'shop-web', path: 'src/cart.ts' },
      { name: 'shop-api', path: 'shop-web/src/cart.ts' },
      { name: 'shop-web', path: 'shop-web/src/cart.ts' },
    ]);
    expect(RepoPaths.ownersOf('src/cart.ts', repos).map((h) => h.name)).toEqual(['shop-api', 'shop-web']);
  });

  it('어느 레포 루트에도 들지 않는 절대 경로는 소속이 없다', () => {
    expect(RepoPaths.ownersOf('E:/other/secret.ts', repos)).toEqual([]);
  });

  it('루트 밖으로 나가는 .. 경로는 어느 레포도 가리키지 못한다', () => {
    expect(RepoPaths.ownersOf('../shop-api/src/a.ts', repos)).toEqual([]);
    expect(RepoPaths.ownersOf('E:/w/shop-web/../shop-api/src/a.ts', repos)).toEqual([]);
    expect(RepoPaths.ownersOf('shop-web/../../x', repos)).toEqual([]);
  });

  it('빈 경로는 소속이 없다', () => {
    expect(RepoPaths.ownersOf('  ', repos)).toEqual([]);
  });
});

describe('RepoPaths.relativeIn — 작업 폴더 안의 상대 경로', () => {
  it('작업 폴더 아래의 절대 경로는 폴더 기준 경로가 된다', () => {
    expect(RepoPaths.relativeIn('E:/w/shop-api', 'E:/w/shop-api/docs/NOTES.md')).toBe('docs/NOTES.md');
  });

  it('상대 경로는 그대로 쓰고 ./ 는 걷어 낸다', () => {
    expect(RepoPaths.relativeIn('E:/w/shop-api', './NOTES.md')).toBe('NOTES.md');
    expect(RepoPaths.relativeIn(null, 'NOTES.md')).toBe('NOTES.md');
  });

  it('다른 레포나 폴더 밖의 경로는 null이다', () => {
    expect(RepoPaths.relativeIn('E:/w/shop-api', 'E:/w/shop-web/NOTES.md')).toBeNull();
    expect(RepoPaths.relativeIn('E:/w/shop-api', '../shop-web/NOTES.md')).toBeNull();
    expect(RepoPaths.relativeIn(null, '/etc/notes.md')).toBeNull();
    expect(RepoPaths.relativeIn(null, 'E:/w/NOTES.md')).toBeNull();
  });

  it('작업 폴더 자체를 가리키면 null이다', () => {
    expect(RepoPaths.relativeIn('E:/w/shop-api', 'E:/w/shop-api')).toBeNull();
  });
});
