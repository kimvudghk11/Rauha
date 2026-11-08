import { BugNote, BugNoteError, type BugNoteProps } from './bug-note.js';
import { BugNoteDto } from './bug-note-dto.js';
import { BlogRedactor, type RedactContext } from './blog-redact.js';

/**
 * 내 개인 AWS(S3)에 올리고 받는 규칙. 순수 규칙만 있고 AWS 호출은 바깥(S3Port)이 한다.
 * - 프로필 이름을 사용자가 직접 적기 전에는 아무것도 하지 않는다(default 프로필을 대신 쓰지 않는다).
 * - 올리기·받기 직전에 실제 로그인된 계정 번호를 읽어 등록한 개인 계정 번호와 같을 때만 간다.
 * - 올리기 전에 공개용 가림 규칙을 거친다. 앱은 AWS 키를 받지도, 저장하지도, 읽지도 않는다.
 */

export const BUG_KEY_PREFIX = 'bug-notes/';
const KEY_PATTERN = /^bug-notes\/([A-Za-z0-9_-]{1,64})\.json$/;
const PROFILE_PATTERN = /^[A-Za-z0-9_.@+=,-]{1,64}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const ACCOUNT_PATTERN = /^\d{12}$/;
/** 받아올 때 한 번에 읽는 파일 수와 한 파일 크기의 위쪽 한계 */
export const DOWNLOAD_MAX_FILES = 500;
export const DOWNLOAD_MAX_BYTES = 64 * 1024;

export const key = (id: string): string => `${BUG_KEY_PREFIX}${id}.json`;
/** 저장소 파일 이름에서 메모 번호를 꺼낸다. 우리 모양이 아니면 null */
export const idOfKey = (k: string): string | null => KEY_PATTERN.exec(k)?.[1] ?? null;

/** 설정 화면에 적힌 네 칸(비어 있을 수 있다) */
export interface AwsInput {
  readonly profile: string | null;
  readonly bucket: string | null;
  readonly region: string | null;
  readonly account: string | null;
}

/** 올리기·받기를 막는 이유. 메시지가 그대로 화면에 보인다 */
export class BugSyncError extends Error {}

export type TargetResult = { readonly ok: true; readonly target: AwsTarget } | { readonly ok: false; readonly reason: string };

/** 올리고 받을 곳. 네 칸이 모두 올바르게 적혀 있어야 만들어진다. */
export class AwsTarget {
  private constructor(
    readonly profile: string,
    readonly bucket: string,
    readonly region: string,
    private readonly account: string,
  ) {}

  static from(input: AwsInput): TargetResult {
    const profile = input.profile?.trim() ?? '';
    if (profile === '') return { ok: false, reason: '설정에서 프로필 이름을 먼저 적어 주세요. 적기 전에는 올리거나 받지 않아요.' };
    if (!PROFILE_PATTERN.test(profile)) return { ok: false, reason: '프로필 이름에는 영문·숫자와 . _ - 만 쓸 수 있어요.' };
    const bucket = input.bucket?.trim() ?? '';
    if (!BUCKET_PATTERN.test(bucket)) return { ok: false, reason: '버킷 이름을 확인해 주세요(소문자·숫자·점·하이픈, 3~63자).' };
    const region = input.region?.trim() ?? '';
    if (!REGION_PATTERN.test(region)) return { ok: false, reason: '리전을 확인해 주세요(예: ap-northeast-2).' };
    const account = input.account?.trim() ?? '';
    if (!ACCOUNT_PATTERN.test(account)) return { ok: false, reason: '개인 계정 번호는 숫자 12자리예요.' };
    return { ok: true, target: new AwsTarget(profile, bucket, region, account) };
  }

  /** 네 칸이 올바르지 않으면 이유와 함께 던진다 */
  static require(input: AwsInput): AwsTarget {
    const r = AwsTarget.from(input);
    if (!r.ok) throw new BugSyncError(r.reason);
    return r.target;
  }

  /** 실제 계정이 등록한 개인 계정과 다르면 던진다 */
  assertAccount(actualAccount: string): void {
    const why = this.mismatch(actualAccount);
    if (why !== null) throw new BugSyncError(why);
  }

  /** 실제 로그인된 계정이 등록한 개인 계정이 아니면 이유를 돌려준다(번호는 끝 4자리만 보인다). */
  mismatch(actualAccount: string): string | null {
    if (actualAccount === this.account) return null;
    return `이 프로필(${this.profile})의 실제 계정(끝 ${tail(actualAccount)})이 등록한 개인 계정(끝 ${tail(this.account)})과 달라서 멈췄어요. 회사 계정에 올리지 않도록 막은 거예요.`;
  }
}

const tail = (account: string): string => (/^\d{4,}$/.test(account) ? account.slice(-4) : '알 수 없음');

/** 설정 칸에 보여 줄 한 줄 상태: 쓸 수 있으면 null, 아니면 이유 */
export function syncBlockReason(input: AwsInput): string | null {
  const r = AwsTarget.from(input);
  return r.ok ? null : r.reason;
}

export interface UploadItem {
  readonly id: string;
  readonly title: string;
  readonly memo: string;
  /** 이 메모에서 가려진 곳의 수 */
  readonly redactions: number;
  /** 올라갈 파일 내용(JSON 글) */
  readonly body: string;
}

export interface UploadPlan {
  readonly items: readonly UploadItem[];
  /** 미리보기와 실제 올라가는 내용이 같은지 확인하는 값 */
  readonly digest: string;
}

/** 글자 묶음 지문(32비트 FNV-1a). 보안용이 아니라 "미리보기 뒤에 내용이 바뀌지 않았다" 확인용이다. */
export function digestOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 올릴 메모를 가림 규칙에 거쳐 올릴 내용과 미리보기를 만든다. 올림 표시는 올라간 뒤에 따로 한다. */
export function planUpload(notes: readonly BugNote[], context: RedactContext): UploadPlan {
  const items = notes.map((note): UploadItem => {
    const redactor = BlogRedactor.create(context, []);
    const title = redactor.apply(note.title).text.trim();
    const memo = redactor.apply(note.memo).text;
    const redactions = redactor.changes().reduce((sum, c) => sum + c.count, 0);
    const props: BugNoteProps = { ...note.toProps(), title: title === '' ? '(제목 가림)' : title.slice(0, 80), memo: memo.slice(0, 2000), uploaded: true };
    return { id: note.id, title: props.title, memo: props.memo, redactions, body: JSON.stringify({ version: 1, ...props }) };
  });
  return { items, digest: digestOf(items.map((i) => `${i.id}\n${i.body}`).join('\n\n')) };
}

/** 받아온 파일 내용을 메모로 연다. 우리 모양이 아니거나 너무 크면 null(건너뛴다) */
export function parseDownloaded(file: string, body: string): BugNote | null {
  const id = idOfKey(file);
  if (id === null || body.length > DOWNLOAD_MAX_BYTES) return null;
  try {
    const note = BugNoteDto.from(JSON.parse(body) as unknown).toEntity();
    return note.id === id ? note : null;
  } catch (error) {
    if (error instanceof BugNoteError || error instanceof SyntaxError) return null;
    throw error;
  }
}
