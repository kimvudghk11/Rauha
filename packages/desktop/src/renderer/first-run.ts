import { el } from './dom.js';

const FLAG = 'rauha.terminalChecked';

const seen = (): boolean => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};
const markSeen = (): void => {
  try {
    localStorage.setItem(FLAG, '1');
  } catch {
    /* 기억 못 해도 다음에 한 번 더 물을 뿐이다 */
  }
};

/**
 * 첫 실행: 예전 터미널 rauha 실행 파일이 있으면 무엇을 지우는지 보여 주고, 사용자가 확인하면 지운다.
 * 기억·학습 노트·대화 기록은 건드리지 않는다. 찾은 게 없으면 아무것도 보이지 않는다.
 */
export async function offerTerminalCleanup(): Promise<void> {
  if (seen()) return;
  const found = await window.rauha.findTerminalRauha();
  if (found.length === 0) {
    markSeen();
    return;
  }
  const veil = el('div', 'veil');
  const box = el('div', 'dialog');
  box.append(el('b', undefined, '예전 터미널 rauha를 지울까요?'), el('p', undefined, '이 앱이 대신하므로 아래 실행 파일을 지워요. 기억·학습 노트·대화 기록은 그대로 둬요.'));
  const list = el('ul');
  for (const f of found) list.appendChild(el('li', undefined, f.path));
  box.appendChild(list);
  const row = el('div', 'btns');
  const remove = el('button', 'btn primary', '지우기');
  const keep = el('button', 'btn sec', '그대로 두기');
  const done = (message: string) => {
    markSeen();
    box.replaceChildren(el('p', undefined, message), (() => {
      const ok = el('button', 'btn sec', '닫기');
      ok.addEventListener('click', () => veil.remove());
      return ok;
    })());
  };
  remove.addEventListener('click', async () => {
    const removed = await window.rauha.removeTerminalRauha(found.map((f) => f.path));
    done(removed.length > 0 ? `${removed.length}개를 지웠어요.` : '지운 파일이 없어요.');
  });
  keep.addEventListener('click', () => {
    markSeen();
    veil.remove();
  });
  row.append(remove, keep);
  box.appendChild(row);
  veil.appendChild(box);
  document.body.appendChild(veil);
}
