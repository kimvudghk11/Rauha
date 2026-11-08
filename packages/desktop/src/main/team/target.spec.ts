import { describe, expect, it } from 'vitest';
import { parseTarget } from './target.js';

const folders = [
  { name: 'api-server', root: 'C:/work/api-server' },
  { name: 'docs', root: 'C:/work/docs' },
];

describe('parseTarget', () => {
  it('앞에 @폴더이름을 적으면 그 폴더가 대상이고 요청 글에서는 뺀다', () => {
    const p = parseTarget('@api-server 결제 타임아웃 원인 찾아줘', folders);
    expect(p.folder?.root).toBe('C:/work/api-server');
    expect(p.text).toBe('결제 타임아웃 원인 찾아줘');
  });

  it('이름의 대소문자는 가리지 않는다', () => {
    expect(parseTarget('@Docs 정리해줘', folders).folder?.name).toBe('docs');
  });

  it('@가 없으면 작업 폴더 그대로다', () => {
    expect(parseTarget('결제 원인 찾아줘', folders)).toEqual({ folder: null, text: '결제 원인 찾아줘', unknown: null });
  });

  it('없는 이름이면 요청을 그대로 두고 어떤 이름이 틀렸는지 알린다', () => {
    const p = parseTarget('@nothing 해줘', folders);
    expect(p.folder).toBeNull();
    expect(p.unknown).toBe('nothing');
    expect(p.text).toBe('@nothing 해줘');
  });

  it('이름만 적고 요청이 없으면 글은 그대로 둔다', () => {
    expect(parseTarget('@docs', folders).text).toBe('@docs');
  });
});
