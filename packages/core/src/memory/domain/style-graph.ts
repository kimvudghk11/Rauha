/**
 * 사용자 취향(말투·형식·정확도·작업 방식) 그래프. 점은 취향 하나와 주제, 선은 "about"(취향 → 주제)과
 * "replaces"(새 취향 → 같은 키의 옛 취향). 사용자가 직접 말한 것에서 뽑은 취향만 담고, 지어내지 않는다.
 * 같은 키를 다시 들으면 무게가 오르고, 다른 말이면 새 취향이 옛 취향을 대신한다.
 */
export type StyleTopic = 'language' | 'tone' | 'format' | 'accuracy' | 'workflow' | 'other';

export const STYLE_TOPICS: readonly StyleTopic[] = ['language', 'tone', 'format', 'accuracy', 'workflow', 'other'];

/** 모델이 사용자 말에서 뽑은 취향 하나(바깥 입력이라 learn 이 다시 검사한다) */
export interface StylePreference {
  readonly key: string;
  readonly topic: StyleTopic;
  readonly text: string;
  /** 사용자가 실제로 한 말(근거) */
  readonly quote: string;
  /** key=language 일 때 settings.json 에 쓸 값(예: korean) */
  readonly value: string | null;
}

export interface StyleNode {
  readonly id: string;
  readonly key: string;
  readonly topic: StyleTopic;
  readonly text: string;
  readonly quote: string;
  readonly value: string | null;
  readonly weight: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly replacedBy: string | null;
}

export interface StyleEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'about' | 'replaces';
}

const ACTIVE_MAX = 20;
const TEXT_MAX = 200;
const KEY_SHAPE = /^[a-z][a-z0-9-]{1,40}$/;
const LANGUAGE_SHAPE = /^[a-z]{2,20}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export class StyleGraph {
  private constructor(
    private readonly nodes: readonly StyleNode[],
    private readonly links: readonly StyleEdge[],
  ) {}

  static empty(): StyleGraph {
    return new StyleGraph([], []);
  }

  /** 저장본에서 연다. 모양이 틀린 점·선은 버린다(깨진 파일로 앱이 멈추지 않게) */
  static from(raw: unknown): StyleGraph {
    if (!isObject(raw)) return StyleGraph.empty();
    const nodes = (Array.isArray(raw['nodes']) ? raw['nodes'] : []).filter(
      (n): n is StyleNode =>
        isObject(n) &&
        typeof n['id'] === 'string' &&
        typeof n['key'] === 'string' &&
        KEY_SHAPE.test(n['key']) &&
        STYLE_TOPICS.includes(n['topic'] as StyleTopic) &&
        typeof n['text'] === 'string' &&
        n['text'].trim() !== '' &&
        typeof n['quote'] === 'string' &&
        (n['value'] === null || (typeof n['value'] === 'string' && LANGUAGE_SHAPE.test(n['value']))) &&
        typeof n['weight'] === 'number' &&
        typeof n['firstAt'] === 'string' &&
        typeof n['lastAt'] === 'string' &&
        (n['replacedBy'] === null || typeof n['replacedBy'] === 'string'),
    );
    const edges = (Array.isArray(raw['edges']) ? raw['edges'] : []).filter(
      (e): e is StyleEdge => isObject(e) && typeof e['from'] === 'string' && typeof e['to'] === 'string' && (e['kind'] === 'about' || e['kind'] === 'replaces'),
    );
    return new StyleGraph(
      nodes.map((n) => ({ id: n.id, key: n.key, topic: n.topic, text: n.text, quote: n.quote, value: n.value, weight: n.weight, firstAt: n.firstAt, lastAt: n.lastAt, replacedBy: n.replacedBy })),
      edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    );
  }

  /** 새로 들은 취향을 얹은 새 그래프. 이상한 키·빈 말·긴 말은 버린다 */
  learn(prefs: readonly StylePreference[], at: string): StyleGraph {
    let nodes = [...this.nodes];
    const links = [...this.links];
    for (const p of prefs) {
      const text = clean(p.text);
      if (!KEY_SHAPE.test(p.key) || !STYLE_TOPICS.includes(p.topic) || text === '' || text.length > TEXT_MAX) continue;
      const value = p.key === 'language' && p.value !== null && LANGUAGE_SHAPE.test(p.value) ? p.value : null;
      const current = nodes.find((n) => n.key === p.key && n.replacedBy === null);
      if (current !== undefined && current.text === text) {
        nodes = nodes.map((n) => (n === current ? { ...n, weight: n.weight + 1, lastAt: at, quote: clean(p.quote).slice(0, TEXT_MAX) || n.quote } : n));
        continue;
      }
      const id = `style:${p.key}:${nodes.filter((n) => n.key === p.key).length + 1}`;
      nodes.push({ id, key: p.key, topic: p.topic, text, quote: clean(p.quote).slice(0, TEXT_MAX), value, weight: 1, firstAt: at, lastAt: at, replacedBy: null });
      links.push({ from: id, to: `topic:${p.topic}`, kind: 'about' });
      if (current !== undefined) {
        nodes = nodes.map((n) => (n === current ? { ...n, replacedBy: id } : n));
        links.push({ from: id, to: current.id, kind: 'replaces' });
      }
    }
    return new StyleGraph(nodes, links);
  }

  /** 사용자가 지운 취향: 점과 그 점의 선을 없앤다(같은 키를 다시 들으면 새로 배운다) */
  forget(id: string): StyleGraph {
    return new StyleGraph(
      this.nodes.filter((n) => n.id !== id).map((n) => (n.replacedBy === id ? { ...n, replacedBy: null } : n)),
      this.links.filter((e) => e.from !== id && e.to !== id),
    );
  }

  /** 지금 따르는 취향(대신된 것 빼고): 무게 큰 순 → 최근 순, 상한까지 */
  active(): StyleNode[] {
    return this.nodes
      .filter((n) => n.replacedBy === null)
      .sort((a, b) => b.weight - a.weight || b.lastAt.localeCompare(a.lastAt))
      .slice(0, ACTIVE_MAX);
  }

  edges(): readonly StyleEdge[] {
    return this.links;
  }

  /** 팀원 프롬프트에 넣을 목록. 없으면 빈 글 */
  promptBlock(): string {
    return this.active()
      .map((n) => `- ${n.text}`)
      .join('\n');
  }

  /** settings.json 의 language 에 쓸 값(언어 취향이 있을 때만) */
  language(): string | null {
    return this.active().find((n) => n.key === 'language')?.value ?? null;
  }

  /** 계정 CLAUDE.md 에 넣을 rauha 구역(취향이 없으면 빈 글 = 구역을 지운다) */
  claudeMdBlock(): string {
    const lines = this.promptBlock();
    if (lines === '') return '';
    return `${STYLE_BEGIN}\n## 내 답변 스타일 (rauha 가 내 말에서 배운 것, rauha 설정에서 지울 수 있음)\n${lines}\n${STYLE_END}`;
  }

  toJSON(): { nodes: readonly StyleNode[]; edges: readonly StyleEdge[] } {
    return { nodes: this.nodes, edges: this.links };
  }
}

/** 취향을 말한 것 같은 문장인지(모델을 부를지 가르는 값싼 거름망). 일 요청은 모델에 보내지 않는다 */
export const StyleSignal = {
  likely(text: string): boolean {
    const t = text.trim();
    if (t === '') return false;
    return /앞으로|항상|매번|늘\s|언제나|하지\s?마|말고|싫어|별로야|좋겠어|좋겠다|원해|말투|어투|스타일|형식으로|짧게|길게|자세히|간단히|추측|확인한\s?것만|한국어로|영어로|존댓말|반말|표로|from now on|always|never|don't|prefer|in english|in korean/i.test(t);
  },
};

export const STYLE_BEGIN = '<!-- rauha:style:begin -->';
export const STYLE_END = '<!-- rauha:style:end -->';

/** CLAUDE.md 에 rauha 구역만 넣거나 바꾸거나 지운다. 구역 밖 사용자 글은 그대로 */
export function mergeClaudeMd(existing: string, block: string): string {
  const start = existing.indexOf(STYLE_BEGIN);
  const end = existing.indexOf(STYLE_END);
  if (start !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + STYLE_END.length);
    if (block !== '') return `${before}${block}${after}`;
    const head = before.replace(/\s+$/, '');
    const tail = after.replace(/^\s+/, '');
    const rest = tail === '' ? head : head === '' ? tail : `${head}\n\n${tail}`;
    return rest === '' ? '' : `${rest.replace(/\s+$/, '')}\n`;
  }
  if (block === '') return existing;
  const body = existing.replace(/\s+$/, '');
  return body === '' ? `${block}\n` : `${body}\n\n${block}\n`;
}

/**
 * settings.json 의 language 를 넣을지. 사용자가 직접 다른 언어를 정했으면 덮지 않는다(rauha 가 넣은 값만 바꾼다).
 * 바꿀 것이 없으면 null. 다른 키는 건드리지 않는다.
 */
export function mergeLanguageSetting(settings: unknown, language: string, owned: boolean): { settings: Record<string, unknown>; owned: true } | null {
  if (settings !== null && settings !== undefined && !isObject(settings)) return null;
  const base: Record<string, unknown> = isObject(settings) ? settings : {};
  const now = base['language'];
  if (now === language) return null;
  if (typeof now === 'string' && now !== '' && !owned) return null;
  return { settings: { ...base, language }, owned: true };
}
