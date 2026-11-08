import { describe, expect, it } from 'vitest';
import { BlogDraftRequestDto, BlogRequestError, BlogSaveRequestDto, markdownFileName } from './blog-dto.js';

const ctx = { repoNames: ['bridge-backend'], companyNames: ['Acme'], userName: 'kimbo', homePath: '/Users/kimbo' };

describe('블로그 요청', () => {
  it('초안 요청은 어투가 둘 중 하나여야 하고 정리 노트가 비면 안 된다', () => {
    expect(() => BlogDraftRequestDto.from({ note: '글', tone: 'rude' })).toThrow(BlogRequestError);
    expect(() => BlogDraftRequestDto.from({ note: '  ', tone: 'plain' })).toThrow(BlogRequestError);
    expect(() => BlogDraftRequestDto.from(null)).toThrow(BlogRequestError);
    expect(BlogDraftRequestDto.from({ note: '글', tone: 'friendly' }).tone).toBe('friendly');
  });

  it('모델에 보내는 글은 한 번 더 가려진다(화면이 가리지 않았어도 새지 않는다)', () => {
    const dto = BlogDraftRequestDto.from({ note: 'Acme 의 bridge-backend 10.0.0.1 AKIAIOSFODNN7EXAMPLE', tone: 'plain' });
    const sent = dto.redactedNote(ctx);
    for (const leak of ['Acme', 'bridge-backend', '10.0.0.1', 'AKIAIOSFODNN7EXAMPLE']) expect(sent).not.toContain(leak);
  });

  it('사용자가 되돌린 이름은 남기지만 키는 되돌려도 가려진다', () => {
    const dto = BlogDraftRequestDto.from({ note: 'Acme AKIAIOSFODNN7EXAMPLE', tone: 'plain', keep: ['Acme', 'AKIAIOSFODNN7EXAMPLE'] });
    const sent = dto.redactedNote(ctx);
    expect(sent).toContain('Acme');
    expect(sent).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('저장 요청은 경로를 받지 않고 이름만 안전하게 만든다', () => {
    const dto = BlogSaveRequestDto.from({ markdown: '# 제목: a/b?\n본문', path: '/etc/passwd' });
    expect(dto.fileName).toBe('제목 a b.md');
    expect(Object.keys(dto)).not.toContain('path');
    expect(() => BlogSaveRequestDto.from({ markdown: '' })).toThrow(BlogRequestError);
  });

  it('파일 이름은 쓸 수 없는 글자를 없애고 .md로 끝난다', () => {
    expect(markdownFileName('a\\b:c*d')).toBe('a b c d.md');
    expect(markdownFileName('???')).toBe('blog-draft.md');
    expect(markdownFileName('x'.repeat(100)).length).toBe(63);
  });
});
