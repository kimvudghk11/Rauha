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
  { id: 'plain', label: '담백' },
  { id: 'friendly', label: '친근' },
];

const KIND_LABEL: Readonly<Record<RedactChange['kind'], string>> = {
  secret: '키·토큰',
  secretFile: '비밀 파일',
  arn: 'ARN',
  email: '이메일',
  domain: '도메인',
  ip: 'IP',
  account: '계정 번호',
  company: '회사·서비스',
  repo: '레포',
  region: '리전',
  home: '홈 경로',
  user: '사용자 이름',
  money: '금액',
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
  const back = actionButton({ label: '기록으로', icon: 'back', title: '기록으로 돌아가기 (Esc)', onClick: onBack });

  const head = el('div', 'bg-head');
  head.append(el('b', undefined, '블로그 글'), el('span', 'hint', `기록 ${entries.length}개로 정리해요. 모델은 부르지 않아요. 공개해도 되게 이름·주소·키는 일반 이름으로 바꿔요.`));

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
  options.append(
    el('span', 'lbl', 'Template'),
    seg(BLOG_TEMPLATES, () => template, (v) => {
      template = v;
      refresh();
    }),
    fm,
    el('span', 'lbl', '글 길이'),
    seg(BLOG_LENGTHS, () => length, (v) => {
      length = v;
      refresh();
    }),
    el('span', 'lbl', '초안 어투'),
    seg(TONES, () => tone, (v) => {
      tone = v;
    }),
  );

  // 가릴 회사·서비스 이름(설정에 저장)
  const namesBox = el('textarea');
  namesBox.rows = 2;
  namesBox.placeholder = '가릴 회사·서비스 이름을 한 줄에 하나씩 (예: 우리회사)';
  const namesSave = actionButton({ label: '이름 저장', icon: 'save', onClick: () => {
    void deps.names.set(namesFromText(namesBox.value)).then(
      (saved) => {
        ctx = { ...ctx, companyNames: saved };
        namesBox.value = saved.join('\n');
        say(`가릴 이름 ${saved.length}개를 저장했어요.`);
        refresh();
      },
      () => say('이름을 저장하지 못했어요.'),
    );
  } });
  const namesSec = section('가릴 이름', namesBox, el('div', 'btns', ''), el('div', 'hint', '작업 폴더의 레포·폴더 이름은 자동으로 가려요. 회사·서비스 이름은 여기에 적어 두세요(설정에 저장돼요).'));
  namesSec.querySelector('.btns')?.append(namesSave);

  // 코드 조각: 내가 붙여 넣고 체크한 것만 글에 들어간다
  const snipList = el('div', 'bg-snips');
  const snipAdd = actionButton({
    label: '코드 조각 추가',
    icon: 'plus',
    onClick: () => {
      if (snippets.length >= MAX_SNIPPETS) return say(`코드 조각은 ${MAX_SNIPPETS}개까지 넣어요.`);
      snippets.push({ text: '', on: false });
      renderSnippets();
    },
  });
  const snipSec = section('코드 조각 (선택)', snipList, snipAdd, el('div', 'hint', '기록에는 코드가 없어요. 글에 넣고 싶은 조각을 붙여 넣고 "글에 넣기"를 체크한 것만 들어가요. 비밀 파일 이름이나 .env 모양이면 막아요.'));

  function renderSnippets(): void {
    snipList.replaceChildren();
    snippets.forEach((s, i) => {
      const row = el('div', 'item bg-snip');
      const area = el('textarea', 'mono');
      area.rows = 3;
      area.value = s.text;
      area.placeholder = '코드 조각';
      const warn = el('div', 'err');
      warn.hidden = snippetAllowed(s.text);
      warn.textContent = '비밀 파일 이름이나 환경 변수 파일 모양이라 글에 넣지 않아요.';
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
      tg.append(box, el('span', undefined, '글에 넣기'));
      const del = actionButton({
        label: '지우기',
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
  const empty = el('div', 'rnone', '글감이 없어요. 기록을 하나 이상 골라 주세요.');
  const copyBtn = actionButton({ label: 'Copy .md', icon: 'copy', title: '공개용으로 가린 정리 노트를 복사해요', onClick: () => void deps.copy(preview().markdown).then((ok) => done(ok)) });
  copyBtn.classList.add('end');
  const saveBtn = actionButton({ label: 'Save .md', icon: 'save', title: '정리 노트를 .md 파일로 저장해요', onClick: () => void save(preview().markdown, preview().title, [...keep]) });
  const draftBtn = actionButton({
    label: '초안 쓰기',
    icon: 'edit',
    kind: 'primary',
    title: '문서 팀원이 정리 노트로 초안을 써요(누르면 한 번 더 물어봐요)',
    onClick: () => {
      if (draft.kind === 'running') return;
      draft = { kind: 'confirm' };
      renderDraft();
    },
  });
  bar.append(back, copyBtn, saveBtn, draftBtn);
  const draftBox = el('div', 'bg-draft');
  const body = el('div', 'bg-body');
  body.append(section('제목 후보', titleRow), section('태그 후보', tagRow), section('정리 노트 (공개용으로 가린 글)', pre), section('바뀐 목록', changeList), draftBox);
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
      else if (res.saved) flash(`${res.name ?? '파일'} 로 저장했어요`, root);
      else say('저장을 취소했어요.');
    } catch {
      say('파일을 저장하지 못했어요.');
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
      draft = { kind: 'error', message: '초안을 쓰지 못했어요.' };
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
      card.append(el('b', undefined, '모델을 한 번 부릅니다'), el('div', 'hint', `문서 팀원(잉크)이 위 정리 노트(가린 글)만 읽고 ${tone === 'plain' ? '담백한' : '친근한'} 어투로 초안을 써요. 가장 가벼운 모델로 한 번만 부르고, 파일은 만들지 않아요. 구독 한도를 조금 써요.`));
      const go = actionButton({ label: '초안 쓰기 시작', icon: 'edit', kind: 'primary', onClick: () => void runDraft() });
      const no = actionButton({
        label: '취소',
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
      wait.append(el('span', 'spinner'), document.createTextNode('잉크가 초안을 쓰는 중이에요…'));
      card.append(wait);
    } else if (draft.kind === 'error') {
      card.append(el('div', 'err', draft.message));
      const again = actionButton({
        label: '다시 시도',
        icon: 'fetch',
        onClick: () => {
          draft = { kind: 'confirm' };
          renderDraft();
        },
      });
      card.append(again);
    } else {
      const text = draft.text;
      card.append(el('b', undefined, '초안'), Object.assign(el('pre', 'bg-pre'), { textContent: text }));
      const copy = actionButton({ label: '초안 복사', icon: 'copy', onClick: () => void deps.copy(text).then((ok) => done(ok)) });
      const savemd = actionButton({ label: '초안 .md로 저장', icon: 'save', onClick: () => void save(text, text.split('\n').find((l) => l.trim() !== '') ?? '', draftKeep) });
      const row = el('div', 'btns');
      row.append(copy, savemd);
      card.append(row, el('div', 'hint', '모델이 쓴 글이라 사실과 다른 곳이 있을 수 있어요. 올리기 전에 꼭 읽어 보고 고치세요.'));
    }
    draftBox.append(card);
  }

  function renderChanges(changes: readonly RedactChange[]): void {
    changeList.replaceChildren();
    if (changes.length === 0) {
      changeList.append(el('div', 'dim', '바꾼 것이 없어요.'));
      return;
    }
    for (const c of changes) {
      const row = el('div', `rrow bg-chg${c.kept ? ' hl' : ''}`);
      row.append(el('span', 'chip', KIND_LABEL[c.kind]), el('span', 'bg-from', c.original), el('span', 'dim', '→'), el('span', 'bg-to', c.kept ? '(되돌림: 그대로 둠)' : c.replacement), el('span', 'faint', `${c.count}번`));
      if (c.revertible) {
        const b = actionButton({
          label: c.kept ? '다시 가리기' : '되돌리기',
          icon: c.kept ? undefined : 'undo',
          small: true,
          title: c.kept ? '이 값을 다시 가려요' : '이 값을 가리지 않고 그대로 둬요',
          onClick: () => {
            if (c.kept) keep.delete(c.original);
            else keep.add(c.original);
            refresh();
          },
        });
        b.classList.add('end');
        row.append(b);
      } else row.append(el('span', 'faint', '항상 가려요'));
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
      pre.textContent = '가릴 이름을 불러오는 중…';
      return;
    }
    renderChips(titleRow, p.titles, Math.min(titleIndex, p.titles.length - 1), (i) => {
      titleIndex = i;
      refresh();
    });
    renderChips(tagRow, p.tags, null, null);
    pre.textContent = p.markdown;
    renderChanges(p.changes);
    if (p.droppedSnippets > 0) say(`코드 조각 ${p.droppedSnippets}개는 비밀 파일 모양이라 뺐어요.`);
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
    () => say('가릴 이름을 불러오지 못했어요. 이름 가림이 덜 될 수 있으니 복사·저장은 잠시 미뤄 주세요.'),
  );
  return root;
}
