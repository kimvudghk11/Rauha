/**
 * Claude 말고 다른 AI 의 대화 기록 읽기(순수 규칙, 읽기만).
 * - Kiro CLI: ~/.kiro/sessions/cli/<id>.json(제목·폴더·시각) + <id>.jsonl(Prompt·AssistantMessage 줄)
 * - Kiro crew: ~/.kiro/crew/sessions/<이름>.jsonl(첫 줄 metadata, 나머지 role·content)
 * - Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl(session_meta, response_item message)
 * 생각(thinking)·도구 결과는 싣지 않는다. 로그인 파일은 열지 않는다.
 */
import type { TranscriptEntry } from './claude-history.js';

export type OtherSource = 'kiro' | 'kirocrew' | 'codex';
export const OTHER_SOURCE_LABEL: Readonly<Record<OtherSource, string>> = { kiro: 'Kiro', kirocrew: 'Kiro crew', codex: 'ChatGPT (Codex)' };

export interface OtherSummary {
  readonly title: string;
  readonly cwd: string;
  readonly startedAt: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const parse = (line: string): Obj | null => {
  try {
    const v: unknown = JSON.parse(line);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
};
const TEXT_MAX = 20_000;
const TITLE_MAX = 140;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const titleOf = (s: string): string => clip(s.replace(/\s+/g, ' ').trim(), TITLE_MAX);

// ── Kiro CLI ──
export function kiroCliSummary(json: string): (OtherSummary & { readonly updatedAt: string }) | null {
  const o = parse(json);
  if (o === null) return null;
  return { title: titleOf(str(o['title'])), cwd: str(o['cwd']), startedAt: str(o['created_at']), updatedAt: str(o['updated_at']) };
}

export function kiroCliEntry(line: string): TranscriptEntry | null {
  const o = parse(line);
  if (o === null || !isObj(o['data'])) return null;
  const parts = arr(o['data']['content']).filter(isObj);
  const text = parts.filter((p) => p['kind'] === 'text').map((p) => str(p['data'])).join('\n').trim();
  if (o['kind'] === 'Prompt') return text === '' ? null : { role: 'user', text: clip(text, TEXT_MAX), at: '' };
  if (o['kind'] !== 'AssistantMessage') return null;
  const tools = parts.filter((p) => p['kind'] === 'toolUse' && isObj(p['data'])).map((p) => str((p['data'] as Obj)['name'])).filter((n) => n !== '');
  if (text === '' && tools.length === 0) return null;
  return { role: 'assistant', text: clip(text, TEXT_MAX), ...(tools.length > 0 ? { tools } : {}), at: '' };
}

// ── Kiro crew ──
export function kiroCrewSummary(lines: readonly string[]): OtherSummary | null {
  const meta = lines.map(parse).find((o) => o !== null && o['_type'] === 'metadata');
  if (meta === undefined || meta === null) return null;
  return { title: titleOf(str(meta['title'])), cwd: str(meta['project']), startedAt: str(meta['created_at']) };
}

export function kiroCrewEntry(line: string): TranscriptEntry | null {
  const o = parse(line);
  if (o === null || o['_type'] !== undefined) return null;
  const role = o['role'] === 'user' ? 'user' : o['role'] === 'assistant' ? 'assistant' : null;
  const c = o['content'];
  const text = (typeof c === 'string' ? c : arr(c).filter(isObj).map((p) => str(p['text'])).join('\n')).trim();
  return role === null || text === '' ? null : { role, text: clip(text, TEXT_MAX), at: str(o['ts']) };
}

// ── Codex ──
/** Codex 가 첫 질문 앞에 넣는 안내 글(사람이 친 글이 아님) */
const CODEX_INJECTED = /^\s*<(environment_context|user_instructions|permissions|turn_aborted)/;

function codexMessage(o: Obj): { role: 'user' | 'assistant'; text: string } | null {
  const p = o['payload'];
  if (o['type'] !== 'response_item' || !isObj(p) || p['type'] !== 'message') return null;
  const role = p['role'] === 'user' ? 'user' : p['role'] === 'assistant' ? 'assistant' : null;
  if (role === null) return null;
  const text = arr(p['content']).filter(isObj).filter((c) => c['type'] === 'input_text' || c['type'] === 'output_text' || c['type'] === 'text').map((c) => str(c['text'])).join('\n').trim();
  if (text === '' || (role === 'user' && CODEX_INJECTED.test(text))) return null;
  return { role, text };
}

export function codexSummary(lines: readonly string[]): OtherSummary | null {
  let cwd = '';
  let startedAt = '';
  for (const line of lines) {
    const o = parse(line);
    if (o === null) continue;
    if (o['type'] === 'session_meta' && isObj(o['payload'])) {
      cwd = str(o['payload']['cwd']);
      startedAt = str(o['timestamp']) || str(o['payload']['timestamp']);
    }
    const m = codexMessage(o);
    if (m !== null && m.role === 'user') return { title: titleOf(m.text), cwd, startedAt };
  }
  return null;
}

export function codexEntry(line: string): TranscriptEntry | null {
  const o = parse(line);
  if (o === null) return null;
  const m = codexMessage(o);
  return m === null ? null : { role: m.role, text: clip(m.text, TEXT_MAX), at: str(o['timestamp']) };
}

/** 화면이 여는 id: 출처 + 파일 이름(Codex 는 날짜 폴더 포함). 경로 문자(.., \, 다른 /)는 받지 않는다 */
export class OtherHistoryId {
  private constructor(readonly source: OtherSource, readonly file: string) {}

  static of(source: OtherSource, file: string): OtherHistoryId | null {
    return OtherHistoryId.parse(`${source}:${file}`);
  }

  static parse(raw: unknown): OtherHistoryId | null {
    if (typeof raw !== 'string') return null;
    const m = /^(kiro|kirocrew|codex):(.+)$/.exec(raw);
    if (m === null) return null;
    const source = m[1] as OtherSource;
    const file = m[2] ?? '';
    const ok = source === 'codex' ? /^\d{4}\/\d{2}\/\d{2}\/rollout-[A-Za-z0-9._-]{1,200}$/.test(file) && !file.includes('..') : /^[A-Za-z0-9._-]{1,200}$/.test(file) && !file.includes('..');
    return ok ? new OtherHistoryId(source, file) : null;
  }

  toString(): string {
    return `${this.source}:${this.file}`;
  }
}
