import { DomainError } from '@rauha/core';

/** 터미널 한 칸: 지금 폴더, 이전 폴더, 명령이 돌고 있는지. 상태는 이름 있는 메서드로만 바꾼다. */
export class Terminal {
  private constructor(
    readonly id: string,
    private dir: string,
    private before: string | null,
    private busy: boolean,
  ) {}

  static open(id: string, cwd: string): Terminal {
    return new Terminal(id, cwd, null, false);
  }

  get cwd(): string {
    return this.dir;
  }

  get previous(): string | null {
    return this.before;
  }

  isRunning(): boolean {
    return this.busy;
  }

  /** 폴더를 옮겼다(cd). 돌고 있는 명령이 있으면 옮기지 못한다. */
  movedTo(dir: string): void {
    if (this.busy) throw new DomainError('TERMINAL_BUSY', '명령이 돌고 있는 동안은 폴더를 옮길 수 없어요.');
    this.before = this.dir;
    this.dir = dir;
  }

  /** 명령을 시작한다. 이미 돌고 있으면 시작하지 못한다. */
  started(): void {
    if (this.busy) throw new DomainError('TERMINAL_BUSY', '앞선 명령이 아직 돌고 있어요.');
    this.busy = true;
  }

  finished(): void {
    this.busy = false;
  }
}
