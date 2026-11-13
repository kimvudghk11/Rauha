import { describe, expect, it } from 'vitest';
import { ApiEnvironment, ApiEnvironments, EnvBar, checkVarName } from './api-env.js';

describe('환경 바(base_url 바로 고치기·환경 색)', () => {
  const view = { id: 'e1', name: 'Local', vars: [{ name: 'base_url', value: 'http://localhost:3000', secret: false, has: true }, { name: 'token', value: '', secret: true, has: true }] };
  it('base_url 만 바꾸고 비밀 변수는 값을 보내지 않아 그대로 둔다', () => {
    expect(EnvBar.withBaseUrl(view, ' http://localhost:4000/ ')).toEqual([
      { name: 'base_url', value: 'http://localhost:4000', secret: false },
      { name: 'token', value: null, secret: true },
    ]);
  });
  it('base_url 이 없던 환경이면 맨 앞에 더한다', () => {
    expect(EnvBar.withBaseUrl({ ...view, vars: [] }, 'http://127.0.0.1:8080')).toEqual([{ name: 'base_url', value: 'http://127.0.0.1:8080', secret: false }]);
  });
  it('환경 색: localhost 주소나 local·dev 이름은 local, prod·live 는 prod, 그 밖은 remote', () => {
    expect(EnvBar.tone('Local', 'http://localhost:3000')).toBe('local');
    expect(EnvBar.tone('anything', 'http://127.0.0.1:8080')).toBe('local');
    expect(EnvBar.tone('Production', 'https://api.example.com')).toBe('prod');
    expect(EnvBar.tone('운영', 'https://api.example.com')).toBe('prod');
    expect(EnvBar.tone('Staging', 'https://stg.example.com')).toBe('remote');
    expect(EnvBar.tone(null, null)).toBe('none');
  });
});

const FAKE = ['sec', 'ret', '-value', '-9'].join('');
let n = 0;
const nid = (): string => `e${++n}`;

describe('환경 변수 이름', () => {
  it('글자·숫자·_·.·-만 되고 위험한 이름은 막는다', () => {
    expect(checkVarName('base_url')).toBe('base_url');
    for (const bad of ['', '1a', 'a b', '__proto__', 'constructor', 'prototype', 'a{b}']) expect(() => checkVarName(bad)).toThrow();
  });
});

describe('환경', () => {
  const env = ApiEnvironment.create({ id: 'a', name: 'Local', vars: [{ name: 'base', value: 'http://localhost', secret: false }, { name: 'token', value: FAKE, secret: true }] });
  it('화면용 모양에는 비밀 값이 없고 값이 있다는 표시만 있다', () => {
    const v = env.view();
    expect(JSON.stringify(v)).not.toContain(FAKE);
    expect(v.vars[1]).toEqual({ name: 'token', value: '', secret: true, has: true });
    expect(v.vars[0]?.value).toBe('http://localhost');
  });
  it('비밀 변수의 값을 null로 보내면 지금 값을 그대로 둔다', () => {
    const next = env.edit('Local', [{ name: 'base', value: 'http://x', secret: false }, { name: 'token', value: null, secret: true }]);
    expect(next.variableMap().get('token')).toBe(FAKE);
    expect(next.variableMap().get('base')).toBe('http://x');
  });
  it('없는 변수를 null로 이어 받으려 하면 오류다', () => {
    expect(() => env.edit('Local', [{ name: 'new', value: null, secret: true }])).toThrow('no value to keep');
  });
  it('같은 이름 변수가 두 번 나오면 오류다', () => {
    expect(() => env.edit('Local', [{ name: 'a', value: '1', secret: false }, { name: 'a', value: '2', secret: false }])).toThrow('twice');
  });
  it('이름이 비면 오류다', () => expect(() => ApiEnvironment.create({ id: 'x', name: ' ' })).toThrow());
});

describe('환경 모음', () => {
  it('첫 환경을 더하면 자동으로 고른 환경이 된다', () => {
    const all = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'a', name: 'Local' }));
    expect(all.selectedId).toBe('a');
  });
  it('같은 이름(대소문자 무시)은 못 더한다', () => {
    const all = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'a', name: 'Local' }));
    expect(() => all.add(ApiEnvironment.create({ id: 'b', name: 'local' }))).toThrow('already exists');
  });
  it('고른 환경을 지우면 선택이 풀린다', () => {
    const all = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'a', name: 'Local' }));
    expect(all.remove('a').selectedId).toBeNull();
  });
  it('요청에서 꺼낸 비밀은 고른 환경에 비밀 변수로 들어가고, 이미 있는 이름은 덮지 않는다', () => {
    const all = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'a', name: 'Local', vars: [{ name: 'tok', value: 'mine', secret: true }] }));
    const next = all.withSecrets([{ name: 'tok', value: FAKE }, { name: 'key', value: FAKE }], nid);
    const m = next.selectedVariables();
    expect(m.get('tok')).toBe('mine');
    expect(m.get('key')).toBe(FAKE);
    expect(next.find('a')?.props.vars.find((v) => v.name === 'key')?.secret).toBe(true);
  });
  it('환경이 하나도 없으면 Default를 만들어 넣는다', () => {
    const next = ApiEnvironments.empty().withSecrets([{ name: 'k', value: FAKE }], nid);
    expect(next.items.map((e) => e.name)).toEqual(['Default']);
    expect(next.selectedVariables().get('k')).toBe(FAKE);
  });
});
