import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
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
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ok: true, data: { sessions: rows.slice(0, MAX_SESSIONS), roots: roots.map((r) => r.label) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async open(raw: unknown): Promise<HistoryResult<{ readonly entries: readonly TranscriptEntry[]; readonly truncated: boolean }>> {
    let id: HistoryId;
    try {
      id = HistoryId.parse(raw);
    } catch {
      return { ok: false, error: 'That conversation is not in the list. Refresh the list.' };
    }
    const roots = await this.deps.roots();
    const root = roots[id.root];
    if (root === undefined) return { ok: false, error: 'That conversation is not in the list. Refresh the list.' };
    const path = join(root.dir, 'projects', id.project, `${id.session}.jsonl`);
    const st = await stat(path).catch(() => null);
    if (st === null || !st.isFile()) return { ok: false, error: 'That conversation file no longer exists.' };
    if (st.size > MAX_FILE) return { ok: false, error: 'That conversation is too large to open here.' };
    const entries: TranscriptEntry[] = [];
    let truncated = false;
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const e = transcriptEntry(line);
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
