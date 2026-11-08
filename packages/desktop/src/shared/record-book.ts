/**
 * 기록 탭의 규칙. 끝난 작업 하나를 "포트폴리오·이력서에 쓸 수 있는 요약"으로 남긴다.
 * 기록에는 요약만 둔다: 비밀 값(토큰·키·비밀번호)·코드·전체 로그·달러 금액·비밀 파일 이름은 넣지 않는다.
 * 값은 불변이고, 바꾸는 메서드는 새 값을 돌려준다.
 */

export type RecordTag = 'troubleshooting' | 'network' | 'infra' | 'design' | 'feature' | 'security' | 'performance' | 'docs' | 'etc';

export const RECORD_TAGS: readonly { readonly id: RecordTag; readonly label: string }[] = [
  { id: 'troubleshooting', label: '트러블슈팅' },
  { id: 'network', label: '네트워크 구성' },
  { id: 'infra', label: '인프라' },
  { id: 'design', label: '설계' },
  { id: 'feature', label: '기능 구현' },
  { id: 'security', label: '보안' },
  { id: 'performance', label: '성능' },
  { id: 'docs', label: '문서' },
  { id: 'etc', label: '기타' },
];

/** 태그를 어림잡는 낱말. 사용자가 언제든 고칠 수 있으니 어림이 틀려도 괜찮다. */
const TAG_WORDS: Readonly<Record<Exclude<RecordTag, 'etc'>, RegExp>> = {
  troubleshooting: /오류|에러|버그|장애|원인|실패|안 ?돼|안 ?되|타임아웃|timeout|exception|crash|크래시|고쳐|디버그|debug|문제|느려|멈춤|\b5\d\d\b/i,
  network: /네트워크|vpc|서브넷|subnet|라우팅|라우트|보안 ?그룹|security ?group|\bdns\b|로드 ?밸런서|\balb\b|\bnlb\b|피어링|방화벽|\bcdn\b|nginx|ingress|게이트웨이|\bnat\b|\bcidr\b|\bvpn\b|\btls\b|\bssl\b|\bport\b/i,
  infra: /aws|terraform|테라폼|k8s|kubernetes|쿠버네티스|배포|deploy|오토스케일|autoscal|인프라|docker|도커|\bci\b|\bcd\b|\bec2\b|\becs\b|\beks\b|lambda|\bs3\b|\brds\b|helm|cloudformation|\bcdk\b/i,
  design: /설계|아키텍처|architecture|스키마|schema|구조|리팩터|다이어그램|\berd\b|시안|디자인/i,
  feature: /구현|추가|만들|기능|\bapi\b|개발|신규/i,
  security: /보안|권한|인증|토큰|암호|취약|\biam\b|oauth|\bjwt\b|secret|\bcors\b|\bxss\b|\bcsrf\b/i,
  performance: /성능|느리|지연|인덱스|캐시|cache|최적화|latency|병목/i,
  docs: /문서|보고서|readme|주간보고|정리해|회의록|가이드/i,
};

export const REQUEST_LIMIT = 200;
export const SUMMARY_LIMIT = 600;
const SUMMARY_LINES = 12;
const FIELD_LIMIT = 160;
export const MEMO_LIMIT = 500;
export const MAX_FILES = 50;
const MAX_APPROVALS = 30;
const CUT = '…(줄임)';
const HIDDEN = '[값 가림]';

export class RecordError extends Error {}

export const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, HIDDEN],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, HIDDEN],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, HIDDEN],
  [/\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{10,}/g, HIDDEN],
  [/\bnpm_[A-Za-z0-9]{30,}/g, HIDDEN],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, HIDDEN],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, HIDDEN],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${HIDDEN}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${HIDDEN}@`],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi, `$1$2${HIDDEN}`],
  // 섞인 글자로 길게 이어진 값(키·해시 비슷한 것). 순수 16진수(git 커밋 번호 등)는 비밀이 아니라서 남긴다.
  [/\b(?![0-9a-f]{40,64}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, HIDDEN],
];

export const MONEY_PATTERNS: readonly RegExp[] = [/(?:US)?\$\s?\d[\d,]*(?:\.\d+)?/gi, /\d[\d,.]*\s?(?:달러|USD)/gi];

/** 글에서 비밀 값·코드 블록·달러 금액을 지운다. 몇 번 거쳐도 결과가 같다. */
export function scrub(text: string): string {
  let out = text.replace(/```[\s\S]*?(?:```|$)/g, '(코드 생략)');
  for (const [pattern, to] of SECRET_PATTERNS) out = out.replace(pattern, to);
  for (const pattern of MONEY_PATTERNS) out = out.replace(pattern, '[금액 생략]');
  return out;
}

const oneLine = (text: string, limit: number): string => {
  const flat = scrub(text).replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** 결과 글: 비밀·코드를 지우고 12줄·600자까지만 남긴다(전체 로그를 넣지 않는다). */
function summaryOf(result: string | null): string {
  const clean = scrub(result ?? '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (clean === '') return '모름';
  let lines = clean.split('\n');
  if (lines.length > SUMMARY_LINES) lines = [...lines.slice(0, SUMMARY_LINES - 1), CUT];
  const joined = lines.join('\n');
  return joined.length > SUMMARY_LIMIT ? `${joined.slice(0, SUMMARY_LIMIT - CUT.length)}${CUT}` : joined;
}

const SECRET_FILE = [/^\.env(?!.*\.(?:example|sample|template)$)(?:\..*)?$/i, /\.(?:pem|key|p12|pfx|keystore)$/i, /^id_(?:rsa|ed25519|ecdsa|dsa)/i, /^\.(?:npmrc|pypirc|netrc)$/i, /^credentials(?:\.json)?$/i, /^secrets?\.(?:json|ya?ml)$/i];

function isSecretFile(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return SECRET_FILE.some((p) => p.test(name));
}

export type ApprovalDecision = 'once' | 'job' | 'revise' | 'deny';
const DECISIONS: readonly ApprovalDecision[] = ['once', 'job', 'revise', 'deny'];

/** 허락 결정 하나: 무엇을 허락했나(요약), 왜 물었나, 어떻게 정했나, 내가 남긴 말 */
export interface ApprovalNote {
  readonly tool: string;
  readonly headline: string;
  readonly reason: string;
  readonly decision: ApprovalDecision;
  readonly note: string | null;
  readonly at: string;
}

/** 고를 방향이 있었을 때 AI가 추천한 것과 내가 고른 것 */
export interface Direction {
  readonly recommended: string;
  readonly chosen: string;
  readonly reason: string | null;
}

/** 작업이 끝났을 때 main이 모아 건네는 날것의 값. 모든 값이 여기서 다듬어진다. */
export interface RecordInput {
  readonly id: string;
  readonly request: string;
  readonly result: string | null;
  readonly status: 'done' | 'stopped';
  readonly stopReason: string | null;
  /** 일한 팀원 이름들 */
  readonly roles: readonly string[];
  /** 지나온 단계 이름들 */
  readonly stages: readonly string[];
  readonly queuedAt: string;
  readonly endedAt: string;
  readonly repo: string | null;
  readonly files: readonly string[];
  readonly approvals: readonly ApprovalNote[];
  readonly direction: Direction | null;
}

export interface RecordProps {
  readonly id: string;
  readonly request: string;
  readonly summary: string;
  readonly status: 'done' | 'stopped';
  readonly stopReason: string | null;
  readonly roles: readonly string[];
  readonly stages: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly repo: string | null;
  readonly files: readonly string[];
  /** 이름을 남기지 않은 비밀 파일 수 */
  readonly hiddenFiles: number;
  /** 상한 때문에 이름을 줄인 파일 수 */
  readonly moreFiles: number;
  readonly approvals: readonly ApprovalNote[];
  readonly direction: Direction | null;
  readonly tags: readonly RecordTag[];
  readonly memo: string;
}

function inferTags(request: string, summary: string): readonly RecordTag[] {
  const pick = (text: string): RecordTag[] => (Object.keys(TAG_WORDS) as (keyof typeof TAG_WORDS)[]).filter((tag) => TAG_WORDS[tag].test(text));
  const fromRequest = pick(request);
  if (fromRequest.length > 0) return fromRequest;
  const fromSummary = summary === '모름' ? [] : pick(summary);
  return fromSummary.length > 0 ? fromSummary : ['etc'];
}

function checkedTags(tags: readonly string[]): readonly RecordTag[] {
  if (tags.length === 0) throw new RecordError('태그는 하나 이상 골라 주세요.');
  const ids = RECORD_TAGS.map((t) => t.id as string);
  const unique: RecordTag[] = [];
  for (const tag of tags) {
    if (!ids.includes(tag)) throw new RecordError('모르는 태그예요.');
    if (!unique.includes(tag as RecordTag)) unique.push(tag as RecordTag);
  }
  return unique;
}

const memoOf = (text: string): string => {
  const clean = scrub(text).trim();
  return clean.length > MEMO_LIMIT ? clean.slice(0, MEMO_LIMIT) : clean;
};

function approvalOf(a: ApprovalNote): ApprovalNote | null {
  if (!DECISIONS.includes(a.decision)) return null;
  return { tool: oneLine(a.tool, 40), headline: oneLine(a.headline, FIELD_LIMIT), reason: oneLine(a.reason, FIELD_LIMIT), decision: a.decision, note: a.note === null || a.note.trim() === '' ? null : oneLine(a.note, FIELD_LIMIT), at: a.at };
}

/** 끝난 작업 하나의 기록 */
export class RecordEntry {
  private constructor(private readonly props: RecordProps) {}

  /** 작업이 끝났을 때 날것의 값에서 만든다. 요약·비밀 가리기·태그 어림이 여기서 일어난다. */
  static capture(input: RecordInput): RecordEntry {
    if (input.status !== 'done' && input.status !== 'stopped') throw new RecordError('끝난 작업만 기록해요.');
    const request = oneLine(input.request, REQUEST_LIMIT);
    if (request === '') throw new RecordError('요청이 비어 있는 작업은 기록하지 않아요.');
    const summary = summaryOf(input.result);
    const shown: string[] = [];
    let hidden = 0;
    for (const raw of input.files) {
      const path = raw.replace(/\\/g, '/').trim().slice(0, 200);
      if (path === '') continue;
      if (isSecretFile(path)) hidden += 1;
      else shown.push(path);
    }
    return RecordEntry.restore({
      id: input.id,
      request,
      summary,
      status: input.status,
      stopReason: input.stopReason,
      roles: input.roles,
      stages: input.stages,
      startedAt: input.queuedAt,
      endedAt: input.endedAt,
      repo: input.repo,
      files: shown.slice(0, MAX_FILES),
      hiddenFiles: hidden,
      moreFiles: Math.max(0, shown.length - MAX_FILES),
      approvals: input.approvals as ApprovalNote[],
      direction: input.direction,
      tags: inferTags(request, summary),
      memo: '',
    });
  }

  /** 저장 파일에서 다시 만든다. 규칙(비밀 가리기 등)을 한 번 더 지킨다(몇 번 거쳐도 같다). */
  static restore(p: RecordProps): RecordEntry {
    if (p.id === '') throw new RecordError('기록 번호가 없어요.');
    if (p.status !== 'done' && p.status !== 'stopped') throw new RecordError('끝난 작업만 기록해요.');
    if (p.endedAt === '') throw new RecordError('끝난 시각이 없어요.');
    const request = oneLine(p.request, REQUEST_LIMIT);
    if (request === '') throw new RecordError('요청이 비어 있는 작업은 기록하지 않아요.');
    const direction = p.direction === null ? null : { recommended: oneLine(p.direction.recommended, FIELD_LIMIT), chosen: oneLine(p.direction.chosen, FIELD_LIMIT), reason: p.direction.reason === null || p.direction.reason.trim() === '' ? null : oneLine(p.direction.reason, FIELD_LIMIT) };
    const approvals = p.approvals.map(approvalOf).filter((a): a is ApprovalNote => a !== null).slice(0, MAX_APPROVALS);
    return new RecordEntry({
      ...p,
      request,
      summary: p.summary === '모름' ? '모름' : summaryOf(p.summary),
      stopReason: p.stopReason === null ? null : oneLine(p.stopReason, FIELD_LIMIT),
      roles: p.roles.map((r) => oneLine(r, 30)).filter((r) => r !== ''),
      stages: p.stages.map((s) => oneLine(s, 30)).filter((s) => s !== ''),
      repo: p.repo === null || p.repo.trim() === '' ? null : oneLine(p.repo, 80),
      files: p.files.filter((f) => !isSecretFile(f)).slice(0, MAX_FILES),
      approvals,
      direction: direction !== null && direction.recommended === '' && direction.chosen === '' ? null : direction,
      tags: checkedTags(p.tags),
      memo: memoOf(p.memo),
    });
  }

  get id(): string { return this.props.id; }
  get request(): string { return this.props.request; }
  get summary(): string { return this.props.summary; }
  get status(): 'done' | 'stopped' { return this.props.status; }
  get stopReason(): string | null { return this.props.stopReason; }
  get roles(): readonly string[] { return this.props.roles; }
  get stages(): readonly string[] { return this.props.stages; }
  get startedAt(): string { return this.props.startedAt; }
  get endedAt(): string { return this.props.endedAt; }
  get repo(): string | null { return this.props.repo; }
  get files(): readonly string[] { return this.props.files; }
  get hiddenFiles(): number { return this.props.hiddenFiles; }
  get moreFiles(): number { return this.props.moreFiles; }
  get approvals(): readonly ApprovalNote[] { return this.props.approvals; }
  get direction(): Direction | null { return this.props.direction; }
  get tags(): readonly RecordTag[] { return this.props.tags; }
  get memo(): string { return this.props.memo; }

  /** 걸린 시간(초). 시작·끝 시각이 이상하면 모른다(null). */
  durationSeconds(): number | null {
    const start = Date.parse(this.props.startedAt);
    const end = Date.parse(this.props.endedAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
    return Math.round((end - start) / 1000);
  }

  /** 내가 AI의 추천과 다르게 이끌었다: 방향을 다르게 골랐거나, 허락 때 "이렇게 바꿔 줘"라고 했다. */
  divergedFromAi(): boolean {
    const d = this.props.direction;
    return (d !== null && d.recommended !== d.chosen) || this.props.approvals.some((a) => a.decision === 'revise');
  }

  withTags(tags: readonly string[]): RecordEntry {
    return new RecordEntry({ ...this.props, tags: checkedTags(tags) });
  }

  withMemo(memo: string): RecordEntry {
    return new RecordEntry({ ...this.props, memo: memoOf(memo) });
  }

  /** 글자 검색에 걸리는 모든 글(요청·요약·메모·파일·팀·레포·태그 이름) */
  searchText(): string {
    const tagNames = this.props.tags.map((t) => RECORD_TAGS.find((x) => x.id === t)?.label ?? '');
    return [this.props.request, this.props.summary, this.props.memo, ...this.props.files, ...this.props.roles, this.props.repo ?? '', ...tagNames].join('\n').toLowerCase();
  }
}

export interface RecordFilter {
  readonly text: string;
  readonly tag: RecordTag | null;
  readonly status: 'all' | 'done' | 'stopped';
  readonly repo: string | null;
  readonly divergedOnly: boolean;
  /** 이 시각(ISO) 이후에 끝난 것만. null이면 전체 */
  readonly since: string | null;
}

/** 기록 모음. 끝난 시각이 늦은 것이 위에 온다. */
export class RecordBook {
  private constructor(readonly entries: readonly RecordEntry[]) {}

  static empty(): RecordBook {
    return new RecordBook([]);
  }

  static restore(entries: readonly RecordEntry[]): RecordBook {
    return new RecordBook(RecordBook.sorted(entries));
  }

  private static sorted(entries: readonly RecordEntry[]): RecordEntry[] {
    return [...entries].sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || 0);
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  get(id: string): RecordEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /** 같은 작업은 한 번만 기록한다(끝난 작업을 여러 번 알려 와도 안전하다). */
  add(entry: RecordEntry): RecordBook {
    return this.has(entry.id) ? this : new RecordBook(RecordBook.sorted([entry, ...this.entries]));
  }

  setTags(id: string, tags: readonly string[]): RecordBook {
    return this.replace(id, (e) => e.withTags(tags));
  }

  setMemo(id: string, memo: string): RecordBook {
    return this.replace(id, (e) => e.withMemo(memo));
  }

  remove(id: string): RecordBook {
    this.need(id);
    return new RecordBook(this.entries.filter((e) => e.id !== id));
  }

  view(filter: RecordFilter): readonly RecordEntry[] {
    const text = filter.text.trim().toLowerCase();
    const since = filter.since === null ? null : Date.parse(filter.since);
    return this.entries.filter(
      (e) =>
        (filter.tag === null || e.tags.includes(filter.tag)) &&
        (filter.status === 'all' || e.status === filter.status) &&
        (filter.repo === null || e.repo === filter.repo) &&
        (!filter.divergedOnly || e.divergedFromAi()) &&
        (since === null || Date.parse(e.endedAt) >= since) &&
        (text === '' || e.searchText().includes(text)),
    );
  }

  tagCounts(): Readonly<Record<RecordTag, number>> {
    const counts = Object.fromEntries(RECORD_TAGS.map((t) => [t.id, 0])) as Record<RecordTag, number>;
    for (const e of this.entries) for (const tag of e.tags) counts[tag] += 1;
    return counts;
  }

  repos(): readonly string[] {
    return [...new Set(this.entries.map((e) => e.repo).filter((r): r is string => r !== null))].sort();
  }

  /** 상한을 넘으면 오래된 것을 넘친 몫으로 나눈다(버리지 않고 보관 파일로 옮기게). */
  trimmed(max: number): { kept: RecordBook; overflow: readonly RecordEntry[] } {
    return { kept: new RecordBook(this.entries.slice(0, max)), overflow: this.entries.slice(max) };
  }

  private need(id: string): RecordEntry {
    const found = this.get(id);
    if (found === null) throw new RecordError('그 기록을 찾지 못했어요.');
    return found;
  }

  private replace(id: string, change: (e: RecordEntry) => RecordEntry): RecordBook {
    const found = this.need(id);
    const next = change(found);
    return new RecordBook(this.entries.map((e) => (e === found ? next : e)));
  }
}
