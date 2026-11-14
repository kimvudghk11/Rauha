import { describe, expect, it } from 'vitest';
import { yamlToJson } from './yaml-text.js';

describe('YAML → JSON (OpenAPI 가져오기)', () => {
  it('OpenAPI YAML 을 같은 모양의 JSON 으로 바꾼다', () => {
    expect(JSON.parse(yamlToJson('openapi: 3.0.0\ninfo:\n  title: Pet\npaths:\n  /pets:\n    get:\n      summary: List\n'))).toEqual({ openapi: '3.0.0', info: { title: 'Pet' }, paths: { '/pets': { get: { summary: 'List' } } } });
  });
  it('별칭을 끝없이 펼치는 문서(billion laughs)는 거절한다', () => {
    const bomb = ['a: &a ["x","x","x","x","x","x","x","x","x"]', ...Array.from({ length: 9 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(',')}]`)].join('\n');
    expect(() => yamlToJson(bomb)).toThrow();
  });
  it('깨진 YAML 은 알기 쉬운 오류', () => {
    expect(() => yamlToJson('a: [1, 2')).toThrow(/neither JSON nor valid YAML/);
  });
});
