import { bodyFrom, liftAuth, splitQuery } from './api-curl.js';
import { API_METHODS, ApiError, ApiRequest, type ApiMethod, type KeyValue } from './api-request.js';

/**
 * `.http` 파일(VS Code REST Client 형식) 읽기·쓰기.
 *   ### 이름
 *   GET https://host/path?x=1 HTTP/1.1
 *   Header: value
 *
 *   본문
 * `@name = value` 줄은 파일 변수로 읽는다. 쓸 때 비밀 값은 `{{이름}}`으로 바꿔 저장소에 비밀이 들어가지 않게 한다.
 */
export interface HttpFileContent {
  readonly requests: readonly ApiRequest[];
  /** `@name = value` 파일 변수 */
  readonly variables: readonly { readonly name: string; readonly value: string }[];
}

const MAX_REQUESTS = 500;

export function parseHttpFile(text: string, newId: () => string): HttpFileContent {
  const variables: { name: string; value: string }[] = [];
  const requests: ApiRequest[] = [];
  const blocks: { name: string; lines: string[] }[] = [{ name: '', lines: [] }];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^###/.test(raw)) blocks.push({ name: raw.replace(/^#{3,}\s*/, '').trim(), lines: [] });
    else (blocks[blocks.length - 1] as { lines: string[] }).lines.push(raw);
  }
  for (const block of blocks) {
    const lines = block.lines;
    let i = 0;
    let name = block.name;
    // 요청 줄 앞: 빈 줄, 주석, @변수
    for (; i < lines.length; i++) {
      const l = (lines[i] as string).trim();
      if (l === '') continue;
      const v = /^@([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(l);
      if (v !== null) {
        variables.push({ name: v[1] as string, value: (v[2] as string).trim() });
        continue;
      }
      const meta = /^(?:#|\/\/)\s*@name\s+(.+)$/.exec(l);
      if (meta !== null) {
        name = (meta[1] as string).trim();
        continue;
      }
      if (l.startsWith('#') || l.startsWith('//')) continue;
      break;
    }
    if (i >= lines.length) continue;
    const first = (lines[i++] as string).trim();
    const m = /^(?:([A-Za-z]+)\s+)?(\S+)(?:\s+HTTP\/[\d.]+)?$/.exec(first);
    if (m === null) throw new ApiError(`Cannot read the request line: ${first.slice(0, 60)}`);
    const method = (m[1] ?? 'GET').toUpperCase();
    if (!API_METHODS.includes(method as ApiMethod)) throw new ApiError(`The method ${method} is not supported.`);
    let url = m[2] as string;
    // 줄을 바꿔 이어 쓴 쿼리(?a=1 / &b=2)
    for (; i < lines.length; i++) {
      const l = (lines[i] as string).trim();
      if (l.startsWith('?') || l.startsWith('&')) url += l;
      else break;
    }
    const headers: KeyValue[] = [];
    for (; i < lines.length; i++) {
      const l = lines[i] as string;
      if (l.trim() === '') {
        i++;
        break;
      }
      if (l.trim().startsWith('#') || l.trim().startsWith('//')) continue;
      const c = l.indexOf(':');
      if (c > 0) headers.push({ key: l.slice(0, c).trim(), value: l.slice(c + 1).trim(), enabled: true });
    }
    const bodyLines = lines.slice(i);
    while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] as string).trim() === '') bodyLines.pop();
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
    const body = method === 'GET' || method === 'HEAD' ? ({ kind: 'none' } as const) : bodyFrom(bodyLines.join('\n'), ct);
    const sp = splitQuery(url);
    const lifted = liftAuth(headers);
    if (requests.length >= MAX_REQUESTS) throw new ApiError(`At most ${MAX_REQUESTS} requests can be read from one file.`);
    requests.push(ApiRequest.create({ id: newId(), name: name === '' ? `${method} ${sp.url.slice(0, 40)}` : name, method: method as ApiMethod, url: sp.url, query: sp.query, headers: lifted.headers, body, auth: lifted.auth }));
  }
  if (requests.length === 0) throw new ApiError('No request found in that .http file.');
  return { requests, variables };
}

const fieldLine = (s: string): string => s.replace(/[\r\n]+/g, ' ');

/** 요청 목록을 `.http` 글로. 비밀 값은 `{{이름}}`으로 바뀌어 쓰인다. */
export function toHttpFile(requests: readonly ApiRequest[]): string {
  const out: string[] = [];
  for (const r of requests) {
    const safe = r.withSecretsAsVariables().request;
    const p = safe.props;
    const qs = p.query.filter((q) => q.enabled && q.key !== '');
    let url = safe.urlWithPathVars();
    if (qs.length > 0) url += `${url.includes('?') ? '&' : '?'}${qs.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}')}`).join('&')}`;
    if (p.auth.kind === 'apikey' && p.auth.in === 'query') url += `${url.includes('?') ? '&' : '?'}${p.auth.name}=${p.auth.value}`;
    const block = [`### ${fieldLine(p.name)}`, `${p.method} ${fieldLine(url)} HTTP/1.1`];
    for (const h of p.headers) if (h.enabled && h.key !== '') block.push(`${fieldLine(h.key)}: ${fieldLine(h.value)}`);
    const a = p.auth;
    if (a.kind === 'bearer') block.push(`Authorization: Bearer ${fieldLine(a.token)}`);
    else if (a.kind === 'basic') block.push(`Authorization: Basic ${fieldLine(a.username)} ${fieldLine(a.password)}`);
    else if (a.kind === 'apikey' && a.in === 'header') block.push(`${fieldLine(a.name)}: ${fieldLine(a.value)}`);
    const b = p.body;
    if (b.kind === 'json' && !p.headers.some((h) => h.key.toLowerCase() === 'content-type')) block.push('Content-Type: application/json');
    if (b.kind === 'form' && !p.headers.some((h) => h.key.toLowerCase() === 'content-type')) block.push('Content-Type: application/x-www-form-urlencoded');
    if (b.kind === 'json' || b.kind === 'raw') block.push('', b.text);
    else if (b.kind === 'form') block.push('', b.fields.filter((f) => f.enabled && f.key !== '').map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}')}`).join('&'));
    else if (b.kind === 'multipart') {
      // JetBrains·VS Code REST Client 의 multipart 모양: 파일은 "< 경로"
      const boundary = 'rauha-boundary';
      block.push(`Content-Type: multipart/form-data; boundary=${boundary}`, '');
      for (const f of b.parts.filter((x) => x.enabled && x.key !== '')) {
        const name = fieldLine(f.key).replace(/"/g, '');
        block.push(`--${boundary}`, f.file ? `Content-Disposition: form-data; name="${name}"; filename="${fieldLine(f.value.split(/[\\/]/).pop() ?? 'file')}"` : `Content-Disposition: form-data; name="${name}"`, '', f.file ? `< ${fieldLine(f.value)}` : fieldLine(f.value));
      }
      block.push(`--${boundary}--`);
    }
    out.push(block.join('\n'));
  }
  return `${out.join('\n\n')}\n`;
}
