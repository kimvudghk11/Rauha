import { readFile, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/** 시트 하나: 이름과 줄(칸은 글) */
export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

const MAX_BYTES = 20 * 1024 * 1024;

/** CSV·TSV 한 덩어리 → 줄. 따옴표 안의 쉼표·줄바꿈·"" 을 다룬다. */
export function parseDelimited(text: string, sep: ',' | '\t' = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** zip 의 파일들(이름 → 내용). 저장(0)·deflate(8)만 읽는다(xlsx 는 이 둘만 쓴다). */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // 끝에서 중앙 디렉터리 끝 표시(0x06054b50)를 찾는다
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('zip 파일이 아니에요');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** "B3" → 열 번호 1(0부터) */
function column(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** xlsx(엑셀) → 시트들. 공유 문자열·인라인 문자열·숫자·불을 글로 읽는다(수식은 마지막으로 계산된 값). */
export function parseXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const targetOf = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: decode(m[1]!), target: targetOf.get(m[2]!) ?? '' }));
  return sheets.map(({ name, target }) => {
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = text(path);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
        const inner = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const value = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decode(v ?? '');
        const at = ref === '' ? row.length : column(ref);
        while (row.length < at) row.push('');
        row[at] = value;
      }
      rows.push(row);
    }
    return { name, rows };
  });
}

/** 파일 확장자로 CSV·TSV·XLSX 를 읽는다. 너무 크거나 모르는 형식이면 던진다. */
export async function readSpreadsheet(path: string): Promise<Sheet[]> {
  const info = await stat(path);
  if (info.size > MAX_BYTES) throw new Error(`파일이 너무 커요(${Math.round(info.size / 1e6)}MB, 20MB 까지)`);
  const lower = path.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return parseXlsx(await readFile(path));
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const text = await readFile(path, 'utf8');
    const name = path.split(/[\\/]/).pop() ?? path;
    return [{ name, rows: parseDelimited(text, lower.endsWith('.tsv') || (!text.includes(',') && text.includes('\t')) ? '\t' : ',') }];
  }
  throw new Error('읽을 수 있는 형식은 .csv·.tsv·.xlsx 예요(.xls 는 엑셀에서 .xlsx 로 저장해 주세요)');
}
