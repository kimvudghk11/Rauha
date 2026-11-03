import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '../../shared/domain-error.js';
import { MEMBER_ROLES, type MemberRole } from '../domain/member-role.js';
import type { ToolKit } from '../domain/tool-kit.js';

/** 업무 지시서를 받아 일하는 팀원. 공통 앞부분(_common.md)은 이들에게만 붙인다. 라우터·답변 팀원에게는 맞지 않는 지침이라 입력만 길어진다. */
const WORK_ROLES: ReadonlySet<MemberRole> = new Set(['intake', 'tester', 'implementer', 'reviewer']);

/**
 * 팀원 시스템 프롬프트. 실험하기 쉽도록 코드가 아니라 파일(`prompts/*.md`)에서 읽는다.
 * 해시는 실행 기록과 bench 표에 남겨 어떤 프롬프트 버전의 결과인지 구분한다.
 */
export class PromptLibrary {
  private constructor(
    private readonly prompts: Readonly<Record<MemberRole, string>>,
    /** 도구 묶음을 붙였을 때만 덧붙이는 사용법(_kit-<묶음>.md) */
    private readonly kits: Readonly<Record<ToolKit, string>>,
    readonly hash: string,
  ) {}

  /** 저장소의 기본 프롬프트 폴더. src와 dist가 같은 깊이라 둘 다에서 맞는다. */
  static defaultDir(): string {
    return fileURLToPath(new URL('../../../../../prompts/', import.meta.url));
  }

  static async load(dir: string): Promise<PromptLibrary> {
    const read = async (name: string) => {
      try {
        return (await readFile(join(dir, name), 'utf8')).trim();
      } catch {
        throw new DomainError('PROMPT_MISSING', `프롬프트 파일이 없습니다: ${join(dir, name)}`);
      }
    };
    const common = await read('_common.md');
    const kits = { browser: await read('_kit-browser.md'), aws: await read('_kit-aws.md') };
    // 동시에 읽되, 없는 파일은 역할 순서상 첫 번째 것을 알려 준다(어느 읽기가 먼저 끝나는지에 따라 메시지가 바뀌지 않게).
    const settled = await Promise.allSettled(MEMBER_ROLES.map((role) => read(`${role}.md`)));
    const missing = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (missing !== undefined) throw missing.reason;
    const entries = MEMBER_ROLES.map((role, i) => {
      const own = (settled[i] as PromiseFulfilledResult<string>).value;
      return [role, WORK_ROLES.has(role) ? `${common}\n\n${own}` : own] as const;
    });
    const prompts = Object.fromEntries(entries) as Record<MemberRole, string>;
    const hash = createHash('sha256').update(JSON.stringify([entries, kits])).digest('hex').slice(0, 8);
    return new PromptLibrary(prompts, kits, hash);
  }

  system(role: MemberRole, kits: readonly ToolKit[] = []): string {
    return [this.prompts[role], ...kits.map((kit) => this.kits[kit])].join('\n\n');
  }
}
