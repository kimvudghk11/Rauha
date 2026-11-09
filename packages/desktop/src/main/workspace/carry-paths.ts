import type { SecretPolicy } from '@rauha/core';

/** 한 번에 옮기는 파일 수 상한(앞 대화가 가리키는 파일은 보통 몇 개뿐이다) */
export const MAX_CARRY_FILES = 200;

/**
 * 앞 업무가 남긴 파일 중 새 worktree로 옮겨도 되는 경로만 가려내는 값 객체.
 * 레포 안 상대 경로만 허용하고, 비밀 파일·.git 아래·레포 밖(.., 절대 경로, 드라이브)은 뺀다.
 */
export class CarryPaths {
  private constructor(private readonly paths: readonly string[]) {}

  static of(raw: readonly string[], secrets: SecretPolicy): CarryPaths {
    const kept = new Set<string>();
    for (const path of raw) {
      const clean = CarryPaths.clean(path);
      if (clean !== null && !secrets.isSecret(clean)) kept.add(clean);
    }
    return new CarryPaths([...kept].slice(0, MAX_CARRY_FILES));
  }

  allowed(): readonly string[] {
    return this.paths;
  }

  private static clean(path: string): string | null {
    if (path === '' || path.includes('\0')) return null;
    const slashed = path.replace(/\\/g, '/');
    if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return null;
    const parts: string[] = [];
    for (const part of slashed.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') return null;
      if (part.toLowerCase() === '.git') return null;
      parts.push(part);
    }
    return parts.length === 0 ? null : parts.join('/');
  }
}
