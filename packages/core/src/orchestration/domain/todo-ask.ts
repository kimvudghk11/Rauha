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

/** 할 일 탭에 넣을 카드 하나. checklist 가 비면 할 일 하나짜리 카드 */
export interface TodoCard {
  readonly title: string;
  readonly note: string;
  readonly due: string | null;
  readonly checklist: readonly string[];
  /** 카드에 담긴 할 일(근거 확인을 거친 것) */
  readonly items: readonly TodoItem[];
}

/** 카드 제목에 쓰는, 사용자가 말한 때 */
const WHEN = /(오늘|내일|모레|이번\s*주|다음\s*주|이번\s*달|다음\s*달|주말)/;
/** 체크리스트 글 끝의 날짜 꼬리 */
const DUE_TAIL = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;
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

  /** 할 일 탭에 이미 있는 것(끝나지 않은 카드 제목·안 끝난 체크리스트 글)과 같은 할 일은 뺀다. 날짜 꼬리 "(YYYY-MM-DD)"는 무시한다. */
  static fresh(items: readonly TodoItem[], open: readonly string[]): { items: TodoItem[]; skipped: number } {
    const have = new Set(open.map((o) => squash(o.replace(DUE_TAIL, ''))));
    const kept = items.filter((i) => !have.has(squash(i.title)));
    return { items: kept, skipped: items.length - kept.length };
  }

  /**
   * 할 일 탭에 넣을 카드 하나. 할 일이 여럿이면 카드 하나에 체크리스트로 묶는다(할 일마다 카드를 따로 만들지 않는다).
   * 하나뿐이면 그 할 일이 카드다. 제목은 사용자가 말한 때(내일·이번 주…) → 한 파일에서 왔으면 그 파일 이름 → 정리한 날 순으로 짓는다.
   */
  static card(items: readonly TodoItem[], input: string, today: string): TodoCard {
    const dues = items.flatMap((i) => (i.due === null ? [] : [i.due])).sort();
    const due = dues[0] ?? null;
    const files = TodoAsk.sources(items);
    const from = files.length > 0 ? `출처: ${[...new Set(files.map((f) => f.replace(/\\/g, '/')))].join(', ')}` : '';
    if (items.length === 1) {
      const only = items[0]!;
      return { title: only.title, note: [only.note, from].filter((s) => s !== '').join('\n').slice(0, NOTE_MAX), due, checklist: [], items };
    }
    const notes = items.filter((i) => i.note !== '').map((i) => `- ${i.title}: ${i.note}`);
    return {
      title: TodoAsk.cardTitle(input, today, files),
      note: [...notes, from].filter((s) => s !== '').join('\n').slice(0, NOTE_MAX),
      due,
      checklist: items.map((i) => `${i.title}${i.due !== null && i.due !== due ? ` (${i.due})` : ''}`.slice(0, TITLE_MAX)),
      items,
    };
  }

  private static cardTitle(input: string, today: string, files: readonly string[]): string {
    const when = WHEN.exec(input)?.[1];
    if (when !== undefined) return `${when.replace(/\s+/g, ' ')} 할 일`;
    const names = [...new Set(files.map((f) => f.replace(/\\/g, '/').split('/').pop() ?? f))];
    if (names.length === 1) return `할 일 (${names[0]})`;
    return `할 일 정리 (${today.slice(5)})`;
  }

  /** 넣은 결과를 사용자에게 보일 글. skipped: 할 일 탭에 이미 있어 넣지 않은 수. card: 여러 할 일을 묶은 카드 */
  static report(added: readonly TodoItem[], dropped: number, skipped = 0, card: TodoCard | null = null): string {
    if (added.length === 0 && skipped === 0) return dropped > 0 ? '할 일로 옮길 만한 것을 확실히 찾지 못했어요(근거를 확인하지 못해 뺀 것이 있어요). 할 일을 한 줄씩 말해 주시거나 파일 경로를 알려 주시면 넣을게요.' : '할 일을 찾지 못했어요. 할 일을 한 줄씩 말해 주시거나 파일 경로를 알려 주시면 넣을게요.';
    const grouped = card !== null && card.checklist.length > 1;
    const lines = grouped ? card.checklist.map((c) => `- [ ] ${c}`) : added.map((t) => `- ${t.title}${t.due !== null ? ` (${t.due})` : ''}`);
    const files = TodoAsk.sources(added);
    return [
      grouped ? `할 일 탭에 카드 "${card.title}" 하나를 만들고 체크리스트 ${card.checklist.length}개를 넣었어요.` : added.length === 0 ? '새로 넣은 할 일은 없어요.' : `할 일 탭에 ${added.length}개 넣었어요.`,
      ...lines,
      ...(files.length > 0 ? [`읽은 파일: ${files.join(', ')}`] : []),
      ...(skipped > 0 ? [`(이미 할 일 탭에 있는 ${skipped}개는 다시 넣지 않았어요.)`] : []),
      ...(dropped > 0 ? [`(근거를 확인하지 못한 ${dropped}개는 넣지 않았어요.)`] : []),
    ].join('\n');
  }
}
