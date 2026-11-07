import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { RuleBookDto } from './rule-book.dto.js';

const valid = { rules: [{ id: 'a', text: 'git push 허락', bucket: 'allow', scope: { kind: 'global' }, tools: ['Bash'], includes: ['git push'] }] };

describe('RuleBookDto', () => {
  it('JSON을 규칙 모음으로 바꾸고 다시 JSON으로 돌려도 같다', () => {
    const dto = RuleBookDto.from(valid);
    const book = dto.toEntity();
    expect(book.verdictFor('Bash', 'git push', 'C:/x')).toBe('allow');
    expect(RuleBookDto.fromEntity(book).toJSON()).toEqual(valid);
  });

  it('목록만 있는 JSON도 읽는다', () => {
    expect(RuleBookDto.from(valid.rules).toEntity().rules.length).toBe(1);
  });

  it('모양이 틀린 입력은 거절한다', () => {
    expect(() => RuleBookDto.from('글')).toThrow(DomainError);
    expect(() => RuleBookDto.from({ rules: [{ id: 'a' }] })).toThrow(/id·글·칸/);
    expect(() => RuleBookDto.from({ rules: [{ ...valid.rules[0], bucket: '이상한 칸' }] })).toThrow(DomainError);
    expect(() => RuleBookDto.from({ rules: [{ ...valid.rules[0], scope: { kind: 'folder' } }] })).toThrow(/범위/);
  });

  it('찾을 글이 없는 허락 규칙은 엔티티로 바꿀 때 거절한다', () => {
    const dto = RuleBookDto.from({ rules: [{ ...valid.rules[0], includes: [] }] });
    expect(() => dto.toEntity()).toThrow(DomainError);
  });

  it('빈 규칙 모음을 만들 수 있다', () => {
    expect(RuleBookDto.empty().toEntity().rules).toEqual([]);
  });
});
