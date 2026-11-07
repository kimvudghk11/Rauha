import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Rule, RuleBook } from '../domain/rule-book.js';
import { FileRuleStore } from './file-rule-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-rules-'));
  dirs.push(d);
  return join(d, 'sub', 'rules.json');
};

describe('FileRuleStore', () => {
  it('파일이 없으면 빈 규칙이다', async () => {
    expect((await new FileRuleStore(file()).load()).rules).toEqual([]);
  });

  it('저장한 규칙을 다시 읽는다', async () => {
    const store = new FileRuleStore(file());
    await store.save(RuleBook.of([Rule.create({ id: 'a', text: '답은 한국어로', bucket: 'always', scope: { kind: 'global' }, match: { tools: [], includes: [] } })]));
    expect((await store.load()).alwaysTexts('C:/x')).toEqual(['답은 한국어로']);
  });

  it('깨진 파일은 빈 규칙으로 덮지 않고 오류로 알린다', async () => {
    const path = file();
    const store = new FileRuleStore(path);
    await store.save(RuleBook.empty());
    writeFileSync(path, '{ 깨짐');
    await expect(store.load()).rejects.toThrow();
  });
});
