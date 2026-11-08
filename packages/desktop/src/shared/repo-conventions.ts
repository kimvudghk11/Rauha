/**
 * 레포의 브랜치·커밋 이름 방식을 기존 기록에서 읽어, 새로 남기는 브랜치와 커밋이 같은 방식을 따르게 한다.
 * 팀·사람마다 방식이 다르므로 정해 둔 규칙이 아니라 이미 있는 브랜치 이름과 커밋 제목을 보고 따른다.
 * 근거가 약하면(기록이 적거나 방식이 제각각이면) 예전 기본값(rauha/job-…, "rauha: …")을 쓴다.
 */

export type CommitStyle =
  | { readonly kind: 'conventional'; readonly scope: boolean; readonly lang: 'ko' | 'en'; readonly types: readonly string[] }
  | { readonly kind: 'bracket'; readonly tag: string; readonly lang: 'ko' | 'en' }
  | { readonly kind: 'ticket'; readonly sample: string; readonly lang: 'ko' | 'en' }
  | { readonly kind: 'plain'; readonly lang: 'ko' | 'en' }
  | { readonly kind: 'default' };

export interface BranchStyle {
  /** 예: 'feature/' · 'feat/' · '' (접두어 없음) · null(근거 약함 → 기본값) */
  readonly prefix: string | null;
  /** 접두어 뒤에 티켓 번호(ABC-123)를 먼저 붙이는 방식인지 */
  readonly ticket: boolean;
  /** 이름 속 단어 구분자 */
  readonly separator: '-' | '_';
}

const CONVENTIONAL = /^(\w+)(\(([^)]+)\))?(!)?: /;
const BRACKET = /^\[([^\]]+)\]\s*/;
const TICKET = /^([A-Z][A-Z0-9]+-\d+)[\s:\]-]/;
const BRANCH_TICKET = /^(?:[a-z]+\/)?([A-Za-z][A-Za-z0-9]+-\d+)(?:[-_/]|$)/;
const ENOUGH = 3;
const SHARE = 0.6;
const TYPE_WORDS = new Set(['feat', 'feature', 'fix', 'bugfix', 'hotfix', 'chore', 'docs', 'doc', 'refactor', 'test', 'tests', 'style', 'perf', 'build', 'ci', 'revert', 'release', 'wip']);
const hasHangul = (s: string) => /[가-힣]/.test(s);

function lang(subjects: readonly string[]): 'ko' | 'en' {
  const korean = subjects.filter(hasHangul).length;
  return korean * 2 >= subjects.length ? 'ko' : 'en';
}

function topShare<T>(items: readonly T[], key: (t: T) => string | null): { key: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: { key: string; count: number } | null = null;
  for (const [k, count] of counts) if (best === null || count > best.count) best = { key: k, count };
  return best;
}

export class RepoConventions {
  private constructor(
    readonly branch: BranchStyle,
    readonly commit: CommitStyle,
  ) {}

  static default(): RepoConventions {
    return new RepoConventions({ prefix: null, ticket: false, separator: '-' }, { kind: 'default' });
  }

  /**
   * @param branches 기존 브랜치 이름들(원격 `origin/` 접두어는 있어도 된다. main·develop 같은 줄기와 rauha/ 작업 브랜치는 무시한다)
   * @param subjects 최근 커밋 제목들(병합 커밋은 빼고 넘긴다)
   */
  static infer(branches: readonly string[], subjects: readonly string[]): RepoConventions {
    return new RepoConventions(inferBranch(branches), inferCommit(subjects));
  }

  /** 새 작업 브랜치 이름. 티켓 번호는 요청 글에서 찾고, 없으면 이름에서 뺀다. */
  branchName(request: string, jobId: string): string {
    const short = jobId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    if (this.branch.prefix === null) return `rauha/job-${short}`;
    const sep = this.branch.separator;
    const ticket = this.branch.ticket ? (request.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? null) : null;
    const words = slug(request, sep).split(sep).filter((w) => w !== '').slice(0, 5).join(sep);
    const parts = [ticket, words === '' ? null : words].filter((p): p is string => p !== null);
    return `${this.branch.prefix}${(parts.length > 0 ? parts : [`job${sep}${short}`]).join(sep)}`;
  }

  /** 새 커밋 제목. summary는 한 줄로 줄인 요청 내용. */
  commitSubject(summary: string, request = summary): string {
    const text = summary.replace(/\s+/g, ' ').trim().slice(0, 60);
    const c = this.commit;
    switch (c.kind) {
      case 'conventional': {
        const type = pickType(c.types, request);
        return `${type}: ${text}`;
      }
      case 'bracket':
        return `[${c.tag}] ${text}`;
      case 'ticket': {
        const t = request.match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
        return t === undefined ? text : c.sample.startsWith('[') ? `[${t}] ${text}` : `${t} ${text}`;
      }
      case 'plain':
        return text;
      case 'default':
        return `rauha: ${text}`;
    }
  }

  /** 팀원 프롬프트에 붙이는 한두 줄: "이 레포는 이렇게 쓴다". 근거가 없으면 빈 글. */
  promptNote(): string {
    const lines: string[] = [];
    if (this.branch.prefix !== null) lines.push(`브랜치 이름은 이 레포 방식을 따른다: 접두어 "${this.branch.prefix}"${this.branch.ticket ? ', 티켓 번호가 있으면 이름 앞에' : ''}, 단어 구분은 "${this.branch.separator}".`);
    const c = this.commit;
    if (c.kind === 'conventional') lines.push(`커밋 제목은 이 레포 방식(${c.types.slice(0, 4).join('/')}${c.scope ? '(범위)' : ''}: 내용, ${c.lang === 'ko' ? '한국어' : '영어'})을 따른다.`);
    else if (c.kind === 'bracket') lines.push(`커밋 제목은 "[${c.tag}] 내용" 방식(${c.lang === 'ko' ? '한국어' : '영어'})을 따른다.`);
    else if (c.kind === 'ticket') lines.push(`커밋 제목은 티켓 번호로 시작하는 방식(예: ${c.sample})을 따른다.`);
    else if (c.kind === 'plain') lines.push(`커밋 제목은 접두어 없이 ${c.lang === 'ko' ? '한국어' : '영어'} 한 줄로 쓴다.`);
    return lines.join('\n');
  }
}

function slug(request: string, sep: string): string {
  const base = request
    .replace(/[A-Z][A-Z0-9]+-\d+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
  return base.slice(0, 40);
}

function pickType(types: readonly string[], request: string): string {
  const r = request.toLowerCase();
  const want = /버그|오류|수정|fix|bug|고쳐/.test(r) ? ['fix', 'bugfix'] : /문서|readme|docs/.test(r) ? ['docs', 'doc'] : /리팩|refactor|정리/.test(r) ? ['refactor'] : /테스트|test/.test(r) ? ['test', 'tests'] : ['feat', 'feature'];
  return want.find((w) => types.includes(w)) ?? types[0] ?? 'chore';
}

function inferBranch(branches: readonly string[]): BranchStyle {
  const names = branches
    .map((b) => b.replace(/^remotes\//, '').replace(/^origin\//, '').trim())
    .filter((b) => b !== '' && b !== 'HEAD' && !b.startsWith('HEAD ') && !/^(main|master|develop|dev|qa|release|staging|production|stage)$/.test(b) && !b.startsWith('rauha/') && !b.includes('->'));
  const defaults: BranchStyle = { prefix: null, ticket: false, separator: '-' };
  if (names.length < ENOUGH) return defaults;
  const prefixOf = (b: string): string | null => {
    const i = b.indexOf('/');
    return i > 0 ? b.slice(0, i + 1) : '';
  };
  const top = topShare(names, prefixOf);
  if (top === null || top.count < ENOUGH || top.count / names.length < SHARE) return defaults;
  // 접두어가 사람 이름·티켓처럼 제각각이 아니라 종류 단어(feature/ fix/ …)일 때만 따른다. 접두어가 없는 방식(top.key === '')도 인정한다.
  if (top.key !== '' && !TYPE_WORDS.has(top.key.slice(0, -1).toLowerCase())) return defaults;
  const own = names.filter((b) => prefixOf(b) === top.key);
  const ticket = own.filter((b) => BRANCH_TICKET.test(b)).length / own.length >= SHARE;
  const underscores = own.filter((b) => b.slice(top.key.length).includes('_')).length;
  const hyphens = own.filter((b) => b.slice(top.key.length).includes('-')).length;
  return { prefix: top.key, ticket, separator: underscores > hyphens ? '_' : '-' };
}

function inferCommit(subjects: readonly string[]): CommitStyle {
  const list = subjects.map((s) => s.trim()).filter((s) => s !== '' && !/^Merge /.test(s));
  if (list.length < ENOUGH) return { kind: 'default' };
  const l = lang(list);
  const conv = list.filter((s) => CONVENTIONAL.test(s));
  if (conv.length / list.length >= SHARE) {
    const typeCounts = new Map<string, number>();
    for (const s of conv) {
      const t = s.match(CONVENTIONAL)?.[1]?.toLowerCase();
      if (t !== undefined) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const scope = conv.filter((s) => s.match(CONVENTIONAL)?.[3] !== undefined).length / conv.length >= 0.5;
    return { kind: 'conventional', scope, lang: l, types };
  }
  const bracket = topShare(list, (s) => s.match(BRACKET)?.[1] ?? null);
  const bracketCount = list.filter((s) => BRACKET.test(s)).length;
  if (bracket !== null && bracketCount / list.length >= SHARE) {
    // 티켓 번호가 대괄호 안에 든 방식([ABC-1])이면 티켓 방식으로 본다.
    if (/^[A-Z][A-Z0-9]+-\d+$/.test(bracket.key)) return { kind: 'ticket', sample: `[${bracket.key}]`, lang: l };
    return { kind: 'bracket', tag: bracket.key, lang: l };
  }
  const ticketed = list.filter((s) => TICKET.test(s));
  if (ticketed.length / list.length >= SHARE) return { kind: 'ticket', sample: ticketed[0]!.match(TICKET)![1]!, lang: l };
  return { kind: 'plain', lang: l };
}
