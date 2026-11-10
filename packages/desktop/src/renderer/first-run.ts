import type { AuthApi } from '../shared/ipc.js';
import { el } from './dom.js';
import { createLoginControl } from './login-view.js';

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
  box.append(el('b', undefined, 'Remove the old terminal rauha?'), el('p', undefined, 'This app replaces it, so the files below will be deleted. Memory, learning notes and chat history are kept.'));
  const list = el('ul');
  for (const f of found) list.appendChild(el('li', undefined, f.path));
  box.appendChild(list);
  const row = el('div', 'btns');
  const remove = el('button', 'btn primary', 'Delete');
  const keep = el('button', 'btn', 'Keep');
  const done = (message: string) => {
    markSeen();
    box.replaceChildren(el('p', undefined, message), (() => {
      const ok = el('button', 'btn', 'Close');
      ok.addEventListener('click', () => veil.remove());
      return ok;
    })());
  };
  remove.addEventListener('click', async () => {
    const removed = await window.rauha.removeTerminalRauha(found.map((f) => f.path));
    done(removed.length > 0 ? `Deleted ${removed.length} file(s).` : 'No files were deleted.');
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

interface WizardApi {
  pickFolder(): Promise<string | null>;
  accounts(): Promise<{ names: readonly string[] }>;
  auth?: AuthApi;
  /** 폴더 안에서 찾은 레포 목록(작업 폴더로 저장된 뒤에 읽는다). 없으면 레포 경고를 건너뛴다. */
  listRepos?(): Promise<readonly { readonly kind: string }[]>;
  update(patch: { workFolder?: string; folderApproved?: boolean; account?: string | null; firstRunDone?: boolean }): Promise<unknown>;
}

/**
 * 첫 실행 마법사: 작업 폴더 고르기 → 그 폴더에서 일해도 되는지 허락 → 계정 고르기.
 * 단계마다 첫 단추에 포커스가 가고, Esc는 한 단계 앞으로 돌아간다(1단계에서는 아무것도 안 한다).
 * 끝나면 설정에 저장하고 resolve한다. 폴더를 고르고 허락하기 전에는 일을 맡길 수 없다.
 */
export function runWizard(api: WizardApi): Promise<void> {
  return new Promise((resolve) => {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog wizard');
    veil.appendChild(box);
    document.body.appendChild(veil);
    let folder: string | null = null;
    /** Esc를 눌렀을 때 돌아갈 곳(1단계는 없음) */
    let goBack: (() => void) | null = null;
    veil.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || goBack === null) return;
      e.preventDefault();
      goBack();
    });
    const focusFirst = (target: HTMLElement) => queueMicrotask(() => target.focus());
    const row = (...children: HTMLElement[]) => {
      const r = el('div', 'btns');
      r.append(...children);
      return r;
    };

    const folderStep = () => {
      goBack = null;
      const pick = el('button', 'btn primary', 'Choose folder');
      const next = el('button', 'btn', 'Next');
      next.disabled = folder === null;
      const shown = el('div', 'dim path', folder ?? 'Not chosen yet.');
      pick.addEventListener('click', async () => {
        const p = await api.pickFolder();
        if (p === null) return;
        folder = p;
        shown.textContent = p;
        next.disabled = false;
        next.classList.add('primary');
        next.focus();
      });
      next.addEventListener('click', () => void approveStep());
      box.replaceChildren(el('b', undefined, '1/3 · Choose a work folder'), el('p', undefined, 'Choose one folder that contains your repos and doc folders. rauha scans it and tells them apart. File contents are read only as needed when a job is given.'), shown, row(pick, next));
      focusFirst(pick);
    };
    const approveStep = async () => {
      goBack = folderStep;
      const yes = el('button', 'btn primary', 'Allow');
      const back = el('button', 'btn', 'Choose another folder');
      const warn = el('p', 'warn-note');
      warn.hidden = true;
      yes.addEventListener('click', () => void accountStep());
      back.addEventListener('click', folderStep);
      box.replaceChildren(el('b', undefined, '2/3 · Allow work in this folder?'), el('div', 'dim path', folder ?? ''), el('p', undefined, 'Teammates can read and edit files inside. Risky actions (pushing to a protected branch, changing production infrastructure) ask for permission each time.'), warn, row(yes, back));
      focusFirst(yes);
      // 레포가 하나도 없는 폴더면 미리 알린다(코드 작업은 레포가 있어야 한다)
      if (api.listRepos === undefined || folder === null) return;
      try {
        await api.update({ workFolder: folder });
        const found = await api.listRepos();
        if (found.some((r) => r.kind === 'repo')) return;
        warn.textContent = 'No git repo found in this folder. Questions and docs still work, but code work needs a folder with repos. Choose another folder or continue as is.';
        warn.hidden = false;
      } catch {
        /* 확인 못 하면 경고 없이 진행한다 */
      }
    };
    const accountStep = async () => {
      goBack = () => void approveStep();
      const { names } = await api.accounts();
      const select = el('select');
      select.appendChild(new Option('Follow folder rules (default)', ''));
      for (const n of names) select.appendChild(new Option(n, n));
      const done = el('button', 'btn primary', 'Get started');
      const prev = el('button', 'btn', 'Back');
      prev.addEventListener('click', () => void approveStep());
      done.addEventListener('click', async () => {
        if (done.disabled) return;
        done.disabled = true;
        await api.update({ ...(folder !== null ? { workFolder: folder } : {}), folderApproved: true, account: select.value === '' ? null : select.value, firstRunDone: true });
        veil.remove();
        resolve();
      });
      box.replaceChildren(el('b', undefined, '3/3 · Claude account to use'), el('p', undefined, 'Choose the account to use. If you are not logged in yet, use the button below to log in in your browser. Tokens are never read.'), select, ...(api.auth === undefined ? [] : [createLoginControl(api.auth).root]), row(prev, done));
      focusFirst(select);
    };
    folderStep();
  });
}
