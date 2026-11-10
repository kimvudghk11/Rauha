import type { RuleBucket } from '@rauha/core/jobs';

/** 화면 한 줄(JSON)로 오가는 규칙. RuleBookDto의 한 항목과 같은 모양이다. */
export interface RuleView {
  readonly id: string;
  readonly text: string;
  readonly bucket: RuleBucket;
  readonly scope: { readonly kind: 'global' } | { readonly kind: 'workspace' | 'folder'; readonly path: string };
  readonly tools: readonly string[];
  readonly includes: readonly string[];
}

export interface RuleForm {
  readonly text: string;
  readonly bucket: RuleBucket;
  readonly scope: 'global' | 'workspace' | 'folder';
  /** 범위가 작업 폴더·폴더일 때의 경로 */
  readonly path: string;
  /** 쉼표로 나눈 "찾을 글" */
  readonly includes: string;
  /** 비면 모든 도구 */
  readonly tool: string;
}

export type FormResult = { readonly ok: true; readonly rule: RuleView } | { readonly ok: false; readonly error: string };

/** 입력 칸의 글 → 규칙. 빠진 칸은 사용자가 고칠 수 있게 어느 칸인지 한국어로 알린다. 규칙의 깊은 검증은 core의 Rule이 한다. */
export function ruleFromForm(form: RuleForm, newId: () => string): FormResult {
  const text = form.text.trim();
  if (text === '') return { ok: false, error: '규칙을 한 줄로 적어 주세요.' };
  const includes = form.includes.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (form.bucket !== 'always' && includes.length === 0) return { ok: false, error: '"찾을 글"을 적어 주세요. 명령이나 경로에 이 글이 들어 있으면 이 규칙이 적용돼요. 예: git push, terraform apply' };
  if (form.scope !== 'global' && form.path.trim() === '') return { ok: false, error: '범위가 폴더이면 폴더 경로를 적어 주세요.' };
  const scope = form.scope === 'global' ? ({ kind: 'global' } as const) : ({ kind: form.scope, path: form.path.trim() } as const);
  return { ok: true, rule: { id: newId(), text, bucket: form.bucket, scope, tools: form.tool === '' ? [] : [form.tool], includes: form.bucket === 'always' ? [] : includes } };
}

/** 규칙 → 고치는 칸 값(ruleFromForm의 반대). 제자리에서 고칠 때 칸을 미리 채운다. */
export function ruleToForm(rule: RuleView): RuleForm {
  return {
    text: rule.text,
    bucket: rule.bucket,
    scope: rule.scope.kind,
    path: rule.scope.kind === 'global' ? '' : rule.scope.path,
    includes: rule.includes.join(', '),
    tool: rule.tools[0] ?? '',
  };
}

/** 같은 번호의 규칙을 그 자리에서 바꾼 목록. 그 번호가 없으면(그 사이에 지웠으면) null. */
export function replaceRule(rules: readonly RuleView[], next: RuleView): RuleView[] | null {
  if (!rules.some((r) => r.id === next.id)) return null;
  return rules.map((r) => (r.id === next.id ? next : r));
}
