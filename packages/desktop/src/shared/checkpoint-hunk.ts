/**
 * 작업 변경의 hunk 단위 되돌리기에 쓰는 순수 규칙. hunk 는 번호가 아니라 내용 해시로 가리킨다
 * (화면에 그려진 diff 와 실제 diff 가 어긋나면 번호가 다른 hunk 를 가리킬 수 있으므로).
 * 바깥(git·파일)은 모른다. 패치 만들기는 FileDiff.hunkPatch, 실제 적용은 main/git/checkpoint-git.ts.
 */
import type { RevertSummary } from './checkpoint.js';
import { GitInputError } from './git-guard.js';
import type { Hunk } from './git-diff.js';

/** 파일 하나에서 hunk 별 상태를 계산하는 상한(hunk 마다 git 을 두 번 부르므로) */
export const HUNK_STATE_LIMIT = 50;

/** pending: 작업이 바꾼 그대로라 되돌릴 수 있음 · already: 이미 되돌려짐 · conflict: 작업 뒤 그 자리가 바뀌어 건너뜀 */
export type HunkState = 'pending' | 'already' | 'conflict';

/** FNV-1a 32비트 둘(시드가 다름)을 이어 16자리 16진수로. 보안용이 아니라 "화면과 실제가 같은 hunk 인가" 확인용이다. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** hunk 내용 해시: 경로·시작 줄·모든 줄(종류·글·줄끝 CR·개행 없음 표시). */
export function hunkHash(path: string, hunk: Hunk): string {
  const lines = hunk.lines.map((l) => `${l.kind}${l.cr ? 'r' : ''}${l.noEol ? 'e' : ''}:${l.text}`);
  return fingerprint([path, String(hunk.oldStart), String(hunk.newStart), ...lines].join('\n'));
}

/** 화면에서 온 hunk 해시. 형식이 아니면 만들 수 없다. */
export class HunkRef {
  private constructor(readonly value: string) {}

  static parse(input: unknown): HunkRef {
    if (typeof input !== 'string' || !/^[0-9a-f]{16}$/.test(input)) throw new GitInputError('The change id is not valid.');
    return new HunkRef(input);
  }
}

/** 해시가 맞는 hunk 번호. 없거나 둘 이상이 겹치면 null(어느 것인지 모르면 건드리지 않는다). */
export function findHunk(path: string, hunks: readonly Hunk[], ref: HunkRef): number | null {
  const at = hunks.flatMap((h, i) => (hunkHash(path, h) === ref.value ? [i] : []));
  return at.length === 1 ? at[0]! : null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** hunk 하나를 되돌리기 전 확인 창 글 */
export function hunkRevertSummary(path: string, hunk: Hunk): RevertSummary {
  const added = hunk.lines.filter((l) => l.kind === 'add').length;
  const deleted = hunk.lines.filter((l) => l.kind === 'del').length;
  const lines = [`Removes ${plural(added, 'line', 'lines')} the job added and brings back ${plural(deleted, 'line', 'lines')} it deleted, only in this part of the file (around line ${hunk.newStart}).`];
  lines.push('If the file changed there after the job, nothing is touched.');
  lines.push('Before anything changes, Rauha saves a backup so you can use Undo the undo.');
  return { title: `Revert this change in ${path}?`, body: lines.join('\n'), okLabel: 'Revert hunk' };
}
