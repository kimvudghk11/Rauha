/**
 * 답답한 점(버그 메모)의 규칙. 메모(BugNote)와 목록(BugNoteList)이 스스로 규칙을 지킨다.
 * 값은 불변이다. 바꾸는 메서드는 새 값을 돌려준다(저장·화면 갱신은 바깥이 맡는다).
 * 시각은 ISO 글자로만 다뤄서 시계·시간대에 기대지 않는다.
 */

export const BUG_TITLE_LIMIT = 80;
export const BUG_MEMO_LIMIT = 2000;
export const BUG_SCREEN_LIMIT = 40;
export const BUG_ENV_LIMIT = 60;
/** 한 사람이 쓰는 앱이라 이 정도면 넘칠 일이 없다. 파일이 끝없이 커지는 것만 막는다. */
export const BUG_NOTES_MAX = 500;

export type BugStatus = 'open' | 'done';

export class BugNoteError extends Error {}

export interface BugNoteProps {
  readonly id: string;
  readonly title: string;
  readonly memo: string;
  /** 적을 때 보던 탭 이름 */
  readonly screen: string;
  readonly appVersion: string;
  readonly os: string;
  readonly createdAt: string;
  /** 상태가 마지막으로 바뀐 시각. 받아와 합칠 때 "최신 쪽"을 가린다 */
  readonly updatedAt: string;
  readonly status: BugStatus;
  /** 지금 상태 그대로 내 저장소에 올라가 있다 */
  readonly uploaded: boolean;
}

export interface BugDraft {
  readonly title: string;
  readonly memo: string;
  readonly screen: string;
  readonly appVersion: string;
  readonly os: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const isTime = (s: string): boolean => !Number.isNaN(Date.parse(s));
const clip = (s: string, n: number): string => s.trim().slice(0, n);

export class BugNote {
  private constructor(private readonly p: BugNoteProps) {}

  /** 새 메모. 제목은 꼭 있어야 하고 80자까지, 메모는 2000자까지 */
  static create(draft: BugDraft, id: string, now: string): BugNote {
    const title = draft.title.trim();
    if (title === '') throw new BugNoteError('제목을 적어 주세요.');
    if (title.length > BUG_TITLE_LIMIT) throw new BugNoteError(`제목은 ${BUG_TITLE_LIMIT}자까지예요.`);
    const memo = draft.memo.trim();
    if (memo.length > BUG_MEMO_LIMIT) throw new BugNoteError(`메모는 ${BUG_MEMO_LIMIT}자까지예요.`);
    return BugNote.restore({ id, title, memo, screen: clip(draft.screen, BUG_SCREEN_LIMIT), appVersion: clip(draft.appVersion, BUG_ENV_LIMIT), os: clip(draft.os, BUG_ENV_LIMIT), createdAt: now, updatedAt: now, status: 'open', uploaded: false });
  }

  /** 저장된 값을 다시 연다. 모양이 틀리면 던진다 */
  static restore(p: BugNoteProps): BugNote {
    if (!ID_PATTERN.test(p.id)) throw new BugNoteError('번호 모양이 올바르지 않아요.');
    if (p.title.trim() === '' || p.title.length > BUG_TITLE_LIMIT) throw new BugNoteError('제목이 올바르지 않아요.');
    if (p.memo.length > BUG_MEMO_LIMIT) throw new BugNoteError('메모가 너무 길어요.');
    if (!isTime(p.createdAt) || !isTime(p.updatedAt)) throw new BugNoteError('시각이 올바르지 않아요.');
    if (p.status !== 'open' && p.status !== 'done') throw new BugNoteError('상태가 올바르지 않아요.');
    return new BugNote({ ...p, screen: p.screen.slice(0, BUG_SCREEN_LIMIT), appVersion: p.appVersion.slice(0, BUG_ENV_LIMIT), os: p.os.slice(0, BUG_ENV_LIMIT) });
  }

  get id(): string {
    return this.p.id;
  }
  get title(): string {
    return this.p.title;
  }
  get memo(): string {
    return this.p.memo;
  }
  get status(): BugStatus {
    return this.p.status;
  }
  get uploaded(): boolean {
    return this.p.uploaded;
  }
  get createdAt(): string {
    return this.p.createdAt;
  }
  get updatedAt(): string {
    return this.p.updatedAt;
  }

  isDone(): boolean {
    return this.p.status === 'done';
  }

  toProps(): BugNoteProps {
    return this.p;
  }

  /** 해결했다고 표시한다. 이미 해결이면 그대로. 올린 뒤 바뀐 것이므로 다시 올려야 한다 */
  resolve(now: string): BugNote {
    return this.isDone() ? this : new BugNote({ ...this.p, status: 'done', updatedAt: now, uploaded: false });
  }

  /** 해결 표시를 거둔다 */
  reopen(now: string): BugNote {
    return this.isDone() ? new BugNote({ ...this.p, status: 'open', updatedAt: now, uploaded: false }) : this;
  }

  markUploaded(): BugNote {
    return this.p.uploaded ? this : new BugNote({ ...this.p, uploaded: true });
  }

  /** 같은 번호의 받아온 메모와 합친다. 상태는 더 늦게 바뀐 쪽을 따른다. 글은 이 컴퓨터 것을 그대로 둔다. */
  mergeStatus(remote: BugNote): BugNote {
    if (Date.parse(remote.p.updatedAt) > Date.parse(this.p.updatedAt)) return new BugNote({ ...this.p, status: remote.p.status, updatedAt: remote.p.updatedAt, uploaded: true });
    if (remote.p.updatedAt === this.p.updatedAt && remote.p.status === this.p.status) return this.markUploaded();
    return this;
  }

  /** 받아온 메모를 이 컴퓨터에 처음 들일 때: 이미 저장소에 있으므로 올림으로 본다 */
  asDownloaded(): BugNote {
    return this.markUploaded();
  }

  /** 채팅 입력칸·할 일 카드에 넣을 수정 요청 글 */
  asRequest(): string {
    const lines = [`[답답한 점] ${this.p.title}`];
    if (this.p.memo !== '') lines.push(this.p.memo);
    const where = [this.p.screen !== '' ? `${this.p.screen} 화면` : '', this.p.appVersion !== '' ? `v${this.p.appVersion}` : '', this.p.os].filter((s) => s !== '');
    if (where.length > 0) lines.push(`(${where.join(' · ')})`);
    return lines.join('\n');
  }
}

/** 메모 모음. 새로 적은 것이 위에 온다. */
export class BugNoteList {
  private constructor(private readonly notes: readonly BugNote[]) {}

  static empty(): BugNoteList {
    return new BugNoteList([]);
  }

  static of(notes: readonly BugNote[]): BugNoteList {
    const seen = new Set<string>();
    return new BugNoteList(notes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).slice(0, BUG_NOTES_MAX));
  }

  /** 새로 적은 것이 위. 같은 시각이면 모음에 든 순서 */
  get items(): readonly BugNote[] {
    return [...this.notes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  get size(): number {
    return this.notes.length;
  }
  open(): readonly BugNote[] {
    return this.items.filter((n) => !n.isDone());
  }
  done(): readonly BugNote[] {
    return this.items.filter((n) => n.isDone());
  }
  /** 아직 올리지 않았거나 올린 뒤 바뀐 메모 */
  pendingUpload(): readonly BugNote[] {
    return this.items.filter((n) => !n.uploaded);
  }

  find(id: string): BugNote | undefined {
    return this.notes.find((n) => n.id === id);
  }

  require(id: string): BugNote {
    const found = this.find(id);
    if (found === undefined) throw new BugNoteError('그 메모를 찾을 수 없어요.');
    return found;
  }

  add(note: BugNote): BugNoteList {
    if (this.notes.length >= BUG_NOTES_MAX) throw new BugNoteError(`메모는 ${BUG_NOTES_MAX}개까지 둘 수 있어요. 해결한 것부터 지워 주세요.`);
    return new BugNoteList([...this.notes, note]);
  }

  resolve(id: string, now: string): BugNoteList {
    return this.replace(this.require(id).resolve(now));
  }

  reopen(id: string, now: string): BugNoteList {
    return this.replace(this.require(id).reopen(now));
  }

  remove(id: string): BugNoteList {
    this.require(id);
    return new BugNoteList(this.notes.filter((n) => n.id !== id));
  }

  /** 올리기가 끝난 번호들에 올림 표시를 한다 */
  markUploaded(ids: readonly string[]): BugNoteList {
    const set = new Set(ids);
    return new BugNoteList(this.notes.map((n) => (set.has(n.id) ? n.markUploaded() : n)));
  }

  /** 받아온 메모를 합친다. 같은 번호는 상태가 최신인 쪽, 새 번호는 더한다(최대 개수까지) */
  mergeRemote(remotes: readonly BugNote[]): BugNoteList {
    let next: readonly BugNote[] = this.notes;
    for (const remote of remotes) {
      const local = next.find((n) => n.id === remote.id);
      if (local !== undefined) next = next.map((n) => (n.id === remote.id ? n.mergeStatus(remote) : n));
      else if (next.length < BUG_NOTES_MAX) next = [...next, remote.asDownloaded()];
    }
    return new BugNoteList(next);
  }

  private replace(note: BugNote): BugNoteList {
    return new BugNoteList(this.notes.map((n) => (n.id === note.id ? note : n)));
  }
}
