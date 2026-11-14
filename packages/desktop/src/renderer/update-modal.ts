import type { DiagnosticsResult, UpdateApi } from '../shared/ipc.js';
import type { UpdateView } from '../shared/update-record.js';
import { canDismiss, progressModal, type ModalAction } from '../shared/update-progress.js';
import { diagnosticsText } from './diagnostics-text.js';
import { el } from './dom.js';

/**
 * 화면 가운데 업데이트 진행 모달. 그릴 내용은 shared/update-progress.ts가 정하고, 여기서는 그대로 그린다.
 * 내려받는 중 "취소"와 실패 뒤 "닫기"만 닫을 수 있다.
 */
export function createUpdateModal(api: UpdateApi, copyDiagnostics: () => Promise<DiagnosticsResult>) {
  let veil: HTMLElement | null = null;
  let latest: UpdateView | null = null;
  let startedAt = 0;
  let lastPhase = 'idle';
  let hint = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || latest === null) return;
    e.stopPropagation();
    if (canDismiss(latest.install.phase)) void api.cancel();
  };

  const act = (action: ModalAction): void => {
    hint = '';
    if (action === 'cancel' || action === 'close') void api.cancel();
    else if (action === 'retry') void api.install();
    else if (action === 'browser') void api.download();
    else
      void copyDiagnostics()
        .catch(() => null)
        .then((r) => {
          hint = diagnosticsText(r);
          paint();
        });
  };

  const LABEL: Record<ModalAction, string> = { cancel: 'Cancel', retry: 'Try again', browser: 'Get in browser', copy: 'Copy diagnostics', close: 'Close' };

  function paint(): void {
    const view = latest;
    const model = view === null ? null : progressModal(view.install, Date.now() - startedAt);
    if (model === null) {
      veil?.remove();
      veil = null;
      window.removeEventListener('keydown', onKey, true);
      clearInterval(timer);
      timer = undefined;
      return;
    }
    if (veil === null) {
      veil = el('div', 'veil');
      veil.dataset['updateModal'] = '1';
      document.body.append(veil);
      window.addEventListener('keydown', onKey, true);
    }
    const box = el('div', 'dialog');
    box.style.width = '420px';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    box.append(el('b', undefined, model.title), el('p', 'headline', model.headline));
    if (model.bar !== 'none') {
      const bar = el('div', model.bar === 'indeterminate' ? 'progress indeterminate' : 'progress');
      const fill = el('i');
      if (model.percent !== null) fill.style.width = `${model.percent}%`;
      bar.append(fill);
      bar.setAttribute('role', 'progressbar');
      if (model.percent !== null) bar.setAttribute('aria-valuenow', String(Math.round(model.percent)));
      box.append(bar);
    }
    // 진행 중에는 제목·한 줄·막대만(받은 양·속도·단계 목록은 보이지 않는다). 실패하면 이유와 버튼만 더한다
    if (model.reason !== null) box.append(el('p', 'err reason', model.reason));
    if (hint !== '') box.append(el('p', 'hint', hint));
    if (model.actions.length > 0) {
      const btns = el('div', 'btns end');
      for (const a of model.actions) {
        const b = el('button', `btn${a === 'retry' ? ' primary' : ''}`, LABEL[a]);
        b.dataset['action'] = a;
        b.addEventListener('click', () => act(a));
        btns.append(b);
      }
      box.append(btns);
    }
    veil.replaceChildren(box);
    // 막대가 1초마다 새 퍼센트로
    if (timer === undefined) timer = setInterval(paint, 1000);
  }

  return {
    render(view: UpdateView): void {
      latest = view;
      if (view.install.phase === 'downloading' && lastPhase !== 'downloading') startedAt = Date.now();
      lastPhase = view.install.phase;
      if (view.install.phase === 'idle') hint = '';
      paint();
    },
  };
}
