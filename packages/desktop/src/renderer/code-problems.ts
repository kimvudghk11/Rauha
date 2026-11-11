import { problemCountText, type ProblemBook } from '../shared/problems.js';
import { baseName } from '../shared/open-files.js';
import { el } from './dom.js';

/**
 * 편집기 아래 Problems 목록. 열어 둔 파일의 오류·경고를 파일별로 묶어 보이고, 줄을 누르면 그 자리로 간다.
 * 상태줄의 단추(button)가 개수를 보이고 목록을 열고 닫는다.
 */
export function createProblemsPanel(openAt: (path: string, line: number, column: number) => void) {
  const root = el('div', 'code-problems');
  root.hidden = true;
  const head = el('div', 'cp-head');
  const title = el('b', undefined, 'Problems');
  const count = el('span', 'dim cp-count');
  const close = el('button', 'btn ghost icon sm', '×');
  close.title = 'Close Problems';
  head.append(title, count, close);
  const list = el('div', 'cp-list');
  root.append(head, list);

  const button = el('button', 'link cp-btn');
  button.title = 'Show or hide Problems (Ctrl/Cmd+Shift+M)';
  button.hidden = true;

  const toggle = (): void => {
    root.hidden = !root.hidden;
  };
  button.addEventListener('click', toggle);
  close.addEventListener('click', () => (root.hidden = true));

  return {
    root,
    button,
    toggle,
    /** 목록을 다시 그린다. tsActive 는 지금 파일이 TS/JS 라 단추를 보일지 */
    paint(book: ProblemBook, failure: string | null, tsActive: boolean): void {
      const c = book.counts();
      const text = failure !== null ? 'Problems unavailable' : problemCountText(c);
      button.textContent = failure !== null ? text : c.errors + c.warnings === 0 ? 'Problems: none' : `Problems: ${text}`;
      button.classList.toggle('err', c.errors > 0);
      button.hidden = !tsActive && c.errors + c.warnings === 0;
      count.textContent = failure ?? text;
      list.replaceChildren();
      const rows = book.rows();
      if (rows.length === 0) list.append(el('div', 'cp-empty', failure ?? 'No problems found in the open files.'));
      for (const { path, item } of rows) {
        const row = el('button', 'cp-row');
        row.type = 'button';
        row.append(el('span', `dot ${item.severity === 'error' ? 'red' : 'yellow'}`), el('span', 'cp-msg', item.message), el('span', 'dim cp-where', `${baseName(path)} [${item.line}, ${item.column}]`));
        row.title = `${path}:${item.line}:${item.column}  TS${item.code}`;
        row.addEventListener('click', () => openAt(path, item.line, item.column));
        list.append(row);
      }
    },
  };
}
