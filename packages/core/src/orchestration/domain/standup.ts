/** 스탠드업에 넣을 저장소 하나의 사실(rauha가 git 으로 읽은 것) */
export interface StandupRepo {
  readonly name: string;
  /** 지금 브랜치. 모르면 null */
  readonly branch: string | null;
  /** 커밋 안 한 변경 파일 수 */
  readonly dirty: number;
  /** 기간 안의 내 커밋(새것부터) */
  readonly commits: readonly { readonly hash: string; readonly at: string; readonly subject: string }[];
}

const ASKS = /스탠드업|stand-?up|데일리|daily|일일\s*(보고|정리|업무)|어제\s*(한|했던)?\s*(일|작업)|퇴근\s*(전|정리|보고)|오늘\s*한\s*(일|작업)/i;
const DAY_MS = 86_400_000;

/**
 * 아침 스탠드업·퇴근 정리. 커밋·브랜치·커밋 안 한 변경은 rauha가 git 으로 모으고(모델 호출 없음),
 * 답변 팀원은 그 사실로 글만 쓴다. 저장소를 뒤지느라 턴을 쓰지 않고, 커밋에 없는 일을 지어내지 않게.
 */
export class Standup {
  private constructor() {}

  static asks(text: string): boolean {
    return ASKS.test(text);
  }

  /** 지난 근무일(YYYY-MM-DD): 월요일·주말이면 지난 금요일, 그 밖에는 어제 */
  static since(today: string): string {
    const t = Date.parse(`${today}T00:00:00Z`);
    const weekday = new Date(t).getUTCDay();
    const back = weekday === 1 ? 3 : weekday === 0 ? 2 : 1;
    return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
  }

  static block(since: string, repos: readonly StandupRepo[]): string {
    const busy = repos.filter((r) => r.commits.length > 0 || r.dirty > 0);
    const head = `<work_log since="${since}">\nrauha가 git 으로 모은 ${since} 이후 내 커밋과 지금 상태입니다. 이것만으로 쓰고, 여기 없는 일은 지어내지 마세요.`;
    if (busy.length === 0) return `${head}\n이 기간에 내 커밋과 커밋 안 한 변경이 없어요.\n</work_log>`;
    const sections = busy.map((r) => {
      const state = [r.branch !== null ? `브랜치 ${r.branch}` : null, r.dirty > 0 ? `커밋 안 한 변경 ${r.dirty}개` : null].filter((s) => s !== null).join(', ');
      return [`■ ${r.name}${state !== '' ? ` (${state})` : ''}`, ...r.commits.map((c) => `- ${c.hash} ${c.at} ${c.subject}`)].join('\n');
    });
    return `${head}\n${sections.join('\n')}\n</work_log>`;
  }
}
