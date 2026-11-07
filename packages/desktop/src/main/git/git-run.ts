import { execFile } from 'node:child_process';
import type { GitErrorCode } from '../../shared/git-api.js';

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 화면에 그대로 보여도 되는 git 실패(이유를 담는다) */
export class GitFailure extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GitFailure';
  }
}

/**
 * git을 셸 없이(execFile, 인자 배열) 돌린다. 종료 코드가 0이 아니어도 던지지 않고 돌려준다(diff --no-index는 1이 정상).
 * 비밀번호 창이 뜨지 않게 GIT_TERMINAL_PROMPT=0, 한글 경로가 깨지지 않게 core.quotepath=false.
 */
export function runGit(root: string, args: readonly string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' } },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        if (e !== null && typeof e.code === 'string') return reject(new GitFailure('FAILED', e.code === 'ENOENT' ? 'git을 찾지 못했어요. git이 설치돼 있는지 확인해 주세요.' : e.message));
        resolve({ code: e === null ? 0 : Number(e.code ?? 1), stdout, stderr });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** 성공해야 하는 git 명령. 실패하면 git이 알려 준 이유로 GitFailure를 던진다. */
export async function mustGit(root: string, args: readonly string[], input?: string, code: GitErrorCode = 'FAILED'): Promise<string> {
  const r = await runGit(root, args, input);
  if (r.code !== 0) throw new GitFailure(code, (r.stderr.trim() || r.stdout.trim() || `git ${args[0]} 실패`).split('\n').slice(0, 6).join('\n'));
  return r.stdout;
}
