import { realpath } from 'node:fs/promises';

/** 폴더를 같은 폴더끼리 비교할 수 있게 실제 경로로 바꾼다(심볼릭 링크·Windows 대소문자·macOS /private 차이를 없앤다). */
export async function canonical(path: string): Promise<string> {
  const real = await realpath(path);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * git 명령을 돌려도 되는 폴더인지 가린다. 앱이 작업 폴더에서 찾은 레포의 루트만 통과한다.
 * 목록에 없으면 한 번 다시 찾아 본다(방금 만든 레포일 수 있다).
 */
export class RepoGate {
  private known = new Set<string>();

  constructor(private readonly scan: () => Promise<readonly string[]>) {}

  private async reload(): Promise<void> {
    const next = new Set<string>();
    for (const root of await this.scan()) {
      try {
        next.add(await canonical(root));
      } catch {
        /* 사라진 폴더는 건너뛴다 */
      }
    }
    this.known = next;
  }

  /** 알려진 레포 루트면 그 경로를, 아니면 null */
  async check(root: unknown): Promise<string | null> {
    if (typeof root !== 'string' || root === '') return null;
    let key: string;
    try {
      key = await canonical(root);
    } catch {
      return null;
    }
    if (!this.known.has(key)) await this.reload();
    return this.known.has(key) ? root : null;
  }
}
