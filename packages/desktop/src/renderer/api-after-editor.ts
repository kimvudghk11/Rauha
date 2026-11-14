import { CAPTURE_SOURCES, CHECK_OPS, CHECK_TARGETS, type ApiAfter, type Capture, type CaptureSource, type Check, type CheckOp, type CheckTarget } from '../shared/api-after.js';
import { el } from './dom.js';
import { button } from './todo-parts.js';
import { select } from './todo-parts.js';

const SOURCE_LABEL: Readonly<Record<CaptureSource, string>> = { json: 'JSON path', header: 'Header', status: 'Status code', body: 'Whole body' };
const TARGET_LABEL: Readonly<Record<CheckTarget, string>> = { status: 'Status code', json: 'JSON path', header: 'Header', time: 'Response time (ms)', body: 'Body' };
const OP_LABEL: Readonly<Record<CheckOp, string>> = { eq: 'equals', neq: 'not equal', contains: 'contains', exists: 'exists', lt: 'less than', gt: 'greater than', matches: 'matches regex' };
const needsPath = (t: CaptureSource | CheckTarget): boolean => t === 'json' || t === 'header';

export interface AfterEditor {
  readonly root: HTMLElement;
  load(after: ApiAfter): void;
  read(): ApiAfter;
  /** 켜진 규칙 수(탭 배지) */
  count(): number;
}

/**
 * "After response" 탭: 응답 값을 환경 변수로 저장하는 표와, 응답 검증 표.
 * Postman 의 Tests·APIdog 의 후처리와 같은 일을 스크립트 없이 한다.
 */
export function buildAfterEditor(onChange: () => void): AfterEditor {
  const root = el('div', 'api-after');
  let captures: Capture[] = [];
  let checks: Check[] = [];

  const capHost = el('div', 'api-after-rows');
  const checkHost = el('div', 'api-after-rows');

  const input = (value: string, placeholder: string, set: (v: string) => void, cls = 'sm'): HTMLInputElement => {
    const i = el('input', cls);
    i.value = value;
    i.placeholder = placeholder;
    i.spellcheck = false;
    i.addEventListener('input', () => (set(i.value), onChange()));
    return i;
  };
  const toggle = (on: boolean, set: (v: boolean) => void): HTMLInputElement => {
    const c = el('input');
    c.type = 'checkbox';
    c.checked = on;
    c.setAttribute('aria-label', 'Enabled');
    c.addEventListener('change', () => (set(c.checked), onChange()));
    return c;
  };
  const remove = (fn: () => void): HTMLButtonElement => {
    const b = button('×', 'btn icon sm ghost', () => (fn(), paint(), onChange()));
    b.title = 'Remove row';
    b.setAttribute('aria-label', 'Remove row');
    return b;
  };

  const paint = (): void => {
    capHost.replaceChildren();
    captures.forEach((c, i) => {
      const row = el('div', 'api-after-row');
      const set = (patch: Partial<Capture>): void => void (captures[i] = { ...(captures[i] as Capture), ...patch });
      const path = input(c.path, c.from === 'json' ? '$.data.accessToken' : 'X-Request-Id', (v) => set({ path: v }));
      path.hidden = !needsPath(c.from);
      const from = select(CAPTURE_SOURCES.map((s) => [s, SOURCE_LABEL[s]] as const), c.from, (v) => {
        set({ from: v });
        path.hidden = !needsPath(v);
        path.placeholder = v === 'json' ? '$.data.accessToken' : 'X-Request-Id';
        onChange();
      });
      row.append(toggle(c.enabled, (v) => set({ enabled: v })), input(c.name, 'variable name', (v) => set({ name: v }), 'sm api-after-var'), el('span', 'dim', '←'), from, path, remove(() => (captures = captures.filter((_x, j) => j !== i))));
      capHost.append(row);
    });
    checkHost.replaceChildren();
    checks.forEach((c, i) => {
      const row = el('div', 'api-after-row');
      const set = (patch: Partial<Check>): void => void (checks[i] = { ...(checks[i] as Check), ...patch });
      const path = input(c.path, c.target === 'json' ? '$.data.id' : 'Content-Type', (v) => set({ path: v }));
      path.hidden = !needsPath(c.target);
      const value = input(c.value, 'expected', (v) => set({ value: v }));
      value.hidden = c.op === 'exists';
      const target = select(CHECK_TARGETS.map((t) => [t, TARGET_LABEL[t]] as const), c.target, (v) => {
        set({ target: v });
        path.hidden = !needsPath(v);
        path.placeholder = v === 'json' ? '$.data.id' : 'Content-Type';
        onChange();
      });
      const op = select(CHECK_OPS.map((o) => [o, OP_LABEL[o]] as const), c.op, (v) => {
        set({ op: v });
        value.hidden = v === 'exists';
        onChange();
      });
      row.append(toggle(c.enabled, (v) => set({ enabled: v })), target, path, op, value, remove(() => (checks = checks.filter((_x, j) => j !== i))));
      checkHost.append(row);
    });
  };

  const addCap = button('+ Save a value', 'btn sm', () => {
    captures = [...captures, { name: captures.length === 0 ? 'token' : '', from: 'json', path: captures.length === 0 ? '$.accessToken' : '', enabled: true }];
    paint();
    onChange();
  });
  const addCheck = button('+ Add check', 'btn sm', () => {
    checks = [...checks, checks.length === 0 ? { target: 'status', path: '', op: 'eq', value: '200', enabled: true } : { target: 'json', path: '', op: 'exists', value: '', enabled: true }];
    paint();
    onChange();
  });

  const capHead = el('div', 'bar');
  capHead.append(el('b', undefined, 'Save to environment'), el('span', 'hint grow', 'After a response, put a value into the selected environment so the next request can use {{name}}.'), addCap);
  const checkHead = el('div', 'bar');
  checkHead.append(el('b', undefined, 'Checks'), el('span', 'hint grow', 'Pass or fail is shown next to the response.'), addCheck);
  root.append(capHead, capHost, checkHead, checkHost);
  paint();

  return {
    root,
    load: (after) => {
      captures = after.captures.map((c) => ({ ...c }));
      checks = after.checks.map((c) => ({ ...c }));
      paint();
    },
    read: () => ({ captures: captures.filter((c) => c.name !== '' || c.path !== ''), checks: [...checks] }),
    count: () => captures.filter((c) => c.enabled).length + checks.filter((c) => c.enabled).length,
  };
}
