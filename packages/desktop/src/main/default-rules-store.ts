import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DefaultRuleSet, DefaultRulesDto, DomainError } from '@rauha/core';
import type { DefaultRuleOp } from '../shared/ipc.js';

/** 끈·고친 기본 규칙을 JSON 파일 하나에 둔다(이 PC에만). 없거나 깨진 파일은 기본 규칙으로 연다. */
export class DefaultRulesStore {
  constructor(private readonly file: string) {}

  async load(): Promise<DefaultRuleSet> {
    try {
      return DefaultRulesDto.from(JSON.parse(await readFile(this.file, 'utf8'))).toEntity();
    } catch {
      return DefaultRuleSet.initial();
    }
  }

  async save(set: DefaultRuleSet): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(DefaultRulesDto.fromEntity(set), null, 2), 'utf8');
  }
}

/** 화면에서 온 일(바깥 입력)을 기본 규칙 상태에 적용한다. 규칙에 어긋나면 이유를 돌려주고 바꾸지 않는다. */
export function applyDefaultRuleOp(set: DefaultRuleSet, op: unknown): { readonly ok: true; readonly set: DefaultRuleSet } | { readonly ok: false; readonly error: string } {
  try {
    if (typeof op !== 'object' || op === null) return { ok: false, error: '알 수 없는 요청이에요.' };
    const o = op as DefaultRuleOp;
    switch (o.kind) {
      case 'toggle':
        return { ok: true, set: set.setEnabled(String(o.id), o.enabled === true) };
      case 'edit':
        return { ok: true, set: set.edit(String(o.id), { text: String(o.text), variants: DefaultRulesDto.from({ edits: [{ id: o.id, text: o.text, variants: o.variants }] }).json.edits[0]?.variants ?? [] }) };
      case 'restore':
        return { ok: true, set: set.restoreOne(String(o.id)) };
      case 'restoreAll':
        return { ok: true, set: set.restoreAll() };
      default:
        return { ok: false, error: '알 수 없는 요청이에요.' };
    }
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
