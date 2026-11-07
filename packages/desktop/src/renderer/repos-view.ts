import type { RepoRow } from '../shared/ipc.js';
import { el } from './dom.js';

const KIND_LABEL: Readonly<Record<RepoRow['kind'], string>> = { repo: '레포', docs: '문서 폴더', other: '기타' };

/** 앞섬·뒤처짐을 "↑2 ↓1"로. 원격이 없으면 "원격 없음". */
export function syncText(ahead: number | null, behind: number | null): string {
  if (ahead === null || behind === null) return '원격 없음';
  if (ahead === 0 && behind === 0) return '원격과 같음';
  return [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : ''].filter((x) => x !== '').join(' ');
}

/**
 * 레포 탭: 작업 폴더 안의 레포·문서 폴더 목록(브랜치, 상태, 지금 일하는 작업 수).
 * "@이름"으로 일을 맡길 때 쓰는 이름이다. 새 폴더는 "다시 읽기"로 반영한다.
 */
export function buildRepos(api: { list: () => Promise<readonly RepoRow[]> }, workFolder: () => Promise<string | null>) {
  const root = el('section', 'repos');
  const head = el('div', 'rhead');
  const refresh = el('button', 'btn sec', '다시 읽기');
  head.append(el('b', undefined, '레포'), el('span', 'hint', '작업 폴더 안의 레포와 문서 폴더예요. 일을 맡길 때 @이름으로 고를 수 있어요.'), refresh);
  const list = el('div', 'rlist');
  root.append(head, list);

  async function load(): Promise<void> {
    list.replaceChildren(el('div', 'dim pad', '작업 폴더를 읽는 중…'));
    const [rows, folder] = await Promise.all([api.list(), workFolder()]);
    list.replaceChildren();
    if (folder === null) list.appendChild(el('div', 'dim pad', '작업 폴더를 아직 고르지 않았어요. 설정에서 골라 주세요.'));
    else if (rows.length === 0) list.appendChild(el('div', 'dim pad', `${folder} 안에서 레포나 문서 폴더를 찾지 못했어요.`));
    for (const r of rows) {
      const card = el('div', 'pane repo');
      const top = el('div', 'rtop');
      top.append(el('b', undefined, `@${r.name}`), el('span', 'chip', KIND_LABEL[r.kind]));
      if (r.working > 0) top.appendChild(el('span', 'chip yellow', `작업 중 ${r.working}`));
      if (r.worktrees > 0) top.appendChild(el('span', 'chip yellow', `worktree 작업 중 ${r.worktrees}`));
      card.appendChild(top);
      card.appendChild(el('div', 'dim', r.relative === '.' ? r.root : r.relative));
      if (r.status !== null) {
        const st = el('div', 'rstat');
        st.append(el('span', undefined, r.status.branch ?? '(분리된 HEAD)'), el('span', 'dim', syncText(r.status.ahead, r.status.behind)), el('span', r.status.changed > 0 ? 'bad' : 'dim', r.status.changed > 0 ? `바뀐 파일 ${r.status.changed}` : '깨끗함'));
        card.appendChild(st);
      }
      list.appendChild(card);
    }
  }

  refresh.addEventListener('click', () => void load());
  void load();
  return { root, refresh: load };
}
