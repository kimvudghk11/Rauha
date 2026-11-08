import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultRuleSet } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { applyDefaultRuleOp, DefaultRulesStore } from './default-rules-store.js';

describe('applyDefaultRuleOp', () => {
  const initial = DefaultRuleSet.initial();

  it('끄기·고치기·되돌리기를 적용한다', () => {
    const off = applyDefaultRuleOp(initial, { kind: 'toggle', id: 'default:unknown', enabled: false });
    expect(off.ok && off.set.disabledIds).toEqual(['default:unknown']);
    const edited = applyDefaultRuleOp(initial, { kind: 'edit', id: 'default:ask-infra', text: '내 글', variants: [{ tools: ['Bash'], includes: ['terraform apply'] }] });
    expect(edited.ok && edited.set.entries().find((e) => e.rule.id === 'default:ask-infra')?.rule.text).toBe('내 글');
    const back = applyDefaultRuleOp(off.ok ? off.set : initial, { kind: 'restoreAll' });
    expect(back.ok && back.set.disabledIds).toEqual([]);
  });

  it('규칙에 어긋나는 고침은 이유를 돌려주고 바꾸지 않는다', () => {
    expect(applyDefaultRuleOp(initial, { kind: 'edit', id: 'default:ask-infra', text: 'x', variants: [] })).toMatchObject({ ok: false });
    expect(applyDefaultRuleOp(initial, { kind: 'toggle', id: 'default:nope', enabled: false })).toMatchObject({ ok: false });
    expect(applyDefaultRuleOp(initial, 'x')).toMatchObject({ ok: false });
  });
});

describe('DefaultRulesStore', () => {
  it('저장했다 읽고, 파일이 없거나 깨지면 기본 규칙으로 연다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rauha-dr-'));
    try {
      const store = new DefaultRulesStore(join(dir, 'd.json'));
      expect((await store.load()).disabledIds).toEqual([]);
      await store.save(DefaultRuleSet.initial().setEnabled('default:unknown', false));
      expect((await store.load()).disabledIds).toEqual(['default:unknown']);
      await writeFile(join(dir, 'd.json'), '{깨짐', 'utf8');
      expect((await store.load()).disabledIds).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
