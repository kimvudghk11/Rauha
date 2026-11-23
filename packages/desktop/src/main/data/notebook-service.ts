import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RauhaNotebook, type NotebookJson } from '../../shared/rauha-notebook.js';

export interface NotebookServiceDeps {
  /** 저장 파일(rauha 데이터 폴더의 notebook.json) */
  readonly file: string;
  /** ~ 를 풀 홈 폴더 */
  readonly home: string;
  readonly newId: () => string;
  /** ISO 시각 */
  readonly now: () => string;
  /** 룰 파일 읽기(없거나 못 읽으면 null). 호출 때마다 지금 내용을 읽는다 */
  readonly readText: (path: string) => string | null;
  /** 노트가 바뀌면(화면에 알린다) */
  readonly onChange?: (book: NotebookJson) => void;
}

/** 팀원에게 붙이는 기억 글자 수 */
const MEMORY_CHARS = 12_000;
/** 룰 파일 하나·전체 글자 수 */
const RULE_CHARS = 30_000;
const RULES_CHARS = 60_000;

const expandHome = (path: string, home: string): string => (/^~[\\/]/.test(path) ? `${home.replace(/[\\/]+$/, '')}/${path.slice(2)}` : path);

/**
 * rauha 노트(기억·항상 룰). 불러오기 → 노트 메서드 → 저장. 규칙(경로·비밀 파일·길이)은 RauhaNotebook 이 지킨다.
 * 작업 폴더가 아니라 rauha 데이터 폴더에 남아, 어느 폴더에서 일하든 모든 팀원 호출에 붙는다.
 */
export class NotebookService {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly deps: NotebookServiceDeps,
    private book: RauhaNotebook,
  ) {}

  static open(deps: NotebookServiceDeps): NotebookService {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(deps.file, 'utf8'));
    } catch {
      raw = null;
    }
    return new NotebookService(deps, RauhaNotebook.fromJSON(raw));
  }

  get(): NotebookJson {
    return this.book.toJSON();
  }

  async remember(note: { readonly title: string; readonly text: string; readonly source: string | null }): Promise<string> {
    await this.change((b) => b.remember({ id: this.deps.newId(), title: note.title, text: note.text, source: note.source, at: this.deps.now() }));
    return `rauha 기억에 남겼어요: "${note.title.trim()}" (다음 대화부터 모든 팀원이 봐요. 설정 → Rules 에서 지울 수 있어요)`;
  }

  async keepRule(raw: string): Promise<string> {
    const path = expandHome(raw.trim(), this.deps.home);
    // 규칙(절대 경로·비밀 파일)을 먼저 본다: 비밀 파일이면 읽지도 않는다
    RauhaNotebook.empty().keepRule({ id: 'check', path, at: '' });
    if (this.deps.readText(path) === null) throw new Error(`그 파일을 읽을 수 없어요: ${path}`);
    await this.change((b) => b.keepRule({ id: this.deps.newId(), path, at: this.deps.now() }));
    return `항상 따를 룰로 남겼어요: ${path} (원본은 고치지 않고, 팀원을 부를 때마다 지금 내용을 읽어 붙여요)`;
  }

  async forget(id: string): Promise<void> {
    await this.change((b) => b.forget(id));
  }

  /** 팀원 시스템 프롬프트의 rauha 기억 글 */
  memoryBlock(): string {
    return this.book.memoryBlock(MEMORY_CHARS);
  }

  /** 팀원 시스템 프롬프트의 규칙 글: 남긴 룰 파일의 지금 내용(읽지 못한 파일은 그렇다고 적는다) */
  rulesBlock(): string {
    const parts: string[] = [];
    let used = 0;
    for (const rule of this.book.rules) {
      const text = this.deps.readText(rule.path);
      const body = text === null ? '(지금은 이 파일을 읽을 수 없어요)' : text.length > RULE_CHARS ? `${text.slice(0, RULE_CHARS)}\n…(잘림)` : text;
      const part = `### 룰 파일 ${rule.path}\n${body.trim()}`;
      if (used + part.length > RULES_CHARS) break;
      parts.push(part);
      used += part.length;
    }
    return parts.join('\n\n');
  }

  /** 한 번에 하나씩 바꾸고 저장한다(동시에 저장해 서로 덮어쓰지 않게). 규칙을 어기면 던지고 아무것도 바꾸지 않는다 */
  private change(apply: (book: RauhaNotebook) => RauhaNotebook): Promise<void> {
    const run = this.queue.then(async () => {
      const next = apply(this.book);
      if (next === this.book) return;
      mkdirSync(dirname(this.deps.file), { recursive: true });
      await writeFile(this.deps.file, JSON.stringify(next.toJSON(), null, 2), 'utf8');
      this.book = next;
      this.deps.onChange?.(next.toJSON());
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
