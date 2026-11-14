import { createReadStream } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { codexEntry, codexSummary, kiroCliEntry, kiroCliSummary, kiroCrewEntry, kiroCrewSummary, OTHER_SOURCE_LABEL, OtherHistoryId } from '../../shared/other-history.js';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { HistoryId, mergeTurns, sessionSummary, transcriptEntry, type TranscriptEntry } from '../../shared/claude-history.js';

/** 목록 한 줄 */
export interface ClaudeSessionRow {
  readonly id: string;
  readonly title: string;
  /** 대화한 작업 폴더 */
  readonly cwd: string;
  readonly startedAt: string;
  /** 마지막으로 쓴 시각(파일 수정 시각) */
  readonly updatedAt: string;
  readonly bytes: number;
  /** 어느 설정 폴더(계정)의 대화인지: ~/.claude 또는 rauha 계정 폴더 */
  readonly source: string;
  /** 프로그램(rauha 팀원 등)이 시작한 대화 */
  readonly automated: boolean;
}

export type HistoryResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

const HEAD_BYTES = 256 * 1024;
const MAX_SESSIONS = 1500;
const MAX_ENTRIES = 4000;
const MAX_FILE = 200 * 1024 * 1024;
const SESSION_FILE = /^[A-Za-z0-9._-]{1,200}\.jsonl$/;

export interface ClaudeHistoryDeps {
  /** 대화 내역을 찾을 Claude 설정 폴더들(기본 ~/.claude 와 지금 계정의 CLAUDE_CONFIG_DIR). 같은 폴더는 한 번만 */
  readonly roots: () => Promise<readonly { readonly dir: string; readonly label: string }[]>;
  /** 다른 AI 의 기록 폴더(없으면 그 출처는 건너뜀): ~/.kiro, ~/.codex */
  readonly others?: { readonly kiro?: string; readonly codex?: string };
}

/**
 * Claude Code 대화 내역(이 컴퓨터의 모든 프로젝트). 각 설정 폴더의 projects/*\/*.jsonl 만 읽고,
 * 로그인 정보·설정 파일은 열지 않는다. 화면은 목록에서 받은 id 로만 세션을 연다(경로를 보내지 않는다).
 */
export class ClaudeHistoryService {
  constructor(private readonly deps: ClaudeHistoryDeps) {}

  async list(): Promise<HistoryResult<{ readonly sessions: readonly ClaudeSessionRow[]; readonly roots: readonly string[] }>> {
    try {
      const roots = await this.deps.roots();
      const rows: ClaudeSessionRow[] = [];
      for (const [ri, root] of roots.entries()) {
        const projectsDir = join(root.dir, 'projects');
        const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
        for (const p of projects) {
          if (!p.isDirectory()) continue;
          const files = await readdir(join(projectsDir, p.name), { withFileTypes: true }).catch(() => []);
          for (const f of files) {
            if (!f.isFile() || !SESSION_FILE.test(f.name)) continue;
            let id: HistoryId;
            try {
              id = HistoryId.of(ri, p.name, f.name.slice(0, -'.jsonl'.length));
            } catch {
              continue;
            }
            const path = join(projectsDir, p.name, f.name);
            const st = await stat(path).catch(() => null);
            if (st === null || st.size === 0) continue;
            const head = sessionSummary(await readHead(path));
            if (head.title === '') continue;
            rows.push({ id: id.toString(), title: head.title, cwd: head.cwd || p.name, startedAt: head.startedAt, updatedAt: st.mtime.toISOString(), bytes: st.size, source: root.label, automated: head.automated });
          }
        }
      }
      const others = await this.otherRows();
      rows.push(...others);
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const labels = [...roots.map((r) => r.label), ...new Set(others.map((r) => r.source))];
      return { ok: true, data: { sessions: rows.slice(0, MAX_SESSIONS), roots: labels } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Kiro CLI · Kiro crew · Codex 대화 목록(읽기만) */
  private async otherRows(): Promise<ClaudeSessionRow[]> {
    const rows: ClaudeSessionRow[] = [];
    const { kiro, codex } = this.deps.others ?? {};
    const row = async (id: OtherHistoryId | null, path: string, s: { title: string; cwd: string; startedAt: string } | null, updated?: string): Promise<void> => {
      if (id === null || s === null || s.title === '') return;
      const st = await stat(path).catch(() => null);
      if (st === null || st.size === 0) return;
      rows.push({ id: id.toString(), title: s.title, cwd: s.cwd, startedAt: s.startedAt, updatedAt: updated || st.mtime.toISOString(), bytes: st.size, source: OTHER_SOURCE_LABEL[id.source], automated: false });
    };
    if (kiro !== undefined) {
      const cli = join(kiro, 'sessions', 'cli');
      for (const f of await readdir(cli).catch(() => [] as string[])) {
        if (!f.endsWith('.json')) continue;
        const name = f.slice(0, -'.json'.length);
        const meta = kiroCliSummary(await readFile(join(cli, f), 'utf8').catch(() => ''));
        const path = join(cli, `${name}.jsonl`);
        // 제목이 비어 있는 대화가 있다: 첫 질문을 제목으로
        const firstAsk = meta !== null && meta.title === '' ? (await readHead(path).catch(() => [] as string[])).map(kiroCliEntry).find((e) => e?.role === 'user')?.text ?? '' : '';
        const titled = meta === null ? null : { ...meta, title: meta.title || firstAsk.replace(/\s+/g, ' ').trim().slice(0, 140) };
        await row(OtherHistoryId.of('kiro', name), path, titled, meta?.updatedAt);
      }
      const crew = join(kiro, 'crew', 'sessions');
      for (const f of await readdir(crew).catch(() => [] as string[])) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(crew, f);
        await row(OtherHistoryId.of('kirocrew', f.slice(0, -'.jsonl'.length)), path, kiroCrewSummary(await readHead(path).catch(() => [])));
      }
    }
    if (codex !== undefined) {
      const base = join(codex, 'sessions');
      for (const y of await readdir(base).catch(() => [] as string[]))
        for (const m of await readdir(join(base, y)).catch(() => [] as string[]))
          for (const d of await readdir(join(base, y, m)).catch(() => [] as string[]))
            for (const f of await readdir(join(base, y, m, d)).catch(() => [] as string[])) {
              if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue;
              const path = join(base, y, m, d, f);
              await row(OtherHistoryId.of('codex', `${y}/${m}/${d}/${f.slice(0, -'.jsonl'.length)}`), path, codexSummary(await readHead(path).catch(() => [])));
            }
    }
    return rows;
  }

  private otherPath(id: OtherHistoryId): string | null {
    const { kiro, codex } = this.deps.others ?? {};
    if (id.source === 'kiro') return kiro === undefined ? null : join(kiro, 'sessions', 'cli', `${id.file}.jsonl`);
    if (id.source === 'kirocrew') return kiro === undefined ? null : join(kiro, 'crew', 'sessions', `${id.file}.jsonl`);
    return codex === undefined ? null : join(codex, 'sessions', ...id.file.split('/')) + '.jsonl';
  }

  async open(raw: unknown): Promise<HistoryResult<{ readonly entries: readonly TranscriptEntry[]; readonly truncated: boolean }>> {
    const other = OtherHistoryId.parse(raw);
    if (other !== null) {
      const path = this.otherPath(other);
      if (path === null) return { ok: false, error: 'That conversation is not in the list. Refresh the list.' };
      const parseLine = other.source === 'kiro' ? kiroCliEntry : other.source === 'kirocrew' ? kiroCrewEntry : codexEntry;
      return this.readEntries(path, parseLine);
    }
    let id: HistoryId;
    try {
      id = HistoryId.parse(raw);
    } catch {
      return { ok: false, error: 'That conversation is not in the list. Refresh the list.' };
    }
    const roots = await this.deps.roots();
    const root = roots[id.root];
    if (root === undefined) return { ok: false, error: 'That conversation is not in the list. Refresh the list.' };
    return this.readEntries(join(root.dir, 'projects', id.project, `${id.session}.jsonl`), transcriptEntry);
  }

  private async readEntries(path: string, parseLine: (line: string) => TranscriptEntry | null): Promise<HistoryResult<{ readonly entries: readonly TranscriptEntry[]; readonly truncated: boolean }>> {
    const st = await stat(path).catch(() => null);
    if (st === null || !st.isFile()) return { ok: false, error: 'That conversation file no longer exists.' };
    if (st.size > MAX_FILE) return { ok: false, error: 'That conversation is too large to open here.' };
    const entries: TranscriptEntry[] = [];
    let truncated = false;
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const e = parseLine(line);
      if (e === null) continue;
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push(e);
    }
    rl.close();
    return { ok: true, data: { entries: mergeTurns(entries), truncated } };
  }
}

/** 파일 앞부분(256KB)의 완성된 줄들 */
async function readHead(path: string): Promise<string[]> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split(/\r?\n/);
    if (bytesRead === HEAD_BYTES) lines.pop();
    return lines;
  } finally {
    await fh.close();
  }
}
