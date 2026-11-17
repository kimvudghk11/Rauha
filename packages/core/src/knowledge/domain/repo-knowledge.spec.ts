import { describe, expect, it } from 'vitest';
import { RepoKnowledge, type RepoFacts } from './repo-knowledge.js';
import { RepoRef } from './repo-ref.js';

const ref = (commit: string) => RepoRef.of({ branch: 'main', commit: commit.padEnd(40, '0'), dirty: false });

function facts(totalFiles = 10, dirs: { path: string; files: number }[] = [{ path: 'src/domain', files: 2 }, { path: 'src/shared', files: 1 }]): RepoFacts {
  return { totalFiles, dirs, packageManager: 'yarn', scripts: { test: 'vitest run' }, instructionFiles: ['CLAUDE.md'], testPattern: '*.spec.ts' };
}

function knowledge(): RepoKnowledge {
  const k = RepoKnowledge.create({
    basis: ref('a1b2c3d'),
    facts: facts(),
    symbols: new Map([
      ['src/domain/money.ts', ['Money']],
      ['src/domain/cart.ts', ['Cart']],
      ['src/shared/format.ts', ['formatWon']],
    ]),
  });
  k.writeNotes([
    { area: 'src/domain', text: '값 객체와 엔티티', sources: ['src/domain/money.ts'] },
    { area: 'src/shared', text: '공용 도우미', sources: ['src/shared/format.ts'] },
  ]);
  return k;
}

describe('RepoKnowledge — 일할 곳의 관례 메모', () => {
  it('업무 범위(파일·폴더 glob)가 걸친 영역의 메모만 골라 묶는다', () => {
    const block = knowledge().areaNotesFor(['src/domain/money.ts', 'src/domain/**']);
    expect(block).toContain('<area_notes>');
    expect(block).toContain('- src/domain: 값 객체와 엔티티');
    expect(block).not.toContain('공용 도우미');
  });

  it('범위가 걸친 영역에 메모가 없으면 빈 글(묶음을 붙이지 않는다)', () => {
    expect(knowledge().areaNotesFor(['docs/guide.md'])).toBe('');
    expect(knowledge().areaNotesFor([])).toBe('');
  });

  it('상한을 넘으면 뒤의 메모부터 뺀다', () => {
    const full = knowledge().areaNotesFor(['src/domain/a.ts', 'src/shared/b.ts']);
    const block = knowledge().areaNotesFor(['src/domain/a.ts', 'src/shared/b.ts'], full.length - 1);
    expect(block).toContain('src/domain');
    expect(block).not.toContain('src/shared');
  });
});

describe('RepoKnowledge', () => {
  it('있던 파일 내용만 바뀌면 메모는 그대로 두고 심볼 지도와 기준만 고친다(메서드 하나 추가로 다시 조사하지 않게)', () => {
    const k = knowledge();
    expect(k.staleAreas()).toEqual([]);
    k.applyChanges({ basis: ref('b2'), facts: facts(), changed: new Map([['src/domain/money.ts', ['Money', 'discount']]]) });
    expect(k.staleAreas()).toEqual([]);
    expect(k.symbols.get('src/domain/money.ts')).toEqual(['Money', 'discount']);
    expect(k.basis.label()).toBe('main (b200000)');
  });

  it('메모가 있는 영역에 파일이 새로 생기거나 메모 근거 파일이 지워지면 낡음이 된다', () => {
    const added = knowledge();
    added.applyChanges({ basis: ref('b2'), facts: facts(), changed: new Map([['src/domain/coupon.ts', ['Coupon']]]) });
    expect(added.staleAreas()).toEqual(['src/domain']);
    const removed = knowledge();
    removed.applyChanges({ basis: ref('b2'), facts: facts(), changed: new Map([['src/shared/format.ts', null]]) });
    expect(removed.staleAreas()).toEqual(['src/shared']);
  });

  it('메모 없는 새 폴더에 파일이 생기면 그 영역도 낡음', () => {
    const k = knowledge();
    const next = facts(11, [...facts().dirs, { path: 'src/coupon', files: 1 }]);
    k.applyChanges({ basis: ref('b2'), facts: next, changed: new Map([['src/coupon/coupon.ts', ['Coupon']]]) });
    expect(k.staleAreas()).toEqual(['src/coupon']);
  });

  it('내용이 그대로인 파일은 바뀐 것으로 치지 않는다(커밋 안 한 변경이 남아 있어도 매번 다시 조사하지 않게)', () => {
    const k = RepoKnowledge.create({ basis: ref('a'), facts: facts(), symbols: new Map(), files: ['src/domain/money.ts'], hashes: new Map([['src/domain/money.ts', 'h1']]) });
    expect(k.changedFiles(new Map([['src/domain/money.ts', 'h1'], ['src/domain/cart.ts', 'h2']]))).toEqual(['src/domain/cart.ts']);
    k.applyChanges({ basis: ref('a'), facts: facts(), changed: new Map([['src/domain/cart.ts', ['Cart']]]), hashes: new Map([['src/domain/cart.ts', 'h2']]) });
    expect(k.changedFiles(new Map([['src/domain/cart.ts', 'h2']]))).toEqual([]);
    expect(k.changedFiles(new Map([['src/domain/cart.ts', null]]))).toEqual(['src/domain/cart.ts']);
  });

  it('지운 파일은 심볼 지도에서 빠진다', () => {
    const k = knowledge();
    k.applyChanges({ basis: ref('b2'), facts: facts(), changed: new Map([['src/domain/cart.ts', null]]) });
    expect(k.symbols.has('src/domain/cart.ts')).toBe(false);
  });

  it('메모 근거에 지식에 없는 파일이 있으면 버린다', () => {
    const k = knowledge();
    k.writeNotes([{ area: 'src/domain', text: '바뀜', sources: ['src/domain/money.ts', 'src/made/up.ts'] }]);
    expect(k.notes.find((n) => n.area === 'src/domain')!.sources).toEqual(['src/domain/money.ts']);
  });

  it('바뀐 파일이 200개 이상이거나 전체의 30% 이상이면 다시 만든다', () => {
    const small = knowledge();
    expect(small.needsRebuild(3)).toBe(true);
    expect(small.needsRebuild(2)).toBe(false);
    const big = RepoKnowledge.create({ basis: ref('a'), facts: facts(1000), symbols: new Map() });
    expect(big.needsRebuild(200)).toBe(true);
    expect(big.needsRebuild(199)).toBe(false);
  });

  it('영역은 파일이 있는 깊이 1~2 폴더, 루트 파일만 있으면 "."', () => {
    expect(knowledge().areas()).toEqual(['src/domain', 'src/shared']);
    const flat = RepoKnowledge.create({ basis: ref('a'), facts: facts(2, [{ path: '.', files: 2 }]), symbols: new Map() });
    expect(flat.areas()).toEqual(['.']);
  });

  it('팀원에게 주는 묶음은 구조·명령·메모만 담고 심볼 지도는 뺀다(턴마다 다시 보내져 토큰이 커서)', () => {
    const block = knowledge().toBlock('shop');
    expect(block).toContain('basis="main (a1b2c3d)"');
    expect(block).toContain('값 객체와 엔티티');
    expect(block).not.toContain('src/domain/money.ts: Money');
  });

  it('조사 팀원에게는 심볼 지도까지 주고, 상한을 넘으면 심볼 지도부터 줄인다', () => {
    const k = knowledge();
    expect(k.toBlock('shop', 12_000, true)).toContain('src/domain/money.ts: Money');
    const block = k.toBlock('shop', 500, true);
    expect(block.length).toBeLessThanOrEqual(500);
    expect(block).toContain('값 객체와 엔티티');
  });
});
