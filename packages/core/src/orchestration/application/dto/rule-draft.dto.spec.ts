import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { RuleDraftDto } from './rule-draft.dto.js';

describe('RuleDraftDto', () => {
  it('묻지 않고 할 것 규칙을 초안으로 읽는다', () => {
    expect(RuleDraftDto.from({ text: ' terraform apply는 qa에선 묻지 마 ', bucket: 'allow', scope: 'global', tools: ['Bash'], includes: [' terraform apply ', 'qa'] })).toEqual({
      text: 'terraform apply는 qa에선 묻지 마',
      bucket: 'allow',
      scope: 'global',
      path: null,
      tools: ['Bash'],
      includes: ['terraform apply', 'qa'],
    });
  });

  it('항상 지킬 것은 찾을 글과 도구를 비운다', () => {
    expect(RuleDraftDto.from({ text: '답은 한국어로', bucket: 'always', scope: 'global', includes: ['x'], tools: ['Bash'] })).toMatchObject({ includes: [], tools: [] });
  });

  it('폴더 범위는 폴더 이름을 담고, 모르면 거절한다(넓은 규칙이 되지 않게)', () => {
    expect(RuleDraftDto.from({ text: 'a', bucket: 'ask', scope: 'folder', path: 'bridge-backend', includes: ['git push'] })).toMatchObject({ scope: 'folder', path: 'bridge-backend' });
    expect(() => RuleDraftDto.from({ text: 'a', bucket: 'ask', scope: 'folder', path: '', includes: ['git push'] })).toThrow(/어느 폴더/);
  });

  it('허락·묻지 않음 규칙은 찾을 글이 없으면 거절한다', () => {
    expect(() => RuleDraftDto.from({ text: 'a', bucket: 'allow', scope: 'global', includes: [] })).toThrow(DomainError);
  });

  it('모양이 틀린 출력은 거절한다', () => {
    expect(() => RuleDraftDto.from('글')).toThrow(DomainError);
    expect(() => RuleDraftDto.from({ text: '', bucket: 'allow', includes: ['x'] })).toThrow(/글/);
    expect(() => RuleDraftDto.from({ text: 'a', bucket: '이상한 칸', includes: ['x'] })).toThrow(/칸/);
  });

  it('알 수 없는 범위는 전체로 본다', () => {
    expect(RuleDraftDto.from({ text: 'a', bucket: 'ask', scope: '??', includes: ['x'] }).scope).toBe('global');
  });
});
