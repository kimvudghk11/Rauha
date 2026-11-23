/**
 * rauha 자체 기억(작업 폴더가 아니라 rauha 데이터 폴더에 남는다).
 * - notes: "라우하에 저장·기억해줘"로 받은 글(예: memory.md 요약). 모든 팀원 호출에 <rauha-memory> 로 붙는다.
 * - rules: 항상 따를 룰 파일(예: backend-engineering-rules/RULES.md). 원본은 읽기만 하고, 호출 때마다 지금 내용을 읽어 <user-rules> 로 붙인다.
 * 값은 불변이고 바꾸면 새 노트를 돌려준다.
 */
export interface NotebookNote {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** 글을 가져온 파일(없으면 null) */
  readonly source: string | null;
  /** ISO 시각 */
  readonly at: string;
}

export interface NotebookRule {
  readonly id: string;
  /** 룰 파일 절대 경로 */
  readonly path: string;
  readonly at: string;
}

export interface NotebookJson {
  readonly notes: readonly NotebookNote[];
  readonly rules: readonly NotebookRule[];
}

export class NotebookError extends Error {}

const TITLE_MAX = 120;
const TEXT_MAX = 40_000;
const NOTES_MAX = 100;
const RULES_MAX = 20;
/** 절대 경로: /… , ~/… , C:\… , \\server\… */
const ABSOLUTE = /^(\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/;
/** 비밀이 들어 있을 만한 파일 이름(룰 파일로 읽지 않는다) */
const SECRET_NAME = /(^|[\\/])(\.env(\..*)?|\.credentials\.json|credentials(\.json)?|id_(rsa|ed25519|ecdsa|dsa)|.*\.(pem|key|p12|pfx|keystore|jks)|.*token.*|.*secret.*)$/i;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const pathKey = (p: string): string => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();

export class RauhaNotebook {
  private constructor(
    readonly notes: readonly NotebookNote[],
    readonly rules: readonly NotebookRule[],
  ) {}

  static empty(): RauhaNotebook {
    return new RauhaNotebook([], []);
  }

  /** 저장본 읽기. 모양이 틀린 칸은 버린다(나머지는 살린다) */
  static fromJSON(raw: unknown): RauhaNotebook {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    const str = (v: unknown): v is string => typeof v === 'string';
    const notes = list(o['notes']).flatMap((n): NotebookNote[] => {
      const x = (typeof n === 'object' && n !== null ? n : {}) as Record<string, unknown>;
      return str(x['id']) && str(x['title']) && str(x['text']) && str(x['at']) && (x['source'] === null || str(x['source'])) ? [{ id: x['id'], title: x['title'], text: x['text'], source: x['source'] as string | null, at: x['at'] }] : [];
    });
    const rules = list(o['rules']).flatMap((r): NotebookRule[] => {
      const x = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
      return str(x['id']) && str(x['path']) && str(x['at']) ? [{ id: x['id'], path: x['path'], at: x['at'] }] : [];
    });
    return new RauhaNotebook(notes.slice(-NOTES_MAX), rules.slice(-RULES_MAX));
  }

  toJSON(): NotebookJson {
    return { notes: this.notes, rules: this.rules };
  }

  /** 글을 기억한다. 같은 제목이면 새 글로 바꾼다(id·자리는 그대로) */
  remember(note: NotebookNote): RauhaNotebook {
    const title = squash(note.title);
    const text = note.text.trim();
    if (title === '' || title.length > TITLE_MAX) throw new NotebookError(`title must be 1 to ${TITLE_MAX} characters.`);
    if (text === '') throw new NotebookError('text is empty.');
    if (text.length > TEXT_MAX) throw new NotebookError(`text is too long (up to ${TEXT_MAX} characters). Save a summary instead.`);
    const same = this.notes.find((n) => squash(n.title).toLowerCase() === title.toLowerCase());
    const next: NotebookNote = { id: same?.id ?? note.id, title, text, source: note.source, at: note.at };
    const notes = same === undefined ? [...this.notes, next].slice(-NOTES_MAX) : this.notes.map((n) => (n === same ? next : n));
    return new RauhaNotebook(notes, this.rules);
  }

  /** 항상 따를 룰 파일을 남긴다. 절대 경로만, 비밀 파일은 안 된다. 같은 파일이면 그대로 */
  keepRule(rule: NotebookRule): RauhaNotebook {
    const path = rule.path.trim();
    if (!ABSOLUTE.test(path)) throw new NotebookError('path must be an absolute file path.');
    if (SECRET_NAME.test(path)) throw new NotebookError('That file may hold secrets (keys, tokens, credentials). rauha does not read it as a rule file.');
    if (this.rules.some((r) => pathKey(r.path) === pathKey(path))) return this;
    if (this.rules.length >= RULES_MAX) throw new NotebookError(`Up to ${RULES_MAX} rule files.`);
    return new RauhaNotebook(this.notes, [...this.rules, { id: rule.id, path, at: rule.at }]);
  }

  /** 노트나 룰을 지운다. 없는 id 면 그대로 */
  forget(id: string): RauhaNotebook {
    if (!this.notes.some((n) => n.id === id) && !this.rules.some((r) => r.id === id)) return this;
    return new RauhaNotebook(
      this.notes.filter((n) => n.id !== id),
      this.rules.filter((r) => r.id !== id),
    );
  }

  /** 팀원 시스템 프롬프트에 붙일 기억 글. 최근 것부터 한도 안에서. 없으면 빈 글 */
  memoryBlock(maxChars: number): string {
    const parts: string[] = [];
    let used = 0;
    for (const n of [...this.notes].sort((a, b) => b.at.localeCompare(a.at))) {
      const part = `## ${n.title}${n.source !== null ? ` (from ${n.source})` : ''}\n${n.text}`;
      if (used + part.length > maxChars) continue;
      parts.push(part);
      used += part.length;
    }
    return parts.length === 0 ? '' : parts.join('\n\n');
  }
}
