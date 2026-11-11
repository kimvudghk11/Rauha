import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_LIMIT, tokenizeJson } from './api-json.js';

const joined = (src: string): string => tokenizeJson(src).map((x) => x.text).join('');

describe('JSON 구문 색 조각', () => {
  it('키·문자열·숫자·참거짓·null·기호로 나눈다', () => {
    const t = tokenizeJson('{\n  "a": [1, -2.5e3, true, null, "x"]\n}');
    expect(t.filter((x) => x.kind !== 'punct' && x.kind !== 'text').map((x) => `${x.kind}:${x.text}`)).toEqual(['key:"a"', 'number:1', 'number:-2.5e3', 'bool:true', 'null:null', 'string:"x"']);
  });
  it('조각을 이어 붙이면 원문과 같다', () => {
    const src = '{"a":{"b":"c\\"d"},"e":[]}';
    expect(joined(src)).toBe(src);
  });
  it('문자열 안의 따옴표 이스케이프와 콜론은 문자열로 둔다', () => {
    expect(tokenizeJson('"a:b\\"c"')).toEqual([{ kind: 'string', text: '"a:b\\"c"' }]);
  });
  it('JSON이 아닌 글도 이어 붙이면 그대로다', () => {
    expect(joined('hello 12 world')).toBe('hello 12 world');
  });
  it('너무 길면 색을 칠하지 않고 한 덩어리다', () => {
    expect(tokenizeJson('1'.repeat(HIGHLIGHT_LIMIT + 1))).toHaveLength(1);
  });
});
