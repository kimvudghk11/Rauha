import type { ApiAuth, ApiBody, ApiRequestProps } from '../shared/api-request.js';
import { el } from './dom.js';
import { kvTable } from './api-parts.js';
import { select } from './todo-parts.js';

type Section = 'params' | 'headers' | 'body' | 'auth';
const SECTIONS: readonly (readonly [Section, string])[] = [
  ['params', 'Params'],
  ['headers', 'Headers'],
  ['body', 'Body'],
  ['auth', 'Auth'],
];
const BODY_KINDS = [
  ['none', 'None'],
  ['json', 'JSON'],
  ['form', 'Form (urlencoded)'],
  ['raw', 'Raw text'],
] as const;
const AUTH_KINDS = [
  ['none', 'No auth'],
  ['bearer', 'Bearer token'],
  ['basic', 'Basic auth'],
  ['apikey', 'API key'],
] as const;

export interface RequestEditor {
  readonly root: HTMLElement;
  /** 요청을 불러온다(URL·메서드·이름은 바깥 줄이 맡는다) */
  load(request: ApiRequestProps): void;
  /** 편집기가 가진 부분(쿼리·헤더·본문·인증)을 합쳐 요청으로 */
  read(base: ApiRequestProps): ApiRequestProps;
}

/** 요청 편집기: Params · Headers · Body · Auth 탭. 바뀔 때마다 onChange를 부른다. */
export function buildRequestEditor(onChange: () => void): RequestEditor {
  const root = el('div', 'api-editor');
  let section: Section = 'params';
  const tabs = el('div', 'tabs');
  const panels = new Map<Section, HTMLElement>();

  const params = kvTable(onChange);
  const headers = kvTable(onChange);
  const form = kvTable(onChange);

  // Body
  let bodyKind: ApiBody['kind'] = 'none';
  const bodyText = el('textarea', 'api-body-text mono');
  bodyText.placeholder = '{ "name": "value" }';
  bodyText.spellcheck = false;
  bodyText.addEventListener('input', onChange);
  const bodyNote = el('div', 'hint');
  const bodyKindSelect = select(BODY_KINDS, 'none', (v) => {
    bodyKind = v;
    paintBody();
    onChange();
  });
  const bodyArea = el('div', 'api-fields');
  const paintBody = (): void => {
    bodyKindSelect.value = bodyKind;
    bodyArea.replaceChildren();
    if (bodyKind === 'none') bodyArea.append(el('div', 'hint', 'This request has no body.'));
    else if (bodyKind === 'form') bodyArea.append(form.root);
    else {
      bodyText.placeholder = bodyKind === 'json' ? '{ "name": "value" }' : 'Text to send as the request body';
      bodyNote.textContent = bodyKind === 'json' ? 'Sent with Content-Type: application/json. Use {{name}} for variables.' : 'Sent as is. Add a Content-Type header if the server needs one.';
      bodyArea.append(bodyText, bodyNote);
    }
  };

  // Auth
  let auth: ApiAuth = { kind: 'none' };
  const authArea = el('div', 'api-fields');
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string): HTMLElement => {
    const row = el('label', 'api-field');
    row.append(el('span', 'lbl', label));
    const input = el('input');
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      set(input.value);
      onChange();
    });
    row.append(input);
    return row;
  };
  const authKindSelect = select(AUTH_KINDS, 'none', (v) => {
    auth = v === 'none' ? { kind: 'none' } : v === 'bearer' ? { kind: 'bearer', token: '' } : v === 'basic' ? { kind: 'basic', username: '', password: '' } : { kind: 'apikey', name: 'X-API-Key', value: '', in: 'header' };
    paintAuth();
    onChange();
  });
  const paintAuth = (): void => {
    authKindSelect.value = auth.kind;
    authArea.replaceChildren();
    const a = auth;
    if (a.kind === 'none') authArea.append(el('div', 'hint', 'This request sends no credentials.'));
    else {
      if (a.kind === 'bearer') authArea.append(field('Token', a.token, (v) => (auth = { kind: 'bearer', token: v }), '{{token}}'));
      else if (a.kind === 'basic') {
        authArea.append(
          field('Username', a.username, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'basic' }>), username: v }), '{{username}}'),
          field('Password', a.password, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'basic' }>), password: v }), '{{password}}'),
        );
      } else {
        const where = select([['header', 'Header'], ['query', 'Query parameter']] as const, a.in, (v) => {
          auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), in: v };
          onChange();
        });
        const wrap = el('label', 'api-field');
        wrap.append(el('span', 'lbl', 'Send in'), where);
        authArea.append(
          wrap,
          field('Name', a.name, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), name: v }), 'X-API-Key'),
          field('Value', a.value, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), value: v }), '{{api_key}}'),
        );
      }
      authArea.append(el('div', 'hint', 'Type a variable like {{token}}. A secret typed as plain text moves into the selected environment when you save, and the request keeps only its name.'));
    }
  };

  const show = (s: Section): void => {
    section = s;
    for (const [id, p] of panels) p.hidden = id !== s;
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', SECTIONS[i]?.[0] === s));
  };
  for (const [id, label] of SECTIONS) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.dataset['section'] = id;
    b.addEventListener('click', () => show(id));
    tabs.append(b);
  }
  const kvHint = (text: string): HTMLElement => el('div', 'hint', text);
  const mk = (id: Section, ...nodes: HTMLElement[]): void => {
    const p = el('div', 'api-panel');
    p.append(...nodes);
    panels.set(id, p);
  };
  mk('params', params.root, kvHint('Checked rows are added to the URL as ?name=value.'));
  mk('headers', headers.root, kvHint('Example: Accept: application/json'));
  const bodyBar = el('div', 'bar');
  bodyBar.append(el('span', 'lbl', 'Type'), bodyKindSelect);
  mk('body', bodyBar, bodyArea);
  mk('auth', (() => {
    const bar = el('div', 'bar');
    bar.append(el('span', 'lbl', 'Type'), authKindSelect);
    return bar;
  })(), authArea);
  root.append(tabs, ...panels.values());
  show(section);
  paintBody();
  paintAuth();

  const badge = (): void => {
    const counts: Record<Section, number> = {
      params: params.rows().filter((r) => r.enabled).length,
      headers: headers.rows().filter((r) => r.enabled).length,
      body: bodyKind === 'none' ? 0 : 1,
      auth: auth.kind === 'none' ? 0 : 1,
    };
    tabs.querySelectorAll('button').forEach((b, i) => {
      const [id, label] = SECTIONS[i] as readonly [Section, string];
      b.textContent = counts[id] > 0 ? `${label} (${counts[id]})` : label;
    });
  };
  tabs.addEventListener('input', badge);
  root.addEventListener('input', badge);
  root.addEventListener('change', badge);

  return {
    root,
    load: (r) => {
      params.set(r.query);
      headers.set(r.headers);
      bodyKind = r.body.kind;
      bodyText.value = r.body.kind === 'json' || r.body.kind === 'raw' ? r.body.text : '';
      form.set(r.body.kind === 'form' ? r.body.fields : []);
      auth = r.auth;
      paintBody();
      paintAuth();
      badge();
    },
    read: (base) => {
      const body: ApiBody = bodyKind === 'none' ? { kind: 'none' } : bodyKind === 'form' ? { kind: 'form', fields: form.rows() } : { kind: bodyKind, text: bodyText.value };
      return { ...base, query: params.rows(), headers: headers.rows(), body, auth };
    },
  };
}
