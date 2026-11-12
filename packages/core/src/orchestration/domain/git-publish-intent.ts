/**
 * 사용자가 이번 요청에서 커밋·push·PR(·PR 머지)을 시켰는지.
 * 시켰으면 팀원이 그대로 하고, 시키지 않았으면 허락 카드로 묻는다.
 * "커밋하지 마", "커밋은 내가 할게" 같은 부정은 시킨 것으로 보지 않는다.
 */

type Kind = 'commit' | 'push' | 'pr' | 'merge';

const KEYWORDS: ReadonlyArray<readonly [Kind, RegExp]> = [
  ['commit', /커밋|\bcommit(?:s|ted|ting)?\b/gi],
  ['push', /푸시|푸쉬|\bpush(?:es|ed|ing)?\b|(?:깃허브|github|원격|remote|origin|브랜치|branch)[^\n,.;!?]{0,12}올려/gi],
  ['pr', /풀\s?리퀘(?:스트)?|\bpull[- ]requests?\b|\bPRs?\b/gi],
  ['merge', /머지|병합|\bmerge[sd]?\b/gi],
];

/** 뒤따르는 말이 "하지 마, 안 해, 내가 할게"인 경우 */
const NEGATED_AFTER = /지\s*(?:마|말|않)|안\s*(?:해|할|하|돼|되)|말고|말아|금지|내가|직접\s*(?:할|하)|제외|빼고|없이|하면\s*안|^\s*(?:is\s+)?(?:not|yourself)\b|\bnothing\b/i;
/** 앞선 말이 "don't, never, 안"인 경우 */
const NEGATED_BEFORE = /\b(?:don'?t|do\s+not|never|no|not|without|avoid|skip)\s+(?:\w+\s+){0,2}$|안\s*$/i;
/** 커밋을 하라는 말이 아니라 커밋 내역을 가리키는 경우 */
const HISTORY_AFTER = /^.{0,6}?(?:보여|로그|내역|기록|목록|히스토리|log\b|history|message|메시지)/i;
const HISTORY_BEFORE = /(?:최근|이전|지난|마지막|last|latest|recent|previous|each)\s*$/i;
const CLAUSE_END = /[.,;!?\n]/;

interface Hit {
  readonly kind: Kind;
  readonly start: number;
  readonly end: number;
}

function hitsIn(text: string): Hit[] {
  const hits = KEYWORDS.flatMap(([kind, pattern]) => [...text.matchAll(pattern)].map((m) => ({ kind, start: m.index as number, end: (m.index as number) + m[0].length })));
  return hits.sort((a, b) => a.start - b.start);
}

function clauseAfter(text: string, from: number, limit: number): string {
  const rest = text.slice(from, limit);
  const cut = rest.search(CLAUSE_END);
  return cut < 0 ? rest : rest.slice(0, cut);
}

function clauseBefore(text: string, to: number, limit: number): string {
  const head = text.slice(limit, to);
  const cut = Math.max(...[...'.,;!?\n'].map((c) => head.lastIndexOf(c)));
  return cut < 0 ? head : head.slice(cut + 1);
}

export class GitPublishIntent {
  private constructor(
    private readonly commit: boolean,
    private readonly push: boolean,
    private readonly pr: boolean,
    private readonly merge: boolean,
  ) {}

  /** 아무것도 시키지 않은 요청 */
  static none(): GitPublishIntent {
    return new GitPublishIntent(false, false, false, false);
  }

  static from(request: string): GitPublishIntent {
    const found = new Set<Kind>();
    const hits = hitsIn(request);
    hits.forEach((hit, i) => {
      const after = clauseAfter(request, hit.end, hits[i + 1]?.start ?? request.length);
      const before = clauseBefore(request, hit.start, hits[i - 1]?.end ?? 0);
      if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) return;
      if (hit.kind === 'commit' && (HISTORY_AFTER.test(after) || HISTORY_BEFORE.test(before))) return;
      found.add(hit.kind);
    });
    return new GitPublishIntent(found.has('commit'), found.has('push'), found.has('pr'), found.has('merge'));
  }

  /** push와 PR은 커밋도 함께 시킨 것이다 */
  allowsCommit(): boolean {
    return this.commit || this.push || this.pr;
  }

  /** PR은 push도 함께 시킨 것이다 */
  allowsPush(): boolean {
    return this.push || this.pr;
  }

  allowsPullRequest(): boolean {
    return this.pr;
  }

  /** PR을 언급하며 머지하라고 한 경우만 */
  allowsMerge(): boolean {
    return this.pr && this.merge;
  }

  /**
   * 코드 작업이 끝난 뒤 커밋·PR 단계를 붙일지. 시키지 않았으면 none,
   * 시켰어도 작업이 끝까지 통과하지 못했으면(멈춤) 검증 안 된 변경을 올리지 않게 skip.
   */
  afterRun(status: 'complete' | 'stopped'): 'publish' | 'skip' | 'none' {
    if (!this.allowsCommit()) return 'none';
    return status === 'complete' ? 'publish' : 'skip';
  }

  /** 시킨 git 일을 사람이 읽는 말로("커밋·push·PR"). 시키지 않았으면 빈 글. */
  label(): string {
    return [this.allowsCommit() && '커밋', this.allowsPush() && 'push', this.allowsPullRequest() && 'PR', this.allowsMerge() && '머지'].filter((w): w is string => w !== false).join('·');
  }

  equals(other: GitPublishIntent): boolean {
    return this.commit === other.commit && this.push === other.push && this.pr === other.pr && this.merge === other.merge;
  }
}
