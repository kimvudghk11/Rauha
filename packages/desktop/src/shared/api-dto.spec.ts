import { describe, expect, it } from 'vitest';
import { ApiRequestDto } from './api-dto.js';

const base = { id: 'r1', name: 'x', method: 'POST', url: 'http://x/:id' };

describe('ApiRequestDto — 새 칸들', () => {
  it('경로 변수·multipart·응답 뒤 규칙을 읽는다', () => {
    const j = ApiRequestDto.from({
      ...base,
      pathVars: [{ key: 'id', value: '1' }],
      body: { kind: 'multipart', parts: [{ key: 'f', value: 'C:/a.png', file: true }, { key: 't', value: 'hi' }] },
      after: { captures: [{ name: 'token', from: 'json', path: '$.token' }], checks: [{ target: 'status', op: 'eq', value: '200' }] },
    }).json;
    expect(j.pathVars).toEqual([{ key: 'id', value: '1', enabled: true }]);
    expect(j.body).toEqual({ kind: 'multipart', parts: [{ key: 'f', value: 'C:/a.png', enabled: true, file: true }, { key: 't', value: 'hi', enabled: true, file: false }] });
    expect(j.after).toEqual({ captures: [{ name: 'token', from: 'json', path: '$.token', enabled: true }], checks: [{ target: 'status', path: '', op: 'eq', value: '200', enabled: true }] });
  });
  it('옛 저장 파일(새 칸 없음)도 그대로 읽힌다', () => {
    const j = ApiRequestDto.from(base).json;
    expect(j.pathVars).toEqual([]);
    expect(j.after).toEqual({ captures: [], checks: [] });
  });
  it('모르는 출처·대상·비교는 거절한다', () => {
    expect(() => ApiRequestDto.from({ ...base, after: { captures: [{ name: 'a', from: 'cookie', path: '' }] } })).toThrow(/json, header, status or body/);
    expect(() => ApiRequestDto.from({ ...base, after: { checks: [{ target: 'status', op: 'approx', value: '1' }] } })).toThrow(/eq, neq/);
  });
  it('규칙은 칸마다 최대 50줄', () => {
    const many = Array.from({ length: 51 }, () => ({ target: 'status', op: 'eq', value: '200' }));
    expect(() => ApiRequestDto.from({ ...base, after: { checks: many } })).toThrow(/at most 50/);
  });
});
