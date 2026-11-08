import { describe, expect, it } from 'vitest';
import { defaultIndentSize, languageOf } from './code-language.js';

describe('파일 이름으로 언어 고르기', () => {
  it('확장자로 고른다(대소문자 무시)', () => {
    expect(languageOf('App.TSX')).toBe('tsx');
    expect(languageOf('main.py')).toBe('python');
    expect(languageOf('a.spec.ts')).toBe('typescript');
  });

  it('확장자 없는 이름도 안다', () => {
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('.gitignore')).toBe('properties');
  });

  it('모르는 건 plain', () => {
    expect(languageOf('LICENSE')).toBe('plain');
    expect(languageOf('a.xyz')).toBe('plain');
  });

  it('기본 들여쓰기: 웹·YAML 은 2칸, 파이썬·자바는 4칸', () => {
    expect(defaultIndentSize('typescript')).toBe(2);
    expect(defaultIndentSize('python')).toBe(4);
  });
});
