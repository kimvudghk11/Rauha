import { describe, expect, it } from 'vitest';
import { ruleFromForm, type RuleForm } from './rules-form.js';

const form = (over: Partial<RuleForm> = {}): RuleForm => ({ text: 'git push는 묻지 마', bucket: 'allow', scope: 'global', path: '', includes: 'git push', tool: 'Bash', ...over });
const id = () => 'new-id';

describe('ruleFromForm', () => {
  it('쉼표로 나눈 찾을 글과 도구를 규칙으로 바꾼다', () => {
    const r = ruleFromForm(form({ includes: ' git push , origin ' }), id);
    expect(r).toEqual({ ok: true, rule: { id: 'new-id', text: 'git push는 묻지 마', bucket: 'allow', scope: { kind: 'global' }, tools: ['Bash'], includes: ['git push', 'origin'] } });
  });

  it('글이 비면 어느 칸인지 알린다', () => {
    expect(ruleFromForm(form({ text: ' ' }), id)).toMatchObject({ ok: false, error: expect.stringContaining('한 줄') });
  });

  it('묻지 않음·허락 규칙은 찾을 글이 없으면 거절한다', () => {
    expect(ruleFromForm(form({ includes: ' , ' }), id)).toMatchObject({ ok: false, error: expect.stringContaining('찾을 글') });
  });

  it('항상 지킬 것은 찾을 글 없이도 되고 조건은 비운다', () => {
    const r = ruleFromForm(form({ bucket: 'always', includes: 'x', tool: 'Bash' }), id);
    expect(r).toMatchObject({ ok: true, rule: { includes: [] } });
  });

  it('폴더 범위인데 경로가 없으면 거절하고, 있으면 그 폴더 범위가 된다', () => {
    expect(ruleFromForm(form({ scope: 'folder', path: ' ' }), id)).toMatchObject({ ok: false });
    expect(ruleFromForm(form({ scope: 'folder', path: ' C:/work/a ' }), id)).toMatchObject({ ok: true, rule: { scope: { kind: 'folder', path: 'C:/work/a' } } });
  });

  it('도구를 고르지 않으면 모든 도구에 적용한다', () => {
    expect(ruleFromForm(form({ tool: '' }), id)).toMatchObject({ ok: true, rule: { tools: [] } });
  });
});
