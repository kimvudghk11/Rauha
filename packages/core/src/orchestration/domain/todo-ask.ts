/** 뽑은 할 일 하나 */
export interface TodoItem {
  readonly title: string;
  readonly note: string;
  /** YYYY-MM-DD. 사용자나 파일이 날짜를 말하지 않았으면 null */
  readonly due: string | null;
  /** 근거가 된 말이나 파일의 줄(그대로 옮긴 것) */
  readonly quote: string;
  /** 근거가 있는 곳: 파일 경로, 사용자 말이면 null */
  readonly source: string | null;
}

const ASKS = /투두|todo|to-do|할\s*일\s*(목록|리스트|정리|만들|추가|에\s*(넣|추가|적))|(내일|오늘|이번\s*주|다음\s*주)\s*(업무|할\s*일|일정)\s*(정리|목록|만들|짜)|업무\s*(목록|리스트)/i;
/** 코드 안의 TODO 주석 이야기는 할 일 탭이 아니다 */
const CODE_TODO = /주석|코드\s*(의|안|속|에\s*있는)?\s*todo|todo\s*(주석|comment)|fixme|\/\/\s*todo/i;
/** 파일·폴더를 가리키는 말: 그 파일을 읽어 안의 할 일을 넣는다 */
const FILES = /파일|문서|폴더|디렉터리|[\w.-]+\/[\w.\-/]*|\.(md|txt|markdown|org)\b|@\S+/i;
const MAX_ITEMS = 50;
const TITLE_MAX = 120;
const NOTE_MAX = 2000;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/**
 * "투두 정리해줘", "내일 업무 정리", "docs 의 todo 파일 찾아서 넣어줘"면 할 일을 뽑아 할 일 탭에 넣는다.
 * 지어낸 항목이 들어가지 않게, 근거(quote)가 그 출처(사용자 말 또는 rauha 가 다시 읽은 파일)에 실제로 있는 것만 남긴다.
 */
export class TodoAsk {
  private constructor() {}

  static asks(text: string): boolean {
    return TodoAsk.isTodoRequest(text) && !CODE_TODO.test(text);
  }

  /** 파일·폴더를 가리키는 요청인지(그러면 팀원이 파일을 찾아 읽는다) */
  static fromFiles(text: string): boolean {
    return FILES.test(text.replace(/to-?do/gi, ''));
  }

  private static isTodoRequest(text: string): boolean {
    return ASKS.test(text);
  }

  /**
   * 근거가 출처에 있는 것만 남긴다. 사용자 말(source null)은 said 에서, 파일은 files(경로 → 내용, 못 읽었으면 null)에서 찾는다.
   * 같은 제목은 한 번, 길이·개수 제한, 날짜 모양이 틀리면 날짜 없음.
   */
  static keep(items: readonly TodoItem[], said: readonly string[], files: ReadonlyMap<string, string | null> = new Map()): TodoItem[] {
    const spoken = said.map(squash).join('\n');
    const byPath = new Map([...files].map(([p, text]) => [norm(p), text === null ? null : squash(text)] as const));
    const seen = new Set<string>();
    const out: TodoItem[] = [];
    for (const item of items) {
      const title = item.title.trim().slice(0, TITLE_MAX);
      const quote = squash(item.quote);
      const corpus = item.source === null ? spoken : (byPath.get(norm(item.source)) ?? null);
      if (title === '' || quote.length < 2 || corpus === null || !corpus.includes(quote) || seen.has(squash(title))) continue;
      seen.add(squash(title));
      out.push({ title, note: item.note.trim().slice(0, NOTE_MAX), due: item.due !== null && DAY.test(item.due) ? item.due : null, quote: item.quote.trim(), source: item.source });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  /** 근거를 확인하려고 rauha 가 다시 읽어야 할 파일들 */
  static sources(items: readonly TodoItem[]): string[] {
    return [...new Set(items.flatMap((i) => (i.source === null ? [] : [i.source])))];
  }

  /** 넣은 결과를 사용자에게 보일 글. skipped: 할 일 탭에 이미 있어 넣지 않은 수 */
  static report(added: readonly TodoItem[], dropped: number, skipped = 0): string {
    if (added.length === 0 && skipped === 0) return dropped > 0 ? '할 일로 옮길 만한 것을 확실히 찾지 못했어요(근거를 확인하지 못해 뺀 것이 있어요). 할 일을 한 줄씩 말해 주시거나 파일 경로를 알려 주시면 넣을게요.' : '할 일을 찾지 못했어요. 할 일을 한 줄씩 말해 주시거나 파일 경로를 알려 주시면 넣을게요.';
    const lines = added.map((t) => `- ${t.title}${t.due !== null ? ` (${t.due})` : ''}`);
    const files = TodoAsk.sources(added);
    return [
      `할 일 탭에 ${added.length}개 넣었어요.`,
      ...lines,
      ...(files.length > 0 ? [`읽은 파일: ${files.join(', ')}`] : []),
      ...(skipped > 0 ? [`(이미 할 일 탭에 있는 ${skipped}개는 다시 넣지 않았어요.)`] : []),
      ...(dropped > 0 ? [`(근거를 확인하지 못한 ${dropped}개는 넣지 않았어요.)`] : []),
    ].join('\n');
  }
}
