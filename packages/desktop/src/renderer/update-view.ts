import type { UpdateApi } from '../shared/ipc.js';
import type { UpdateView } from '../shared/update-record.js';
import { el } from './dom.js';
import { installStateText } from '../shared/update-install.js';
import { bannerText, MAC_INSTALL_NOTE } from './update-text.js';

const XATTR = 'xattr -dr com.apple.quarantine /Applications/rauha.app';

/** 위쪽 얇은 배너와 설정 화면이 같은 상태를 보도록 한 곳에서 받아 나눠 준다. */
export function createUpdateFeed(api: UpdateApi, banner: HTMLElement, platform: string) {
  const listeners = new Set<(view: UpdateView) => void>();
  let latest: UpdateView | null = null;

  function renderBanner(view: UpdateView): void {
    banner.hidden = !view.showBanner;
    if (!view.showBanner) {
      banner.replaceChildren();
      return;
    }
    const bar = el('div', 'update-bar');
    const msg = el('span', 'msg', bannerText(view));
    msg.title = msg.textContent ?? '';
    bar.appendChild(msg);
    const busy = view.install.phase === 'downloading' || view.install.phase === 'installing';
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
