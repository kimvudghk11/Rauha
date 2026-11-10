import { Checklist, ChecklistError } from '../shared/todo-checklist.js';
import { COLUMN_COLORS, type ColumnColor } from '../shared/todo-columns.js';
import { LABEL_MAX, NOTE_LIMIT, TEAM_CHOICES, TITLE_LIMIT, TODO_PRIORITIES, type Label, type Todo, type TodoPatch, type TodoPriority } from '../shared/todo-list.js';
import { el, isEnterKey } from './dom.js';
import { COLOR_LABEL, PRIORITY_LABEL, button, chipOf, confirmDialog, dueText, labelChip, meter, select, ymd, type TodoCtx } from './todo-parts.js';

export interface DetailView {
  /** 가운데 모달의 바깥 막(보이지 않을 때는 hidden) */
  readonly root: HTMLElement;
  /** 카드를 연다(null이면 닫는다). 열려 있던 카드의 아직 안 보낸 고침은 먼저 보낸다. */
  show(id: string | null): void;
  /** 보드가 바뀐 뒤 칸·기한·맡기기 같은 읽기 부분만 맞춘다(쓰고 있는 글은 건드리지 않는다). 카드가 사라졌으면 닫는다. */
  refresh(): void;
  current(): string | null;
}

const SAVE_DELAY_MS = 500;

function newItemId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 속성 표의 한 줄: `이름 : 값` */
function prop(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'dprop');
  row.append(el('span', 'dpk', label), control);
  return row;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * 카드 창: 화면 가운데에 뜨는 모달(폭 720px, 최대 높이 85vh). 큰 제목 · `이름 : 값` 속성 표 · 자동 높이 설명 · 체크리스트.
 * Esc·바깥 누르기·× 로 닫고, 닫기 직전에 안 보낸 고침을 바로 저장한다. 바꾸는 즉시(글은 잠깐 쉬었다가) 자동 저장한다.
 */
export function buildDetail(ctx: TodoCtx, onClose: (closedId: string) => void): DetailView {
  const root = el('div', 'veil tveil');
  const modal = el('div', 'tmodal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '카드');
  root.append(modal);
  root.hidden = true;
  let id: string | null = null;
  let pending: { -readonly [K in keyof TodoPatch]: TodoPatch[K] } = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 읽기 부분을 맞추는 함수(카드를 열 때마다 새로 정해진다)
  let sync: () => void = () => undefined;

  async function flush(): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const target = id;
    if (target === null || Object.keys(pending).length === 0) return;
    const patch = pending;
    pending = {};
    const status = modal.querySelector<HTMLElement>('.dstatus');
    if (status !== null) status.textContent = '저장 중…';
    const res = await ctx.act({ kind: 'edit', id: target, patch });
    const after = modal.querySelector<HTMLElement>('.dstatus');
    const err = modal.querySelector<HTMLElement>('.derr');
    if (after !== null) after.textContent = res.ok ? '저장됨' : '저장하지 못했어요';
    if (err !== null) err.textContent = res.ok ? '' : res.error;
  }

  function queue(patch: TodoPatch, soon = false): void {
    pending = { ...pending, ...patch };
    if (timer !== null) clearTimeout(timer);
    const status = modal.querySelector<HTMLElement>('.dstatus');
    if (status !== null) status.textContent = '고치는 중…';
    timer = setTimeout(() => void flush(), soon ? 0 : SAVE_DELAY_MS);
  }

  // ── 닫기·키보드 ──

  /** 닫는다. 쓰다 만 칸의 글은 확정시키고(blur) 안 보낸 고침은 바로 보낸다. */
  function close(): void {
    const closed = id;
    if (closed === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && modal.contains(active)) active.blur();
    void flush();
    hide();
    onClose(closed);
  }

  function hide(): void {
    id = null;
    root.hidden = true;
    modal.replaceChildren();
    document.removeEventListener('keydown', onKey);
  }

  /** 다른 창(확인 창·메뉴)이 위에 떠 있으면 키 처리를 그쪽에 맡긴다 */
  const overlaid = (): boolean => document.querySelector('.menu, .veil:not(.tveil)') !== null;

  function onKey(e: KeyboardEvent): void {
    if (!root.isConnected) {
      // 할 일 탭이 바뀌어 화면이 사라졌다: 안 보낸 고침만 보내고 정리한다
      document.removeEventListener('keydown', onKey);
      void flush();
      return;
    }
    if (e.defaultPrevented || e.isComposing || overlaid()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // 포커스 가두기: 창 안의 마지막에서 Tab이면 처음으로, 처음에서 Shift+Tab이면 마지막으로
    const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hidden && n.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !modal.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // 바깥(어두운 막)을 누르면 닫는다. 창 안에서 시작한 끌기가 바깥에서 끝나도 닫지 않도록 누르기 시작한 곳을 본다.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });

  function build(todo: Todo): void {
    modal.replaceChildren();
    const board = ctx.board();

    const close_ = button('×', 'btn icon lg ghost dclose', close);
    close_.title = '닫기 (Esc)';
    close_.setAttribute('aria-label', '닫기');

    const body = el('div', 'dbody');
    const derr = el('div', 'err derr');

    // 큰 제목
    const title = el('input', 'dtitle');
    title.value = todo.title;
    title.maxLength = TITLE_LIMIT;
    title.placeholder = '제목';
    title.setAttribute('aria-label', '제목');
    title.addEventListener('input', () => {
      if (title.value.trim() === '') {
        derr.textContent = '제목을 적어 주세요.';
        return;
      }
      derr.textContent = '';
      queue({ title: title.value });
    });
    body.append(title);

    // 속성 표: 칸·우선순위·마감일·레포·맡길 팀·라벨
    const column = select(board.columns.items.map((c) => [c.id, c.hidden ? `${c.name} (숨김)` : c.name] as const), todo.columnId, (v) => {
      void flush().then(() => ctx.act({ kind: 'move', id: todo.id, columnId: v, beforeId: null }));
    });
    column.setAttribute('aria-label', '칸');
    const priority = select(TODO_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const), todo.priority, (v: TodoPriority) => queue({ priority: v }, true));
    priority.setAttribute('aria-label', '우선순위');
    const due = el('input');
    due.type = 'date';
    due.value = todo.due ?? '';
    due.setAttribute('aria-label', '마감일');
    due.addEventListener('change', () => queue({ due: due.value === '' ? null : due.value }, true));
    const dueNote = el('span', 'hint');
    const repoNames = [...new Set([...ctx.repos(), ...(todo.repo === null ? [] : [todo.repo])])].sort();
    const repo = select([['', '없음'] as const, ...repoNames.map((n) => [n, n] as const)], todo.repo ?? '', (v) => queue({ repo: v === '' ? null : v }, true));
    repo.setAttribute('aria-label', '레포');
    const team = select([['', '자동(메인이 골라요)'] as const, ...TEAM_CHOICES.map((t) => [t.id, t.label] as const)], todo.team ?? '', (v) => queue({ team: v === '' ? null : v }, true));
    team.setAttribute('aria-label', '맡길 팀');
    const dueRow = el('div', 'bar');
    dueRow.append(due, dueNote);

    // 라벨
    let labels: readonly Label[] = todo.labels;
    const labelBox = el('div', 'dlabels');
    const labelInput = el('input', 'grow');
    labelInput.placeholder = '라벨 이름';
    labelInput.maxLength = 20;
    labelInput.setAttribute('aria-label', '새 라벨 이름');
    const labelColor = select(COLUMN_COLORS.map((c) => [c, COLOR_LABEL[c]] as const), 'blue' as ColumnColor, () => undefined);
    labelColor.setAttribute('aria-label', '새 라벨 색');
    const labelErr = el('div', 'err');
    const setLabels = (next: readonly Label[]): void => {
      labels = next;
      queue({ labels }, true);
      renderLabels();
    };
    function renderLabels(): void {
      labelBox.replaceChildren();
      const chips = el('div', 'tchips');
      for (const l of labels) {
        const x = button('×', 'link', () => setLabels(labels.filter((k) => k !== l)));
        x.title = '라벨 빼기';
        x.setAttribute('aria-label', `${l.name} 라벨 빼기`);
        const unit = el('span', 'dlabel');
        unit.append(labelChip(l), x);
        chips.append(unit);
      }
      const known = ctx.board().labels().filter((k) => !labels.some((l) => l.name.toLowerCase() === k.name.toLowerCase()));
      const picks = el('div', 'tchips');
      for (const k of known) {
        const pick = el('button', `chip ${k.color === 'gray' ? '' : k.color}`.trim(), `+ ${k.name}`);
        pick.type = 'button';
        pick.addEventListener('click', () => setLabels([...labels, k]));
        const del = button('×', 'link', () =>
          confirmDialog('라벨을 지울까요?', `"${k.name}" 라벨이 모든 카드에서 빠져요. 카드는 그대로 남아요.`, [{ label: '지우기', cls: 'btn danger', pick: () => void ctx.act({ kind: 'label-remove', name: k.name }) }]),
        );
        del.title = '이 라벨을 모든 카드에서 지우기';
        del.setAttribute('aria-label', `${k.name} 라벨 모두 지우기`);
        const unit = el('span', 'dlabel');
        unit.append(pick, del);
        picks.append(unit);
      }
      const add = el('div', 'bar');
      add.append(labelInput, labelColor, button('추가', 'btn', addLabel));
      labelBox.append(chips, add, labelErr);
      if (known.length > 0) labelBox.append(picks);
    }
    function addLabel(): void {
      const name = labelInput.value.trim();
      if (name === '') return;
      if (labels.length >= LABEL_MAX) {
        labelErr.textContent = `라벨은 ${LABEL_MAX}개까지예요.`;
        return;
      }
      if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
        labelErr.textContent = '같은 라벨이 이미 있어요.';
        return;
      }
      labelErr.textContent = '';
      labelInput.value = '';
      setLabels([...labels, { name, color: labelColor.value as ColumnColor }]);
      // 이어서 쓸 수 있게 이름칸으로 돌아간다
      queueMicrotask(() => labelInput.focus());
    }
    labelInput.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        addLabel();
      }
    });
    renderLabels();

    const props = el('div', 'dprops');
    props.append(prop('칸', column), prop('우선순위', priority), prop('마감일', dueRow), prop('레포', repo), prop('맡길 팀', team), prop('라벨', labelBox));
    body.append(props);

    // 설명: 글에 맞춰 높이가 늘어난다
    const note = el('textarea', 'dnote');
    note.rows = 3;
    note.maxLength = NOTE_LIMIT;
    note.value = todo.note;
    note.placeholder = '설명을 적어 보세요(팀에 맡길 때 함께 보내요)';
    note.setAttribute('aria-label', '설명');
    const fit = (): void => {
      note.style.height = 'auto';
      note.style.height = `${note.scrollHeight}px`;
    };
    note.addEventListener('input', () => {
      fit();
      queue({ note: note.value });
    });
    title.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        note.focus();
      }
    });
    const noteBox = el('div', 'dsection');
    noteBox.append(el('div', 'lbl', '설명'), note);
    body.append(noteBox);

    // 체크리스트: Enter로 잇따라 적는다. 항목 안에서 Alt+위/아래 방향키로 순서를 바꾼다.
    let checklist = todo.checklist;
    const checkBox = el('div', 'dcheck');
    const checkErr = el('div', 'err');
    function guarded(change: () => Checklist): boolean {
      let ok = true;
      try {
        checkErr.textContent = '';
        checklist = change();
        queue({ checklist: checklist.items }, true);
      } catch (error) {
        if (!(error instanceof ChecklistError)) throw error;
        checkErr.textContent = error.message;
        ok = false;
      }
      renderChecklist();
      return ok;
    }
    const focusItem = (index: number): void => queueMicrotask(() => checkBox.querySelectorAll<HTMLInputElement>('input.dcitem')[index]?.focus());
    function renderChecklist(): void {
      checkBox.replaceChildren();
      const p = checklist.progress();
      if (p.total > 0) {
        const top = el('div', 'bar');
        top.append(meter(p.percent), el('span', 'hint', `${p.done}/${p.total} · ${p.percent}%`));
        checkBox.append(top);
      }
      checklist.items.forEach((item, index) => {
        const row = el('div', 'bar dcrow');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = item.done;
        box.setAttribute('aria-label', `${item.text} 완료`);
        box.addEventListener('change', () => guarded(() => checklist.toggle(item.id)));
        const text = el('input', 'grow dcitem');
        text.value = item.text;
        text.maxLength = 120;
        text.setAttribute('aria-label', '항목');
        // 글을 고치고 칸을 벗어나면(change) 저장한다. 같은 글이면 아무 일도 없다.
        text.addEventListener('change', () => {
          if (text.value !== item.text) guarded(() => checklist.rename(item.id, text.value));
        });
        text.addEventListener('keydown', (e) => {
          if (isEnterKey(e)) {
            e.preventDefault();
            // 글을 확정시킨 뒤 새 항목 입력칸으로 간다
            text.blur();
            queueMicrotask(() => checkBox.querySelector<HTMLInputElement>('input.dcnew')?.focus());
          } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const items = checklist.items;
            const target = e.key === 'ArrowUp' ? index - 1 : index + 1;
            if (target < 0 || target >= items.length) return;
            const beforeId = e.key === 'ArrowUp' ? items[index - 1]!.id : (items[index + 2]?.id ?? null);
            if (guarded(() => checklist.move(item.id, beforeId))) focusItem(target);
          }
        });
        const x = button('×', 'btn icon ghost', () => guarded(() => checklist.remove(item.id)));
        x.title = '항목 지우기';
        x.setAttribute('aria-label', `${item.text} 항목 지우기`);
        row.append(box, text, x);
        checkBox.append(row);
      });
      const add = el('input', 'dcnew');
      add.placeholder = '항목을 치고 Enter';
      add.maxLength = 120;
      add.setAttribute('aria-label', '새 항목');
      add.addEventListener('keydown', (e) => {
        if (isEnterKey(e) && add.value.trim() !== '') {
          e.preventDefault();
          const text = add.value;
          guarded(() => checklist.add(text, newItemId()));
          // 이어서 쓸 수 있게 입력칸에 다시 간다
          queueMicrotask(() => checkBox.querySelector<HTMLInputElement>('input.dcnew')?.focus());
        }
      });
      checkBox.append(add, checkErr);
    }
    renderChecklist();
    const checkSection = el('div', 'dsection');
    checkSection.append(el('div', 'lbl', '체크리스트'), checkBox);
    body.append(checkSection);

    // 팀에 맡기기(선택) · 복제 · 지우기
    const actions = el('div', 'btns');
    const delegate = button('팀에 맡기기', 'btn', () => {
      void flush()
        .then(() => ctx.act({ kind: 'delegate', id: todo.id }))
        .then((r) => r.ok && r.jobId !== null && ctx.openJob(r.jobId));
    });
    const job = button('진행 보기', 'btn', () => {
      const j = ctx.board().get(todo.id)?.jobId;
      if (j !== null && j !== undefined) ctx.openJob(j);
    });
    const copy = button('복제', 'btn', () => {
      void flush()
        .then(() => ctx.act({ kind: 'duplicate', id: todo.id }))
        .then((r) => {
          const status = modal.querySelector<HTMLElement>('.dstatus');
          if (r.ok && status !== null) status.textContent = '복제했어요';
        });
    });
    const remove = button('지우기', 'btn danger', () =>
      confirmDialog('카드를 지울까요?', `"${ctx.board().get(todo.id)?.title ?? todo.title}" 카드가 지워져요. 되돌릴 수 없어요.`, [
        {
          label: '지우기',
          cls: 'btn danger',
          pick: () => {
            pending = {};
            if (timer !== null) clearTimeout(timer);
            timer = null;
            void ctx.act({ kind: 'remove', id: todo.id });
          },
        },
      ]),
    );
    actions.append(delegate, job, copy, remove);
    body.append(actions, el('div', 'hint', 'AI에 맡기는 건 선택이에요. 맡기지 않아도 카드를 그대로 관리할 수 있어요.'));

    // 아래 줄: 저장 상태 + 시각
    const foot = el('div', 'dfoot');
    const stamps = el('span', 'hint');
    foot.append(el('span', 'hint dstatus', '저장됨'), stamps, derr);
    modal.append(close_, body, foot);

    sync = () => {
      const now = ctx.board().get(todo.id);
      if (now === null) return;
      const b = ctx.board();
      column.value = now.columnId;
      const d = dueText(b, now, ctx.today());
      dueNote.replaceChildren(...(d === null || !b.isOverdue(now, ctx.today()) ? [] : [chipOf(d.text, d.cls)]));
      delegate.hidden = !b.canDelegate(now);
      job.hidden = now.jobId === null;
      stamps.textContent = `만든 ${ymd(now.createdAt)} · 바꾼 ${ymd(now.updatedAt)}${now.completedAt === null ? '' : ` · 끝낸 ${ymd(now.completedAt)}`}`;
    };
    sync();
    // 설명 높이는 화면에 붙은 뒤에 잴 수 있다
    requestAnimationFrame(fit);
  }

  return {
    root,
    show(next: string | null): void {
      if (next === null) {
        if (id !== null) close();
        return;
      }
      if (id !== null && id !== next) void flush();
      const todo = ctx.board().get(next);
      if (todo === null) {
        if (id !== null) hide();
        return;
      }
      if (id !== next) {
        id = next;
        pending = {};
        build(todo);
        document.addEventListener('keydown', onKey);
      }
      root.hidden = false;
      // 처음 열 때만 제목에 초점을 둔다(이미 열려 있으면 쓰던 곳을 건드리지 않는다)
      if (!modal.contains(document.activeElement)) modal.querySelector<HTMLInputElement>('.dtitle')?.focus();
    },
    refresh(): void {
      if (id === null) return;
      if (ctx.board().get(id) === null) {
        // 다른 곳에서 카드가 지워졌다
        const gone = id;
        hide();
        onClose(gone);
        return;
      }
      sync();
    },
    current: () => id,
  };
}
