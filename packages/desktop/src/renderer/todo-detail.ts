import { Checklist, ChecklistError } from '../shared/todo-checklist.js';
import { COLUMN_COLORS, type ColumnColor } from '../shared/todo-columns.js';
import { LABEL_MAX, NOTE_LIMIT, TEAM_CHOICES, TITLE_LIMIT, TODO_PRIORITIES, type Label, type Todo, type TodoPatch, type TodoPriority } from '../shared/todo-list.js';
import { el, isEnterKey } from './dom.js';
import { COLOR_LABEL, PRIORITY_LABEL, button, chipOf, confirmDialog, dueText, labelChip, meter, select, ymd, type TodoCtx } from './todo-parts.js';

export interface DetailView {
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

function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'dfield');
  row.append(el('span', 'lbl', label), control);
  return row;
}

/** 카드 상세 패널. 바꾸는 즉시(글은 잠깐 쉬었다가) 자동 저장한다. */
export function buildDetail(ctx: TodoCtx, onClose: () => void): DetailView {
  const root = el('aside', 'tdetail pane');
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
    const status = root.querySelector<HTMLElement>('.dstatus');
    if (status !== null) status.textContent = '저장 중…';
    const res = await ctx.act({ kind: 'edit', id: target, patch });
    const after = root.querySelector<HTMLElement>('.dstatus');
    const err = root.querySelector<HTMLElement>('.derr');
    if (after !== null) after.textContent = res.ok ? '저장됨' : '저장하지 못했어요';
    if (err !== null) err.textContent = res.ok ? '' : res.error;
  }

  function queue(patch: TodoPatch, soon = false): void {
    pending = { ...pending, ...patch };
    if (timer !== null) clearTimeout(timer);
    const status = root.querySelector<HTMLElement>('.dstatus');
    if (status !== null) status.textContent = '고치는 중…';
    timer = setTimeout(() => void flush(), soon ? 0 : SAVE_DELAY_MS);
  }

  function build(todo: Todo): void {
    root.replaceChildren();
    const board = ctx.board();

    // 머리: 제목 + 닫기
    const head = el('div', 'ph');
    const title = el('input', 'grow dtitle');
    title.value = todo.title;
    title.maxLength = TITLE_LIMIT;
    title.setAttribute('aria-label', '제목');
    const derr = el('div', 'err derr');
    title.addEventListener('input', () => {
      if (title.value.trim() === '') {
        derr.textContent = '제목을 적어 주세요.';
        return;
      }
      derr.textContent = '';
      queue({ title: title.value });
    });
    const close = button('×', 'btn icon sm ghost', () => {
      void flush();
      onClose();
    });
    close.title = '닫기';
    close.setAttribute('aria-label', '닫기');
    head.append(title, close);

    const body = el('div', 'dbody');

    // 칸·우선순위·마감·레포·팀
    const column = select(board.columns.items.map((c) => [c.id, c.name] as const), todo.columnId, (v) => {
      void flush().then(() => ctx.act({ kind: 'move', id: todo.id, columnId: v, beforeId: null }));
    });
    const priority = select(TODO_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const), todo.priority, (v: TodoPriority) => queue({ priority: v }, true));
    const due = el('input');
    due.type = 'date';
    due.value = todo.due ?? '';
    due.addEventListener('change', () => queue({ due: due.value === '' ? null : due.value }, true));
    const dueNote = el('span', 'hint');
    const repoNames = [...new Set([...ctx.repos(), ...(todo.repo === null ? [] : [todo.repo])])].sort();
    const repo = select([['', '없음'] as const, ...repoNames.map((n) => [n, n] as const)], todo.repo ?? '', (v) => queue({ repo: v === '' ? null : v }, true));
    const team = select([['', '자동(메인이 골라요)'] as const, ...TEAM_CHOICES.map((t) => [t.id, t.label] as const)], todo.team ?? '', (v) => queue({ team: v === '' ? null : v }, true));
    const dueRow = el('div', 'bar');
    dueRow.append(due, dueNote);
    body.append(field('칸', column), field('우선순위', priority), field('마감일', dueRow), field('레포', repo), field('맡길 팀', team));

    // 라벨
    let labels: readonly Label[] = todo.labels;
    const labelBox = el('div', 'dlabels');
    const labelInput = el('input', 'sm grow');
    labelInput.placeholder = '라벨 이름';
    labelInput.maxLength = 20;
    labelInput.setAttribute('aria-label', '새 라벨 이름');
    const labelColor = select(COLUMN_COLORS.map((c) => [c, COLOR_LABEL[c]] as const), 'blue' as ColumnColor, () => undefined, 'sm');
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
        picks.append(pick);
      }
      const add = el('div', 'bar');
      add.append(labelInput, labelColor, button('추가', 'btn sm', addLabel));
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
    }
    labelInput.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        addLabel();
      }
    });
    renderLabels();
    body.append(field('라벨', labelBox));

    // 설명
    const note = el('textarea');
    note.rows = 5;
    note.maxLength = NOTE_LIMIT;
    note.value = todo.note;
    note.placeholder = '설명(팀에 맡길 때 함께 보내요)';
    note.addEventListener('input', () => queue({ note: note.value }));
    body.append(field('설명', note));

    // 체크리스트
    let checklist = todo.checklist;
    const checkBox = el('div', 'dcheck');
    const checkErr = el('div', 'err');
    function guarded(change: () => Checklist): void {
      try {
        checkErr.textContent = '';
        checklist = change();
        queue({ checklist: checklist.items }, true);
      } catch (error) {
        if (!(error instanceof ChecklistError)) throw error;
        checkErr.textContent = error.message;
      }
      renderChecklist();
    }
    function renderChecklist(): void {
      checkBox.replaceChildren();
      const p = checklist.progress();
      if (p.total > 0) {
        const top = el('div', 'bar');
        top.append(meter(p.percent), el('span', 'hint', `${p.done}/${p.total} · ${p.percent}%`));
        checkBox.append(top);
      }
      for (const item of checklist.items) {
        const row = el('div', 'bar');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = item.done;
        box.setAttribute('aria-label', `${item.text} 완료`);
        box.addEventListener('change', () => guarded(() => checklist.toggle(item.id)));
        const text = el('input', 'sm grow');
        text.value = item.text;
        text.maxLength = 120;
        text.setAttribute('aria-label', '항목');
        text.addEventListener('change', () => guarded(() => checklist.rename(item.id, text.value)));
        const x = button('×', 'btn icon sm ghost', () => guarded(() => checklist.remove(item.id)));
        x.title = '항목 지우기';
        x.setAttribute('aria-label', `${item.text} 항목 지우기`);
        row.append(box, text, x);
        checkBox.append(row);
      }
      const add = el('input', 'sm');
      add.placeholder = '항목을 치고 Enter';
      add.maxLength = 120;
      add.setAttribute('aria-label', '새 항목');
      add.addEventListener('keydown', (e) => {
        if (isEnterKey(e) && add.value.trim() !== '') {
          e.preventDefault();
          const text = add.value;
          guarded(() => checklist.add(text, newItemId()));
          // 이어서 쓸 수 있게 입력칸에 다시 간다
          queueMicrotask(() => checkBox.querySelector<HTMLInputElement>('input[aria-label="새 항목"]')?.focus());
        }
      });
      checkBox.append(add, checkErr);
    }
    renderChecklist();
    body.append(field('체크리스트', checkBox));

    // 팀에 맡기기(선택) · 지우기
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
    actions.append(delegate, job, remove);
    const aiHint = el('div', 'hint', 'AI에 맡기는 건 선택이에요. 맡기지 않아도 카드를 그대로 관리할 수 있어요.');
    body.append(actions, aiHint);

    // 아래 줄: 저장 상태 + 시각
    const foot = el('div', 'dfoot');
    const stamps = el('span', 'hint');
    foot.append(el('span', 'hint dstatus', '저장됨'), stamps, derr);
    root.append(head, body, foot);

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
  }

  return {
    root,
    show(next: string | null): void {
      if (id !== null && id !== next) void flush();
      if (next === null) {
        id = null;
        root.hidden = true;
        root.replaceChildren();
        return;
      }
      const todo = ctx.board().get(next);
      if (todo === null) {
        id = null;
        root.hidden = true;
        return;
      }
      if (id !== next) {
        id = next;
        pending = {};
        build(todo);
      }
      root.hidden = false;
    },
    refresh(): void {
      if (id === null) return;
      if (ctx.board().get(id) === null) {
        id = null;
        root.hidden = true;
        root.replaceChildren();
        onClose();
        return;
      }
      sync();
    },
    current: () => id,
  };
}
