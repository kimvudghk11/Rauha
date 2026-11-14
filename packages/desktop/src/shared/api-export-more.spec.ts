import { describe, expect, it } from 'vitest';
import { parseCurl, toCurl } from './api-curl.js';
import { toHttpFile } from './api-http-file.js';
import { ApiRequest } from './api-request.js';

const upload = ApiRequest.create({
  id: 'u1',
  name: 'Upload',
  method: 'POST',
  url: '{{base_url}}/users/:id/avatar',
  pathVars: [{ key: 'id', value: '7', enabled: true }],
  body: { kind: 'multipart', parts: [{ key: 'title', value: 'me', enabled: true, file: false }, { key: 'file', value: 'C:/pics/me.png', enabled: true, file: true }] },
});

describe('내보내기·가져오기 — multipart 와 경로 변수', () => {
  it('cURL 은 경로 변수를 채우고 multipart 는 -F 로 쓴다(파일은 @경로)', () => {
    const c = toCurl(upload);
    expect(c).toContain("'{{base_url}}/users/7/avatar'");
    expect(c).toContain("-F 'title=me'");
    expect(c).toContain("-F 'file=@C:/pics/me.png'");
  });
  it('cURL 의 -F 는 multipart 로 들어오고 @경로는 파일 필드가 된다', () => {
    const r = parseCurl(`curl -X POST http://x/upload -F 'title=hello' -F 'doc=@/tmp/a b.pdf;type=application/pdf'`, 'n1');
    expect(r.props.body).toEqual({ kind: 'multipart', parts: [{ key: 'title', value: 'hello', enabled: true, file: false }, { key: 'doc', value: '/tmp/a b.pdf', enabled: true, file: true }] });
  });
  it('.http 는 REST Client 의 multipart 모양으로 쓰고 파일은 "< 경로"', () => {
    const t = toHttpFile([upload]);
    expect(t).toContain('POST {{base_url}}/users/7/avatar HTTP/1.1');
    expect(t).toContain('Content-Type: multipart/form-data; boundary=rauha-boundary');
    expect(t).toContain('Content-Disposition: form-data; name="file"; filename="me.png"');
    expect(t).toContain('< C:/pics/me.png');
  });
});
