import { RuleBookDto } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { RecordOpDto } from './record-dto.js';
import { replaceRule, RULE_LIMITS, ruleSizeError, type RuleView } from './rules-form.js';
import { TodoOpDto } from './todo-dto.js';
import { TodoList } from './todo-list.js';

const rule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'r1', text: 'ask before push', bucket: 'ask', scope: { kind: 'global' }, tools: ['Bash'], includes: ['git push'], ...over });

describe('규칙 수정·추가 입력 공격', () => {
  it('정상 규칙은 크기 검사를 통과한다', () => {
    expect(ruleSizeError(rule())).toBeNull();
  });

  it.each([
    ['글이 너무 길다', rule({ text: 'x'.repeat(RULE_LIMITS.text + 1) })],
    ['번호가 너무 길다', rule({ id: 'i'.repeat(RULE_LIMITS.id + 1) })],
    ['찾을 글이 너무 많다', rule({ includes: Array.from({ length: RULE_LIMITS.items + 1 }, (_, i) => `a${i}`) })],
    ['찾을 글 하나가 너무 길다', rule({ includes: ['y'.repeat(RULE_LIMITS.item + 1)] })],
    ['도구 이름이 너무 많다', rule({ tools: Array.from({ length: RULE_LIMITS.items + 1 }, () => 'Bash') })],
    ['경로가 너무 길다', rule({ scope: { kind: 'folder', path: 'p'.repeat(RULE_LIMITS.path + 1) } })],
    ['객체가 아니다', 'rule'],
    ['null', null],
    ['배열', [rule()]],
  ])('크기 상한을 넘으면 거절한다: %s', (_n, input) => {
    expect(ruleSizeError(input)).not.toBeNull();
  });

  const current = RuleBookDto.from({ rules: [rule()] }).toJSON().rules as readonly RuleView[];

  it('고칠 규칙이 없으면(지웠거나 번호를 바꿔 보내면) 아무것도 바꾸지 않는다', () => {
    expect(replaceRule(current, rule({ id: 'nope' }) as unknown as RuleView)).toBeNull();
    expect(replaceRule(current, rule({ id: 'R1' }) as unknown as RuleView)).toBeNull();
  });

  it('타입을 속인 규칙은 목록 검증(RuleBookDto)이 거절한다', () => {
    const bad: unknown[] = [rule({ text: 5 }), rule({ bucket: 'everything' }), rule({ scope: { kind: 'folder' } }), rule({ scope: { kind: 'folder', path: '  ' } }), rule({ scope: 'global' }), rule({ id: 7 }), rule({ bucket: 'allow', includes: [] }), rule({ bucket: 'allow', includes: ['', '  '] }), rule({ text: '   ' })];
    for (const b of bad) expect(() => RuleBookDto.from({ rules: [b] }).toEntity(), JSON.stringify(b)).toThrow();
  });

  it('도구·찾을 글 목록에 섞인 숫자·객체는 버려지고 __proto__ 키는 영향이 없다', () => {
    const parsed = JSON.parse('{"id":"r2","text":"t","bucket":"ask","scope":{"kind":"global"},"tools":["Bash",1,{},null],"includes":["a",2],"__proto__":{"polluted":1}}') as unknown;
    const json = RuleBookDto.from({ rules: [parsed] }).toEntity();
    expect(json.rules[0]!.match.tools).toEqual(['Bash']);
    expect(json.rules[0]!.match.includes).toEqual(['a']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('같은 번호의 규칙을 두 번 추가하면 거절한다', () => {
    expect(() => RuleBookDto.from({ rules: [rule(), rule()] }).toEntity()).toThrow();
  });
});

describe('기록 일괄 삭제 입력 공격', () => {
  it('지우기 요청은 문자열 번호만 받는다', () => {
    for (const bad of [null, undefined, 1, 'remove', [], {}, { kind: 'remove' }, { kind: 'remove', id: 1 }, { kind: 'remove', id: null }, { kind: 'remove', id: ['a'] }, { kind: 'remove', id: {} }, { kind: 'removeAll' }, { kind: ['remove'], id: 'a' }]) {
      expect(() => RecordOpDto.from(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => RecordOpDto.from({ kind: 'remove', id: 'abc' })).not.toThrow();
  });
});

describe('할 일 라벨 삭제 입력 공격', () => {
  it('이름이 문자열이 아니면 거절한다', () => {
    for (const name of [undefined, null, 1, {}, [], ['a'], true]) {
      expect(() => TodoOpDto.from({ kind: 'label-remove', name }), String(name)).toThrow();
    }
  });
  it('이름이 비거나 공백뿐이어도 DTO는 받지만 도메인이 거절한다(전부 지우는 일이 없다)', () => {
    for (const name of ['', '   ', '\t\n']) {
      const dto = TodoOpDto.from({ kind: 'label-remove', name });
      expect(dto).toBeTruthy();
    }
  });
});

describe('할 일 라벨 삭제 도메인 규칙', () => {
  const at = '2026-11-11T00:00:00.000Z';
  const board = (): TodoList => TodoList.empty().add({ title: 'a', labels: [{ name: 'Bug', color: 'red' }, { name: 'keep', color: 'blue' }] }, () => 'c1', at).add({ title: 'b', labels: [{ name: 'bug', color: 'red' }] }, () => 'c2', at);

  it('빈 이름·공백뿐인 이름으로는 아무것도 지우지 않고 거절한다', () => {
    for (const name of ['', '   ', '\t\n']) expect(() => TodoOpDto.from({ kind: 'label-remove', name }).applyTo(board(), () => 'x', at), JSON.stringify(name)).toThrow();
  });

  it('이름이 같은 라벨만(대소문자 무시) 모든 카드에서 빠지고 카드와 다른 라벨은 남는다', () => {
    const next = TodoOpDto.from({ kind: 'label-remove', name: ' BUG ' }).applyTo(board(), () => 'x', at);
    expect(next.items.length).toBe(2);
    expect(next.items.flatMap((t) => t.labels.map((l) => l.name))).toEqual(['keep']);
  });

  it('없는 이름·__proto__ 같은 이름은 아무것도 바꾸지 않는다', () => {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) {
      const next = TodoOpDto.from({ kind: 'label-remove', name }).applyTo(board(), () => 'x', at);
      expect(next.items.flatMap((t) => t.labels.map((l) => l.name)).length).toBe(3);
    }
  });
});
