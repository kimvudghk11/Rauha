import { describe, expect, it } from 'vitest';
import { BackupLedger, Checkpoint, CheckpointBook, CHECKPOINT_LIMITS, RevertPlan, type FileChange, type FileState } from './checkpoint.js';
import { BackupLedgerDto, CheckpointBookDto } from './checkpoint-dto.js';

const H = (c: string) => c.repeat(40);
const begin = (jobId = 'job1', place: 'repo' | 'worktree' = 'repo') => Checkpoint.begin({ jobId, repoRoot: '/r', place, startedAt: 't0', head: H('a'), branch: 'main', startTree: H('b'), startDirty: 2 });
const file = (path: string, kind: FileChange['kind'], added = 1, removed = 0): FileChange => ({ path, kind, added, removed, binary: false });
const finished = (files: FileChange[]) => begin().finishInPlace({ endedAt: 't1', headAtEnd: H('a'), endTree: H('c'), files, hiddenCount: 0 });

describe('Checkpoint', () => {
  it('작업이 끝나기 전에는 바뀐 것을 보일 수 없고 되돌릴 수도 없다', () => {
    const cp = begin();
    expect(cp.hasChanges()).toBe(false);
    expect(cp.revertBlock()).toMatch(/still running/);
  });

  it('바뀐 파일이 있으면 합계를 센다', () => {
    const cp = finished([file('a.ts', 'modified', 3, 1), file('b.ts', 'added', 5, 0)]);
    expect(cp.hasChanges()).toBe(true);
    expect(cp.totals()).toEqual({ files: 2, added: 8, removed: 1 });
    expect(cp.revertBlock()).toBeNull();
  });

  it('작업 중에 커밋이 생겼으면 이력을 건드리지 않으려고 파일 되돌리기를 막는다', () => {
    const cp = begin().finishInPlace({ endedAt: 't1', headAtEnd: H('d'), endTree: H('c'), files: [file('a.ts', 'modified')], hiddenCount: 0 });
    expect(cp.revertBlock()).toMatch(/Commits were made/);
  });

  it('시작 때 기준 트리를 못 남겼으면 되돌리기를 막는다', () => {
    const cp = Checkpoint.begin({ jobId: 'j', repoRoot: '/r', place: 'repo', startedAt: 't', head: null, branch: null, startTree: null, startDirty: 0 }).finishInPlace({ endedAt: 't1', headAtEnd: null, endTree: null, files: [file('a', 'added')], hiddenCount: 0 });
    expect(cp.revertBlock()).toMatch(/No checkpoint/);
  });

  it('worktree 로 돈 작업은 그 브랜치가 체크포인트라 파일 되돌리기 대신 브랜치 버리기를 안내한다', () => {
    const cp = begin('j', 'worktree').finishBranch({ endedAt: 't1', workBranch: 'rauha/job-abc', branchTip: H('e'), files: [file('a.ts', 'modified')], hiddenCount: 0 });
    expect(cp.hasChanges()).toBe(true);
    expect(cp.revertBlock()).toMatch(/Discard branch/);
    expect(cp.discardBlock()).toBeNull();
    expect(cp.withBranchDiscarded().discardBlock()).toMatch(/already/);
  });

  it('worktree 작업이 남긴 변경이 없으면 보일 것이 없다', () => {
    const cp = begin('j', 'worktree').finishBranch({ endedAt: 't1', workBranch: null, branchTip: null, files: [], hiddenCount: 0 });
    expect(cp.hasChanges()).toBe(false);
  });

  it('파일 목록은 500개까지만 둔다', () => {
    const many = Array.from({ length: 600 }, (_, i) => file(`f${i}.ts`, 'added'));
    expect(finished(many).data.files).toHaveLength(CHECKPOINT_LIMITS.files);
  });
});

describe('CheckpointBook', () => {
  it('같은 작업은 덮어쓰고 최근 100개만 둔다', () => {
    let book = CheckpointBook.empty();
    for (let i = 0; i < 105; i += 1) book = book.remember(begin(`job${i}`));
    expect(book.size).toBe(CHECKPOINT_LIMITS.records);
    expect(book.find('job0')).toBeNull();
    expect(book.find('job104')).not.toBeNull();
    expect(book.remember(finished([file('a', 'added')])).find('job1')?.hasChanges()).toBe(true);
    expect(book.remember(begin('job104')).size).toBe(CHECKPOINT_LIMITS.records);
  });
});

describe('CheckpointBookDto', () => {
  it('저장했다 읽어도 같다', () => {
    const book = CheckpointBook.empty().remember(finished([file('src/a.ts', 'modified', 2, 1)]));
    const back = CheckpointBookDto.from(JSON.parse(JSON.stringify(CheckpointBookDto.fromEntity(book)))).toEntity();
    expect(back.find('job1')?.data).toEqual(book.find('job1')?.data);
  });

  it('경로 탈출·.git 안쪽·옵션처럼 읽히는 브랜치가 든 항목은 건너뛴다', () => {
    const good = CheckpointBookDto.fromEntity(CheckpointBook.empty().remember(finished([file('a.ts', 'added')]))).items[0]!;
    const evilPath = { ...good, jobId: 'x1', files: [{ path: '../../etc/passwd', kind: 'added', added: 1, removed: 0, binary: false }] };
    const dotGit = { ...good, jobId: 'x2', files: [{ path: '.git/config', kind: 'modified', added: 1, removed: 0, binary: false }] };
    const evilBranch = { ...good, jobId: 'x3', workBranch: '--force' };
    const dto = CheckpointBookDto.from({ items: [good, evilPath, dotGit, evilBranch, 5] });
    expect(dto.skipped).toBe(4);
    expect(dto.toEntity().size).toBe(1);
  });

  it('해시 모양이 아닌 값은 받지 않는다', () => {
    const good = CheckpointBookDto.fromEntity(CheckpointBook.empty().remember(finished([file('a.ts', 'added')]))).items[0]!;
    expect(CheckpointBookDto.from({ items: [{ ...good, startTree: '--output=/tmp/x' }] }).skipped).toBe(1);
  });
});

describe('RevertPlan', () => {
  const files = [file('mod.ts', 'modified', 4, 2), file('new.ts', 'added', 10, 0), file('gone.ts', 'deleted', 0, 7)];
  const states: Record<string, FileState> = {
    'mod.ts': { start: 's1', end: 'e1', now: 'e1' },
    'new.ts': { start: null, end: 'e2', now: 'e2' },
    'gone.ts': { start: 's3', end: null, now: null },
  };

  it('작업 끝났을 때와 같은 파일은 수정은 복원, 새 파일은 삭제, 지운 파일은 다시 만든다', () => {
    const plan = RevertPlan.of(files, states);
    expect(plan.items.map((i) => i.action)).toEqual(['restore', 'delete', 'restore']);
    expect(plan.fileCount).toBe(3);
  });

  it('작업 뒤에 사용자가 고친 파일은 충돌로 건너뛴다', () => {
    const plan = RevertPlan.of(files, { ...states, 'mod.ts': { start: 's1', end: 'e1', now: 'mine' } });
    expect(plan.conflicts.map((c) => c.path)).toEqual(['mod.ts']);
    expect(plan.fileCount).toBe(2);
  });

  it('이미 시작 때 내용이면 다시 건드리지 않는다', () => {
    const plan = RevertPlan.of(files, { ...states, 'mod.ts': { start: 's1', end: 'e1', now: 's1' } });
    expect(plan.items[0]!.action).toBe('already');
  });

  it('링크·폴더처럼 읽을 수 없게 바뀐 경로와 상태를 모르는 파일은 덮어쓰지 않는다', () => {
    expect(RevertPlan.of(files, { ...states, 'mod.ts': { start: 's1', end: 'e1', now: 'unreadable' } }).items[0]!.action).toBe('conflict');
    expect(RevertPlan.of(files, {}).items.every((i) => i.action === 'conflict')).toBe(true);
  });

  it('고른 파일만 계획에 넣고, 줄 수는 건드릴 파일만 센다', () => {
    const plan = RevertPlan.of(files, states, ['mod.ts', 'new.ts']);
    expect(plan.items).toHaveLength(2);
    expect(plan.removedLines).toBe(14);
    expect(plan.restoredLines).toBe(2);
  });

  it('확인 글에 파일 수·지워질 줄·새 파일 삭제·충돌·백업 상한을 모두 적는다', () => {
    const plan = RevertPlan.of(files, { ...states, 'mod.ts': { start: 's1', end: 'e1', now: 'mine' } });
    const s = plan.summary('all');
    expect(s.title).toBe('Undo all changes (2 files)?');
    expect(s.body).toContain('Removes 10 lines');
    expect(s.body).toContain('1 new file');
    expect(s.body).toContain('new.ts');
    expect(s.body).toContain('Conflict, skipped');
    expect(s.body).toContain('last 20 backups');
    expect(s.okLabel).toBe('Undo all changes');
  });

  it('건드릴 것이 없으면 확인 창 대신 알린다', () => {
    const s = RevertPlan.of(files, {}).summary('all');
    expect(s.title).toBe('Nothing to undo');
    expect(s.body).toContain('mod.ts');
  });

  it('한 파일 되돌리기 확인 글은 그 파일 이름을 제목에 쓴다', () => {
    const s = RevertPlan.of(files, states, ['mod.ts']).summary('file');
    expect(s.title).toBe('Revert mod.ts?');
    expect(s.okLabel).toBe('Revert file');
  });
});

describe('BackupLedger', () => {
  const entry = (id: string, jobId = 'j') => ({ id, jobId, repoRoot: '/r', createdAt: 't', files: 1 });

  it('백업은 최근 20개만 두고 넘친 오래된 것의 id 를 알려 준다', () => {
    let ledger = BackupLedger.empty();
    const evicted: string[] = [];
    for (let i = 0; i < 23; i += 1) {
      const r = ledger.add(entry(`backup-${String(i).padStart(2, '0')}`));
      ledger = r.ledger;
      evicted.push(...r.evicted);
    }
    expect(ledger.items).toHaveLength(20);
    expect(evicted).toEqual(['backup-00', 'backup-01', 'backup-02']);
  });

  it('작업의 가장 최근 백업을 찾고, 쓴 백업은 장부에서 뺀다', () => {
    const a = BackupLedger.empty().add(entry('backup-aa', 'j1')).ledger.add(entry('backup-bb', 'j1')).ledger;
    expect(a.latestFor('j1')?.id).toBe('backup-bb');
    expect(a.remove('backup-bb').latestFor('j1')?.id).toBe('backup-aa');
    expect(a.latestFor('other')).toBeNull();
  });

  it('장부 DTO 는 id 모양이 이상한 항목(경로 탈출 등)을 받지 않는다', () => {
    const dto = BackupLedgerDto.from({ items: [entry('../../evil'), entry('backup-ok')] });
    expect(dto.skipped).toBe(1);
    expect(dto.toEntity().items).toHaveLength(1);
  });
});
