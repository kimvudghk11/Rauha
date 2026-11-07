import { describe, expect, it } from 'vitest';
import { WorktreeLedger } from './worktree-ledger.js';

const path = (n: string) => () => `C:/tmp/${n}`;

describe('WorktreeLedger', () => {
  it('레포에 처음 오는 작업은 원래 폴더를 쓴다', () => {
    expect(WorktreeLedger.empty().claim('a', 'C:/w/app', path('x')).place).toEqual({ kind: 'original' });
  });

  it('같은 레포에 두 번째로 오는 작업은 자기 worktree를 쓴다', () => {
    const first = WorktreeLedger.empty().claim('a', 'C:/w/app', path('x'));
    const second = first.ledger.claim('b', 'C:/w/app', path('wt-b'));
    expect(second.place).toEqual({ kind: 'worktree', path: 'C:/tmp/wt-b' });
    expect(second.ledger.worktreeJobs('C:/w/app')).toBe(1);
  });

  it('다른 레포의 작업은 서로 상관없이 원래 폴더를 쓴다', () => {
    const first = WorktreeLedger.empty().claim('a', 'C:/w/app', path('x'));
    expect(first.ledger.claim('b', 'C:/w/web', path('y')).place).toEqual({ kind: 'original' });
  });

  it('경로 표기(슬래시·대소문자·끝 슬래시)가 달라도 같은 레포로 본다', () => {
    const first = WorktreeLedger.empty().claim('a', 'C:\\W\\App\\', path('x'));
    expect(first.ledger.claim('b', 'c:/w/app', path('wt')).place.kind).toBe('worktree');
  });

  it('원래 폴더를 쓰던 작업이 끝나면 다음 작업이 다시 원래 폴더를 쓴다', () => {
    let l = WorktreeLedger.empty().claim('a', 'C:/w/app', path('x')).ledger;
    l = l.claim('b', 'C:/w/app', path('wt')).ledger;
    l = l.release('a').ledger;
    expect(l.claim('c', 'C:/w/app', path('wt2')).place).toEqual({ kind: 'original' });
  });

  it('작업이 끝나면 정리할 worktree 경로를 돌려주고, 원래 폴더 작업은 null이다', () => {
    const l = WorktreeLedger.empty().claim('a', 'C:/w/app', path('x')).ledger.claim('b', 'C:/w/app', path('wt-b')).ledger;
    expect(l.release('b').worktree).toBe('C:/tmp/wt-b');
    expect(l.release('a').worktree).toBeNull();
    expect(l.release('없음').worktree).toBeNull();
  });

  it('같은 작업이 두 번 청구해도 처음 자리를 그대로 준다', () => {
    const first = WorktreeLedger.empty().claim('a', 'C:/w/app', path('x'));
    expect(first.ledger.claim('a', 'C:/w/app', path('다른')).place).toEqual({ kind: 'original' });
  });

  it('바꿔도 원래 장부는 그대로다', () => {
    const empty = WorktreeLedger.empty();
    empty.claim('a', 'C:/w/app', path('x'));
    expect(empty.repoOf('a')).toBeNull();
  });
});
