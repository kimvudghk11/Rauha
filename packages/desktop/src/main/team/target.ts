/** 일을 맡길 곳으로 고를 수 있는 폴더 하나(레포이거나 문서 폴더) */
export interface TargetFolder {
  readonly name: string;
  readonly root: string;
}

export interface ParsedRequest {
  /** 요청 글에서 가장 먼저 가리킨 폴더(주 작업 폴더). 없으면 null(기본 작업 폴더 그대로) */
  readonly folder: TargetFolder | null;
  /** 그 뒤에 가리킨 다른 폴더들. 주 폴더 밖이라 읽기만 한다. */
  readonly also: readonly TargetFolder[];
  /** 맨 앞 @이름을 뺀 요청 글 */
  readonly text: string;
  /** @이름을 적었는데 맞는 폴더가 없으면 그 이름(고른 폴더가 하나도 없을 때만) */
  readonly unknown: string | null;
}

/** 이름 앞뒤에 이 글자가 붙어 있으면 다른 단어의 일부로 본다(bridge-backend-v2 안의 bridge-backend). 한글 조사는 단어 경계다. */
const WORD = '[A-Za-z0-9_-]';
const MENTION = /(?:^|\s)@([^\s@]+)/g;
const TRAILING_PUNCT = /[.,!?;:)\]}"'、。]+$/;

interface Hit {
  readonly folder: TargetFolder;
  readonly start: number;
  readonly end: number;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 요청 글에서 폴더(레포) 언급을 읽는 DTO. 바깥 입력(사용자 글)을 검증·변환하는 곳이라 규칙이 여기에 있다.
 * - `@이름`은 글 어디에 있어도 알아본다. 이름만 단어로 정확히 나와도 알아본다. 대소문자는 가리지 않는다.
 * - 이름이 다른 이름의 일부면 더 긴 이름이 이긴다. 단어의 일부만 겹치는 것(frontend ↔ front)은 고르지 않는다.
 * - 대소문자만 다른 이름이 둘 이상이면 어느 쪽인지 알 수 없으니 그 이름은 고르지 않는다(추론하지 않는다).
 * - 먼저 나온 것이 주 폴더, 나머지는 함께 읽을 곳이다.
 */
export class RequestTargetDto {
  private constructor(
    readonly folder: TargetFolder | null,
    readonly also: readonly TargetFolder[],
    readonly text: string,
    readonly unknown: string | null,
  ) {}

  static from(request: string, folders: readonly TargetFolder[]): RequestTargetDto {
    const trimmed = request.trim();
    const hits = RequestTargetDto.findHits(trimmed, RequestTargetDto.unambiguous(folders));
    const ordered: TargetFolder[] = [];
    for (const h of hits) if (!ordered.includes(h.folder)) ordered.push(h.folder);
    const [folder = null, ...also] = ordered;
    if (folder === null) return new RequestTargetDto(null, [], trimmed, RequestTargetDto.firstUnknown(trimmed));
    // 맨 앞 @이름만 요청 글에서 뺀다. 문장 속 이름은 문장의 일부라 그대로 둔다.
    const first = hits[0]!;
    const leading = first.start === 0 && trimmed.startsWith('@');
    const rest = leading ? trimmed.slice(first.end).trim() : trimmed;
    return new RequestTargetDto(folder, also, rest === '' ? trimmed : rest, null);
  }

  toParsed(): ParsedRequest {
    return { folder: this.folder, also: this.also, text: this.text, unknown: this.unknown };
  }

  /** 이름이 (대소문자 무시로) 하나뿐인 폴더만 */
  private static unambiguous(folders: readonly TargetFolder[]): TargetFolder[] {
    const count = new Map<string, number>();
    for (const f of folders) count.set(f.name.toLowerCase(), (count.get(f.name.toLowerCase()) ?? 0) + 1);
    return folders.filter((f) => f.name !== '' && count.get(f.name.toLowerCase()) === 1);
  }

  /** 긴 이름부터 찾아 이미 잡힌 자리와 겹치는 짧은 이름은 버리고, 글에 나온 순서로 돌려준다. */
  private static findHits(text: string, folders: readonly TargetFolder[]): Hit[] {
    const accepted: Hit[] = [];
    const byLength = [...folders].sort((a, b) => b.name.length - a.name.length);
    for (const folder of byLength) {
      const pattern = new RegExp(`(?<!${WORD})@?${escapeRegExp(folder.name)}(?!${WORD})`, 'gi');
      for (const m of text.matchAll(pattern)) {
        const hit: Hit = { folder, start: m.index!, end: m.index! + m[0].length };
        if (!accepted.some((a) => hit.start < a.end && a.start < hit.end)) accepted.push(hit);
      }
    }
    return accepted.sort((a, b) => a.start - b.start);
  }

  /** 아는 폴더가 하나도 안 잡혔을 때, 틀린 @이름 하나를 알려 준다. */
  private static firstUnknown(text: string): string | null {
    for (const m of text.matchAll(MENTION)) {
      const name = m[1]!.replace(TRAILING_PUNCT, '');
      if (name !== '') return name;
    }
    return null;
  }
}

/** "@api-server 결제 원인 찾아줘", "bridge-backend 정리해줘"처럼 요청 글에서 대상 폴더를 정한다. */
export function parseTarget(request: string, folders: readonly TargetFolder[]): ParsedRequest {
  return RequestTargetDto.from(request, folders).toParsed();
}
