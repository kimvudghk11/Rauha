import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDelimited, parseXlsx, readSpreadsheet } from './spreadsheet.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 시험용 zip: 파일마다 deflate(8) 또는 저장(0). CRC 는 읽는 쪽이 보지 않아 0 으로 둔다. */
function zip(files: Record<string, string>, method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const XLSX = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="10월 비용" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>항목</t></si><si><t>금액</t></si><si><t>AWS &amp; 도메인</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>123456</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>메모</t></is></c><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>',
};

describe('스프레드시트 읽기(회계·클라우드 비용 팀원)', () => {
  it('CSV: 따옴표 안의 쉼표·줄바꿈·"" 와 BOM 을 다룬다', () => {
    expect(parseDelimited('﻿항목,금액\n"서버, 도메인",12000\n"메모 ""중요""\n둘째 줄",3\n')).toEqual([
      ['항목', '금액'],
      ['서버, 도메인', '12000'],
      ['메모 "중요"\n둘째 줄', '3'],
    ]);
  });

  it('XLSX: 시트 이름과 공유·인라인 문자열·숫자·불, 비어 있는 칸 자리까지 읽는다(deflate·저장 모두)', () => {
    for (const method of [8, 0] as const) {
      const [sheet] = parseXlsx(zip(XLSX, method));
      expect(sheet).toEqual({ name: '10월 비용', rows: [['항목', '금액'], ['AWS & 도메인', '', '123456'], ['메모', 'TRUE']] });
    }
  });

  it('확장자로 형식을 고르고, 모르는 형식은 알려 준다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-sheet-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'cost.tsv'), 'a\tb\n1\t2\n');
    writeFileSync(join(dir, 'book.xlsx'), zip(XLSX));
    writeFileSync(join(dir, 'old.xls'), 'x');
    expect((await readSpreadsheet(join(dir, 'cost.tsv')))[0]!.rows).toEqual([['a', 'b'], ['1', '2']]);
    expect((await readSpreadsheet(join(dir, 'book.xlsx')))[0]!.name).toBe('10월 비용');
    await expect(readSpreadsheet(join(dir, 'old.xls'))).rejects.toThrow('.xlsx');
  });
});
