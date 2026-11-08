import { BugNote, BugNoteError, BugNoteList, BUG_NOTES_MAX, type BugNoteProps, type BugStatus } from './bug-note.js';

/** 저장 파일·화면에서 오가는 메모 하나(글자·숫자·참거짓뿐) */
export type BugNoteJson = BugNoteProps;

export interface BugListJson {
  readonly version: 1;
  readonly items: readonly BugNoteJson[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, field: string, fallback?: string): string {
  if (typeof v === 'string') return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new BugNoteError(`${field} 값이 글자가 아니에요.`);
}

/** 메모 하나의 경계: 어떤 모양이든 검사해서 BugNote가 되거나 BugNoteError를 던진다 */
export class BugNoteDto {
  private constructor(readonly json: BugNoteJson) {}

  static from(input: unknown): BugNoteDto {
    if (!isObject(input)) throw new BugNoteError('메모 모양이 올바르지 않아요.');
    const status = input['status'];
    if (status !== 'open' && status !== 'done') throw new BugNoteError('상태가 올바르지 않아요.');
    const createdAt = str(input['createdAt'], '만든 시각');
    const json: BugNoteJson = {
      id: str(input['id'], '번호'),
      title: str(input['title'], '제목'),
      memo: str(input['memo'], '메모', ''),
      screen: str(input['screen'], '화면', ''),
      appVersion: str(input['appVersion'], '앱 버전', ''),
      os: str(input['os'], 'OS', ''),
      createdAt,
      updatedAt: str(input['updatedAt'], '바뀐 시각', createdAt),
      status: status as BugStatus,
      uploaded: input['uploaded'] === true,
    };
    BugNote.restore(json);
    return new BugNoteDto(json);
  }

  static fromEntity(note: BugNote): BugNoteDto {
    return new BugNoteDto(note.toProps());
  }

  toEntity(): BugNote {
    return BugNote.restore(this.json);
  }

  toJSON(): BugNoteJson {
    return this.json;
  }
}

/** 메모 모음 파일의 경계. 깨진 항목은 건너뛰고 몇 개였는지 센다 */
export class BugListDto {
  private constructor(
    readonly items: readonly BugNoteJson[],
    readonly skipped: number,
  ) {}

  static from(input: unknown): BugListDto {
    const isList = isObject(input) && Array.isArray(input['items']);
    const raw = isList ? (input['items'] as unknown[]) : [];
    const items: BugNoteJson[] = [];
    let skipped = isList ? 0 : 1;
    for (const r of raw.slice(0, BUG_NOTES_MAX)) {
      try {
        items.push(BugNoteDto.from(r).toJSON());
      } catch {
        skipped += 1;
      }
    }
    return new BugListDto(items, skipped);
  }

  static fromEntity(list: BugNoteList): BugListDto {
    return new BugListDto(list.items.map((n) => n.toProps()), 0);
  }

  toEntity(): BugNoteList {
    return BugNoteList.of(this.items.map((j) => BugNote.restore(j)));
  }

  toJSON(): BugListJson {
    return { version: 1, items: this.items };
  }
}

/** 화면이 main에 보내는 요청 */
export type BugOp =
  | { readonly kind: 'add'; readonly title: string; readonly memo: string; readonly screen: string }
  | { readonly kind: 'resolve'; readonly id: string }
  | { readonly kind: 'reopen'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string };

export class BugOpDto {
  private constructor(readonly op: BugOp) {}

  static from(input: unknown): BugOpDto {
    if (!isObject(input)) throw new BugNoteError('요청 모양이 올바르지 않아요.');
    switch (input['kind']) {
      case 'add':
        return new BugOpDto({ kind: 'add', title: str(input['title'], '제목'), memo: str(input['memo'], '메모', ''), screen: str(input['screen'], '화면', '') });
      case 'resolve':
      case 'reopen':
      case 'remove':
        return new BugOpDto({ kind: input['kind'], id: str(input['id'], '번호') });
      default:
        throw new BugNoteError('알 수 없는 요청이에요.');
    }
  }
}
