import { onlyDocuments } from '../../domain/question-hint.js';
import { Department, type DepartmentId, type DepartmentMemberRole } from '../../domain/department.js';

export interface Route {
  /**
   * task: 코드가 아닌 결과물(문서·보고서). TDD 없이 문서 팀원이 만든다. feature: 설계 대화부터 하는 기능 요청.
   * company: 마케팅·BM·디자인·보안·릴리스처럼 회사 부서가 맡는 일(department 필수). launch: 앱·웹을 기획해 오픈하기까지 여러 부서가 이어 쓰는 계획.
   */
  readonly mode: 'work' | 'question' | 'task' | 'feature' | 'ops' | 'debug' | 'risk' | 'ideate' | 'company' | 'launch';
  readonly refersToPast: boolean;
  readonly pastQuery: string | null;
  /** company일 때 맡을 부서. 그 밖에는 null */
  readonly department: DepartmentId | null;
  /** company일 때 일을 맡을 팀원. null이면 넓은 요청이라 부서장이 나눈다 */
  readonly member: DepartmentMemberRole | null;
  /** question일 때 답의 깊이. light: 파일을 안 열어도 되는 가벼운 질문(haiku 몇 턴). 그 밖에는 항상 deep. */
  readonly depth: 'light' | 'deep';
}

const MODES: readonly Route['mode'][] = ['work', 'question', 'task', 'feature', 'ops', 'debug', 'risk', 'ideate', 'company', 'launch'];
const FALLBACK: Route = { mode: 'work', refersToPast: false, pastQuery: null, department: null, member: null, depth: 'deep' };

/**
 * 라우터 출력 → 입력 종류. 깨진 출력은 작업으로 본다: 작업이면 접수 팀장이 한 번 더 걸러 주고,
 * 지난 작업 찾기는 하지 않아 엉뚱한 작업을 이어 고치는 일은 생기지 않는다.
 */
export class RouteDto {
  private constructor() {}

  /** "더 깊게 알아보기": 라우터를 거치지 않고 같은 질문을 deep으로 다시 묻는다. */
  static deepQuestion(): Route {
    return { mode: 'question', refersToPast: false, pastQuery: null, department: null, member: null, depth: 'deep' };
  }

  /**
   * input: 사용자가 한 말. 코드 수정(work·feature)으로 판정됐어도 문서 파일만 가리키면 문서 경로(task)로 돌린다
   * (haiku 라우터가 "한 줄 추가해줘"를 코드 수정으로 읽어 테스트 팀원이 막히던 문제).
   */
  static read(output: unknown, input = ''): Route {
    const route = RouteDto.parse(output);
    return (route.mode === 'work' || route.mode === 'feature') && onlyDocuments(input) ? { ...route, mode: 'task', depth: 'deep' } : route;
  }

  private static parse(input: unknown): Route {
    if (typeof input !== 'object' || input === null) return FALLBACK;
    const o = input as Record<string, unknown>;
    const mode = MODES.find((m) => m === o['mode']);
    if (mode === undefined) return FALLBACK;
    const query = typeof o['pastQuery'] === 'string' && o['pastQuery'].trim() !== '' ? o['pastQuery'].trim() : null;
    const refersToPast = o['refersToPast'] === true;
    // 지난 작업을 가리키는 질문은 기억에서 고른 작업을 읽어야 해서 가볍게 답하지 않는다.
    const depth = mode === 'question' && !refersToPast && o['depth'] === 'light' ? 'light' : 'deep';
    const base = { mode, refersToPast, pastQuery: query, depth } as const;
    if (mode !== 'company') return { ...base, department: null, member: null };
    // 부서를 못 읽어도 작업(코드 수정)으로 되돌리지 않는다: 회사 일로 들어왔으니 기획부 부서장이 받아 나눈다.
    const department = Department.named(o['department']) ?? Department.of('planning');
    const member = department.member(String(o['member']));
    return { ...base, department: department.id, member: member?.role ?? null };
  }
}
