/**
 * 일마다 세션 한도를 얼마나 썼는지(시작과 끝의 세션 사용률 차이). 모델을 부르지 않고 이미 읽는 한도 값만 쓴다.
 * 같은 때 다른 일이 돌았으면 그 몫도 섞이므로 그렇다고 밝히고, 세션이 새로 시작됐거나 못 읽었으면 지어내지 않는다.
 */
interface Entry {
  readonly before: number | null;
  readonly after: number | null;
  readonly over: boolean;
  readonly overlapped: boolean;
}

const KEEP = 200;

export class SessionMeter {
  private constructor(private readonly entries: ReadonlyMap<string, Entry>) {}

  static empty(): SessionMeter {
    return new SessionMeter(new Map());
  }

  /** 일이 돌기 시작했다. percent: 그때 읽은 세션 사용률(못 읽었으면 null) */
  start(id: string, percent: number | null): SessionMeter {
    if (this.entries.has(id)) return this;
    const running = [...this.entries].filter(([, e]) => !e.over).map(([k]) => k);
    const next = new Map(this.entries);
    for (const k of running) next.set(k, { ...next.get(k)!, overlapped: true });
    next.set(id, { before: percent, after: null, over: false, overlapped: running.length > 0 });
    return new SessionMeter(trim(next));
  }

  /** 시작 직후 새로 읽은 값으로 시작값을 고친다(시작할 때 들고 있던 값은 25초까지 묵었을 수 있다). 못 읽었거나 이미 끝난 일은 그대로 */
  restart(id: string, percent: number | null): SessionMeter {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.over || percent === null) return this;
    const next = new Map(this.entries);
    next.set(id, { ...entry, before: percent });
    return new SessionMeter(next);
  }

  /** 일이 끝났다. percent: 끝난 뒤 읽은 세션 사용률 */
  finish(id: string, percent: number | null): SessionMeter {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.over) return this;
    const next = new Map(this.entries);
    next.set(id, { ...entry, after: percent, over: true });
    return new SessionMeter(next);
  }

  /** 결과 카드에 붙일 한 줄. 알 수 없으면 null(화면에 안 보인다) */
  line(id: string): string | null {
    const e = this.entries.get(id);
    if (e === undefined || !e.over || e.before === null || e.after === null || e.after < e.before) return null;
    const spent = Math.round(e.after - e.before);
    const amount = spent < 1 ? 'under 1%' : `+${spent}%`;
    return `Session: ${amount}${e.overlapped ? ' (other work ran at the same time)' : ''}`;
  }
}

function trim(map: Map<string, Entry>): Map<string, Entry> {
  while (map.size > KEEP) map.delete(map.keys().next().value!);
  return map;
}
