import { describe, expect, it } from 'vitest';
import { branchMark } from './git-branch-mark.js';

describe('git 브랜치 줄 표시', () => {
  it('지금 체크아웃한 브랜치는 강조 이름표와 "현재" 글자 배지와 설명을 가진다', () => {
    expect(branchMark('main', true)).toEqual({ className: 'is-current', badge: '현재', title: '지금 체크아웃한 브랜치: main' });
  });

  it('다른 브랜치는 강조도 배지도 없다', () => {
    expect(branchMark('dev', false)).toEqual({ className: '', badge: null, title: 'dev' });
  });

  it('분리된 HEAD처럼 이름이 없으면 설명에 그대로 알린다', () => {
    expect(branchMark(null, true).title).toBe('지금 체크아웃한 상태: 분리된 HEAD');
  });
});
