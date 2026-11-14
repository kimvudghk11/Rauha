import { describe, expect, it } from 'vitest';
import { AfterRules, jsonAt } from './api-after.js';

const res = (over: Partial<{ status: number; headers: [string, string][]; body: string; ms: number }> = {}) => ({
  status: 200,
  headers: [['content-type', 'application/json'], ['X-Request-Id', 'abc-1']] as [string, string][],
  body: JSON.stringify({ accessToken: 'tok-1', user: { id: 7, roles: ['admin', 'dev'] }, items: [{ id: 'a' }, { id: 'b' }] }),
  ms: 120,
  ...over,
});

describe('jsonAt — JSON 경로로 값 꺼내기', () => {
  const v = { a: { b: [10, { c: 'x' }] }, 'with space': 1 };
  it('$. 로 시작해도 되고 안 해도 된다', () => {
    expect(jsonAt(v, '$.a.b[0]')).toEqual({ found: true, value: 10 });
    expect(jsonAt(v, 'a.b.1.c')).toEqual({ found: true, value: 'x' });
  });
  it('따옴표 키와 $ 하나(전체)를 읽는다', () => {
    expect(jsonAt(v, '$["with space"]')).toEqual({ found: true, value: 1 });
    expect(jsonAt(v, '$')).toEqual({ found: true, value: v });
  });
  it('없는 경로는 found false', () => {
    expect(jsonAt(v, 'a.z').found).toBe(false);
    expect(jsonAt(v, 'a.b[9]').found).toBe(false);
  });
});

describe('AfterRules — 응답 뒤 변수 저장', () => {
  it('JSON 경로·헤더·상태에서 값을 꺼내 변수로 돌려준다', () => {
    const r = AfterRules.of({
      captures: [
        { name: 'token', from: 'json', path: '$.accessToken', enabled: true },
        { name: 'rid', from: 'header', path: 'x-request-id', enabled: true },
        { name: 'code', from: 'status', path: '', enabled: true },
        { name: 'firstRole', from: 'json', path: 'user.roles[0]', enabled: true },
        { name: 'off', from: 'json', path: 'accessToken', enabled: false },
      ],
      checks: [],
    }).run(res());
    expect(r.captured).toEqual([
      { name: 'token', value: 'tok-1', found: true },
      { name: 'rid', value: 'abc-1', found: true },
      { name: 'code', value: '200', found: true },
      { name: 'firstRole', value: 'admin', found: true },
    ]);
  });
  it('객체·숫자 값은 JSON 글로 저장하고, 못 찾으면 found false 로 알린다', () => {
    const r = AfterRules.of({ captures: [{ name: 'u', from: 'json', path: 'user.id', enabled: true }, { name: 'nope', from: 'json', path: 'missing.x', enabled: true }], checks: [] }).run(res());
    expect(r.captured).toEqual([
      { name: 'u', value: '7', found: true },
      { name: 'nope', value: '', found: false },
    ]);
  });
  it('JSON 이 아닌 본문에서 JSON 경로를 찾으면 found false', () => {
    const r = AfterRules.of({ captures: [{ name: 't', from: 'json', path: 'a', enabled: true }], checks: [] }).run(res({ body: '<html>' }));
    expect(r.captured[0]?.found).toBe(false);
  });
  it('변수 이름이 규칙에 맞지 않으면 만들 때 거절한다', () => {
    expect(() => AfterRules.of({ captures: [{ name: '1bad name', from: 'json', path: 'a', enabled: true }], checks: [] })).toThrow(/variable name/);
  });
});

describe('AfterRules — 검증', () => {
  const run = (checks: Parameters<typeof AfterRules.of>[0]['checks'], over = {}) => AfterRules.of({ captures: [], checks }).run(res(over)).checks;

  it('상태 코드 같음·다름·범위', () => {
    const r = run([
      { target: 'status', path: '', op: 'eq', value: '200', enabled: true },
      { target: 'status', path: '', op: 'lt', value: '300', enabled: true },
      { target: 'status', path: '', op: 'eq', value: '201', enabled: true },
    ]);
    expect(r.map((c) => c.pass)).toEqual([true, true, false]);
    expect(r[2]).toMatchObject({ label: 'Status = 201', actual: '200' });
  });
  it('JSON 값 같음·있음·포함', () => {
    const r = run([
      { target: 'json', path: 'user.id', op: 'eq', value: '7', enabled: true },
      { target: 'json', path: 'accessToken', op: 'exists', value: '', enabled: true },
      { target: 'json', path: 'user.roles', op: 'contains', value: 'dev', enabled: true },
      { target: 'json', path: 'nope', op: 'exists', value: '', enabled: true },
    ]);
    expect(r.map((c) => c.pass)).toEqual([true, true, true, false]);
    expect(r[3]).toMatchObject({ actual: '(not found)' });
  });
  it('응답 시간과 헤더, 본문 포함', () => {
    const r = run([
      { target: 'time', path: '', op: 'lt', value: '500', enabled: true },
      { target: 'header', path: 'content-type', op: 'contains', value: 'json', enabled: true },
      { target: 'body', path: '', op: 'contains', value: 'tok-1', enabled: true },
      { target: 'time', path: '', op: 'lt', value: '100', enabled: true },
    ]);
    expect(r.map((c) => c.pass)).toEqual([true, true, true, false]);
    expect(r[0]?.label).toBe('Response time < 500 ms');
  });
  it('정규식 맞음과 같지 않음', () => {
    const r = run([
      { target: 'json', path: 'accessToken', op: 'matches', value: '^tok-\\d+$', enabled: true },
      { target: 'json', path: 'user.id', op: 'neq', value: '8', enabled: true },
      { target: 'json', path: 'accessToken', op: 'matches', value: '([', enabled: true },
    ]);
    expect(r.map((c) => c.pass)).toEqual([true, true, false]);
    expect(r[2]?.actual).toMatch(/invalid pattern/i);
  });
  it('꺼진 검증은 건너뛴다', () => {
    expect(run([{ target: 'status', path: '', op: 'eq', value: '500', enabled: false }])).toEqual([]);
  });
  it('검증이나 저장 규칙이 하나도 없으면 비었다고 안다', () => {
    expect(AfterRules.of({ captures: [], checks: [] }).isEmpty()).toBe(true);
    expect(AfterRules.of({ captures: [{ name: 'a', from: 'status', path: '', enabled: false }], checks: [] }).isEmpty()).toBe(true);
  });
});
