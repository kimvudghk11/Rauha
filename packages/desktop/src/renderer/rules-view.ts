import type { RuleBucket } from '@rauha/core/jobs';
import type { DefaultRuleView } from '@rauha/core/jobs';
import { variantsFromText, variantsToText } from '../shared/default-rules-form.js';
import type { DefaultRuleOp, DefaultRulesResult } from '../shared/ipc.js';
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
export function buildRules(api: { draft: (sentence: string) => ReturnType<Window['rauha']['draftRule']>; list: () => Promise<readonly RuleView[]>; add: (r: RuleView) => ReturnType<Window['rauha']['addRule']>; remove: (id: string) => Promise<readonly RuleView[]>; defaults?: { list: () => Promise<readonly DefaultRuleView[]>; apply: (op: DefaultRuleOp) => Promise<DefaultRulesResult> } }) {
  const root = el('section', 'rules');
  const head = el('div', 'rhead');
  head.append(el('b', undefined, '규칙'), el('span', 'hint', '내 규칙을 적어 두면 팀원이 따라요. 비밀 파일과 git push 거절은 규칙과 상관없이 늘 지켜져요.'));

  // 말로 적기: haiku 한 번으로 칸·범위·찾을 글을 정리해 아래 폼에 채워 준다. 사용자가 보고 "규칙 더하기"를 눌러야 들어간다.
  const talk = el('div', 'ruletalk pane');
  const sentence = el('textarea');
  sentence.rows = 2;
  sentence.placeholder = '말로 적어요  예: api-server에서는 git push는 늘 먼저 물어봐 줘';
  const draftBtn = el('button', 'btn', '정리하기');
  const draftNote = el('div', 'hint');
  talk.append(el('div', 'ph', '말로 적기'), sentence, el('div', 'row', ''), draftNote);
  talk.children[2]!.appendChild(draftBtn);

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
  const resetAll = el('button', 'btn', '기본 규칙 모두 되돌리기');
  resetAll.title = '끈 기본 규칙을 다시 켜고, 고친 기본 규칙을 처음 글로 되돌려요. 내 규칙은 그대로예요.';
  const defaultsNote = el('div', 'hint');
  let defaults: readonly DefaultRuleView[] = [];
  let editingDefault: string | null = null;
  let mine: readonly RuleView[] = [];
  root.append(head, talk, form, grid, el('div', 'rfoot'));
  root.lastElementChild!.append(defaultsNote, resetAll);

  function defaultCard(d: DefaultRuleView): HTMLElement {
    const card = el('div', d.enabled ? 'item rule default' : 'item rule default off');
    const top = el('div', 'dtop');
    top.append(el('span', 'chip', '기본'), ...(d.edited ? [el('span', 'chip', '고침')] : []));
    const toggle = el('label', 'tg');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = d.enabled;
    box.addEventListener('change', () => void apply({ kind: 'toggle', id: d.id, enabled: box.checked }));
    toggle.append(box, el('span', undefined, d.enabled ? '켬' : '끔'));
    top.appendChild(toggle);
    card.append(top);
    if (editingDefault === d.id) {
      const text = el('textarea');
      text.rows = 3;
      text.value = d.text;
      const variants = el('textarea');
      variants.rows = Math.min(8, Math.max(3, d.variants.length + 1));
      variants.value = variantsToText(d.variants);
      variants.hidden = d.bucket === 'always';
      const err = el('div', 'err');
      const save = el('button', 'btn primary', '저장');
      save.addEventListener('click', () => void apply({ kind: 'edit', id: d.id, text: text.value, variants: variantsFromText(variants.value) }, err));
      const cancel = el('button', 'btn', '취소');
      cancel.addEventListener('click', () => {
        editingDefault = null;
        void refresh();
      });
      const row = el('div', 'row');
      row.append(save, cancel);
      card.append(text, ...(d.bucket === 'always' ? [] : [el('div', 'hint', '찾을 글: 한 줄이 한 경우예요. 줄 안의 글은 +로 이어 모두 들어 있을 때 맞고, 앞에 "Bash:"처럼 도구를 적을 수 있어요.'), variants]), err, row);
      return card;
    }
    card.appendChild(el('div', undefined, d.text));
    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'chip', '전체'));
    if (d.variants.length > 0) meta.appendChild(el('span', 'chip', `찾을 글 ${d.variants.length}가지`));
    card.appendChild(meta);
    if (d.note !== null) card.appendChild(el('div', 'hint', d.note));
    const row = el('div', 'row');
    const edit = el('button', 'btn sm', '고치기');
    edit.addEventListener('click', () => {
      editingDefault = d.id;
      void refresh();
    });
    row.appendChild(edit);
    if (d.edited || !d.enabled) {
      const restore = el('button', 'btn sm', '기본값으로');
      restore.addEventListener('click', () => void apply({ kind: 'restore', id: d.id }));
      row.appendChild(restore);
    }
    card.appendChild(row);
    return card;
  }

  async function apply(op: DefaultRuleOp, err?: HTMLElement): Promise<void> {
    const res = await api.defaults!.apply(op);
    if (!res.ok) {
      if (err !== undefined) err.textContent = res.error;
      else defaultsNote.textContent = res.error;
      return;
    }
    defaultsNote.textContent = '';
    editingDefault = null;
    defaults = res.rules;
    render(mine);
  }

  async function refresh(): Promise<void> {
    defaults = api.defaults === undefined ? [] : await api.defaults.list();
    render(mine);
  }
  resetAll.addEventListener('click', () => void apply({ kind: 'restoreAll' }));

  function render(rules: readonly RuleView[]): void {
    mine = rules;
    resetAll.hidden = api.defaults === undefined;
    resetAll.disabled = defaults.every((d) => d.enabled && !d.edited);
    grid.replaceChildren();
    for (const col of COLUMNS) {
      const pane = el('div', 'pane rcol');
      pane.append(el('div', 'ph', col.title), el('div', 'hint pad', col.hint));
      const own = rules.filter((r) => r.bucket === col.bucket);
      for (const d of defaults.filter((x) => x.bucket === col.bucket)) pane.appendChild(defaultCard(d));
      if (own.length === 0 && defaults.every((d) => d.bucket !== col.bucket)) pane.appendChild(el('div', 'dim pad', '아직 없어요.'));
      for (const r of own) {
        const card = el('div', 'item rule');
        card.appendChild(el('div', undefined, r.text));
        const meta = el('div', 'meta');
        meta.appendChild(el('span', 'chip', SCOPE_LABEL(r)));
        if (r.includes.length > 0) meta.appendChild(el('span', 'chip', `${r.tools.join('·') || '모든 도구'}: ${r.includes.join(' + ')}`));
        const del = el('button', 'btn sm danger', '지우기');
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

  draftBtn.addEventListener('click', () => {
    if (sentence.value.trim() === '') return;
    draftBtn.disabled = true;
    draftNote.textContent = '정리하는 중… (가장 가벼운 모델을 한 번 불러요)';
    void api.draft(sentence.value).then((res) => {
      draftBtn.disabled = false;
      if (!res.ok) {
        draftNote.textContent = res.error;
        return;
      }
      const r = res.draft;
      text.value = r.text;
      bucket.value = r.bucket;
      scope.value = r.scope.kind;
      path.value = r.scope.kind === 'global' ? '' : r.scope.path;
      path.hidden = r.scope.kind === 'global';
      tool.value = r.tools[0] === 'Bash' || r.tools[0] === 'Write' ? r.tools[0] : '';
      includes.value = r.includes.join(', ');
      includes.hidden = r.bucket === 'always';
      tool.hidden = r.bucket === 'always';
      draftNote.textContent = '이렇게 정리했어요. 아래 칸을 확인하고 고쳐도 되고, 맞으면 "규칙 더하기"를 눌러 주세요.';
    });
  });

  void api.list().then((rules) => {
    mine = rules;
    return refresh();
  });
  return { root };
}
