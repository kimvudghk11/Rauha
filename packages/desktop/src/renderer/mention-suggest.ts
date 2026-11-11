import { activeMention, completeMention, rankMentionFiles, type MentionDraft } from '../shared/file-mention.js';
import { el, isEnterKey } from './dom.js';

export interface MentionSources {
  /** 작업 폴더 안 파일 경로 목록(작업 폴더 기준). 비밀 파일·생성물은 main이 이미 뺐다. */
  readonly files: () => Promise<readonly string[]>;
  /** 일을 맡길 수 있는 폴더(레포) 이름 */
  readonly folders: () => Promise<readonly string[]>;
  /** 최근 연 파일(최근 것이 앞) */
  readonly recent: () => readonly string[];
}

interface Item {
  /** 입력칸에 넣을 글(@ 뒤) */
  readonly text: string;
  readonly name: string;
  readonly dir: string;
  readonly folder: boolean;
}

const LIST_TTL_MS = 8000;
const MAX_ITEMS = 8;
const MAX_FOLDERS = 3;

/**
 * 입력창에서 `@`를 치는 동안 입력창 위에 뜨는 후보 목록. 폴더(대상 지정)와 파일(참고 자료 지정)이 함께 나온다.
 * 키: ↑↓ 고르기, Tab/Enter 채우기(이미 다 친 경로면 Enter는 보내기), Esc 닫기. 채운 글은 그냥 `@src/foo.ts` 글이다.
 */
export function attachMentionSuggest(input: HTMLTextAreaElement, host: HTMLElement, sources: MentionSources, onFilled: () => void) {
  const box = el('div', 'cmd-suggest mention-suggest');
  box.hidden = true;
  host.appendChild(box);
  let list: readonly Item[] = [];
  let index = 0;
  let draft: MentionDraft | null = null;
  let cache: { at: number; files: readonly string[]; folders: readonly string[] } | null = null;
  let loading: Promise<void> | null = null;
  let stamp = 0;

  const load = (): Promise<void> => {
    if (cache !== null && Date.now() - cache.at < LIST_TTL_MS) return Promise.resolve();
    loading ??= Promise.all([sources.files().catch(() => []), sources.folders().catch(() => [])])
      .then(([files, folders]) => {
        cache = { at: Date.now(), files, folders };
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };

  const compute = (query: string): Item[] => {
    if (cache === null) return [];
    const q = query.toLowerCase();
    const folders = query.includes('/') ? [] : cache.folders.filter((f) => f.toLowerCase().includes(q)).slice(0, MAX_FOLDERS);
    const files = rankMentionFiles(query, cache.files, sources.recent(), MAX_ITEMS - folders.length);
    return [
      ...folders.map((f): Item => ({ text: f, name: f, dir: 'folder', folder: true })),
      ...files.map((p): Item => ({ text: p, name: p.slice(p.lastIndexOf('/') + 1), dir: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '', folder: false })),
    ];
  };

  const close = (): void => {
    list = [];
    draft = null;
    stamp += 1;
    box.hidden = true;
  };

  const fill = (item: Item): void => {
    if (draft === null) return;
    const done = completeMention(input.value, draft, item.text);
    input.value = done.text;
    input.setSelectionRange(done.caret, done.caret);
    close();
    input.focus();
    onFilled();
  };

  function paint(): void {
    box.replaceChildren();
    list.forEach((item, i) => {
      const row = el('div', i === index ? 'it on' : 'it');
      row.append(el('b', undefined, item.name), el('span', 'ds', item.dir));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        fill(item);
      });
      box.appendChild(row);
    });
    box.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  const show = (d: MentionDraft): void => {
    draft = d;
    list = compute(d.query);
    index = Math.min(index, Math.max(0, list.length - 1));
    box.hidden = list.length === 0;
    if (list.length > 0) paint();
  };

  return {
    update(): void {
      const caret = input.selectionStart ?? input.value.length;
      const d = input.value.startsWith('/') ? null : activeMention(input.value, caret);
      if (d === null) {
        close();
        return;
      }
      const mine = (stamp += 1);
      void load().then(() => {
        // 기다리는 사이 글이 바뀌었으면 이 결과는 버린다
        if (mine === stamp) show(d);
      });
    },
    close,
    /** 키를 썼으면 true(그 키는 입력창 기본 동작을 하지 않는다) */
    key(e: KeyboardEvent): boolean {
      if (box.hidden || list.length === 0 || e.isComposing) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        index = (index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        paint();
        return true;
      }
      if (e.key === 'Escape') {
        close();
        return true;
      }
      const picked = list[index]!;
      const complete = draft !== null && picked.text === draft.query;
      if (e.key === 'Tab' || (isEnterKey(e) && !e.shiftKey && !complete)) {
        fill(picked);
        return true;
      }
      return false;
    },
  };
}
