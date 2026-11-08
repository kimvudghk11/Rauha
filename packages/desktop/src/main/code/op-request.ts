import type { CreateRequest, DuplicateRequest, MoveRequest, PathRequest, RenameRequest } from '../../shared/code-api.js';
import { cleanRelative } from './code-path.js';

/** 화면에서 온 경로·이름 하나의 글자 수 상한(그 뒤로는 경로·이름 검사가 따로 본다) */
const MAX_TEXT = 1024;

const obj = (input: unknown): Record<string, unknown> | null => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length <= MAX_TEXT && !v.includes('\0') ? v : null);
/** 작업 폴더 기준 상대 경로(빈 문자열 = 작업 폴더). 절대 경로·`..`·`.git` 안이면 null. */
const rel = (v: unknown): string | null => {
  const t = text(v);
  return t === null ? null : cleanRelative(t);
};

/** 파일 조작 요청 DTO들. 화면이 보낸 값은 믿지 않고 모양을 다시 검사해서 만든다. 이름의 규칙(쓸 수 있는 글자 등)은 shared/code-ops의 checkName이 본다. */
export class CreateRequestDto {
  private constructor(readonly request: CreateRequest) {}
  static from(input: unknown): CreateRequestDto | null {
    const o = obj(input);
    const parent = rel(o?.['parent']);
    const name = text(o?.['name']);
    const kind = o?.['kind'];
    if (parent === null || name === null || (kind !== 'file' && kind !== 'dir')) return null;
    return new CreateRequestDto({ parent, name, kind });
  }
}

export class RenameRequestDto {
  private constructor(readonly request: RenameRequest) {}
  static from(input: unknown): RenameRequestDto | null {
    const o = obj(input);
    const path = rel(o?.['path']);
    const name = text(o?.['name']);
    return path === null || name === null ? null : new RenameRequestDto({ path, name });
  }
}

export class PathRequestDto {
  private constructor(readonly request: PathRequest) {}
  static from(input: unknown): PathRequestDto | null {
    const path = rel(obj(input)?.['path']);
    return path === null ? null : new PathRequestDto({ path });
  }
}

export class DuplicateRequestDto {
  private constructor(readonly request: DuplicateRequest) {}
  static from(input: unknown): DuplicateRequestDto | null {
    const o = obj(input);
    const path = rel(o?.['path']);
    if (path === null) return null;
    if (o?.['destDir'] === undefined || o['destDir'] === null) return new DuplicateRequestDto({ path });
    const destDir = rel(o['destDir']);
    return destDir === null ? null : new DuplicateRequestDto({ path, destDir });
  }
}

export class MoveRequestDto {
  private constructor(readonly request: MoveRequest) {}
  static from(input: unknown): MoveRequestDto | null {
    const o = obj(input);
    const path = rel(o?.['path']);
    const destDir = rel(o?.['destDir']);
    return path === null || destDir === null ? null : new MoveRequestDto({ path, destDir });
  }
}
