export interface BranchMark {
  /** 색·굵기를 입히는 클래스(현재 브랜치만) */
  readonly className: string;
  /** 색을 못 보는 사람을 위한 작은 글자 배지(현재 브랜치만) */
  readonly badge: string | null;
  readonly title: string;
}

/** 지금 체크아웃한 브랜치를 한눈에 알아보게 하는 표시 규칙. 색에만 기대지 않고 글자 배지와 설명도 준다. */
export function branchMark(name: string | null, current: boolean): BranchMark {
  if (!current) return { className: '', badge: null, title: name ?? '' };
  return { className: 'is-current', badge: '현재', title: name === null ? '지금 체크아웃한 상태: 분리된 HEAD' : `지금 체크아웃한 브랜치: ${name}` };
}
