/** 편집기에 여는 파일 크기 상한. 넘으면 열지 않는다(화면이 굳고, 저장하다 망가지기 쉽다). */
export const MAX_OPEN_BYTES = 1024 * 1024;

/** 바이너리인지 볼 앞부분 길이 */
const SNIFF_BYTES = 8000;

export type Eol = 'lf' | 'crlf';

/** 저장할 때 되살릴 파일 모양. 편집기 안에서는 줄 바꿈을 \n 하나로 다룬다. */
export interface TextFormat {
  readonly bom: boolean;
  readonly eol: Eol;
  /** 줄 끝이 CRLF·LF로 섞여 있었다. 저장하면 하나로 통일된다. */
  readonly mixedEol: boolean;
}

export type Decoded = { readonly ok: true; readonly text: string; readonly format: TextFormat } | { readonly ok: false; readonly reason: 'binary' | 'encoding' };

const BOM = [0xef, 0xbb, 0xbf] as const;

const hasBom = (bytes: Uint8Array): boolean => BOM.every((b, i) => bytes[i] === b);

/**
 * 파일 바이트를 편집기 글자로 바꾼다.
 * - 앞부분에 NUL이 있으면 바이너리, UTF-8로 읽히지 않으면 "다른 인코딩"이라 연다고 하지 않는다(저장하면 글자가 깨진다).
 * - BOM과 줄 끝(CRLF/LF)은 따로 적어 두었다가 저장할 때 되살린다.
 */
export function decodeFile(bytes: Uint8Array): Decoded {
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { ok: false, reason: 'binary' };
  const bom = hasBom(bytes);
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  } catch {
    return { ok: false, reason: 'encoding' };
  }
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const loneCr = /\r(?!\n)/.test(raw);
  const eol: Eol = crlf > lf ? 'crlf' : 'lf';
  const mixedEol = (crlf > 0 && lf > 0) || loneCr;
  return { ok: true, text: raw.replace(/\r\n?/g, '\n'), format: { bom, eol, mixedEol } };
}

/** 편집기 글자를 디스크에 쓸 바이트로 되돌린다(decodeFile의 반대). */
export function encodeFile(text: string, format: Pick<TextFormat, 'bom' | 'eol'>): Uint8Array {
  const body = new TextEncoder().encode(format.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text);
  if (!format.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(BOM, 0);
  out.set(body, 3);
  return out;
}
