import type { DiagnosticsResult, UpdateApi } from '../shared/ipc.js';
import type { UpdateView } from '../shared/update-record.js';
import { canDismiss, progressModal, type ModalAction } from '../shared/update-progress.js';
import { diagnosticsText } from './diagnostics-text.js';
import { el } from './dom.js';

const MARK = { done: '✓', active: '●', pending: '○', failed: '✕' } as const;

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

  const LABEL: Record<ModalAction, string> = { cancel: '취소', retry: '다시 시도', browser: '브라우저로 받기', copy: '진단 정보 복사', close: '닫기' };

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
    if (model.detail !== null) box.append(el('p', 'hint detail', model.detail));
    if (model.reason !== null) box.append(el('p', 'err reason', model.reason));
    if (model.note !== null) box.append(el('p', 'hint note', model.note));
    const steps = el('ul', 'steps');
    for (const s of model.steps) steps.append(el('li', s.state, `${MARK[s.state]} ${s.label}`));
    box.append(steps);
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
    // 받는 동안 속도·남은 시간이 1초마다 갱신되도록
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
