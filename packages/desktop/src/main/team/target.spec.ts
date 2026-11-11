import { describe, expect, it } from 'vitest';
import { parseTarget } from './target.js';

const folders = [
  { name: 'api-server', root: 'C:/work/api-server' },
  { name: 'docs', root: 'C:/work/docs' },
];

const repos = [
  { name: 'bridge-backend', root: 'C:/work/bridge-backend' },
  { name: 'bridge-backend-v2', root: 'C:/work/bridge-backend-v2' },
  { name: 'Front', root: 'C:/work/Front' },
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

  it('@가 없고 레포 이름도 안 나오면 작업 폴더 그대로다', () => {
    expect(parseTarget('결제 원인 찾아줘', folders)).toEqual({ folder: null, also: [], text: '결제 원인 찾아줘', unknown: null });
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

  it('@이름이 문장 중간에 있어도 그 폴더를 대상으로 삼는다', () => {
    const p = parseTarget('결제 원인을 @api-server 에서 찾아줘', folders);
    expect(p.folder?.name).toBe('api-server');
    expect(p.text).toBe('결제 원인을 @api-server 에서 찾아줘');
  });

  it('@이름 뒤에 쉼표나 조사가 붙어도 알아본다', () => {
    expect(parseTarget('@api-server, 결제 원인 찾아줘', folders).folder?.name).toBe('api-server');
    expect(parseTarget('결제는 @docs를 보고 정리해줘', folders).folder?.name).toBe('docs');
  });

  it('레포 이름이 요청 글에 단어로 정확히 나오면 그 레포가 대상이다', () => {
    const p = parseTarget('bridge-backend 정리해줘', repos);
    expect(p.folder?.name).toBe('bridge-backend');
    expect(p.also).toEqual([]);
    expect(p.text).toBe('bridge-backend 정리해줘');
  });

  it('한글 조사가 붙은 레포 이름도 알아보고 대소문자는 가리지 않는다', () => {
    expect(parseTarget('bridge-backend를 정리해줘', repos).folder?.name).toBe('bridge-backend');
    expect(parseTarget('front 화면 고쳐줘', repos).folder?.name).toBe('Front');
  });

  it('이름이 다른 이름의 일부면 더 긴 이름을 고르고 짧은 이름은 따로 고르지 않는다', () => {
    const p = parseTarget('bridge-backend-v2 정리해줘', repos);
    expect(p.folder?.name).toBe('bridge-backend-v2');
    expect(p.also).toEqual([]);
  });

  it('이름의 일부만 겹치는 단어로는 레포를 고르지 않는다', () => {
    expect(parseTarget('frontend 정리해줘', repos).folder).toBeNull();
    expect(parseTarget('bridge 정리해줘', repos).folder).toBeNull();
  });

  it('여러 레포가 나오면 먼저 나온 것이 주 폴더이고 나머지는 함께 읽을 곳이다', () => {
    const p = parseTarget('front 와 bridge-backend 를 비교해줘', repos);
    expect(p.folder?.name).toBe('Front');
    expect(p.also.map((f) => f.name)).toEqual(['bridge-backend']);
  });

  it('같은 레포를 두 번 적어도 한 번만 센다', () => {
    const p = parseTarget('front 먼저, 그다음 @front 다시', repos);
    expect(p.folder?.name).toBe('Front');
    expect(p.also).toEqual([]);
  });

  it('이름이 대소문자만 다른 레포가 둘이면 애매하니 고르지 않는다', () => {
    const dup = [
      { name: 'App', root: 'C:/a/App' },
      { name: 'app', root: 'C:/b/app' },
    ];
    expect(parseTarget('app 정리해줘', dup).folder).toBeNull();
  });

  it('경로 안에 적힌 레포 이름도 알아본다', () => {
    expect(parseTarget('e:\\work\\Front\\src 읽어줘', repos).folder?.name).toBe('Front');
  });
});

describe('parseTarget: 파일 경로 언급', () => {
  it('@폴더/파일 처럼 폴더 안 파일을 가리키면 그 폴더가 대상이고 요청 글은 그대로 둔다', () => {
    const p = parseTarget('@api-server/src/pay.ts 타임아웃 고쳐줘', folders);
    expect(p.folder?.root).toBe('C:/work/api-server');
    expect(p.text).toBe('@api-server/src/pay.ts 타임아웃 고쳐줘');
  });

  it('경로 가운데에 폴더 이름과 같은 조각이 있어도 그 폴더를 대상으로 잡지 않는다', () => {
    const p = parseTarget('@src/docs/a.md 읽어줘', folders);
    expect(p.folder).toBeNull();
  });
});
