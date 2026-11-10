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
  box.append(el('b', undefined, '예전 터미널 rauha를 지울까요?'), el('p', undefined, '이 앱이 대신하므로 아래 실행 파일을 지워요. 기억·학습 노트·대화 기록은 그대로 둬요.'));
  const list = el('ul');
  for (const f of found) list.appendChild(el('li', undefined, f.path));
  box.appendChild(list);
  const row = el('div', 'btns');
  const remove = el('button', 'btn primary', '지우기');
  const keep = el('button', 'btn', '그대로 두기');
  const done = (message: string) => {
    markSeen();
    box.replaceChildren(el('p', undefined, message), (() => {
      const ok = el('button', 'btn', '닫기');
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
      const pick = el('button', 'btn primary', '폴더 고르기');
      const next = el('button', 'btn', '다음');
      next.disabled = folder === null;
      const shown = el('div', 'dim path', folder ?? '아직 안 골랐어요.');
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
      box.replaceChildren(el('b', undefined, '1/3 · 일할 폴더를 골라요'), el('p', undefined, '레포와 문서 폴더가 들어 있는 폴더 하나를 골라 주세요. rauha가 그 안을 훑어서 레포와 문서 폴더를 알아서 구분해요. 파일 내용은 일을 맡았을 때 필요한 만큼만 읽어요.'), shown, row(pick, next));
      focusFirst(pick);
    };
    const approveStep = async () => {
      goBack = folderStep;
      const yes = el('button', 'btn primary', '허락해요');
      const back = el('button', 'btn', '다른 폴더 고르기');
      const warn = el('p', 'warn-note');
      warn.hidden = true;
      yes.addEventListener('click', () => void accountStep());
      back.addEventListener('click', folderStep);
      box.replaceChildren(el('b', undefined, '2/3 · 이 폴더에서 일해도 될까요?'), el('div', 'dim path', folder ?? ''), el('p', undefined, '팀원이 이 안의 파일을 읽고 고칠 수 있어요. 위험한 일(보호 브랜치 push, 운영 인프라 변경 등)은 그때마다 허락을 물어요.'), warn, row(yes, back));
      focusFirst(yes);
      // 레포가 하나도 없는 폴더면 미리 알린다(코드 작업은 레포가 있어야 한다)
      if (api.listRepos === undefined || folder === null) return;
      try {
        await api.update({ workFolder: folder });
        const found = await api.listRepos();
        if (found.some((r) => r.kind === 'repo')) return;
        warn.textContent = '이 폴더에서 git 레포를 찾지 못했어요. 질문·문서 일은 할 수 있지만 코드 작업은 레포가 있는 폴더가 필요해요. 다른 폴더를 고르거나 그대로 진행해도 돼요.';
        warn.hidden = false;
      } catch {
        /* 확인 못 하면 경고 없이 진행한다 */
      }
    };
    const accountStep = async () => {
      goBack = () => void approveStep();
      const { names } = await api.accounts();
      const select = el('select');
      select.appendChild(new Option('폴더 규칙에 맡기기(기본)', ''));
      for (const n of names) select.appendChild(new Option(n, n));
      const done = el('button', 'btn primary', '시작하기');
      const prev = el('button', 'btn', '이전');
      prev.addEventListener('click', () => void approveStep());
      done.addEventListener('click', async () => {
        if (done.disabled) return;
        done.disabled = true;
        await api.update({ ...(folder !== null ? { workFolder: folder } : {}), folderApproved: true, account: select.value === '' ? null : select.value, firstRunDone: true });
        veil.remove();
        resolve();
      });
      box.replaceChildren(el('b', undefined, '3/3 · 쓸 Claude 계정'), el('p', undefined, '쓸 계정을 골라요. 아직 로그인하지 않았다면 아래 버튼으로 브라우저에서 로그인해요. 토큰은 읽지 않아요.'), select, ...(api.auth === undefined ? [] : [createLoginControl(api.auth).root]), row(prev, done));
      focusFirst(select);
    };
    folderStep();
  });
}
