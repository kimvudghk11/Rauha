import type { UpdateApi } from '../shared/ipc.js';
import type { UpdateView } from '../shared/update-record.js';
import { el } from './dom.js';
import { installStateText, isInstallBusy } from '../shared/update-install.js';
import { outcomeText } from '../shared/update-attempt.js';
import type { DiagnosticsResult } from '../shared/ipc.js';
import { createUpdateModal } from './update-modal.js';
import { bannerText, MAC_INSTALL_NOTE } from './update-text.js';

const XATTR = 'xattr -dr com.apple.quarantine /Applications/rauha.app';

/** 위쪽 얇은 배너와 설정 화면이 같은 상태를 보도록 한 곳에서 받아 나눠 준다. */
export function createUpdateFeed(api: UpdateApi, banner: HTMLElement, platform: string, copyDiagnostics: () => Promise<DiagnosticsResult> = async () => ({ ok: false, error: '진단 정보를 만들지 못했어요.' })) {
  const modal = createUpdateModal(api, copyDiagnostics);
  const listeners = new Set<(view: UpdateView) => void>();
  let latest: UpdateView | null = null;

  /** 지난 설치 시도의 결과("v0.1.5로 업데이트됐어요" / "업데이트가 적용되지 않았어요: 이유") */
  function renderAttempt(view: UpdateView): void {
    const a = view.attempt;
    if (a === null) return;
    banner.hidden = false;
    const bar = el('div', 'update-bar');
    const msg = el('span', 'msg', outcomeText(a));
    msg.title = msg.textContent ?? '';
    bar.appendChild(msg);
    if (a.kind === 'failed') {
      if (view.canInstall) {
        const again = el('button', 'btn sm primary', '다시 시도');
        again.addEventListener('click', () => void api.install());
        bar.appendChild(again);
      }
      if (view.hasDownload) {
        const get = el('button', 'btn sm', '브라우저로 받기');
        get.addEventListener('click', () => void api.download());
        bar.appendChild(get);
      }
    }
    const ok = el('button', 'btn sm', '확인');
    ok.addEventListener('click', () => void api.cancel());
    bar.appendChild(ok);
    banner.replaceChildren(bar);
  }

  function renderBanner(view: UpdateView): void {
    if (view.attempt !== null) return renderAttempt(view);
    banner.hidden = !view.showBanner;
    if (!view.showBanner) {
      banner.replaceChildren();
      return;
    }
    const bar = el('div', 'update-bar');
    const msg = el('span', 'msg', bannerText(view));
    msg.title = msg.textContent ?? '';
    bar.appendChild(msg);
    const busy = isInstallBusy(view.install);
    if (view.canInstall) {
      const now = el('button', 'btn sm primary', busy ? installStateText(view.install) : '지금 업데이트');
      now.disabled = busy;
      now.addEventListener('click', () => void api.install());
      bar.appendChild(now);
    }
    if (view.install.phase === 'failed') bar.appendChild(el('span', 'dim', installStateText(view.install)));
    if (view.hasDownload && !busy) {
      const get = el('button', view.canInstall ? 'btn sm' : 'btn sm primary', view.canInstall ? '브라우저로 받기' : '내려받기');
      get.addEventListener('click', () => void api.download());
      bar.appendChild(get);
    }
    const later = el('button', 'btn sm', '나중에');
    later.disabled = busy;
    later.addEventListener('click', () => void api.dismiss());
    bar.appendChild(later);
    banner.replaceChildren(bar);
    if (platform === 'darwin' && view.hasDownload && !view.canInstall) {
      const note = el('div', 'update-note');
      const [before] = MAC_INSTALL_NOTE.split(XATTR);
      note.append(before ?? '', el('code', undefined, XATTR));
      banner.appendChild(note);
    }
  }

  function push(view: UpdateView): void {
    latest = view;
    modal.render(view);
    renderBanner(view);
    for (const fn of listeners) fn(view);
  }

  api.onState(push);
  void api.state().then(push).catch(() => undefined);

  return {
    current: () => latest,
    /** 설정 화면 같은 곳이 상태 변화를 받는다. 돌려주는 함수로 그만 받는다. */
    subscribe(fn: (view: UpdateView) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type UpdateFeed = ReturnType<typeof createUpdateFeed>;
