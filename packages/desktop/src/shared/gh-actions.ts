/** GitHub Actions 보기(읽기 전용)에 쓰는 값과 규칙. API 응답은 여기서만 모양을 확인하고 화면 값으로 바꾼다. */

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** github.com 저장소 하나(owner/repo). 원격 주소에서만 만든다. */
export class GithubRepo {
  private constructor(readonly owner: string, readonly name: string) {}

  static fromRemote(remote: string): GithubRepo | null {
    const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim());
    if (m === null) return null;
    const [owner = '', name = ''] = [m[1], m[2]];
    if (!NAME.test(owner) || !NAME.test(name) || owner.startsWith('.') || name.startsWith('.')) return null;
    return new GithubRepo(owner, name);
  }

  get slug(): string {
    return `${this.owner}/${this.name}`;
  }
}

export type Verdict = 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';

export function runVerdict(status: string, conclusion: string | null): Verdict {
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'queued';
  if (conclusion === 'success' || conclusion === 'neutral') return 'success';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion === 'skipped') return 'skipped';
  return 'failure';
}

export interface RunView {
  readonly id: number;
  readonly workflow: string;
  readonly title: string;
  readonly event: string;
  readonly branch: string;
  readonly number: number;
  readonly attempt: number;
  readonly verdict: Verdict;
  readonly startedAt: string;
  readonly durationSec: number | null;
  /** github.com 주소만(아니면 빈 글) */
  readonly url: string;
  readonly actor: string;
}

export interface StepView {
  readonly number: number;
  readonly name: string;
  readonly verdict: Verdict;
}

export interface JobView {
  readonly id: number;
  readonly name: string;
  readonly verdict: Verdict;
  readonly durationSec: number | null;
  readonly url: string;
  readonly steps: readonly StepView[];
}

export interface LogLine {
  readonly text: string;
  readonly error: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const ghUrl = (v: unknown): string => (typeof v === 'string' && v.startsWith('https://github.com/') ? v : '');
const secs = (from: unknown, to: unknown): number | null => {
  const a = Date.parse(str(from));
  const b = Date.parse(str(to));
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? null : Math.round((b - a) / 1000);
};
const list = (v: unknown, key: string): Obj[] => (isObj(v) && Array.isArray(v[key]) ? (v[key] as unknown[]).filter(isObj) : []);

export function runsFromApi(json: unknown): RunView[] {
  const out: RunView[] = [];
  for (const r of list(json, 'workflow_runs')) {
    const id = int(r['id']);
    if (id === null) continue;
    const verdict = runVerdict(str(r['status']), nul(r['conclusion']));
    const startedAt = str(r['run_started_at']) || str(r['created_at']);
    out.push({
      id,
      workflow: str(r['name']),
      title: str(r['display_title']),
      event: str(r['event']),
      branch: str(r['head_branch']),
      number: int(r['run_number']) ?? 0,
      attempt: int(r['run_attempt']) ?? 1,
      verdict,
      startedAt,
      durationSec: verdict === 'running' || verdict === 'queued' ? secs(startedAt, new Date().toISOString()) : secs(startedAt, r['updated_at']),
      url: ghUrl(r['html_url']),
      actor: isObj(r['actor']) ? str(r['actor']['login']) : '',
    });
  }
  return out;
}

export function jobsFromApi(json: unknown): JobView[] {
  const out: JobView[] = [];
  for (const j of list(json, 'jobs')) {
    const id = int(j['id']);
    if (id === null) continue;
    const steps = (Array.isArray(j['steps']) ? (j['steps'] as unknown[]).filter(isObj) : []).map((s) => ({ number: int(s['number']) ?? 0, name: str(s['name']), verdict: runVerdict(str(s['status']), nul(s['conclusion'])) }));
    out.push({ id, name: str(j['name']), verdict: runVerdict(str(j['status']), nul(j['conclusion'])), durationSec: secs(j['started_at'], j['completed_at']), url: ghUrl(j['html_url']), steps });
  }
  return out;
}

export function durationText(sec: number | null): string {
  if (sec === null) return '';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;

/** 작업 로그 원문에서 마지막 n줄. 줄 앞 시각은 떼고, ##[error] 줄은 오류로 표시한다 */
export function logTail(raw: string, n: number): LogLine[] {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
  return lines.slice(-n).map((l) => {
    const t = l.replace(STAMP, '');
    const error = t.startsWith('##[error]');
    return { text: error ? t.slice('##[error]'.length) : t.replace(/^##\[(group|endgroup|warning|notice|debug)\]/, ''), error };
  });
}
