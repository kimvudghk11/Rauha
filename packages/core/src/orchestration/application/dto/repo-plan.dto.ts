import { DomainError } from '../../../shared/domain-error.js';
import { asRecord, readString, readStringArray } from '../../../shared/validation.js';
import { RepoPlan, type RepoContract, type RepoEdgeCase, type RepoPart } from '../../domain/repo-plan.js';

function list<T>(value: unknown, what: string, read: (item: Record<string, unknown>, at: string) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainError('INVALID_INPUT', `${what}: 배열이 필요합니다.`);
  return value.map((item, i) => read(asRecord(item, `${what}[${i}]`), `${what}[${i}]`));
}

/** 먼저 끝난 저장소가 한 일. 뒤 저장소가 실제 이름(파일, 필드)에 맞춰 쓰게 넘긴다. */
export interface FinishedRepo {
  readonly repo: string;
  readonly title: string;
  readonly files: readonly string[];
}

const contractLine = (c: RepoContract) => `- ${c.what} (${c.between.join(' ↔ ')}): ${c.shape}`;
const edgeLine = (e: RepoEdgeCase) => `- ${e.case} → ${e.handling}`;

/** 나누기 팀원 출력 → 검증된 계획, 그리고 저장소마다 넘길 일. */
export class RepoPlanDto {
  private constructor() {}

  static from(input: unknown, workspaceRepos: readonly string[]): { plan: RepoPlan; decisions: string[] } {
    const o = asRecord(input, '저장소 계획');
    const plan = RepoPlan.of(
      {
        parts: list<RepoPart>(o['parts'], '저장소 계획.parts', (p, at) => ({ repo: readString(p, 'repo', at), request: readString(p, 'request', at), dependsOn: readStringArray(p, 'dependsOn', at) })),
        contract: list<RepoContract>(o['contract'], '저장소 계획.contract', (c, at) => ({ what: readString(c, 'what', at), between: readStringArray(c, 'between', at), shape: readString(c, 'shape', at) })),
        edgeCases: list<RepoEdgeCase>(o['edgeCases'], '저장소 계획.edgeCases', (e, at) => ({ case: readString(e, 'case', at), handling: readString(e, 'handling', at), repo: readString(e, 'repo', at) })),
      },
      workspaceRepos,
    );
    return { plan, decisions: readStringArray(o, 'decisions', '저장소 계획') };
  }

  /**
   * 저장소 하나에 넘길 요청과 접수 팀장에게 줄 블록. 블록에는 그 저장소가 낀 약속, 그리고 먼저 끝난 저장소가
   * 바꾼 파일을 넣는다. 약속의 이름·모양은 다시 정하지 말고 그대로 쓰게 한다.
   */
  static task(plan: RepoPlan, part: RepoPart, finished: readonly FinishedRepo[]): { request: string; block: string } {
    const edges = plan.edgeCasesOf(part.repo);
    const request = [part.request, ...edges.map((e) => `- 엣지 케이스: ${e.case} → ${e.handling}`)].join('\n');
    const contract = plan.contractFor(part.repo);
    const block = [
      `<repos_contract repo="${part.repo}">`,
      `여러 저장소(${plan.parts.map((p) => p.repo).join(', ')})를 함께 고치는 요청 중 이 저장소(${part.repo})의 몫입니다. 다른 저장소는 따로 고칩니다. 이 저장소 밖의 파일은 건드리지 마세요.`,
      ...(contract.length > 0 ? ['저장소 사이의 약속(이름과 모양을 바꾸지 말고 그대로 따르세요):', ...contract.map(contractLine)] : []),
      ...(edges.length > 0 ? ['이 저장소가 맡은 경계의 엣지 케이스(수용 기준과 함께 테스트로 먼저 잠근다):', ...edges.map(edgeLine)] : []),
      ...(finished.length > 0 ? ['먼저 끝난 저장소가 한 일(약속의 실제 구현을 확인할 때 참고):', ...finished.map((f) => `- ${f.repo}: ${f.title}${f.files.length > 0 ? ` (${f.files.join(', ')})` : ''}`)] : []),
      '</repos_contract>',
    ].join('\n');
    return { request, block };
  }
}

export interface ContractItem {
  readonly what: string;
  readonly ok: boolean;
  /** 어긋났을 때 고칠 저장소(계획 안에 있을 때만) */
  readonly repo: string | null;
  readonly fix: string | null;
  readonly evidence: string;
}

/** 약속 검사 결과. 고칠 저장소와 고칠 점이 분명한 불일치만 고치기로 넘긴다. */
export class ContractCheckDto {
  private constructor(readonly items: readonly ContractItem[]) {}

  /** 읽을 수 없는 출력은 검사하지 못한 것(빈 결과)으로 둔다. 검사가 작업 결과를 막지는 않는다. */
  static from(input: unknown, plan: RepoPlan): ContractCheckDto {
    try {
      const o = asRecord(input, '약속 검사');
      const repos = new Set(plan.parts.map((p) => p.repo));
      const items = list<ContractItem>(o['items'], '약속 검사.items', (i, at) => {
        const repo = typeof i['repo'] === 'string' && repos.has(i['repo']) ? i['repo'] : null;
        const fix = typeof i['fix'] === 'string' && i['fix'].trim() !== '' ? i['fix'].trim() : null;
        return { what: readString(i, 'what', at), ok: i['ok'] === true, repo, fix, evidence: typeof i['evidence'] === 'string' ? i['evidence'] : '' };
      });
      return new ContractCheckDto(items);
    } catch (error) {
      if (error instanceof DomainError) return new ContractCheckDto([]);
      throw error;
    }
  }

  /** 고치기로 넘길 불일치: 고칠 저장소와 고칠 점이 있는 것 */
  mismatches(): { what: string; repo: string; fix: string; evidence: string }[] {
    return this.items.flatMap((i) => (!i.ok && i.repo !== null && i.fix !== null ? [{ what: i.what, repo: i.repo, fix: i.fix, evidence: i.evidence }] : []));
  }
}
