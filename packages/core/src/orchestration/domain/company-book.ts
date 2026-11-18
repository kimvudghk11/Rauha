import { Department, DEPARTMENT_ORDER, type DepartmentId } from './department.js';

/** 한 부서가 가장 최근에 낸 결과의 요약 */
export interface CompanyEntry {
  readonly department: DepartmentId;
  readonly summary: string;
  /** ISO 시각 */
  readonly at: string;
}

/** 팀원 입력에 싣는 장부 글의 전체 글자 수 상한 */
const BLOCK_MAX_CHARS = 1800;
/** 부서 하나의 요약을 장부 글에 싣는 글자 수 상한 */
const ENTRY_MAX_CHARS = 420;
/** 요약에서 빼는 뒷부분(근거로 읽은 파일·실행한 명령은 결정이 아니다) */
const TAIL_SECTIONS = /\n+■ (살펴본 파일|실행한 명령)[\s\S]*$/;

const ORDER: readonly DepartmentId[] = DEPARTMENT_ORDER;

/**
 * 회사가 이미 정한 것: 부서마다 가장 최근 결과의 요약. 마케팅 팀원이 매번 "이 제품이 뭔지, 수익 모델이 뭔지, 톤이 뭔지"를
 * 다시 듣지 않고 이것을 읽는다(입력이 줄고 부서끼리 어긋나지 않는다).
 */
export class CompanyBook {
  private constructor(readonly entries: readonly CompanyEntry[]) {}

  static empty(): CompanyBook {
    return new CompanyBook([]);
  }

  static of(entries: readonly CompanyEntry[]): CompanyBook {
    return new CompanyBook([...entries]);
  }

  /** 저장된 글에서 읽는다. 읽을 수 없는 항목은 버린다. */
  static read(input: unknown): CompanyBook {
    const list = Array.isArray(input) ? input : [];
    const entries: CompanyEntry[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const o = item as Record<string, unknown>;
      const department = Department.named(o['department']);
      if (department === null || typeof o['summary'] !== 'string' || o['summary'].trim() === '' || typeof o['at'] !== 'string') continue;
      entries.push({ department: department.id, summary: o['summary'], at: o['at'] });
    }
    return new CompanyBook(entries);
  }

  /** 답 → 장부에 남길 요약. 읽은 파일·명령 목록은 빼고, 줄 경계에서 자른다. */
  static summaryOf(answer: string, max: number): string {
    const lines = answer.replace(TAIL_SECTIONS, '').trim().replace(/\n{3,}/g, '\n\n').split('\n');
    let text = '';
    for (const line of lines) {
      const next = text === '' ? line : `${text}\n${line}`;
      if (next.length > max) break;
      text = next;
    }
    if (text !== '') return text;
    return `${(lines[0] ?? '').slice(0, max - 1)}…`;
  }

  /** 이 부서의 결과를 새로 남긴다(같은 부서의 옛 결과는 대체한다). */
  with(entry: CompanyEntry): CompanyBook {
    return new CompanyBook([...this.entries.filter((e) => e.department !== entry.department), entry]);
  }

  /** 팀원 입력에 넣을 글. 장부가 비었으면 null. */
  block(): string | null {
    if (this.entries.length === 0) return null;
    const sorted = [...this.entries].sort((a, b) => ORDER.indexOf(a.department) - ORDER.indexOf(b.department));
    const lines = sorted.map((e) => `[${Department.of(e.department).label} ${e.at.slice(0, 10)}]\n${CompanyBook.summaryOf(e.summary, ENTRY_MAX_CHARS)}`);
    let body = '';
    for (const line of lines) {
      if (body.length + line.length > BLOCK_MAX_CHARS) break;
      body = body === '' ? line : `${body}\n\n${line}`;
    }
    return `<company>\n회사가 이미 정한 것입니다(부서별 가장 최근 결과). 이것과 어긋나지 않게 하고, 바꿔야 한다고 판단하면 바꾸는 이유를 밝히세요.\n${body}\n</company>`;
  }
}
