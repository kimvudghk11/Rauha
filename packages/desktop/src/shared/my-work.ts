import { langOf } from './tech-stack.js';
/**
 * 이력서용 "내 작업": 여러 git 계정(개인·회사 이메일)을 "나"로 묶고, 작업 폴더 레포들의 커밋을 계정 → 월 → 레포로 센다.
 * 커밋 제목과 숫자만 다룬다(코드·파일 이름은 이력서 메모로 보내지 않는다).
 */
export interface GitAccount {
  readonly label: string;
  readonly emails: readonly string[];
  /** 이 계정의 GitHub 로그인(clone 없이 GitHub 에서 읽은 커밋을 이 계정으로 센다) */
  readonly github?: readonly string[];
}

/** GitHub 에서 읽은 커밋의 작성자 표시: "github:<로그인>" */
export const githubAuthor = (login: string): string => `github:${login.toLowerCase()}`;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const LABEL_MAX = 40;
const ACCOUNTS_MAX = 10;
const EMAILS_MAX = 20;

/** 내 계정 목록(값 객체). 이메일은 소문자로 한 번만 */
export class GitAccounts {
  private constructor(readonly list: readonly GitAccount[]) {}

  static from(raw: unknown): GitAccounts {
    const out: GitAccount[] = [];
    for (const a of Array.isArray(raw) ? raw.slice(0, ACCOUNTS_MAX) : []) {
      if (typeof a !== 'object' || a === null) continue;
      const o = a as Record<string, unknown>;
      const label = typeof o['label'] === 'string' ? o['label'].trim().slice(0, LABEL_MAX) : '';
      const emails = [...new Set((Array.isArray(o['emails']) ? o['emails'] : []).filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))].slice(0, EMAILS_MAX);
      const github = [...new Set((Array.isArray(o['github']) ? o['github'] : []).filter((g): g is string => typeof g === 'string' && LOGIN.test(g.trim())).map((g) => g.trim().toLowerCase()))].slice(0, EMAILS_MAX);
      if (label !== '' && (emails.length > 0 || github.length > 0)) out.push(github.length > 0 ? { label, emails, github } : { label, emails });
    }
    return new GitAccounts(out);
  }

  labelOf(email: string): string | null {
    const e = email.trim().toLowerCase();
    if (e.startsWith('github:')) return this.list.find((a) => (a.github ?? []).includes(e.slice(7)))?.label ?? null;
    return this.list.find((a) => a.emails.includes(e))?.label ?? null;
  }

  /** 계정에 묶인 GitHub 로그인 전부 */
  get logins(): string[] {
    return [...new Set(this.list.flatMap((a) => a.github ?? []))];
  }
}

export interface WorkCommit {
  readonly repo: string;
  readonly hash: string;
  readonly name: string;
  readonly email: string;
  /** 초 단위 UNIX 시각 */
  readonly at: number;
  readonly subject: string;
  readonly added: number;
  readonly removed: number;
  readonly files: number;
  /** 언어별 바꾼 줄 수(늘고 준 줄 합). 문서·설정 파일은 세지 않는다 */
  readonly langs: Readonly<Record<string, number>>;
}

/** git log 형식: 커밋 줄은 "@@" + 해시·이름·이메일·시각·제목(\x1f 로 구분), 그 뒤 --numstat 줄들 */
export const WORK_LOG_FORMAT = '@@%H%x1f%an%x1f%ae%x1f%at%x1f%s';

export function parseWorkLog(text: string, repo: string): WorkCommit[] {
  const out: { repo: string; hash: string; name: string; email: string; at: number; subject: string; added: number; removed: number; files: number; langs: Record<string, number> }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      const [hash = '', name = '', email = '', at = '0', subject = ''] = line.slice(2).split('\u001f');
      if (hash !== '') out.push({ repo, hash, name, email, at: Number(at) || 0, subject, added: 0, removed: 0, files: 0, langs: {} });
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(line);
    const cur = out[out.length - 1];
    if (m === null || cur === undefined) continue;
    const add = m[1] === '-' ? 0 : Number(m[1]);
    const del = m[2] === '-' ? 0 : Number(m[2]);
    cur.added += add;
    cur.removed += del;
    cur.files += 1;
    const lang = langOf(m[3]!);
    if (lang !== null && add + del > 0) cur.langs[lang] = (cur.langs[lang] ?? 0) + add + del;
  }
  return out;
}

export interface RepoWork {
  readonly repo: string;
  readonly commits: number;
  readonly added: number;
  readonly removed: number;
  readonly subjects: readonly string[];
}
export interface MonthWork {
  readonly month: string;
  readonly repos: readonly RepoWork[];
}
export interface AccountWork {
  readonly label: string;
  readonly commits: number;
  readonly added: number;
  readonly removed: number;
  readonly first: number;
  readonly last: number;
  readonly months: readonly MonthWork[];
  /** 내가 바꾼 언어(줄 수 많은 순, 많아야 8개) */
  readonly langs: readonly { readonly lang: string; readonly lines: number }[];
}
export interface WorkSummary {
  readonly total: number;
  readonly accounts: readonly AccountWork[];
  /** 아직 어느 계정에도 넣지 않은 작성자(많이 쓴 순) */
  readonly others: readonly { readonly name: string; readonly email: string; readonly commits: number }[];
  /** 레포 설정 파일에서 읽은 스택(내가 커밋한 레포만) */
  readonly stacks: readonly RepoStack[];
}

export interface RepoStack {
  readonly repo: string;
  readonly stack: readonly string[];
  /** 파일 배치에서 읽은 아키텍처 신호(사람이 읽는 줄) */
  readonly architecture: readonly string[];
}

const monthOf = (at: number): string => new Date(at * 1000).toISOString().slice(0, 7);
const SUBJECTS_PER_REPO = 30;
const LANGS_MAX = 8;

export function summarizeWork(commits: readonly WorkCommit[], accounts: GitAccounts, stacks: readonly RepoStack[] = []): WorkSummary {
  const mine = new Map<string, WorkCommit[]>();
  const others = new Map<string, { name: string; email: string; commits: number }>();
  for (const c of commits) {
    const label = accounts.labelOf(c.email);
    if (label === null) {
      const k = c.email.toLowerCase();
      const o = others.get(k) ?? { name: c.name, email: c.email, commits: 0 };
      o.commits += 1;
      others.set(k, o);
      continue;
    }
    mine.set(label, [...(mine.get(label) ?? []), c]);
  }
  const accountsOut: AccountWork[] = [...mine.entries()].map(([label, list]) => {
    const byMonth = new Map<string, Map<string, WorkCommit[]>>();
    for (const c of list) {
      const m = byMonth.get(monthOf(c.at)) ?? new Map<string, WorkCommit[]>();
      m.set(c.repo, [...(m.get(c.repo) ?? []), c]);
      byMonth.set(monthOf(c.at), m);
    }
    const months = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, repos]) => ({
        month,
        repos: [...repos.entries()].map(([repo, cs]) => ({ repo, commits: cs.length, added: cs.reduce((n, c) => n + c.added, 0), removed: cs.reduce((n, c) => n + c.removed, 0), subjects: [...new Set(cs.map((c) => c.subject))].slice(0, SUBJECTS_PER_REPO) })).sort((a, b) => b.commits - a.commits),
      }));
    const ats = list.map((c) => c.at);
    const lines = new Map<string, number>();
    for (const c of list) for (const [l, n] of Object.entries(c.langs)) lines.set(l, (lines.get(l) ?? 0) + n);
    const langs = [...lines.entries()].map(([lang, n]) => ({ lang, lines: n })).sort((a, b) => b.lines - a.lines).slice(0, LANGS_MAX);
    return { langs, label, commits: list.length, added: list.reduce((n, c) => n + c.added, 0), removed: list.reduce((n, c) => n + c.removed, 0), first: Math.min(...ats), last: Math.max(...ats), months };
  });
  accountsOut.sort((a, b) => b.last - a.last);
  const myRepos = new Set([...mine.values()].flat().map((c) => c.repo));
  return { total: accountsOut.reduce((n, a) => n + a.commits, 0), accounts: accountsOut, others: [...others.values()].sort((a, b) => b.commits - a.commits), stacks: stacks.filter((r) => myRepos.has(r.repo) && (r.stack.length > 0 || r.architecture.length > 0)) };
}

const NOTE_MAX = 12_000;

/**
 * 이력서 초안·면접에 보낼 메모: 계정·기간·레포별 커밋 제목과 숫자만(코드 없음).
 * subjectsPerRow 를 주면 레포·월마다 제목을 그만큼만 남기고 나머지는 개수로 적는다
 * (면접처럼 여러 번 보내는 곳에서 한도를 아끼고, 상한에 걸려 뒤 계정이 통째로 잘리지 않게).
 */
export function resumeNote(s: WorkSummary, opts: { readonly subjectsPerRow?: number; readonly max?: number } = {}): string {
  const max = opts.max ?? NOTE_MAX;
  const per = opts.subjectsPerRow ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  if (s.accounts.length > 0) {
    const first = Math.min(...s.accounts.map((a) => a.first));
    const last = Math.max(...s.accounts.map((a) => a.last));
    lines.push(`# Overview: ${s.total} commits, history spans ${monthOf(first)} ~ ${monthOf(last)} (about ${Math.max(1, Math.round((last - first) / (30 * 86400)))} months)`);
  }
  if (s.stacks.length > 0) {
    lines.push('## Repo tech stacks and architecture (read from manifests and the file layout, no code)');
    for (const r of s.stacks) {
      lines.push(`- ${r.repo}: ${r.stack.join(', ') || '(no manifest stack)'}`);
      for (const a of r.architecture) lines.push(`  - ${a}`);
    }
  }
  for (const a of s.accounts) {
    const changed = a.langs.reduce((n, l) => n + l.lines, 0);
    lines.push(`## ${a.label} account: ${a.commits} commits (+${a.added} −${a.removed}), ${monthOf(a.first)} ~ ${monthOf(a.last)}`);
    if (changed > 0) lines.push(`Languages I changed (lines): ${a.langs.map((l) => `${l.lang} ${Math.round((l.lines / changed) * 100)}% (${l.lines})`).join(', ')}`);
    for (const m of a.months) {
      for (const r of m.repos) {
        const shown = r.subjects.slice(0, per);
        const more = r.subjects.length - shown.length;
        lines.push(`- ${m.month} · ${r.repo} · ${r.commits} commits: ${shown.join(' / ')}${more > 0 ? ` (+${more} more)` : ''}`);
      }
    }
  }
  const text = lines.join('\n');
  return text.length > max ? `${text.slice(0, max)}\n(cut)` : text;
}
