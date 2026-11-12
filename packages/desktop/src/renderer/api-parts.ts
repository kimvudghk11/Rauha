import type { KeyValue } from '../shared/api-request.js';
import { el, isEnterKey } from './dom.js';
import { button } from './todo-parts.js';

/** API 탭 화면 조각들이 함께 쓰는 것: 메서드 이름표, 키-값 표, 글 입력 창, 시간 표시 */

export const METHOD_CLASS: Readonly<Record<string, string>> = { GET: 'm-get', POST: 'm-post', PUT: 'm-put', PATCH: 'm-patch', DELETE: 'm-delete' };

export function methodBadge(method: string): HTMLElement {
  return el('span', `api-method ${METHOD_CLASS[method] ?? 'm-other'}`, method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method);
}

export function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** 주소를 목록에 보이기 좋게 줄인다(프로토콜 뺀 앞부분) */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').slice(0, 80);
}

export interface KvTable {
  readonly root: HTMLElement;
  rows(): KeyValue[];
  set(rows: readonly KeyValue[]): void;
}

/** 켜기·이름·값·지우기 줄들이 있는 표. 맨 아래에는 늘 빈 줄이 하나 있어 거기에 적으면 줄이 늘어난다. */
export function kvTable(onChange: () => void, labels: { key: string; value: string } = { key: 'Name', value: 'Value' }): KvTable {
  const root = el('div', 'api-kv');
  let data: KeyValue[] = [];
  const paint = (): void => {
    root.replaceChildren();
    const rows = [...data, { key: '', value: '', enabled: true }];
    rows.forEach((row, i) => {
      const last = i === data.length;
      const line = el('div', 'api-kv-row');
      const on = el('input');
      on.type = 'checkbox';
      on.checked = row.enabled;
      on.setAttribute('aria-label', 'Enabled');
      on.disabled = last;
      on.addEventListener('change', () => {
        data[i] = { ...(data[i] as KeyValue), enabled: on.checked };
        onChange();
      });
      const key = el('input', 'sm');
      key.placeholder = labels.key;
      key.value = row.key;
      key.spellcheck = false;
      const value = el('input', 'sm');
      value.placeholder = labels.value;
      value.value = row.value;
      value.spellcheck = false;
      const edit = (): void => {
        if (last) {
          if (key.value === '' && value.value === '') return;
          data = [...data, { key: key.value, value: value.value, enabled: true }];
          paint();
          (root.querySelectorAll<HTMLInputElement>('.api-kv-row')[i]?.querySelectorAll<HTMLInputElement>('input.sm')[document.activeElement === value ? 1 : 0])?.focus();
        } else data[i] = { key: key.value, value: value.value, enabled: (data[i] as KeyValue).enabled };
        onChange();
      };
      key.addEventListener('input', edit);
      value.addEventListener('input', edit);
      const del = button('×', 'btn icon sm ghost', () => {
        data = data.filter((_r, j) => j !== i);
        paint();
        onChange();
      });
      del.title = 'Remove row';
      del.setAttribute('aria-label', 'Remove row');
      del.hidden = last;
      line.append(on, key, value, del);
      root.append(line);
    });
  };
  paint();
  return {
    root,
    rows: () => data.filter((r) => r.key !== '' || r.value !== ''),
    set: (rows) => {
      data = rows.map((r) => ({ ...r }));
      paint();
    },
  };
}

export interface AskTextOptions {
  readonly title: string;
  readonly hint?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly ok: string;
  /** 여러 줄 글 칸 */
  readonly multiline?: boolean;
  /** 글 칸 아래에 붙일 요소(파일 고르기 등). 글 칸을 받아 요소를 돌려준다 */
  readonly extra?: (field: HTMLInputElement | HTMLTextAreaElement) => HTMLElement;
}

/** 글을 한 칸(또는 여러 줄) 받는 작은 창. 취소하면 null */
export function askText(o: AskTextOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog api-ask');
    const finish = (v: string | null): void => {
      veil.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const field = o.multiline === true ? el('textarea', 'api-ask-text') : el('input');
    field.value = o.value ?? '';
    field.spellcheck = false;
    if (o.placeholder !== undefined) field.placeholder = o.placeholder;
    const submit = (): void => {
      if (field.value.trim() !== '') finish(field.value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      } else if (o.multiline !== true && isEnterKey(e) && e.target === field) {
        e.preventDefault();
        submit();
      }
    };
    const btns = el('div', 'btns end');
    btns.append(button('Cancel', 'btn', () => finish(null)), button(o.ok, 'btn primary', submit));
    box.append(el('b', undefined, o.title));
    if (o.hint !== undefined) box.append(el('div', 'hint', o.hint));
    box.append(field);
    if (o.extra !== undefined) box.append(o.extra(field));
    box.append(btns);
    veil.append(box);
    document.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    field.focus();
    if (field instanceof HTMLInputElement) field.select();
  });
}
