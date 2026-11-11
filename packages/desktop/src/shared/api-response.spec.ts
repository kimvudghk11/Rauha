import { describe, expect, it } from 'vitest';
import { ApiRequest } from './api-request.js';
import { checkTarget, explainNetworkError } from './api-guard.js';
import { maskHeaderValue, hideSecrets } from './api-redact.js';
import { ApiHistory, RESPONSE_LIMITS, ResponseSummary, type HistoryEntry, type ResponseSummaryProps } from './api-response.js';

const FAKE = ['tok', 'en', '-zz', '9999'].join('');
const sum = (o: Partial<ResponseSummaryProps> = {}): ResponseSummary =>
  ResponseSummary.create({ status: 200, statusText: 'OK', ms: 12, size: 10, headers: [['content-type', 'application/json']], body: '{"a":1}', truncated: false, contentType: 'application/json', redirects: [], binary: false, ...o });

describe('응답 요약', () => {
  it('상태 번호로 색 종류를 정한다', () => {
    expect([100, 204, 302, 404, 503].map((s) => sum({ status: s }).statusClass())).toEqual(['info', 'ok', 'redirect', 'client', 'server']);
  });
  it('JSON 본문은 들여쓰기해서 보이고, 깨진 JSON은 그대로 둔다', () => {
    expect(sum().prettyBody()).toBe('{\n  "a": 1\n}');
    expect(sum({ body: '{"a":' }).prettyBody()).toBe('{"a":');
  });
  it('화면에 싣는 본문은 글자 수 상한에서 잘리고 잘렸다고 표시한다', () => {
    const big = sum({ body: 'x'.repeat(RESPONSE_LIMITS.show + 5) });
    expect(big.props.body).toHaveLength(RESPONSE_LIMITS.show);
    expect(big.props.truncated).toBe(true);
  });
  it('복사용으로 가리면 Set-Cookie·Authorization 값과 아는 비밀이 사라진다', () => {
    const r = sum({ headers: [['Set-Cookie', 'sid=abc123; Path=/; HttpOnly'], ['Authorization', `Bearer ${FAKE}`], ['Content-Type', 'text/plain']], body: `echo ${FAKE}` }).masked([FAKE]);
    const all = JSON.stringify(r.props);
    expect(all).not.toContain('abc123');
    expect(all).not.toContain(FAKE);
    expect(r.props.headers[0]?.[1]).toBe('sid=[hidden]; Path=/; HttpOnly');
    expect(r.props.headers[2]?.[1]).toBe('text/plain');
  });
  it('기록용은 본문을 기록 상한으로 줄인다', () => {
    const r = sum({ body: 'y'.repeat(RESPONSE_LIMITS.history + 100) }).forHistory([]);
    expect(r.props.body).toHaveLength(RESPONSE_LIMITS.history);
    expect(r.props.truncated).toBe(true);
  });
  it('크기를 읽기 쉬운 글로 바꾼다', () => {
    expect([512, 2048, 5 * 1024 * 1024].map(ResponseSummary.sizeText)).toEqual(['512 B', '2.0 KB', '5.0 MB']);
  });
});

describe('헤더 가림', () => {
  it('Bearer 접두사는 남기고 값만 가린다', () => expect(maskHeaderValue('authorization', `Bearer ${FAKE}`)).toBe('Bearer [hidden]'));
  it('이름에 token·secret이 든 헤더도 가린다', () => expect(maskHeaderValue('X-Refresh-Token', 'abcdef')).toBe('[hidden]'));
  it('평범한 헤더는 그대로다', () => expect(maskHeaderValue('Accept', '*/*')).toBe('*/*'));
  it('글 안의 아는 비밀 값을 지운다', () => expect(hideSecrets(`a ${FAKE} b`, [FAKE])).toBe('a [hidden] b'));
});

describe('기록 상한', () => {
  const entry = (i: number): HistoryEntry => ({ id: `h${i}`, at: '2026-01-01T00:00:00Z', request: ApiRequest.create({ id: `r${i}` }).props, status: 200, ms: 1, size: 1, error: null, response: null });
  it('최근 100개만 남기고 새 것이 앞에 온다', () => {
    let h = ApiHistory.empty();
    for (let i = 0; i < 130; i++) h = h.add(entry(i));
    expect(h.entries).toHaveLength(100);
    expect(h.entries[0]?.id).toBe('h129');
    expect(h.entries[99]?.id).toBe('h30');
  });
  it('없는 기록을 지우려면 오류, clear는 모두 지운다', () => {
    expect(() => ApiHistory.empty().remove('x')).toThrow();
    expect(ApiHistory.empty().add(entry(1)).clear().entries).toHaveLength(0);
  });
});

describe('보내도 되는 주소', () => {
  it('http와 https는 된다(localhost·사설 주소 포함)', () => {
    for (const u of ['http://localhost:3000/a', 'https://example.com', 'http://192.168.0.5/x', 'http://10.1.2.3', 'http://172.20.0.1:8080']) expect(checkTarget(u).ok).toBe(true);
  });
  it('file:·ftp:·data:·javascript: 등은 거부한다', () => {
    for (const u of ['file:///etc/passwd', 'ftp://x/y', 'data:text/plain,hi', 'javascript:alert(1)', 'FILE://C:/x']) expect(checkTarget(u).ok).toBe(false);
  });
  it('프로토콜 없는 주소는 이유를 알려 준다', () => {
    const r = checkTarget('localhost:3000/a');
    expect(r.ok === false && r.error).toContain('http://');
  });
  it('인증서 오류는 이유를 설명한다', () => {
    expect(explainNetworkError('DEPTH_ZERO_SELF_SIGNED_CERT', 'x')).toContain('self-signed');
    expect(explainNetworkError('CERT_HAS_EXPIRED', 'x')).toContain('expired');
    expect(explainNetworkError(undefined, 'boom')).toBe('boom');
  });
});
