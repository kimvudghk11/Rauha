import { tokenizeJson } from '../shared/api-json.js';
import type { AfterView, SaveBodyResult, SendResult } from '../shared/api-ipc.js';
import { RESPONSE_LIMITS, ResponseSummary, type ResponseSummaryProps, type StatusClass } from '../shared/api-response.js';
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
  /** 마지막 응답 본문 전체를 파일로 저장 */
  saveBody?(historyId: string): Promise<SaveBodyResult>;
}

type Tab = 'body' | 'headers' | 'checks';

/** 응답 뒤 규칙 결과: 검증 ✓/✗ 줄과 저장한 변수 */
function afterPanel(a: AfterView): HTMLElement {
  const wrap = el('div', 'api-checks');
  if (a.checks.length > 0) {
    for (const c of a.checks) {
      const row = el('div', `api-check ${c.pass ? 'pass' : 'fail'}`);
      row.append(el('span', 'api-check-mark', c.pass ? '✓' : '✗'), el('span', 'mono grow', c.label));
      if (!c.pass) row.append(el('span', 'dim mono', `actual: ${c.actual}`));
      wrap.append(row);
    }
  }
  if (a.captured.length > 0) {
    wrap.append(el('div', 'lbl api-check-sub', 'Saved to environment'));
    for (const c of a.captured) {
      const row = el('div', `api-check ${c.found ? 'saved' : 'fail'}`);
      row.append(el('span', 'api-check-mark', c.found ? '→' : '✗'), el('span', 'mono', `{{${c.name}}}`), el('span', 'dim mono grow', c.found ? c.value.slice(0, 120) : 'not found in the response, not saved'));
      wrap.append(row);
    }
  }
  if (a.note !== null) wrap.append(el('div', 'hint pad', a.note));
  return wrap;
}

const headersText = (headers: readonly (readonly [string, string])[]): string => headers.map(([k, v]) => `${k}: ${v}`).join('\n');

/** 응답 칸: 상태 칩·시간·크기, Body(JSON은 들여쓰기와 구문 색)·Headers, 복사(비밀 가림 옵션) */
export function buildResponseView(deps: ResponseDeps): ResponseView {
  const root = el('div', 'api-response');
  let tab: Tab = 'body';
  let current: { response: ResponseSummaryProps; masked: ResponseSummaryProps | null; historyId: string; after: AfterView | null } | null = null;

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
      if (p.preview !== undefined && p.preview.startsWith('data:image/')) {
        const img = el('img', 'api-res-image');
        img.src = p.preview;
        img.alt = `Image response (${p.contentType})`;
        wrap.append(img, el('div', 'hint pad', `${p.contentType} · ${ResponseSummary.sizeText(p.size)}`));
        return wrap;
      }
      wrap.append(el('div', 'hint pad', `Binary response (${p.contentType || 'unknown type'}, ${ResponseSummary.sizeText(p.size)}). Use Save to file to keep it.`));
      return wrap;
    }
    if (p.body === '') {
      wrap.append(el('div', 'hint pad', 'The response body is empty.'));
      return wrap;
    }
    const pre = el('pre', 'api-code mono');
    const text = r.prettyBody();
    // 아주 큰 JSON 은 색칠(수십만 개 span)을 건너뛰어 화면이 멈추지 않게
    if (r.isJson() && text.length <= 400_000) {
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
    const after = current.after;
    if (after !== null && after.checks.length > 0) {
      const passed = after.checks.filter((c) => c.pass).length;
      const chip = el('button', `chip ${passed === after.checks.length ? 'green' : 'red'} api-checks-chip`, `Checks ${passed}/${after.checks.length}`);
      chip.type = 'button';
      chip.addEventListener('click', () => ((tab = 'checks'), paint()));
      head.append(chip);
    }
    head.append(el('span', 'grow'));

    const mask = el('input');
    mask.type = 'checkbox';
    mask.checked = true;
    const maskLabel = el('label', 'api-mask');
    maskLabel.append(mask, el('span', undefined, 'Hide secrets when copying'));
    const copyBtn = button('Copy', 'btn sm', async () => {
      const source = mask.checked ? (current?.masked ?? r.masked([]).props) : (current?.response ?? p);
      const s = ResponseSummary.create(source);
      const text = tab === 'headers' ? headersText(s.props.headers) : p.binary ? '' : s.prettyBody();
      deps.say((await deps.copy(text)) ? `Copied the ${tab === 'headers' ? 'headers' : 'body'}${mask.checked ? ' (secrets hidden)' : ''}.` : 'Could not copy to the clipboard.');
    });
    const saveBody = deps.saveBody;
    const historyId = current.historyId;
    const saveBtn =
      saveBody === undefined
        ? null
        : button('Save to file', 'btn sm', async () => {
            const r = await saveBody(historyId);
            deps.say(!r.ok ? r.error : r.saved === null ? 'Not saved.' : `Saved the response to ${r.saved}.`);
          });
    const tabs = el('div', 'tabs');
    const tabList: (readonly [Tab, string])[] = [['body', 'Body'], ['headers', `Headers (${p.headers.length})`]];
    if (after !== null) tabList.push(['checks', after.checks.length > 0 ? `Checks (${after.checks.filter((c) => c.pass).length}/${after.checks.length})` : `Saved (${after.captured.filter((c) => c.found).length})`]);
    if (tab === 'checks' && after === null) tab = 'body';
    for (const [id, label] of tabList) {
      const b = el('button', `tab sm${tab === id ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        tab = id;
        paint();
      });
      tabs.append(b);
    }
    head.append(maskLabel, copyBtn);
    if (saveBtn !== null) head.append(saveBtn);

    const content = el('div', 'api-res-content');
    if (tab === 'body') content.append(body(r));
    else if (tab === 'checks' && after !== null) content.append(afterPanel(after));
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
    if (p.truncated)
      notes.append(
        el(
          'div',
          'hint',
          p.size >= RESPONSE_LIMITS.read
            ? `The response is larger than ${ResponseSummary.sizeText(RESPONSE_LIMITS.read)}; only that much was received. Save to file keeps what was received.`
            : `Showing the first ${Math.round(RESPONSE_LIMITS.show / 1_000_000)} million characters of ${ResponseSummary.sizeText(p.size)}. Save to file keeps the whole body.`,
        ),
      );
    if (after?.note) notes.append(el('div', 'hint', after.note));
    if (after !== null && after.captured.some((c) => c.found)) notes.append(el('div', 'hint', `Saved ${after.captured.filter((c) => c.found).map((c) => `{{${c.name}}}`).join(', ')} to the environment.`));
    root.replaceChildren(head, tabs, ...(notes.childElementCount > 0 ? [notes] : []), content);
  };

  return {
    root,
    empty: () => paintEmpty('Send a request to see the response', 'Pick a request on the left, or type a URL and press Send.'),
    sending: () => paintEmpty('Sending…', 'Press Cancel to stop waiting.'),
    show: (result) => {
      if (result.ok) {
        current = { response: result.response, masked: result.masked, historyId: result.historyId, after: result.after ?? null };
        // 검증이 실패하면 바로 보이게
        tab = result.after !== null && result.after !== undefined && result.after.checks.some((c) => !c.pass) ? 'checks' : 'body';
        paint();
        return;
      }
      paintEmpty(result.kind === 'cancelled' ? 'Cancelled' : result.kind === 'timeout' ? 'Timed out' : result.kind === 'missing' ? 'Missing variables' : result.kind === 'blocked' ? 'Not sent' : result.kind === 'busy' ? 'Already sending' : 'Request failed', result.error);
      root.firstElementChild?.classList.add('failed');
    },
  };
}
