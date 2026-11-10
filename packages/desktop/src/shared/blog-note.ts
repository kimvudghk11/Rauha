import { snippetAllowed } from './blog-redact.js';
import { decisionLabel } from './record-dto.js';
import { RECORD_TAGS, type RecordEntry } from './record-book.js';

/**
 * 블로그 정리 노트: 기록(요청·단계·허락 결정·결과·바뀐 파일·태그·메모)에서 글감을 뽑아 뼈대 칸에 채운다. 모델을 부르지 않는다.
 * 근거가 없는 칸은 지어내지 않고 "직접 채우기"로 둔다. 모든 글은 만드는 중에 가림 함수(redact)를 거친다.
 */

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);

export type BlogLength = 'short' | 'normal' | 'detailed';
export type BlogSectionId = 'problem' | 'cause' | 'attempts' | 'solution' | 'lesson' | 'repro';

export const BLOG_LENGTHS: readonly { readonly id: BlogLength; readonly label: string }[] = [
  { id: 'short', label: '짧게' },
  { id: 'normal', label: '보통' },
  { id: 'detailed', label: '자세히' },
];

export type BlogTemplateId = 'troubleshooting' | 'portfolio' | 'til' | 'devlog';

/** 글 틀: 소제목과, 각 소제목에 채울 정리 노트 칸. troubleshooting은 길이 선택(짧게·보통·자세히)을 따른다. */
export const BLOG_TEMPLATES: readonly { readonly id: BlogTemplateId; readonly label: string; readonly parts: readonly { readonly title: string; readonly from: BlogSectionId }[] }[] = [
  { id: 'troubleshooting', label: 'Troubleshooting', parts: [] },
  { id: 'portfolio', label: 'Portfolio', parts: [{ title: '배경', from: 'problem' }, { title: '접근 과정', from: 'attempts' }, { title: '결과', from: 'solution' }, { title: '배운 점', from: 'lesson' }] },
  { id: 'til', label: 'TIL', parts: [{ title: '맥락', from: 'problem' }, { title: '오늘 배운 것', from: 'solution' }, { title: '더 알아볼 것', from: 'lesson' }] },
  { id: 'devlog', label: 'Dev log', parts: [{ title: '오늘 한 일', from: 'solution' }, { title: '막힌 곳', from: 'attempts' }, { title: '내일 할 일', from: 'lesson' }] },
];

export const MANUAL_MARK = '직접 채우기';

const TITLES: Readonly<Record<BlogSectionId, string>> = {
  problem: '문제 상황',
  cause: '원인 추정',
  attempts: '시도한 것 (실패 포함)',
  solution: '해결',
  lesson: '배운 점',
  repro: '재현·확인 방법',
};

const HINTS: Readonly<Record<BlogSectionId, string>> = {
  problem: '어떤 상황이었는지 적어 주세요.',
  cause: '기록에 원인에 대한 말이 없어요. 짐작한 원인과 근거를 적어 주세요.',
  attempts: '기록에 시도한 흔적이 없어요. 해 본 일과 안 된 일을 적어 주세요.',
  solution: '기록에 해결된 결과가 없어요. 어떻게 풀었는지 적어 주세요.',
  lesson: '기록에 메모가 없어요. 이번에 배운 점을 적어 주세요.',
  repro: '기록에 확인한 방법이 없어요. 어떻게 다시 확인할 수 있는지 적어 주세요.',
};

const SECTIONS_BY_LENGTH: Readonly<Record<BlogLength, readonly BlogSectionId[]>> = {
  short: ['problem', 'solution', 'lesson'],
  normal: ['problem', 'cause', 'attempts', 'solution', 'lesson'],
  detailed: ['problem', 'cause', 'attempts', 'solution', 'lesson', 'repro'],
};

const CAUSE_WORDS = /원인|때문|since|because|cause|누락|잘못|부족|초과|꼬여|충돌/i;
const VERIFY_WORDS = /테스트|확인|검증|재현|통과|test|curl|yarn|npm|명령/i;
const TECH_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\baws\b/i, 'AWS'],
  [/terraform|테라폼/i, 'Terraform'],
  [/docker|도커/i, 'Docker'],
  [/k8s|kubernetes|쿠버네티스/i, 'Kubernetes'],
  [/nginx/i, 'Nginx'],
  [/\bdns\b/i, 'DNS'],
  [/\bvpc\b/i, 'VPC'],
  [/\btls\b|\bssl\b/i, 'TLS'],
  [/\bcors\b/i, 'CORS'],
  [/\bjwt\b/i, 'JWT'],
  [/oauth/i, 'OAuth'],
  [/redis/i, 'Redis'],
  [/mysql/i, 'MySQL'],
  [/postgres/i, 'PostgreSQL'],
  [/kafka/i, 'Kafka'],
  [/typescript/i, 'TypeScript'],
  [/\breact\b/i, 'React'],
  [/github actions/i, 'GitHub Actions'],
];

export const MAX_SNIPPETS = 5;
const APPROVALS_NORMAL = 4;
const FILES_SHOWN = 8;
const FILES_DETAILED = 30;

export interface BlogSection {
  readonly id: BlogSectionId;
  readonly title: string;
  readonly lines: readonly string[];
  /** 기록에 근거가 없어 사용자가 직접 채워야 한다 */
  readonly needsInput: boolean;
  readonly hint: string;
}

export interface BlogOptions {
  readonly length: BlogLength;
  /** 사용자가 체크한 코드 조각 */
  readonly snippets: readonly string[];
}

const identity = (s: string): string => s;
const sentences = (text: string): string[] =>
  text
    .split(/\n|(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '모름' && !s.startsWith('…'));

const ENDINGS: readonly (readonly [RegExp, string])[] = [
  [/찾아\s?줘$/u, '찾기'],
  [/고쳐\s?줘$/u, '고치기'],
  [/만들어\s?줘$/u, '만들기'],
  [/알려\s?줘$/u, '알아보기'],
  [/(?:해\s?줘|해\s?주세요|부탁해?)$/u, ''],
  [/줘$/u, ''],
];

const shortRequest = (request: string): string => {
  let base = request.replace(/[.!?\s]+$/u, '').trim();
  for (const [re, to] of ENDINGS) {
    if (re.test(base)) {
      base = base.replace(re, to).trim();
      break;
    }
  }
  return base.length > 40 ? `${base.slice(0, 39)}…` : base;
};

export class BlogNote {
  private constructor(
    readonly sections: readonly BlogSection[],
    private readonly titleList: readonly string[],
    private readonly tagList: readonly string[],
    private readonly snippets: readonly string[],
    private readonly count: number,
    readonly droppedSnippets: number,
    private readonly files: readonly string[],
    private readonly redact: (s: string) => string,
    private readonly byId: Readonly<Record<BlogSectionId, BlogSection>>,
  ) {}

  static compose(entries: readonly RecordEntry[], options: BlogOptions, redact: (s: string) => string = identity): BlogNote {
    const many = entries.length > 1;
    const mark = (i: number): string => (many ? `(${i + 1}) ` : '');
    const detailed = options.length === 'detailed';
    const per = (pick: (e: RecordEntry) => string[]): string[] => entries.flatMap((e, i) => pick(e).map((l) => `${mark(i)}${l}`));

    const content: Record<BlogSectionId, string[]> = {
      problem: per((e) => [`상황: ${e.request}`, ...(e.status === 'stopped' ? [`작업이 중간에 멈췄어요${e.stopReason === null ? '' : `: ${e.stopReason}`}`] : [])]),
      cause: per((e) => [...sentences(e.summary).filter((s) => CAUSE_WORDS.test(s)), ...(e.direction?.reason ? [`방향을 고른 이유: ${e.direction.reason}`] : [])]),
      attempts: per((e) => {
        const lines: string[] = [];
        if (e.stages.length > 0) lines.push(`거친 단계: ${e.stages.join(' → ')}`);
        if (e.direction !== null && e.direction.recommended !== '' && e.direction.recommended !== e.direction.chosen) lines.push(`AI는 "${e.direction.recommended}"을 추천했지만 "${e.direction.chosen}"을 골랐어요 (다른 길을 택함)`);
        const approvals = detailed ? e.approvals : e.approvals.slice(0, APPROVALS_NORMAL);
        for (const a of approvals) lines.push(`${a.headline} → ${decisionLabel(a.decision)}${a.decision === 'deny' ? ' (막힘)' : a.decision === 'revise' ? ' (방향을 바꿈)' : ''}${a.note === null ? '' : ` — ${a.note}`}`);
        if (e.status === 'stopped') lines.push(`끝까지 가지 못하고 멈춤${e.stopReason === null ? '' : ` (${e.stopReason})`}`);
        return lines;
      }),
      solution: per((e) => {
        if (e.status !== 'done') return [];
        const lines = e.summary === '모름' ? [] : e.summary.split('\n').filter((l) => l.trim() !== '');
        if (lines.length > 0 && e.files.length > 0) lines.push(`바뀐 파일 ${e.files.length + e.moreFiles}개: ${e.files.slice(0, FILES_SHOWN).join(', ')}${e.files.length > FILES_SHOWN ? ' 외' : ''}`);
        return lines;
      }),
      lesson: per((e) => (e.memo === '' ? [] : e.memo.split('\n').filter((l) => l.trim() !== ''))),
      repro: per((e) => sentences(e.summary).filter((s) => VERIFY_WORDS.test(s))),
    };

    const build = (id: BlogSectionId): BlogSection => {
      const lines = content[id].map(redact);
      return { id, title: TITLES[id], lines, needsInput: lines.length === 0, hint: HINTS[id] };
    };
    const sections: BlogSection[] = SECTIONS_BY_LENGTH[options.length].map(build);
    const byId = Object.fromEntries((Object.keys(TITLES) as BlogSectionId[]).map((id) => [id, build(id)])) as Record<BlogSectionId, BlogSection>;

    const wanted = options.snippets.map((s) => s.trim()).filter((s) => s !== '');
    const allowed = wanted.filter(snippetAllowed);
    const snippets = allowed.slice(0, MAX_SNIPPETS).map(redact);
    const files = detailed ? entries.flatMap((e) => e.files).filter((f, i, all) => all.indexOf(f) === i).slice(0, FILES_DETAILED).map(redact) : [];

    const first = entries[0];
    const base = first === undefined ? '' : shortRequest(first.request);
    const head = redact(base === '' ? '' : entries.length > 1 ? `${base} 외 ${entries.length - 1}건` : base);
    const titles = head === '' ? [] : [`${head}, 원인부터 해결까지`, `${head} 해결하며 배운 것`, entries.some((e) => e.tags.includes('troubleshooting')) ? `[트러블슈팅] ${head} 정리` : `${head} 기록`];

    return new BlogNote(sections, titles, BlogNote.tagCandidates(entries).map(redact), snippets, entries.length, wanted.length - allowed.length, files, redact, byId);
  }

  private static tagCandidates(entries: readonly RecordEntry[]): string[] {
    const counts = new Map<string, number>();
    for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const labelOf = (id: string): string => RECORD_TAGS.find((t) => t.id === id)?.label ?? id;
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => id !== 'etc').map(labelOf);
    const text = entries.map((e) => `${e.request}\n${e.summary}\n${e.memo}`).join('\n');
    const tech = TECH_WORDS.filter(([re]) => re.test(text)).map(([, name]) => name);
    const out: string[] = [];
    for (const tag of [...ranked.slice(0, 1), ...tech, ...ranked.slice(1), '트러블슈팅', '개발일지', '회고']) if (!out.includes(tag)) out.push(tag);
    return out.slice(0, 3);
  }

  /** 글감이 있는가: 고른 기록이 하나 이상이어야 한다 */
  hasMaterial(): boolean {
    return this.count > 0;
  }

  /** 제목 후보 3개 */
  titles(): readonly string[] {
    return this.titleList;
  }

  /** 태그 후보 3개 */
  tags(): readonly string[] {
    return this.tagList;
  }

  /**
   * 순수 Markdown 글. template을 안 주면 트러블슈팅 틀. frontMatter를 켜면 제목·태그·날짜를 --- 사이(YAML)에 넣고 본문의 # 제목과 태그 줄을 뺀다.
   * 제목·태그·본문 모두 가림 함수를 거친다.
   */
  toMarkdown(options: { readonly title: string; readonly tags?: readonly string[]; readonly template?: BlogTemplateId; readonly frontMatter?: boolean; readonly date?: string }): string {
    const title = this.redact(options.title).split(CR).join('').split(NL).map((l) => l.trim()).filter((l) => l !== '').join(' ');
    const tags = (options.tags ?? this.tagList).map(this.redact);
    const lines: string[] = [];
    if (options.frontMatter === true) {
      const q = (v: string): string => '"' + v.split(BS).join(BS + BS).split('"').join(BS + '"') + '"';
      const plain = (t: string): string => [...t].filter((c) => !',[]'.includes(c) && c !== NL && c !== CR).join('').trim();
      lines.push('---', 'title: ' + q(title));
      if (tags.length > 0) lines.push('tags: [' + tags.map(plain).join(', ') + ']');
      if (options.date !== undefined && options.date !== '') lines.push('date: ' + options.date);
      lines.push('---');
    } else {
      lines.push('# ' + title);
      if (tags.length > 0) lines.push('', '태그: ' + tags.map((t) => '#' + [...t].filter((c) => c.trim() !== '').join('')).join(' '));
    }
    const tpl = BLOG_TEMPLATES.find((t) => t.id === options.template);
    const parts: readonly { readonly title: string; readonly section: BlogSection }[] = tpl === undefined || tpl.parts.length === 0 ? this.sections.map((section) => ({ title: section.title, section })) : tpl.parts.map((p) => ({ title: p.title, section: this.byId[p.from] }));
    const fence = BT + BT + BT;
    for (const { title: heading, section: s } of parts) {
      lines.push('', '## ' + heading);
      if (s.needsInput) lines.push('> ' + MANUAL_MARK + ': ' + s.hint);
      else for (const l of s.lines) lines.push(s.lines.length > 1 ? '- ' + l : l);
      if (s.id === 'solution') for (const c of this.snippets) lines.push('', fence, c, fence);
    }
    if (this.snippets.length > 0 && !parts.some((p) => p.section.id === 'solution')) for (const c of this.snippets) lines.push('', fence, c, fence);
    if (this.files.length > 0) lines.push('', '## 바뀐 파일', ...this.files.map((f) => '- ' + f));
    return lines.join(NL);
  }
}
