import type { WorktreeView } from '../shared/git-worktrees.js';
import { worktreeName } from '../shared/git-worktrees.js';
import { el } from './dom.js';
import type { GitCtx } from './git-common.js';
import { ago } from './git-format.js';

const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/').replace(/[/]+$/, '').toLowerCase();

/**
 * 변경 탭 맨 위의 작업 트리 그림: 세로 선 위에 점으로 메인 폴더와 worktree를 이어서 보인다.
 * 지금 보고 있는 폴더는 파란 점, 변경이 있는 폴더는 노란 점. 작업자 이름과 마지막 커밋 시각을 함께 보인다.
 */
export function buildWorktreeGraph(ctx: GitCtx) {
  const root = el('div', 'gwt');
  let rows: readonly WorktreeView[] = [];

  function draw(): void {
    root.replaceChildren();
    if (rows.length === 0) return;
    const here = norm(ctx.root());
    const now = Math.floor(Date.now() / 1000);
    root.append(el('div', 'gall', `작업 트리 ${rows.length}`));
    const list = el('ol', 'gwtl');
    rows.forEach((w, i) => {
      const li = el('li', `gwti${norm(w.path) === here ? ' on' : ''}${i === rows.length - 1 ? ' last' : ''}`);
      const dot = el('span', `gwdot${w.changed > 0 ? ' dirty' : ''}${w.prunable ? ' gone' : ''}`);
      const info = el('div', 'gwinfo');
      const top = el('div', 'gwtop');
      top.append(el('b', 'mono gwbranch', w.branch ?? '(분리된 HEAD)'));
      if (w.main) top.append(el('span', 'chip', '메인'));
      if (norm(w.path) === here) top.append(el('span', 'chip blue', '여기'));
      if (w.changed > 0) top.append(el('span', 'chip yellow', `변경 ${w.changed}`));
      if (w.locked) top.append(el('span', 'chip', '잠김'));
      if (w.prunable) top.append(el('span', 'chip red', '폴더 없음'));
      const sub = [worktreeName(w.path), w.author, w.at > 0 ? ago(w.at, now) : ''].filter((x) => x !== '').join(' · ');
      info.append(top, el('div', 'dim gwsub', sub));
      li.title = `${w.path}${w.subject === '' ? '' : `\n${w.subject}`}`;
      li.append(dot, info);
      list.append(li);
    });
    root.append(list);
  }

  async function refresh(): Promise<void> {
    rows = (await ctx.call('worktrees', undefined as never)) ?? [];
    draw();
  }
  return { root, refresh, draw };
}
