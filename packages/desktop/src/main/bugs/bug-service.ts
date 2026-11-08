import { BugNote, BugNoteError, BugNoteList } from '../../shared/bug-note.js';
import { BugListDto, BugOpDto, type BugOp } from '../../shared/bug-note-dto.js';
import type { BugDownloadResult, BugPreviewResult, BugResult, BugStateJson, BugUploadResult } from '../../shared/bug-api.js';
import { AwsTarget, BUG_KEY_PREFIX, BugSyncError, DOWNLOAD_MAX_FILES, idOfKey, key, parseDownloaded, planUpload, syncBlockReason, type AwsInput } from '../../shared/bug-sync.js';
import type { RedactContext } from '../../shared/blog-redact.js';
import type { BugStorePort } from './bug-store.js';
import { S3PortError, type S3Port } from './s3-port.js';

export interface BugServiceDeps {
  readonly store: BugStorePort;
  readonly newId: () => string;
  readonly now: () => string;
  /** 앱 버전과 OS(메모에 자동으로 붙는다) */
  readonly env: () => { readonly appVersion: string; readonly os: string };
  /** 설정의 AWS 네 칸(키는 없다) */
  readonly aws: () => AwsInput;
  /** 가림에 쓸 이름들 */
  readonly redactContext: () => RedactContext;
  /** 등록한 프로필로 저장소에 연결한다(여기서는 아직 아무것도 부르지 않는다) */
  readonly connect: (target: AwsTarget) => S3Port;
  readonly onChange?: (state: BugStateJson) => void;
}

const FALLBACK = '알 수 없는 오류로 멈췄어요. 메모는 이 컴퓨터에 그대로 있어요.';

/** 어떤 오류든 화면에 보일 이유로 바꾼다. 우리 규칙·포트가 만든 오류만 그대로 보이고, 나머지는 일반 문구다. */
function reasonOf(error: unknown): string {
  return error instanceof BugNoteError || error instanceof BugSyncError || error instanceof S3PortError ? error.message : FALLBACK;
}

/**
 * 답답한 점 서비스: 불러오기 → 엔티티 메서드 → 저장. 규칙은 BugNote·BugNoteList·AwsTarget이 지킨다.
 * 로컬 저장이 먼저이고, 올리기·받기는 그 위에 얹힌다(실패해도 로컬은 그대로).
 * 로컬 변경은 한 줄로 세워 하나씩 처리하고, 네트워크를 기다리는 동안에는 줄을 붙잡지 않는다.
 */
export class BugService {
  private list: BugNoteList | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BugServiceDeps) {}

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async current(): Promise<BugNoteList> {
    this.list ??= await this.deps.store.load();
    return this.list;
  }

  private state(list: BugNoteList): BugStateJson {
    return { items: BugListDto.fromEntity(list).toJSON().items, syncBlocked: syncBlockReason(this.deps.aws()) };
  }

  private async commit(next: BugNoteList): Promise<BugStateJson> {
    await this.deps.store.save(next);
    this.list = next;
    const state = this.state(next);
    this.deps.onChange?.(state);
    return state;
  }

  get(): Promise<BugStateJson> {
    return this.run(async () => this.state(await this.current()));
  }

  apply(raw: unknown): Promise<BugResult> {
    return this.run(async (): Promise<BugResult> => {
      try {
        const op = BugOpDto.from(raw).op;
        return { ok: true, state: await this.commit(this.applyOp(op, await this.current())) };
      } catch (error) {
        return { ok: false, error: reasonOf(error) };
      }
    });
  }

  private applyOp(op: BugOp, list: BugNoteList): BugNoteList {
    const now = this.deps.now();
    switch (op.kind) {
      case 'add':
        return list.add(BugNote.create({ title: op.title, memo: op.memo, screen: op.screen, ...this.deps.env() }, this.deps.newId(), now));
      case 'resolve':
        return list.resolve(op.id, now);
      case 'reopen':
        return list.reopen(op.id, now);
      case 'remove':
        return list.remove(op.id);
    }
  }

  /** 올리기·받기 직전: 등록한 프로필로 연결하고, 실제 계정이 등록한 개인 계정과 같은지 본다. 아니면 던진다. */
  private async guarded(): Promise<S3Port> {
    const target = AwsTarget.require(this.deps.aws());
    const port = this.deps.connect(target);
    target.assertAccount(await port.callerAccount());
    return port;
  }

  /** 올릴 메모를 가린 결과를 만든다. 계정이 맞는지도 여기서 먼저 본다(아직 아무것도 올리지 않는다). */
  async preview(): Promise<BugPreviewResult> {
    try {
      await this.guarded();
      const plan = planUpload((await this.get_()).pendingUpload(), this.deps.redactContext());
      return { ok: true, items: plan.items.map(({ id, title, memo, redactions }) => ({ id, title, memo, redactions })), digest: plan.digest };
    } catch (error) {
      return { ok: false, error: reasonOf(error) };
    }
  }

  private get_(): Promise<BugNoteList> {
    return this.run(() => this.current());
  }

  /** 미리보기와 같은 내용일 때만 올린다. 하나가 실패해도 나머지는 계속하고, 로컬은 건드리지 않는다. */
  async upload(digest: string): Promise<BugUploadResult> {
    try {
      const pending = (await this.get_()).pendingUpload();
      const plan = planUpload(pending, this.deps.redactContext());
      if (plan.digest !== digest) throw new BugSyncError('미리보기를 본 뒤 메모가 바뀌었어요. 올리기를 눌러 미리보기를 다시 확인해 주세요.');
      const port = await this.guarded();
      const sent: { id: string; updatedAt: string }[] = [];
      let failed = 0;
      let firstError: string | null = null;
      const byId = new Map(pending.map((n) => [n.id, n.updatedAt]));
      for (const item of plan.items) {
        try {
          await port.put(key(item.id), item.body);
          sent.push({ id: item.id, updatedAt: byId.get(item.id) ?? '' });
        } catch (error) {
          failed += 1;
          firstError ??= reasonOf(error);
        }
      }
      const state = await this.run(async () => this.commit((await this.current()).markUploaded(sent)));
      return { ok: true, uploaded: sent.length, failed, firstError, state };
    } catch (error) {
      return { ok: false, error: reasonOf(error) };
    }
  }

  /** 저장소의 메모를 읽어 이 컴퓨터 목록에 합친다(같은 번호는 상태가 최신인 쪽). */
  async download(): Promise<BugDownloadResult> {
    try {
      const port = await this.guarded();
      const keys = (await port.list(BUG_KEY_PREFIX)).filter((k) => idOfKey(k) !== null).slice(0, DOWNLOAD_MAX_FILES);
      const notes: BugNote[] = [];
      let skipped = 0;
      for (const k of keys) {
        try {
          const note = parseDownloaded(k, await port.get(k));
          if (note === null) skipped += 1;
          else notes.push(note);
        } catch {
          skipped += 1;
        }
      }
      return await this.run(async (): Promise<BugDownloadResult> => {
        const before = await this.current();
        const merged = before.mergeRemote(notes);
        const { added, updated } = merged.changesSince(before);
        return { ok: true, added, updated, skipped, state: await this.commit(merged) };
      });
    } catch (error) {
      return { ok: false, error: reasonOf(error) };
    }
  }
}
