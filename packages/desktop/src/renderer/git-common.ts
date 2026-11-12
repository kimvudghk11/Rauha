import type { GitArg, GitData, GitFn, Overview } from '../shared/git-api.js';
import type { DiffView } from '../shared/git-api.js';
import type { ConventionsView } from '../shared/git-conventions-view.js';
import type { Selection } from '../shared/git-diff.js';
import { DIFF_FIRST_LINES, DIFF_MORE_LINES, moreLabel } from '../shared/git-window.js';
import { el, isEnterKey } from './dom.js';

/** git 탭의 화면들이 함께 쓰는 손잡이 */
export interface GitCtx {
  /** 지금 고른 레포 루트 */
  root(): string;
  /** git 함수를 부른다. 실패하면 이유를 띄우고 null. 보호 브랜치면 확인 창을 거쳐 다시 부른다. */
  call<K extends GitFn>(fn: K, arg: GitArg<K>): Promise<GitData<K> | null>;
  say(text: string, bad?: boolean): void;
  ask(options: AskOptions): Promise<{ ok: boolean; value: string }>;
  /** 헤더(브랜치·앞섬/뒤처짐)를 다시 읽는다 */
  changed(): Promise<void>;
  /** 방금 읽은 overview를 헤더에 그대로 쓴다(같은 걸 한 번 더 읽지 않는다) */
  adopt(overview: Overview): void;
  goto(view: 'changes' | 'branches' | 'history' | 'stash' | 'conflicts'): void;
  /** 보호 브랜치 이름인지(칩 표시용) */
  isProtected(name: string): boolean;
  /** 지금 브랜치 이름(분리된 HEAD면 null) */
  branch(): string | null;
  /** 이 레포의 커밋·브랜치 이름 방식 안내(못 읽으면 null). 레포마다 한 번만 읽는다. */
  conventions(): Promise<ConventionsView | null>;
  /** 헤더와 지금 화면을 모두 다시 읽는다 */
  reload(): Promise<void>;
}

export interface AskOptions {
  readonly title: string;
  readonly body?: string;
  /** secret: 비밀번호 칸(글자를 가린다) */
  readonly input?: { readonly label: string; readonly value: string; readonly secret?: boolean };
  readonly okLabel: string;
  readonly danger?: boolean;
}

/** 앱 안 확인 창(시스템 창이 아니다). Esc는 취소. */
export function askDialog(o: AskOptions): Promise<{ ok: boolean; value: string }> {
  return new Promise((resolve) => {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog');
    box.appendChild(el('b', undefined, o.title));
    if (o.body !== undefined) box.appendChild(el('p', 'gpre', o.body));
    let field: HTMLInputElement | null = null;
    if (o.input !== undefined) {
      box.appendChild(el('span', 'dim', o.input.label));
      field = el('input', 'ginput');
      if (o.input.secret === true) {
        field.type = 'password';
        field.autocomplete = 'off';
      }
      field.value = o.input.value;
      box.appendChild(field);
    }
    const row = el('div', 'btns');
    const cancel = el('button', 'btn', 'Cancel');
    const ok = el('button', o.danger === true ? 'btn danger' : 'btn primary', o.okLabel);
    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      veil.remove();
      resolve({ ok: result, value: field?.value ?? '' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (isEnterKey(e) && field !== null && document.activeElement === field) close(true);
    };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey, true);
    row.append(cancel, ok);
    box.appendChild(row);
    veil.appendChild(box);
    document.body.appendChild(veil);
    (field ?? cancel).focus();
  });
}

export interface DiffOptions {
  /** stage: 아직 스테이지 안 한 변경을 고른다 · unstage: 스테이지된 것을 푼다 · view: 읽기만 */
  readonly mode: 'stage' | 'unstage' | 'view';
  readonly apply?: (selection: Selection) => void;
  /** view 모드에서 hunk 머리줄 오른쪽에 붙일 것(예: 변경 보기의 Revert hunk 단추). 없으면 null */
  readonly hunkTag?: (index: number) => HTMLElement | null;
}

/** diff를 좌우 줄 번호와 추가·삭제 색으로 그린다. stage·unstage 모드는 줄과 hunk를 골라 적용한다. */
export function renderDiff(diff: DiffView, options: DiffOptions): HTMLElement {
  const root = el('div', 'gdiff');
  if (diff.binary) return (root.appendChild(el('div', 'dim pad', 'Binary file: the content cannot be shown.')), root);
  if (diff.hunks.length === 0) return (root.appendChild(el('div', 'dim pad', 'No changes.')), root);
  const selectable = options.mode !== 'view';
  const picked = new Map<number, Set<number>>();
  const bar = el('div', 'gdbar');
  const count = el('span', 'dim', '');
  const applyBtn = el('button', 'btn', options.mode === 'stage' ? 'Stage selected lines' : 'Unstage selected lines');
  const refreshBar = () => {
    const n = [...picked.values()].reduce((s, v) => s + v.size, 0);
    count.textContent = n === 0 ? 'Click the box next to a line number to pick lines, or use a hunk button to move a whole chunk.' : `${n} line(s) selected`;
    applyBtn.disabled = n === 0;
  };
  const finish = (sel: Selection) => options.apply?.(sel);
  applyBtn.addEventListener('click', () => finish({ lines: Object.fromEntries([...picked].map(([h, s]) => [h, [...s]])) }));
  if (selectable) {
    bar.append(count, applyBtn);
    root.appendChild(bar);
    refreshBar();
  }
  // 큰 diff는 한꺼번에 그리지 않는다: 처음 DIFF_FIRST_LINES줄만 그리고 "더 보기"로 이어 그린다(화면 요소 수만 개가 탭을 멈추게 하던 것)
  const total = diff.hunks.reduce((n, h) => n + 1 + h.lines.length, 0);
  let drawn = 0;
  let hi = 0;
  let li = 0;
  let more: HTMLButtonElement | null = null;
  const hunkRows: { box: HTMLInputElement; li: number }[][] = [];
  const hunkChecks: HTMLInputElement[] = [];
  const drawChunk = (budget: number): void => {
    more?.remove();
    more = null;
    while (budget > 0 && hi < diff.hunks.length) {
      const h = diff.hunks[hi]!;
      if (li === 0) {
        const head = el('div', 'gh');
        const hcheck = el('input');
        hcheck.type = 'checkbox';
        head.append(...(selectable ? [hcheck] : []), el('span', 'mono', h.header.replace(/\r$/, '')));
        const rows: { box: HTMLInputElement; li: number }[] = [];
        hunkRows[hi] = rows;
        hunkChecks[hi] = hcheck;
        const me = hi;
        if (selectable) {
          const hb = el('button', 'btn sm', options.mode === 'stage' ? 'Stage this hunk' : 'Unstage this hunk');
          hb.addEventListener('click', () => finish({ hunks: [me] }));
          head.appendChild(hb);
        }
        const tag = options.hunkTag?.(hi) ?? null;
        if (tag !== null) head.appendChild(tag);
        hcheck.addEventListener('change', () => {
          for (const r of rows) {
            r.box.checked = hcheck.checked;
            r.box.dispatchEvent(new Event('change'));
          }
        });
        root.appendChild(head);
        budget--;
        drawn++;
      }
      const rows = hunkRows[hi]!;
      const hcheck = hunkChecks[hi]!;
      const me = hi;
      for (; li < h.lines.length && budget > 0; li++, budget--, drawn++) {
        const l = h.lines[li]!;
        const lineNo = li;
        const row = el('div', `gl ${l.kind}`);
        const cell = el('span', 'gc');
        if (selectable && l.kind !== 'ctx') {
          const box = el('input');
          box.type = 'checkbox';
          box.addEventListener('change', () => {
            const set = picked.get(me) ?? new Set<number>();
            if (box.checked) set.add(lineNo);
            else set.delete(lineNo);
            if (set.size === 0) picked.delete(me);
            else picked.set(me, set);
            hcheck.checked = rows.every((r) => r.box.checked);
            refreshBar();
          });
          rows.push({ box, li: lineNo });
          cell.appendChild(box);
        }
        row.append(cell, el('span', 'gn', l.oldNo === null ? '' : String(l.oldNo)), el('span', 'gn', l.newNo === null ? '' : String(l.newNo)), el('span', 'gs', l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '), el('span', 'gt', l.text));
        root.appendChild(row);
      }
      if (li >= h.lines.length) {
        hi++;
        li = 0;
      }
    }
    if (drawn < total) {
      more = el('button', 'btn gmore', moreLabel(drawn, total, DIFF_MORE_LINES));
      more.type = 'button';
      more.addEventListener('click', () => drawChunk(DIFF_MORE_LINES));
      root.appendChild(more);
    }
  };
  drawChunk(DIFF_FIRST_LINES);
  return root;
}
