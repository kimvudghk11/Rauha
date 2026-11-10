import type { BlogApi, BlogToneId } from '../shared/blog-dto.js';
import { BLOG_LENGTHS, BLOG_TEMPLATES, MAX_SNIPPETS, type BlogLength, type BlogTemplateId } from '../shared/blog-note.js';
import { blogPreview } from '../shared/blog-preview.js';
import { snippetAllowed, type RedactChange, type RedactContext } from '../shared/blog-redact.js';
import type { RecordEntry } from '../shared/record-book.js';
import { copiedText } from '../shared/record-ui.js';
import { el } from './dom.js';
import { actionButton, flash } from './record-parts.js';

export interface BlogPanelDeps {
  readonly api: BlogApi;
  /** 설정에 적은 가릴 회사·서비스 이름 읽고 바꾸기 */
  readonly names: { get(): Promise<readonly string[]>; set(names: readonly string[]): Promise<readonly string[]> };
  readonly copy: (text: string) => Promise<boolean>;
}

const TONES: readonly { readonly id: BlogToneId; readonly label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'friendly', label: 'Friendly' },
];

const KIND_LABEL: Readonly<Record<RedactChange['kind'], string>> = {
  secret: 'Keys / tokens',
  secretFile: 'Secret file',
  arn: 'ARN',
  email: 'Email',
  domain: 'Domain',
  ip: 'IP',
  account: 'Account id',
  company: 'Company / service',
  repo: 'Repo',
  region: 'Region',
  home: 'Home path',
  user: 'User name',
  money: 'Amount',
};

interface Snippet {
  text: string;
  on: boolean;
}

type DraftState = { readonly kind: 'idle' } | { readonly kind: 'confirm' } | { readonly kind: 'running' } | { readonly kind: 'done'; readonly text: string } | { readonly kind: 'error'; readonly message: string };

/** "한 줄에 하나" 글을 이름 목록으로 */
export const namesFromText = (text: string): string[] => text.split(/\r?\n|,/).map((n) => n.trim()).filter((n) => n !== '');

/**
 * 블로그 글 패널(기록 탭 안). 고른 기록으로 정리 노트를 만들고(모델 0회), 공개용 가림 결과와 바뀐 목록을 보여 준다.
 * 초안 쓰기는 눌러서 확인한 뒤에만 모델을 한 번 부른다. 화면은 그리기만 하고 규칙은 shared의 blogPreview가 갖는다.
 */
export function buildBlogPanel(deps: BlogPanelDeps, entries: readonly RecordEntry[], onBack: () => void): HTMLElement {
  const root = el('div', 'bg');
  let ctx: RedactContext = { repoNames: [], companyNames: [], userName: '', homePath: '' };
  let length: BlogLength = 'normal';
  let tone: BlogToneId = 'plain';
  let titleIndex = 0;
  let template: BlogTemplateId = 'troubleshooting';
  let frontMatter = false;
  const keep = new Set<string>();
  const snippets: Snippet[] = [];
  let draft: DraftState = { kind: 'idle' };
  let draftKeep: readonly string[] = [];
  /** 가릴 이름을 받아 오기 전에는 글을 보여 주거나 내보내지 않는다(이름이 새지 않게) */
  let ready = false;

  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (text: string): void => {
    notice.textContent = text;
    notice.hidden = text === '';
  };

  /** 위쪽 한 줄(스크롤해도 고정): 되돌아가기 · 복사 · 저장 · 초안 쓰기(강조) */
  const bar = el('div', 'bar rdbar');
  const back = actionButton({ label: 'Records', icon: 'back', title: 'Back to records (Esc)', onClick: onBack });

  const head = el('div', 'bg-head');
  head.append(el('b', undefined, 'Blog post'), el('span', 'hint', `Built from ${entries.length} record(s). No model is called. Names, addresses and keys are replaced with generic ones so it is safe to publish.`));

  function seg<T extends string>(items: readonly { readonly id: T; readonly label: string }[], value: () => T, set: (v: T) => void): HTMLElement {
    const box = el('div', 'seg');
    for (const it of items) {
      const b = el('button', value() === it.id ? 'on' : undefined, it.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        set(it.id);
        for (const x of Array.from(box.children)) x.classList.toggle('on', x === b);
      });
      box.append(b);
    }
    return box;
  }

  const options = el('div', 'bar bg-options');
  const todayText = (): string => {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const fm = el('label', 'tg');
  const fmBox = el('input');
  fmBox.type = 'checkbox';
  fmBox.addEventListener('change', () => {
    frontMatter = fmBox.checked;
    refresh();
  });
  fm.title = 'Put title, tags and date at the top as YAML front-matter (Jekyll, Hugo and similar). Off by default so the text pastes anywhere.';
  fm.append(fmBox, el('span', undefined, 'Front-matter'));
  const group = (...nodes: HTMLElement[]): HTMLElement => {
    const g = el('div', 'bg-opt');
    g.append(...nodes);
    return g;
  };
  options.append(
    group(
      el('span', 'lbl', 'Template'),
      seg(BLOG_TEMPLATES, () => template, (v) => {
        template = v;
        refresh();
      }),
    ),
    group(fm),
    group(
      el('span', 'lbl', 'Length'),
      seg(BLOG_LENGTHS, () => length, (v) => {
        length = v;
        refresh();
      }),
    ),
    group(
      el('span', 'lbl', 'Draft tone'),
      seg(TONES, () => tone, (v) => {
        tone = v;
      }),
    ),
  );

  // 가릴 회사·서비스 이름(설정에 저장)
  const namesBox = el('textarea');
  namesBox.rows = 2;
  namesBox.placeholder = 'Company or service names to hide, one per line';
  const namesSave = actionButton({ label: 'Save names', icon: 'save', onClick: () => {
    void deps.names.set(namesFromText(namesBox.value)).then(
      (saved) => {
        ctx = { ...ctx, companyNames: saved };
        namesBox.value = saved.join('\n');
        say(`Saved ${saved.length} name(s) to hide.`);
        refresh();
      },
      () => say('Could not save the names.'),
    );
  } });
  const namesSec = section('Names to hide', namesBox, namesSave, el('div', 'hint', 'Repo and folder names in the work folder are hidden automatically. Add company or service names here (saved in settings).'));

  // 코드 조각: 내가 붙여 넣고 체크한 것만 글에 들어간다
  const snipList = el('div', 'bg-snips');
  const snipAdd = actionButton({
    label: 'Add code snippet',
    icon: 'plus',
    onClick: () => {
      if (snippets.length >= MAX_SNIPPETS) return say(`Up to ${MAX_SNIPPETS} code snippets.`);
      snippets.push({ text: '', on: false });
      renderSnippets();
    },
  });
  const snipSec = section('Code snippets (optional)', snipList, snipAdd, el('div', 'hint', 'Records contain no code. Paste snippets and tick "Include" for the ones to add. Secret file names and .env-like text are blocked.'));

  function renderSnippets(): void {
    snipList.replaceChildren();
    snippets.forEach((s, i) => {
      const row = el('div', 'item bg-snip');
      const area = el('textarea', 'mono');
      area.rows = 3;
      area.value = s.text;
      area.placeholder = 'Code snippet';
      const warn = el('div', 'err');
      warn.hidden = snippetAllowed(s.text);
      warn.textContent = 'Looks like a secret file name or an env file, so it is not included.';
      area.addEventListener('input', () => {
        s.text = area.value;
        warn.hidden = snippetAllowed(s.text);
        refresh();
      });
      const tg = el('label', 'tg');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.on;
      box.addEventListener('change', () => {
        s.on = box.checked;
        refresh();
      });
      tg.append(box, el('span', undefined, 'Include'));
      const del = actionButton({
        label: 'Delete',
        icon: 'trash',
        kind: 'danger',
        small: true,
        onClick: () => {
          snippets.splice(i, 1);
          renderSnippets();
          refresh();
        },
      });
      del.classList.add('end');
      const line = el('div', 'bar');
      line.append(tg, del);
      row.append(area, warn, line);
      snipList.append(row);
    });
  }

  const titleRow = el('div', 'rtags');
  const tagRow = el('div', 'rtags');
  const pre = el('pre', 'bg-pre');
  const changeList = el('div', 'bg-changes');
  const empty = el('div', 'rnone', 'Nothing to write about. Pick at least one record.');
  const copyBtn = actionButton({ label: 'Copy', icon: 'copy', title: 'Copy as Markdown (.md): copies the redacted text for publishing', onClick: () => void deps.copy(preview().markdown).then((ok) => done(ok)) });
  copyBtn.classList.add('end');
  const saveBtn = actionButton({ label: 'Save', icon: 'save', title: 'Save as a .md file: saves the outline as a .md file', onClick: () => void save(preview().markdown, preview().title, [...keep]) });
  const draftBtn = actionButton({
    label: 'Write draft',
    icon: 'edit',
    kind: 'primary',
    title: 'The docs teammate writes a draft from the outline (asks once more first)',
    onClick: () => {
      if (draft.kind === 'running') return;
      draft = { kind: 'confirm' };
      renderDraft();
    },
  });
  bar.append(back, copyBtn, saveBtn, draftBtn);
  const draftBox = el('div', 'bg-draft');
  const body = el('div', 'bg-body');
  body.append(section('Title ideas', titleRow), section('Tag ideas', tagRow), section('Outline (redacted for publishing)', pre), section('What was replaced', changeList), draftBox);
  root.append(bar, head, notice, options, namesSec, snipSec, empty, body);

  const state = () => ({ template, frontMatter, date: todayText(), length, titleIndex, keep: [...keep], snippets: snippets.filter((s) => s.on && s.text.trim() !== '').map((s) => s.text) });
  const preview = () => blogPreview(entries, ctx, state());

  /** 복사 결과: 됐으면 잠깐 뜨는 알림, 안 됐으면 줄로 */
  function done(ok: boolean): void {
    if (ok) {
      say('');
      flash(copiedText(1, true), root);
    } else say(copiedText(1, false));
  }

  async function save(markdown: string, title: string, keepList: readonly string[]): Promise<void> {
    say('');
    try {
      const res = await deps.api.save({ markdown, title, keep: keepList });
      if (!res.ok) say(res.error);
      else if (res.saved) flash(`Saved as ${res.name ?? 'file'}`, root);
      else say('Save canceled.');
    } catch {
      say('Could not save the file.');
    }
  }

  async function runDraft(): Promise<void> {
    const p = preview();
    draftKeep = [...keep];
    draft = { kind: 'running' };
    renderDraft();
    try {
      const res = await deps.api.draft({ note: p.markdown, tone, keep: draftKeep });
      draft = res.ok ? { kind: 'done', text: res.text } : { kind: 'error', message: res.error };
    } catch {
      draft = { kind: 'error', message: 'Could not write the draft.' };
    }
    renderDraft();
  }

  function renderDraft(): void {
    draftBox.replaceChildren();
    // 강조(파랑)는 한 번에 하나: 확인 카드나 쓰는 중에는 위쪽 "초안 쓰기"가 보조로 물러난다
    draftBtn.classList.toggle('primary', draft.kind === 'idle' || draft.kind === 'done' || draft.kind === 'error');
    draftBtn.disabled = !ready || draft.kind === 'running';
    if (draft.kind === 'idle') return;
    const card = el('div', 'item bg-card');
    if (draft.kind === 'confirm') {
      card.append(el('b', undefined, 'This calls a model once'), el('div', 'hint', `The docs teammate (잉크) reads only the outline above (redacted) and writes a draft in a ${tone === 'plain' ? 'plain' : 'friendly'} tone. It calls the lightest model once and creates no files. It uses a little of your plan limit.`));
      const go = actionButton({ label: 'Start writing', icon: 'edit', kind: 'primary', onClick: () => void runDraft() });
      const no = actionButton({
        label: 'Cancel',
        onClick: () => {
          draft = { kind: 'idle' };
          renderDraft();
        },
      });
      const row = el('div', 'btns');
      row.append(go, no);
      card.append(row);
    } else if (draft.kind === 'running') {
      const wait = el('div', 'dim');
      wait.append(el('span', 'spinner'), document.createTextNode('잉크 is writing the draft…'));
      card.append(wait);
    } else if (draft.kind === 'error') {
      card.append(el('div', 'err', draft.message));
      const again = actionButton({
        label: 'Try again',
        icon: 'fetch',
        onClick: () => {
          draft = { kind: 'confirm' };
          renderDraft();
        },
      });
      card.append(again);
    } else {
      const text = draft.text;
      card.append(el('b', undefined, 'Draft'), Object.assign(el('pre', 'bg-pre'), { textContent: text }));
      const copy = actionButton({ label: 'Copy draft', icon: 'copy', onClick: () => void deps.copy(text).then((ok) => done(ok)) });
      const savemd = actionButton({ label: 'Save draft as .md', icon: 'save', onClick: () => void save(text, text.split('\n').find((l) => l.trim() !== '') ?? '', draftKeep) });
      const row = el('div', 'btns');
      row.append(copy, savemd);
      card.append(row, el('div', 'hint', 'A model wrote this, so some parts may be wrong. Read and fix it before publishing.'));
    }
    draftBox.append(card);
  }

  function renderChanges(changes: readonly RedactChange[]): void {
    changeList.replaceChildren();
    if (changes.length === 0) {
      changeList.append(el('div', 'dim', 'Nothing was replaced.'));
      return;
    }
    for (const c of changes) {
      const row = el('div', `rrow bg-chg${c.kept ? ' hl' : ''}`);
      row.append(el('span', 'chip', KIND_LABEL[c.kind]), el('span', 'bg-from', c.original), el('span', 'dim', '→'), el('span', 'bg-to', c.kept ? '(restored: left as is)' : c.replacement), el('span', 'faint', `x${c.count}`));
      if (c.revertible) {
        const b = actionButton({
          label: c.kept ? 'Hide again' : 'Restore',
          icon: c.kept ? undefined : 'undo',
          small: true,
          title: c.kept ? 'Hide this value again' : 'Leave this value as it is',
          onClick: () => {
            if (c.kept) keep.delete(c.original);
            else keep.add(c.original);
            refresh();
          },
        });
        b.classList.add('end');
        row.append(b);
      } else row.append(el('span', 'faint', 'Always hidden'));
      changeList.append(row);
    }
  }

  function renderChips(host: HTMLElement, items: readonly string[], active: number | null, pick: ((i: number) => void) | null): void {
    host.replaceChildren();
    items.forEach((text, i) => {
      if (pick === null) {
        host.append(el('span', 'chip purple', text));
        return;
      }
      const b = el('button', `chip${i === active ? ' on' : ''}`, text);
      b.type = 'button';
      b.addEventListener('click', () => {
        pick(i);
      });
      host.append(b);
    });
  }

  function refresh(): void {
    const p = preview();
    empty.hidden = p.hasMaterial;
    body.hidden = !p.hasMaterial;
    options.hidden = !p.hasMaterial;
    if (!p.hasMaterial) return;
    for (const b of [copyBtn, saveBtn]) b.disabled = !ready;
    draftBtn.disabled = !ready || draft.kind === 'running';
    if (!ready) {
      pre.textContent = 'Loading names to hide…';
      return;
    }
    renderChips(titleRow, p.titles, Math.min(titleIndex, p.titles.length - 1), (i) => {
      titleIndex = i;
      refresh();
    });
    renderChips(tagRow, p.tags, null, null);
    pre.textContent = p.markdown;
    renderChanges(p.changes);
    if (p.droppedSnippets > 0) say(`${p.droppedSnippets} code snippet(s) looked like secret files and were left out.`);
  }

  function section(title: string, ...nodes: HTMLElement[]): HTMLElement {
    const s = el('div', 'rsec');
    s.append(el('div', 'rsect', title), ...nodes);
    return s;
  }

  refresh();
  void Promise.all([deps.api.context(), deps.names.get()]).then(
    ([base, names]) => {
      ctx = { ...base, companyNames: names };
      ready = true;
      namesBox.value = names.join('\n');
      refresh();
    },
    () => say('Could not load the names to hide. Some names may stay visible, so hold off on copying or saving.'),
  );
  return root;
}
