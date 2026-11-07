import type { RuleBucket } from '@rauha/core/jobs';
import { ruleFromForm, type RuleView } from '../shared/rules-form.js';
import { el } from './dom.js';

const COLUMNS: readonly { bucket: RuleBucket; title: string; hint: string }[] = [
  { bucket: 'always', title: '항상 지킬 것', hint: '팀원 프롬프트에 들어가요.' },
  { bucket: 'allow', title: '묻지 않고 할 것', hint: '이 명령은 허락 없이 진행해요.' },
  { bucket: 'ask', title: '꼭 허락받을 것', hint: '이 명령은 늘 허락을 물어요.' },
];

const SCOPE_LABEL = (r: RuleView): string => (r.scope.kind === 'global' ? '전체' : r.scope.kind === 'workspace' ? `작업 폴더 · ${r.scope.path}` : `폴더 · ${r.scope.path}`);

/**
 * 규칙 탭: 칸 셋(항상 지킬 것 / 묻지 않고 할 것 / 꼭 허락받을 것)과 범위(전체·작업 폴더·폴더).
 * 묻지 않음·허락 규칙은 명령이나 경로에서 찾을 글로 판정한다. 비밀 파일·역할 권한·git push 거절은 규칙보다 앞서 늘 지켜진다.
 */
export function buildRules(api: { list: () => Promise<readonly RuleView[]>; add: (r: RuleView) => ReturnType<Window['rauha']['addRule']>; remove: (id: string) => Promise<readonly RuleView[]> }) {
  const root = el('section', 'rules');
  const head = el('div', 'rhead');
  head.append(el('b', undefined, '규칙'), el('span', 'hint', '내 규칙을 적어 두면 팀원이 따라요. 비밀 파일과 git push 거절은 규칙과 상관없이 늘 지켜져요.'));

  // 입력 폼
  const form = el('form', 'ruleform pane');
  const text = el('input');
  text.placeholder = '규칙을 한 줄로 적어요  예: terraform apply는 qa에서는 묻지 마';
  const bucket = el('select');
  for (const c of COLUMNS) bucket.appendChild(new Option(c.title, c.bucket));
  bucket.value = 'allow';
  const scope = el('select');
  scope.append(new Option('범위: 전체', 'global'), new Option('범위: 작업 폴더', 'workspace'), new Option('범위: 특정 폴더', 'folder'));
  const path = el('input', 'path');
  path.placeholder = '폴더 경로';
  path.hidden = true;
  scope.addEventListener('change', () => (path.hidden = scope.value === 'global'));
  const includes = el('input');
  includes.placeholder = '찾을 글(쉼표로 여러 개)  예: terraform apply, qa';
  const tool = el('select');
  tool.append(new Option('모든 도구', ''), new Option('Bash(명령)', 'Bash'), new Option('Write·Edit(파일)', 'Write'));
  bucket.addEventListener('change', () => ((includes.hidden = bucket.value === 'always'), (tool.hidden = bucket.value === 'always')));
  includes.hidden = false;
  const error = el('div', 'err');
  const add = el('button', 'btn primary', '규칙 더하기');
  add.type = 'submit';
  const row1 = el('div', 'row');
  row1.append(text);
  const row2 = el('div', 'row');
  row2.append(bucket, scope, path, tool, includes, add);
  form.append(row1, row2, error);

  const grid = el('div', 'rcols');
  root.append(head, form, grid);

  function render(rules: readonly RuleView[]): void {
    grid.replaceChildren();
    for (const col of COLUMNS) {
      const pane = el('div', 'pane rcol');
      pane.append(el('div', 'ph', col.title), el('div', 'hint pad', col.hint));
      const mine = rules.filter((r) => r.bucket === col.bucket);
      if (mine.length === 0) pane.appendChild(el('div', 'dim pad', '아직 없어요.'));
      for (const r of mine) {
        const card = el('div', 'rule');
        card.appendChild(el('div', undefined, r.text));
        const meta = el('div', 'meta');
        meta.appendChild(el('span', 'chip', SCOPE_LABEL(r)));
        if (r.includes.length > 0) meta.appendChild(el('span', 'chip', `${r.tools.join('·') || '모든 도구'}: ${r.includes.join(' + ')}`));
        const del = el('button', 'btn sec', '지우기');
        del.addEventListener('click', () => void api.remove(r.id).then(render));
        card.append(meta, del);
        pane.appendChild(card);
      }
      grid.appendChild(pane);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const made = ruleFromForm({ text: text.value, bucket: bucket.value as RuleBucket, scope: scope.value as 'global' | 'workspace' | 'folder', path: path.value, includes: includes.value, tool: tool.value }, () => crypto.randomUUID());
    if (!made.ok) {
      error.textContent = made.error;
      return;
    }
    void api.add(made.rule).then((res) => {
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      error.textContent = '';
      text.value = '';
      includes.value = '';
      render(res.rules);
    });
  });

  void api.list().then(render);
  return { root };
}
