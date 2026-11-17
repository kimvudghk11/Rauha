/** 사용자 말에서 뽑은 할 일 하나 */
export interface TodoItem {
  readonly title: string;
  readonly note: string;
  /** YYYY-MM-DD. 사용자가 날짜를 말하지 않았으면 null */
  readonly due: string | null;
  /** 이 할 일의 근거가 된 사용자 말(그대로 옮긴 것) */
  readonly quote: string;
}

const ASKS = /투두|todo|to-do|할\s*일\s*(목록|리스트|정리|만들|추가|에\s*(넣|추가|적))|(내일|오늘|이번\s*주|다음\s*주)\s*(업무|할\s*일|일정)\s*(정리|목록|만들|짜)|업무\s*(목록|리스트)/i;
/** 코드 안의 TODO 주석 이야기는 할 일 탭이 아니다 */
const CODE_TODO = /주석|코드\s*(의|안|속|에\s*있는)?\s*todo|todo\s*(주석|comment)|fixme|\/\/\s*todo/i;
const MAX_ITEMS = 20;
const TITLE_MAX = 120;
const NOTE_MAX = 2000;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "투두 정리해줘", "내일 업무 정리" 같은 말이면 사용자가 한 말에서 할 일을 뽑아 할 일 탭에 넣는다.
 * 지어낸 항목이 들어가지 않게, 근거로 든 말(quote)이 사용자 말에 실제로 있는 것만 남긴다.
 */
export class TodoAsk {
  private constructor() {}

  static asks(text: string): boolean {
    return ASKS.test(text) && !CODE_TODO.test(text);
  }

  /** 근거가 사용자 말에 있는 것만, 같은 제목은 한 번, 길이·개수 제한, 날짜 모양이 틀리면 날짜 없음 */
  static keep(items: readonly TodoItem[], said: readonly string[]): TodoItem[] {
    const corpus = said.map(squash).join('\n');
    const seen = new Set<string>();
    const out: TodoItem[] = [];
    for (const item of items) {
      const title = item.title.trim().slice(0, TITLE_MAX);
      const quote = squash(item.quote);
      if (title === '' || quote.length < 2 || !corpus.includes(quote) || seen.has(squash(title))) continue;
      seen.add(squash(title));
      out.push({ title, note: item.note.trim().slice(0, NOTE_MAX), due: item.due !== null && DAY.test(item.due) ? item.due : null, quote: item.quote.trim() });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  /** 넣은 결과를 사용자에게 보일 글 */
  static report(added: readonly TodoItem[], dropped: number): string {
    if (added.length === 0) return dropped > 0 ? '말씀하신 내용에서 할 일로 옮길 만한 것을 확실히 찾지 못했어요. 할 일을 한 줄씩 말해 주시면 넣을게요.' : '말씀하신 내용에서 할 일을 찾지 못했어요. 할 일을 한 줄씩 말해 주시면 넣을게요.';
    const lines = added.map((t) => `- ${t.title}${t.due !== null ? ` (${t.due})` : ''}`);
    return [`할 일 탭에 ${added.length}개 넣었어요.`, ...lines, ...(dropped > 0 ? [`(말씀에서 근거를 찾지 못한 ${dropped}개는 넣지 않았어요.)`] : [])].join('\n');
  }
}
