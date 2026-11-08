import { RECORD_TAGS, RecordBook, RecordEntry, RecordError, type ApprovalDecision, type RecordProps } from './record-book.js';

/** 저장 파일·화면에서 오가는 기록 하나 */
export type RecordJson = RecordProps;

export interface RecordBookJson {
  readonly version: 1;
  readonly entries: readonly RecordJson[];
}

/** 화면이 main에 보내는 기록 요청 */
export type RecordOp = { readonly kind: 'tags'; readonly id: string; readonly tags: readonly string[] } | { readonly kind: 'memo'; readonly id: string; readonly memo: string } | { readonly kind: 'remove'; readonly id: string };

export type RecordResult = { readonly ok: true; readonly book: RecordBookJson } | { readonly ok: false; readonly error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, field: string): string {
  if (typeof v === 'string') return v;
  throw new RecordError(`${field} 값이 글자가 아니에요.`);
}

const strOrNull = (v: unknown, field: string): string | null => (v === null || v === undefined ? null : str(v, field));

function strings(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new RecordError(`${field} 값이 목록이 아니에요.`);
  return v.map((x) => str(x, field));
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function propsOf(item: unknown): RecordProps {
  if (!isObject(item)) throw new RecordError('항목이 객체가 아니에요.');
  const d = item['direction'];
  return {
    id: str(item['id'], 'id'),
    request: str(item['request'], '요청'),
    summary: str(item['summary'], '요약'),
    status: str(item['status'], '상태') as RecordProps['status'],
    stopReason: strOrNull(item['stopReason'], '멈춘 이유'),
    roles: strings(item['roles'] ?? [], '팀'),
    stages: strings(item['stages'] ?? [], '단계'),
    startedAt: str(item['startedAt'], '시작 시각'),
    endedAt: str(item['endedAt'], '끝난 시각'),
    repo: strOrNull(item['repo'], '레포'),
    files: strings(item['files'] ?? [], '파일'),
    hiddenFiles: num(item['hiddenFiles']),
    moreFiles: num(item['moreFiles']),
    approvals: (Array.isArray(item['approvals']) ? item['approvals'] : []).filter(isObject).map((a) => ({
      tool: str(a['tool'], '도구'),
      headline: str(a['headline'], '요약'),
      reason: str(a['reason'] ?? '', '이유'),
      decision: str(a['decision'], '결정') as ApprovalDecision,
      note: strOrNull(a['note'], '남긴 말'),
      at: str(a['at'], '시각'),
    })),
    direction: isObject(d) ? { recommended: str(d['recommended'], '추천'), chosen: str(d['chosen'], '선택'), reason: strOrNull(d['reason'], '이유') } : null,
    tags: strings(item['tags'] ?? [], '태그') as RecordProps['tags'],
    memo: str(item['memo'] ?? '', '메모'),
  };
}

const jsonOf = (e: RecordEntry): RecordJson => ({
  id: e.id,
  request: e.request,
  summary: e.summary,
  status: e.status,
  stopReason: e.stopReason,
  roles: e.roles,
  stages: e.stages,
  startedAt: e.startedAt,
  endedAt: e.endedAt,
  repo: e.repo,
  files: e.files,
  hiddenFiles: e.hiddenFiles,
  moreFiles: e.moreFiles,
  approvals: e.approvals,
  direction: e.direction,
  tags: e.tags,
  memo: e.memo,
});

/** 기록 모음 ↔ 저장 파일. 깨진 항목은 건너뛰고(몇 개인지 알려) 나머지로 연다. 읽을 때 비밀 가리기를 한 번 더 한다. */
export class RecordBookDto {
  private constructor(
    readonly json: RecordBookJson,
    readonly skipped: number,
  ) {}

  static from(input: unknown): RecordBookDto {
    const raw = isObject(input) && Array.isArray(input['entries']) ? input['entries'] : [];
    const seen = new Set<string>();
    const entries: RecordJson[] = [];
    let skipped = 0;
    for (const item of raw) {
      try {
        const entry = RecordEntry.restore(propsOf(item));
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(jsonOf(entry));
      } catch (error) {
        if (!(error instanceof RecordError)) throw error;
        skipped += 1;
      }
    }
    return new RecordBookDto({ version: 1, entries }, skipped);
  }

  static fromEntity(book: RecordBook): RecordBookDto {
    return new RecordBookDto({ version: 1, entries: book.entries.map(jsonOf) }, 0);
  }

  toEntity(): RecordBook {
    return RecordBook.restore(this.json.entries.map((p) => RecordEntry.restore(p)));
  }

  toJSON(): RecordBookJson {
    return this.json;
  }
}

/** 화면의 기록 요청 하나 */
export class RecordOpDto {
  private constructor(private readonly op: RecordOp) {}

  static from(input: unknown): RecordOpDto {
    if (!isObject(input)) throw new RecordError('요청 모양이 올바르지 않아요.');
    const id = str(input['id'], '기록 번호');
    switch (input['kind']) {
      case 'tags':
        return new RecordOpDto({ kind: 'tags', id, tags: strings(input['tags'], '태그') });
      case 'memo':
        return new RecordOpDto({ kind: 'memo', id, memo: str(input['memo'], '메모') });
      case 'remove':
        return new RecordOpDto({ kind: 'remove', id });
      default:
        throw new RecordError('모르는 요청이에요.');
    }
  }

  applyTo(book: RecordBook): RecordBook {
    const op = this.op;
    switch (op.kind) {
      case 'tags':
        return book.setTags(op.id, op.tags);
      case 'memo':
        return book.setMemo(op.id, op.memo);
      case 'remove':
        return book.remove(op.id);
    }
  }
}

/** 초를 사람이 읽는 글로. 모르면 "모름". */
export function durationText(seconds: number | null): string {
  if (seconds === null) return '모름';
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분${seconds % 60 === 0 ? '' : ` ${seconds % 60}초`}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간${minutes % 60 === 0 ? '' : ` ${minutes % 60}분`}`;
}

const DECISION_LABEL: Readonly<Record<ApprovalDecision, string>> = { once: '한 번만 허락', job: '이 작업 동안 허락', revise: '고쳐서 다시 해 달라고 함', deny: '허락하지 않음' };
export const decisionLabel = (d: ApprovalDecision): string => DECISION_LABEL[d];

const defaultWhen = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? '모름' : iso.slice(0, 16).replace('T', ' '));

export const RecordDto = {
  /** 포트폴리오·이력서에 옮겨 쓰기 좋은 글. 문제 → 접근 → 방향 → 결과 순서이고, 요약만 담긴다. */
  toMarkdown(e: RecordEntry, when: (iso: string) => string = defaultWhen): string {
    const tagNames = e.tags.map((t) => RECORD_TAGS.find((x) => x.id === t)?.label ?? t).join(', ');
    const lines: string[] = [`## ${e.request}`, ''];
    lines.push(`- 날짜: ${when(e.endedAt)}`, `- 걸린 시간: ${durationText(e.durationSeconds())}`, `- 태그: ${tagNames}`);
    if (e.repo !== null) lines.push(`- 레포: ${e.repo}`);
    if (e.roles.length > 0) lines.push(`- 팀: ${e.roles.join(', ')}`);
    if (e.status === 'stopped') lines.push(`- 상태: 멈춤${e.stopReason === null ? '' : ` (${e.stopReason})`}`);
    if (e.stages.length > 0) lines.push(`- 접근: ${e.stages.join(' → ')}`);
    lines.push('', '### 결과 요약', e.summary);
    if (e.direction !== null) {
      lines.push('', '### 방향', `- AI 추천: ${e.direction.recommended === '' ? '모름' : e.direction.recommended}`, `- 내 선택: ${e.direction.chosen === '' ? '모름' : e.direction.chosen}${e.divergedFromAi() ? ' (내가 다르게 골랐어요)' : ''}`);
      if (e.direction.reason !== null) lines.push(`- 이유: ${e.direction.reason}`);
    }
    if (e.approvals.length > 0) {
      lines.push('', '### 허락 결정');
      for (const a of e.approvals) lines.push(`- ${a.headline} → ${DECISION_LABEL[a.decision]}${a.reason === '' ? '' : ` (이유: ${a.reason})`}${a.note === null ? '' : ` — 내 말: ${a.note}`}`);
    }
    if (e.files.length > 0) {
      lines.push('', '### 바뀐 파일', ...e.files.map((f) => `- ${f}`));
      if (e.moreFiles > 0) lines.push(`- 외 ${e.moreFiles}개`);
    }
    if (e.memo !== '') lines.push('', '### 내 메모', e.memo);
    return lines.join('\n');
  },
};
