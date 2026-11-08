import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile } from './code-text.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('파일 바이트 → 편집기 글자', () => {
  it('UTF-8 글을 그대로 읽는다', () => {
    const r = decodeFile(bytes('안녕\nabc'));
    expect(r).toEqual({ ok: true, text: '안녕\nabc', format: { bom: false, eol: 'lf', mixedEol: false } });
  });

  it('CRLF 파일은 편집기에서 \\n 하나로 다루고 CRLF였다고 기억한다', () => {
    const r = decodeFile(bytes('a\r\nb\r\n'));
    expect(r).toMatchObject({ ok: true, text: 'a\nb\n', format: { eol: 'crlf', mixedEol: false } });
  });

  it('BOM을 떼고 기억한다', () => {
    const r = decodeFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect(r).toMatchObject({ ok: true, text: 'a', format: { bom: true } });
  });

  it('CRLF와 LF가 섞이면 많은 쪽으로 보고 섞였다고 알린다', () => {
    const r = decodeFile(bytes('a\r\nb\r\nc\nd'));
    expect(r).toMatchObject({ ok: true, format: { eol: 'crlf', mixedEol: true } });
  });

  it('앞부분에 NUL이 있으면 바이너리다', () => {
    expect(decodeFile(new Uint8Array([0x50, 0x4b, 0, 3]))).toEqual({ ok: false, reason: 'binary' });
  });

  it('UTF-8이 아닌 글(깨진 바이트)은 다른 인코딩으로 보고 열지 않는다', () => {
    expect(decodeFile(new Uint8Array([0xb0, 0xa1, 0xb3, 0xaa]))).toEqual({ ok: false, reason: 'encoding' });
  });

  it('빈 파일도 연다', () => {
    expect(decodeFile(new Uint8Array())).toMatchObject({ ok: true, text: '' });
  });
});

describe('편집기 글자 → 파일 바이트', () => {
  it('읽은 모양 그대로 되돌린다: CRLF + BOM', () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('가\r\n나\r\n')]);
    const r = decodeFile(original);
    if (!r.ok) throw new Error('읽기 실패');
    expect([...encodeFile(r.text, r.format)]).toEqual([...original]);
  });

  it('LF 파일은 LF로 쓴다', () => {
    expect(new TextDecoder().decode(encodeFile('a\nb', { bom: false, eol: 'lf' }))).toBe('a\nb');
  });
});
