import { tokenizeJson } from '../shared/api-json.js';
import type { SendResult } from '../shared/api-ipc.js';
import { ResponseSummary, type ResponseSummaryProps, type StatusClass } from '../shared/api-response.js';
import { el } from './dom.js';
import { button } from './todo-parts.js';

const STATUS_CHIP: Readonly<Record<StatusClass, string>> = { info: 'blue', ok: 'green', redirect: 'blue', client: 'yellow', server: 'red' };

export interface ResponseView {
  readonly root: HTMLElement;
  /** 아직 보내지 않았다 */
  empty(): void;
  sending(): void;
  show(result: SendResult): void;
}

export interface ResponseDeps {
  copy(text: string): Promise<boolean>;
  say(text: string): void;
}

const headersText = (headers: readonly (readonly [string, string])[]): string => headers.map(([k, v]) => `${k}: ${v}`).join('\n');

/** 응답 칸: 상태 칩·시간·크기, Body(JSON은 들여쓰기와 구문 색)·Headers, 복사(비밀 가림 옵션) */
export function buildResponseView(deps: ResponseDeps): ResponseView {
  const root = el('div', 'api-response');
  let tab: 'body' | 'headers' = 'body';
  let current: { response: ResponseSummaryProps; masked: ResponseSummaryProps | null } | null = null;

  const paintEmpty = (title: string, note: string): void => {
    current = null;
    root.replaceChildren(el('div', 'empty-state api-res-empty'));
    const box = root.firstElementChild as HTMLElement;
    box.append(el('b', undefined, title), el('span', 'dim', note));
  };

  const body = (r: ResponseSummary): HTMLElement => {
    const p = r.props;
    const wrap = el('div', 'api-res-body');
    if (p.binary) {
      wrap.append(el('div', 'hint pad', `Binary response (${p.contentType || 'unknown type'}, ${ResponseSummary.sizeText(p.size)}) is not shown.`));
      return wrap;
    }
    if (p.body === '') {
      wrap.append(el('div', 'hint pad', 'The response body is empty.'));
      return wrap;
    }
    const pre = el('pre', 'api-code mono');
    const text = r.prettyBody();
    if (r.isJson()) {
      for (const t of tokenizeJson(text)) {
        if (t.kind === 'text') pre.append(document.createTextNode(t.text));
        else pre.append(el('span', `j-${t.kind}`, t.text));
      }
    } else pre.textContent = text;
    wrap.append(pre);
    return wrap;
  };

  const paint = (): void => {
    if (current === null) return;
    const r = ResponseSummary.create(current.response);
    const p = r.props;
    const head = el('div', 'bar api-res-head');
    head.append(el('span', `chip ${STATUS_CHIP[r.statusClass()]}`, `${p.status} ${p.statusText}`.trim()), el('span', `api-ms${p.ms < 300 ? ' fast' : p.ms > 2000 ? ' slow' : ''}`, `${p.ms} ms`), el('span', 'dim', ResponseSummary.sizeText(p.size)));
    if (p.truncated) head.append(el('span', 'chip yellow', 'Truncated'));
    head.append(el('span', 'grow'));

    const mask = el('input');
    mask.type = 'checkbox';
    mask.checked = true;
    const maskLabel = el('label', 'api-mask');
    maskLabel.append(mask, el('span', undefined, 'Hide secrets when copying'));
    const copyBtn = button('Copy', 'btn sm', async () => {
      const source = mask.checked ? (current?.masked ?? r.masked([]).props) : (current?.response ?? p);
      const s = ResponseSummary.create(source);
      const text = tab === 'body' ? (p.binary ? '' : s.prettyBody()) : headersText(s.props.headers);
      deps.say((await deps.copy(text)) ? `Copied the ${tab}${mask.checked ? ' (secrets hidden)' : ''}.` : 'Could not copy to the clipboard.');
    });
    const tabs = el('div', 'tabs');
    for (const [id, label] of [['body', 'Body'], ['headers', `Headers (${p.headers.length})`]] as const) {
      const b = el('button', `tab sm${tab === id ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        tab = id;
        paint();
      });
      tabs.append(b);
    }
    head.append(maskLabel, copyBtn);

    const content = el('div', 'api-res-content');
    if (tab === 'body') content.append(body(r));
    else {
      const table = el('table', 'tbl');
      const tb = el('tbody');
      for (const [k, v] of p.headers) {
        const tr = el('tr');
        tr.append(el('td', 'mono api-hk', k), el('td', 'mono api-hv', v));
        tb.append(tr);
      }
      table.append(tb);
      content.append(table);
    }
    const notes = el('div', 'api-res-notes');
    if (p.redirects.length > 0) notes.append(el('div', 'hint', `Followed ${p.redirects.length} redirect${p.redirects.length > 1 ? 's' : ''}: ${p.redirects.join(' → ')}`));
    if (p.truncated) notes.append(el('div', 'hint', `Only the first part of the body was kept (the limit is ${ResponseSummary.sizeText(5 * 1024 * 1024)}).`));
    root.replaceChildren(head, tabs, ...(notes.childElementCount > 0 ? [notes] : []), content);
  };

  return {
    root,
    empty: () => paintEmpty('Send a request to see the response', 'Pick a request on the left, or type a URL and press Send.'),
    sending: () => paintEmpty('Sending…', 'Press Cancel to stop waiting.'),
    show: (result) => {
      if (result.ok) {
        current = { response: result.response, masked: result.masked };
        tab = 'body';
        paint();
        return;
      }
      paintEmpty(result.kind === 'cancelled' ? 'Cancelled' : result.kind === 'timeout' ? 'Timed out' : result.kind === 'missing' ? 'Missing variables' : result.kind === 'blocked' ? 'Not sent' : result.kind === 'busy' ? 'Already sending' : 'Request failed', result.error);
      root.firstElementChild?.classList.add('failed');
    },
  };
}
