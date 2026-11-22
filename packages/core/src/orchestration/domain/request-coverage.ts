/** 팀원이 쪼갠 사용자 요청 항목 하나와 그 결과 */
export interface Ask {
  /** 사용자가 시킨 것 하나(팀원이 요청을 쪼갠 것) */
  readonly ask: string;
  readonly status: 'done' | 'partial' | 'not_done';
  /** 끝났으면 어디에 있는지, 덜 됐으면 왜인지 */
  readonly note: string;
  /** 사용자가 주면 끝낼 수 있는 것. 팀이 더 하면 되는 일이면 빈 글 */
  readonly needs: string;
}

/** 비교용 경로: 역슬래시→슬래시, 소문자, 앞의 ./ 와 끝의 /·/** 를 뗀다 */
function norm(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^\.\//, '')
    .replace(/(\/\*\*?)+$/, '')
    .replace(/\/+$/, '');
}

/**
 * 요청을 빠짐없이 했는지의 표. 팀원이 요청을 항목으로 쪼개 결과를 적고(asks),
 * 읽겠다고 계획한 곳(planned)은 rauha가 실제로 연 경로(opened)와 맞춰 본다. "다 찾았다"는 말 대신 숫자와 목록으로 보인다.
 */
export class RequestCoverage {
  private constructor(
    readonly asks: readonly Ask[],
    private readonly opened: readonly string[],
    private readonly planned: readonly string[],
  ) {}

  static of(asks: readonly Ask[], opened: readonly string[], planned: readonly string[]): RequestCoverage {
    const seen = new Set<string>();
    const places = planned.filter((p) => {
      const key = norm(p);
      if (key === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return new RequestCoverage(
      asks.filter((a) => a.ask.trim() !== ''),
      opened.map(norm).filter((o) => o !== ''),
      places.map((p) => p.trim().replace(/\/+$/, '')),
    );
  }

  unfinished(): Ask[] {
    return this.asks.filter((a) => a.status !== 'done');
  }

  /** 사용자에게 받을 것 없이 팀이 더 하면 끝나는 항목 */
  canContinue(): Ask[] {
    return this.unfinished().filter((a) => a.needs.trim() === '');
  }

  /** 계획했지만 실제로 연 경로 어디에도 들어 있지 않은 곳 */
  unopened(): string[] {
    return this.planned.filter((p) => {
      const key = `/${norm(p)}/`;
      return !this.opened.some((o) => `/${o}/`.includes(key));
    });
  }

  /** 팀이 이어서 끝낼 것이 있으면 그 요청 글, 없으면 null */
  followUp(): string | null {
    const left = this.canContinue();
    const missed = this.unopened();
    if (left.length === 0 && missed.length === 0) return null;
    const parts = ['<unfinished>', '앞선 결과에서 끝나지 않은 것입니다. 이미 한 일은 다시 하지 말고, 아래만 마저 하세요. 결과는 앞선 결과를 포함한 전체로 다시 내세요.'];
    if (left.length > 0) parts.push(`덜 된 항목:\n${left.map((a) => `- ${a.ask.trim()} (${a.status === 'partial' ? '일부' : '못 함'}${a.note.trim() !== '' ? `: ${a.note.trim()}` : ''})`).join('\n')}`);
    if (missed.length > 0) parts.push(`읽겠다고 정했지만 열지 않은 곳(열어서 확인하거나, 볼 필요가 없으면 scope에서 빼세요):\n${missed.map((p) => `- ${p}`).join('\n')}`);
    parts.push('</unfinished>');
    return parts.join('\n');
  }
}
