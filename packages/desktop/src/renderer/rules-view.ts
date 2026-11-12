import type { RuleBucket } from '@rauha/core/jobs';
import type { DefaultRuleView } from '@rauha/core/jobs';
import { variantsFromText, variantsToText } from '../shared/default-rules-form.js';
import type { DefaultRuleOp, DefaultRulesResult } from '../shared/ipc.js';
import { ruleFromForm, ruleToForm, type RuleView } from '../shared/rules-form.js';
import { el, isEnterKey } from './dom.js';

const COLUMNS: readonly { bucket: RuleBucket; title: string; hint: string }[] = [
  { bucket: 'always', title: 'Always follow', hint: 'Added to every teammate prompt.' },
  { bucket: 'allow', title: 'Do without asking', hint: 'These run without approval.' },
  { bucket: 'ask', title: 'Always ask first', hint: 'These always ask for approval.' },
];

const SCOPE_LABEL = (r: RuleView): string => (r.scope.kind === 'global' ? 'All' : r.scope.kind === 'workspace' ? `Work folder · ${r.scope.path}` : `Folder · ${r.scope.path}`);

/**
 * 규칙 탭: 칸 셋(항상 지킬 것 / 묻지 않고 할 것 / 꼭 허락받을 것)과 범위(전체·작업 폴더·폴더).
 * 묻지 않음·허락 규칙은 명령이나 경로에서 찾을 글로 판정한다. 비밀 파일·역할 권한 거절은 규칙보다 앞서 늘 지켜진다. commit·push·PR은 사용자가 요청에서 시켰을 때만 묻지 않는다.
 */
export function buildRules(api: { draft: (sentence: string) => ReturnType<Window['rauha']['draftRule']>; list: () => Promise<readonly RuleView[]>; add: (r: RuleView) => ReturnType<Window['rauha']['addRule']>; remove: (id: string) => Promise<readonly RuleView[]>; update?: (r: RuleView) => ReturnType<Window['rauha']['addRule']>; defaults?: { list: () => Promise<readonly DefaultRuleView[]>; apply: (op: DefaultRuleOp) => Promise<DefaultRulesResult> } }) {
  const root = el('section', 'rules');
  const head = el('div', 'rhead');
  head.append(el('b', undefined, 'Rules'), el('span', 'hint', 'Teammates follow the rules you write. Secret files are always blocked, whatever the rules say. Commit, push and PR happen only when you ask for them.'));

  // 말로 적기: haiku 한 번으로 칸·범위·찾을 글을 정리해 아래 폼에 채워 준다. 사용자가 보고 "규칙 더하기"를 눌러야 들어간다.
  const talk = el('div', 'ruletalk pane');
  const sentence = el('textarea');
  sentence.rows = 2;
  sentence.placeholder = 'Say it in words  e.g. always ask before git push in api-server';
  const draftBtn = el('button', 'btn', 'Turn into a rule');
  const draftNote = el('div', 'hint');
  talk.append(el('div', 'ph', 'Write in words'), sentence, el('div', 'row', ''), draftNote);
  talk.children[2]!.appendChild(draftBtn);

  // 입력 폼
  const form = el('form', 'ruleform pane');
  const text = el('input');
  text.placeholder = 'Write the rule in one line  e.g. do not ask for terraform apply in qa';
  const bucket = el('select');
  for (const c of COLUMNS) bucket.appendChild(new Option(c.title, c.bucket));
  bucket.value = 'allow';
  const scope = el('select');
  scope.append(new Option('Scope: all', 'global'), new Option('Scope: work folder', 'workspace'), new Option('Scope: one folder', 'folder'));
  const path = el('input', 'path');
  path.placeholder = 'Folder path';
  path.hidden = true;
  scope.addEventListener('change', () => (path.hidden = scope.value === 'global'));
  const includes = el('input');
  includes.placeholder = 'Text to match (comma-separated)  e.g. terraform apply, qa';
  const tool = el('select');
  tool.append(new Option('All tools', ''), new Option('Bash (commands)', 'Bash'), new Option('Write · Edit (files)', 'Write'));
  bucket.addEventListener('change', () => ((includes.hidden = bucket.value === 'always'), (tool.hidden = bucket.value === 'always')));
  includes.hidden = false;
  const error = el('div', 'err');
  const add = el('button', 'btn primary', 'Add rule');
  add.type = 'submit';
  const row1 = el('div', 'row');
  row1.append(text);
  const row2 = el('div', 'row');
  row2.append(bucket, scope, path, tool, includes, add);
  form.append(row1, row2, error);

  const grid = el('div', 'rcols');
  const resetAll = el('button', 'btn', 'Restore all default rules');
  resetAll.title = 'Turns disabled default rules back on and resets edited ones to the original text. Your own rules stay.';
  const defaultsNote = el('div', 'hint');
  let defaults: readonly DefaultRuleView[] = [];
  let editingDefault: string | null = null;
  let mine: readonly RuleView[] = [];
  /** 제자리에서 고치는 중인 내 규칙 번호 */
  let editingRule: string | null = null;
  root.append(head, talk, form, grid, el('div', 'rfoot'));
  root.lastElementChild!.append(defaultsNote, resetAll);

  function defaultCard(d: DefaultRuleView): HTMLElement {
    const card = el('div', d.enabled ? 'item rule default' : 'item rule default off');
    const top = el('div', 'dtop');
    top.append(el('span', 'chip', 'Default'), ...(d.edited ? [el('span', 'chip', 'Edited')] : []));
    const toggle = el('label', 'tg');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = d.enabled;
    box.addEventListener('change', () => void apply({ kind: 'toggle', id: d.id, enabled: box.checked }));
    toggle.append(box, el('span', undefined, d.enabled ? 'On' : 'Off'));
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
      const save = el('button', 'btn primary', 'Save');
      save.addEventListener('click', () => void apply({ kind: 'edit', id: d.id, text: text.value, variants: variantsFromText(variants.value) }, err));
      const cancel = el('button', 'btn', 'Cancel');
      cancel.addEventListener('click', () => {
        editingDefault = null;
        void refresh();
      });
      const row = el('div', 'row');
      row.append(save, cancel);
      card.append(text, ...(d.bucket === 'always' ? [] : [el('div', 'hint', 'Text to match: one line per case. Joined with + means all must appear. Start with a tool like "Bash:" to limit it.'), variants]), err, row);
      return card;
    }
    card.appendChild(el('div', undefined, d.text));
    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'chip', 'All'));
    if (d.variants.length > 0) meta.appendChild(el('span', 'chip', `${d.variants.length} match pattern(s)`));
    card.appendChild(meta);
    if (d.note !== null) card.appendChild(el('div', 'hint', d.note));
    const row = el('div', 'row');
    const edit = el('button', 'btn sm', 'Edit');
    edit.addEventListener('click', () => {
      editingDefault = d.id;
      void refresh();
    });
    row.appendChild(edit);
    if (d.edited || !d.enabled) {
      const restore = el('button', 'btn sm', 'Reset to default');
      restore.addEventListener('click', () => void apply({ kind: 'restore', id: d.id }));
      row.appendChild(restore);
    }
    card.appendChild(row);
    return card;
  }

  /** 내 규칙을 그 자리에서 고치는 카드: 칸을 미리 채우고 Save·Cancel(Enter는 저장, Esc는 취소). 저장 중에는 단추를 잠가 중복 클릭이 한 번만 저장된다. */
  function ruleEditCard(r: RuleView): HTMLElement {
    const f = ruleToForm(r);
    const card = el('div', 'item rule editing');
    const t = el('input');
    t.value = f.text;
    t.setAttribute('aria-label', 'Rule text');
    const b = el('select');
    for (const c of COLUMNS) b.appendChild(new Option(c.title, c.bucket));
    b.value = f.bucket;
    const s = el('select');
    s.append(new Option('Scope: all', 'global'), new Option('Scope: work folder', 'workspace'), new Option('Scope: one folder', 'folder'));
    s.value = f.scope;
    const p = el('input');
    p.placeholder = 'Folder path';
    p.value = f.path;
    const tl = el('select');
    tl.append(new Option('All tools', ''), new Option('Bash (commands)', 'Bash'), new Option('Write · Edit (files)', 'Write'));
    tl.value = f.tool;
    const inc = el('input');
    inc.placeholder = 'Text to match (comma-separated)';
    inc.value = f.includes;
    const sync = (): void => {
      p.hidden = s.value === 'global';
      inc.hidden = b.value === 'always';
      tl.hidden = b.value === 'always';
    };
    sync();
    s.addEventListener('change', sync);
    b.addEventListener('change', sync);
    const err = el('div', 'err');
    const save = el('button', 'btn primary', 'Save');
    save.type = 'button';
    const cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    let saving = false;
    const doSave = (): void => {
      if (saving || api.update === undefined) return;
      const made = ruleFromForm({ text: t.value, bucket: b.value as RuleBucket, scope: s.value as 'global' | 'workspace' | 'folder', path: p.value, includes: inc.value, tool: tl.value }, () => r.id);
      if (!made.ok) {
        err.textContent = made.error;
        return;
      }
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      void api.update(made.rule).then((res) => {
        if (!res.ok) {
          saving = false;
          save.disabled = false;
          cancel.disabled = false;
          err.textContent = res.error;
          return;
        }
        editingRule = null;
        render(res.rules);
      });
    };
    const doCancel = (): void => {
      if (saving) return;
      editingRule = null;
      render(mine);
    };
    save.addEventListener('click', doSave);
    cancel.addEventListener('click', doCancel);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        doCancel();
      } else if (isEnterKey(e) && (e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        doSave();
      }
    });
    const row = el('div', 'row');
    row.append(save, cancel);
    card.append(t, b, s, p, tl, inc, err, row);
    queueMicrotask(() => t.focus());
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
      if (own.length === 0 && defaults.every((d) => d.bucket !== col.bucket)) pane.appendChild(el('div', 'dim pad', 'None yet.'));
      for (const r of own) {
        if (editingRule === r.id) {
          pane.appendChild(ruleEditCard(r));
          continue;
        }
        const card = el('div', 'item rule');
        card.appendChild(el('div', undefined, r.text));
        const meta = el('div', 'meta');
        meta.appendChild(el('span', 'chip', SCOPE_LABEL(r)));
        if (r.includes.length > 0) meta.appendChild(el('span', 'chip', `${r.tools.join('·') || 'All tools'}: ${r.includes.join(' + ')}`));
        const del = el('button', 'btn sm danger', 'Delete');
        del.addEventListener('click', () => void api.remove(r.id).then(render));
        const acts = el('div', 'row');
        if (api.update !== undefined) {
          const edit = el('button', 'btn sm', 'Edit');
          edit.addEventListener('click', () => {
            editingRule = r.id;
            render(mine);
          });
          acts.append(edit);
        }
        acts.append(del);
        card.append(meta, acts);
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
    draftNote.textContent = 'Working… (calls the lightest model once)';
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
      draftNote.textContent = 'Here is the rule. Check and edit the fields below, then press "Add rule".';
    });
  });

  void api.list().then((rules) => {
    mine = rules;
    return refresh();
  });
  return { root };
}
