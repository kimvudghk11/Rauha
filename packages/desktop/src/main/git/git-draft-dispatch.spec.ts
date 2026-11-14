import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dispatchGit } from './git-dispatch.js';
import { RepoGate } from './repo-gate.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-draft-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
sh('init', '-q', '-b', 'main');
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false']] as const) sh('config', k, v);
writeFileSync(join(root, 'a.txt'), 'a\n');
sh('add', '-A');
sh('commit', '-q', '-m', 'feat: first');

const seen: { diff: string; style: string }[] = [];
const call = () => dispatchGit({ gate: new RepoGate(async () => [root]), protectedBranches: () => [], openExternal: async () => {}, draftCommit: async (diff, style) => (seen.push({ diff, style }), { subject: 'feat: x', body: '' }) }, 'draftCommit', root, {});

describe('커밋 메시지 초안은 스테이지한 변경만 보낸다', () => {
  it('스테이지한 게 없으면 모델을 부르지 않고 이유를 말한다', async () => {
    writeFileSync(join(root, 'a.txt'), 'changed but not staged\n');
    expect(await call()).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(seen).toHaveLength(0);
  });
  it('스테이지한 diff 와 이 레포의 커밋 방식 안내를 넘긴다(스테이지 안 한 파일은 빠진다)', async () => {
    writeFileSync(join(root, 'b.txt'), 'staged line\n');
    sh('add', 'b.txt');
    expect(await call()).toMatchObject({ ok: true, data: { subject: 'feat: x' } });
    expect(seen[0]?.diff).toContain('+staged line');
    expect(seen[0]?.diff).not.toContain('changed but not staged');
    expect(seen[0]?.style).toMatch(/commit style|This repo uses/);
  });
});
