import type { GitArg, GitData, GitFn } from '../shared/git-api.js';
import type { DiffView } from '../shared/git-api.js';
import type { Selection } from '../shared/git-diff.js';
import { el } from './dom.js';

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
  goto(view: 'changes' | 'branches' | 'history' | 'conflicts'): void;
  /** 보호 브랜치 이름인지(칩 표시용) */
  isProtected(name: string): boolean;
}

export interface AskOptions {
  readonly title: string;
  readonly body?: string;
  readonly input?: { readonly label: string; readonly value: string };
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
      field.value = o.input.value;
      box.appendChild(field);
    }
    const row = el('div', 'btns');
    const cancel = el('button', 'btn sec', '취소');
    const ok = el('button', o.danger === true ? 'btn danger' : 'btn primary', o.okLabel);
    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      veil.remove();
      resolve({ ok: result, value: field?.value ?? '' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && field !== null && document.activeElement === field) close(true);
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
}

/** diff를 좌우 줄 번호와 추가·삭제 색으로 그린다. stage·unstage 모드는 줄과 hunk를 골라 적용한다. */
export function renderDiff(diff: DiffView, options: DiffOptions): HTMLElement {
  const root = el('div', 'gdiff');
  if (diff.binary) return (root.appendChild(el('div', 'dim pad', '바이너리 파일이라 내용을 보여 줄 수 없어요.')), root);
  if (diff.hunks.length === 0) return (root.appendChild(el('div', 'dim pad', '바뀐 내용이 없어요.')), root);
  const selectable = options.mode !== 'view';
  const picked = new Map<number, Set<number>>();
  const bar = el('div', 'gdbar');
  const count = el('span', 'dim', '');
  const applyBtn = el('button', 'btn primary', options.mode === 'stage' ? '고른 줄 스테이지' : '고른 줄 스테이지 해제');
  const refreshBar = () => {
    const n = [...picked.values()].reduce((s, v) => s + v.size, 0);
    count.textContent = n === 0 ? '줄 번호 옆 칸을 눌러 줄을 고르거나, hunk의 버튼으로 덩어리째 옮겨요.' : `고른 줄 ${n}개`;
    applyBtn.disabled = n === 0;
  };
  const finish = (sel: Selection) => options.apply?.(sel);
  applyBtn.addEventListener('click', () => finish({ lines: Object.fromEntries([...picked].map(([h, s]) => [h, [...s]])) }));
  if (selectable) {
    bar.append(count, applyBtn);
    root.appendChild(bar);
    refreshBar();
  }
  diff.hunks.forEach((h, hi) => {
    const head = el('div', 'gh');
    const hcheck = el('input');
    hcheck.type = 'checkbox';
    head.append(...(selectable ? [hcheck] : []), el('span', 'mono', h.header.replace(/\r$/, '')));
    const rows: { box: HTMLInputElement; li: number }[] = [];
    if (selectable) {
      const hb = el('button', 'btn sec', options.mode === 'stage' ? '이 덩어리 스테이지' : '이 덩어리 스테이지 해제');
      hb.addEventListener('click', () => finish({ hunks: [hi] }));
      head.appendChild(hb);
    }
    root.appendChild(head);
    h.lines.forEach((l, li) => {
      const row = el('div', `gl ${l.kind}`);
      const cell = el('span', 'gc');
      if (selectable && l.kind !== 'ctx') {
        const box = el('input');
        box.type = 'checkbox';
        box.addEventListener('change', () => {
          const set = picked.get(hi) ?? new Set<number>();
          if (box.checked) set.add(li);
          else set.delete(li);
          if (set.size === 0) picked.delete(hi);
          else picked.set(hi, set);
          hcheck.checked = rows.every((r) => r.box.checked);
          refreshBar();
        });
        rows.push({ box, li });
        cell.appendChild(box);
      }
      row.append(cell, el('span', 'gn', l.oldNo === null ? '' : String(l.oldNo)), el('span', 'gn', l.newNo === null ? '' : String(l.newNo)), el('span', 'gs', l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '), el('span', 'gt', l.text));
      root.appendChild(row);
    });
    hcheck.addEventListener('change', () => {
      for (const r of rows) {
        r.box.checked = hcheck.checked;
        r.box.dispatchEvent(new Event('change'));
      }
    });
  });
  return root;
}
