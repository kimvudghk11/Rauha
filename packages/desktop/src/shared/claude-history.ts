/**
 * Claude Code 대화 내역 읽기(순수 규칙). Claude Code 는 대화를 `<설정 폴더>/projects/<폴더>/<세션>.jsonl` 에 줄마다 JSON 으로 남긴다.
 * 여기서는 그 줄들에서 목록용 요약(제목·작업 폴더·시각)과 화면용 대화 줄(사람 글·답 글·도구 이름)만 뽑는다.
 * 도구 결과·시스템 알림·생각(thinking)은 싣지 않는다. 로그인 정보(.credentials 등)는 읽지 않는다.
 */

export interface SessionHead {
  readonly title: string;
  readonly cwd: string;
  readonly startedAt: string;
  /** 사람이 아니라 프로그램(rauha 팀원 등)이 보낸 첫 글(<endpoint>… 처럼 태그로 시작) */
  readonly automated: boolean;
}

/** 이어지는 Claude 답(글·도구)을 한 덩어리로 합친다: 도구 하나마다 말풍선이 생기지 않게 */
export function mergeTurns(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === 'assistant' && e.role === 'assistant') {
      const text = [last.text, e.text].filter((t) => t !== '').join('\n\n');
      const tools = [...(last.tools ?? []), ...(e.tools ?? [])];
      out[out.length - 1] = { role: 'assistant', text, ...(tools.length > 0 ? { tools } : {}), at: last.at };
    } else out.push(e);
  }
  return out;
}

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** 답에서 쓴 도구(이름 + 짧은 대상) */
  readonly tools?: readonly string[];
  readonly at: string;
}

const TEXT_MAX = 20_000;
const TITLE_MAX = 140;
/** 사람이 친 글이 아닌 것: 명령 줄·시스템 알림·훅 출력 등 */
const NOT_HUMAN = /^\s*<(local-command|command-|system-reminder|bash-|user-prompt-submit-hook|task-notification)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function parse(line: string): Obj | null {
  try {
    const v: unknown = JSON.parse(line);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** 메시지 content 의 글(문자열이거나 text 조각들) */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .filter((b) => b['type'] === 'text')
    .map((b) => str(b['text']))
    .join('\n');
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 사람이 친 글이면 그 글, 아니면 null(도구 결과·명령·알림) */
function humanText(o: Obj): string | null {
  if (o['type'] !== 'user' || o['isMeta'] === true) return null;
  const msg = isObj(o['message']) ? o['message'] : null;
  if (msg === null) return null;
  const c = msg['content'];
  if (Array.isArray(c) && c.some((b) => isObj(b) && b['type'] === 'tool_result')) return null;
  const t = stripIdeContext(textOf(c));
  if (t.trim() === '' || NOT_HUMAN.test(t)) return null;
  return t;
}

/** VS Code 확장이 사람 글 앞에 붙이는 꼬리표(열린 파일·선택·진단)는 떼고, 붙여넣은 글은 껍질만 벗긴다 */
const IDE_CONTEXT = /<(ide_opened_file|ide_selection|ide_diagnostics)\b[^>]*>[\s\S]*?<\/\1>/g;
const PASTED = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/g;
function stripIdeContext(t: string): string {
  return t.replace(IDE_CONTEXT, '').replace(PASTED, '$1').trim();
}

/** 슬래시 명령 줄이면 그 이름(/reload-plugins), 아니면 null */
function commandName(o: Obj): string | null {
  if (o['type'] !== 'user') return null;
  const msg = isObj(o['message']) ? o['message'] : null;
  const m = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(msg === null ? '' : textOf(msg['content']));
  return m === null ? null : (m[1] ?? null);
}

/** 목록 한 줄: 앞부분 줄들에서 제목(요약 줄 또는 첫 사람 질문)·작업 폴더·시작 시각 */
export function sessionSummary(lines: readonly string[]): SessionHead {
  let title = '';
  let summary = '';
  let cwd = '';
  let startedAt = '';
  let command = '';
  for (const line of lines) {
    const o = parse(line);
    if (o === null) continue;
    if (o['type'] === 'summary' && summary === '') summary = str(o['summary']);
    if (cwd === '' && str(o['cwd']) !== '') cwd = str(o['cwd']);
    if (startedAt === '' && str(o['timestamp']) !== '') startedAt = str(o['timestamp']);
    if (title === '') {
      const h = humanText(o);
      if (h !== null) title = h;
    }
    if (command === '') command = commandName(o) ?? '';
    if (title !== '' && cwd !== '' && startedAt !== '' && summary !== '') break;
  }
  const t = (summary || title || command).replace(/\s+/g, ' ').trim();
  return { title: clip(t, TITLE_MAX), cwd, startedAt, automated: /^\s*<[A-Za-z_][\w-]*[\s>]/.test(title) };
}

/** 도구 호출 한 줄: 이름 + 짧은 대상(파일·명령·주소) */
function toolLine(b: Obj): string {
  const name = str(b['name']) || 'tool';
  const input = isObj(b['input']) ? b['input'] : {};
  const target = str(input['file_path']) || str(input['path']) || str(input['command']) || str(input['url']) || str(input['pattern']) || str(input['description']);
  return target === '' ? name : `${name} ${clip(target.replace(/\s+/g, ' '), 120)}`;
}

/** 대화 한 줄을 화면용으로. 보일 것이 없으면 null */
export function transcriptEntry(line: string): TranscriptEntry | null {
  const o = parse(line);
  if (o === null) return null;
  const at = str(o['timestamp']);
  if (o['type'] === 'user') {
    const h = humanText(o);
    return h === null ? null : { role: 'user', text: clip(h, TEXT_MAX), at };
  }
  if (o['type'] !== 'assistant') return null;
  const msg = isObj(o['message']) ? o['message'] : null;
  const c = msg?.['content'];
  const text = textOf(c).trim();
  const tools = Array.isArray(c) ? c.filter(isObj).filter((b) => b['type'] === 'tool_use').map(toolLine) : [];
  if (text === '' && tools.length === 0) return null;
  return { role: 'assistant', text: clip(text, TEXT_MAX), ...(tools.length > 0 ? { tools } : {}), at };
}

const PART = /^[A-Za-z0-9._-]{1,200}$/;

/** 세션을 가리키는 값: `뿌리번호:프로젝트폴더/세션id`. 경로 조각에 / \ .. 가 들어갈 수 없다 */
export class HistoryId {
  private constructor(
    readonly root: number,
    readonly project: string,
    readonly session: string,
  ) {}

  static parse(v: unknown): HistoryId {
    if (typeof v !== 'string') throw new Error('Not a session id.');
    const m = /^(\d{1,2}):([^/]+)\/([^/]+)$/.exec(v);
    if (m === null) throw new Error('Not a session id.');
    const project = m[2] as string;
    const session = m[3] as string;
    if (!PART.test(project) || !PART.test(session) || project.includes('..') || session.includes('..')) throw new Error('Not a session id.');
    return new HistoryId(Number(m[1]), project, session);
  }

  static of(root: number, project: string, session: string): HistoryId {
    return HistoryId.parse(`${root}:${project}/${session}`);
  }

  toString(): string {
    return `${this.root}:${this.project}/${this.session}`;
  }

  toJSON(): { readonly root: number; readonly project: string; readonly session: string } {
    return { root: this.root, project: this.project, session: this.session };
  }
}
