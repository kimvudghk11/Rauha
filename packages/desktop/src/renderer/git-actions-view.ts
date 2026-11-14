import { durationText, type JobView, type RunView, type Verdict } from '../shared/gh-actions.js';
import { el } from './dom.js';
import type { GitCtx } from './git-common.js';
import { ago } from './git-format.js';

const VERDICT_MARK: Readonly<Record<Verdict, string>> = { queued: '○', running: '◌', success: '✓', failure: '✗', cancelled: '⊘', skipped: '–' };
const VERDICT_WORD: Readonly<Record<Verdict, string>> = { queued: 'Queued', running: 'Running', success: 'Succeeded', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' };
/** 진행 중인 실행이 있을 때만, 이 간격으로 다시 묻는다(ETag 라 바뀐 게 없으면 GitHub 횟수에 안 들어간다) */
const LIVE_MS = 30_000;

const mark = (v: Verdict): HTMLElement => {
  const m = el('span', `gact-mark ${v}`, VERDICT_MARK[v]);
  m.title = VERDICT_WORD[v];
  return m;
};

/**
 * Actions 탭(읽기 전용): 이 레포의 GitHub 원격에서 최근 실행 → 실행을 누르면 작업(job)과 단계 →
 * 실패한 작업은 로그 끝부분(GitHub CLI 로그인 필요). 다시 실행·취소는 하지 않는다(GitHub 에서).
 */
export function buildActions(ctx: GitCtx) {
  const root = el('div', 'gpanel gactions');
  const head = el('div', 'gtools gact-head');
  const title = el('span', 'hint grow', 'GitHub Actions');
  const reload = el('button', 'btn sm', 'Refresh');
  reload.type = 'button';
  head.append(title, reload);
  const body = el('div', 'gact-body');
  const runsBox = el('div', 'gact-runs');
  const detail = el('div', 'gact-detail');
  detail.append(el('div', 'dim pad', 'Pick a run to see its jobs and steps.'));
  body.append(runsBox, detail);
  root.append(head, body);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let picked: number | null = null;
  let signedIn = false;
  let wasRunning = new Set<number>();

  const openLink = (url: string, label: string): HTMLElement => {
    const b = el('button', 'btn sm', label);
    b.type = 'button';
    b.disabled = url === '';
    b.addEventListener('click', () => void window.open(url, '_blank'));
    return b;
  };

  async function showLog(job: JobView, box: HTMLElement): Promise<void> {
    box.replaceChildren(el('span', 'spinner'), el('span', 'hint', ' Reading the end of the log…'));
    const r = await ctx.callRaw('actionsLog', { jobId: job.id });
    if (!r.ok) return void box.replaceChildren(el('div', 'err', r.error));
    if (r.data.needsLogin) {
      box.replaceChildren(el('div', 'hint', 'GitHub shows logs only to signed-in people. Install the GitHub CLI and run gh auth login once, then reopen this tab — or open the log on GitHub.'), openLink(job.url, 'Open log on GitHub'));
      return;
    }
    const pre = el('div', 'gact-log');
    for (const l of r.data.lines) pre.append(el('div', l.error ? 'err' : '', l.text === '' ? ' ' : l.text));
    box.replaceChildren(pre);
    pre.scrollTop = pre.scrollHeight;
  }

  async function showRun(run: RunView): Promise<void> {
    picked = run.id;
    for (const row of runsBox.querySelectorAll('.gact-run')) row.classList.toggle('on', row.getAttribute('data-id') === String(run.id));
    const top = el('div', 'gact-dtop');
    top.append(mark(run.verdict), el('b', 'grow', `${run.workflow} #${run.number}`), openLink(run.url, 'Open on GitHub'));
    detail.replaceChildren(top, el('div', 'hint', `${run.title} · ${run.event} ${run.branch} · ${durationText(run.durationSec)}`), el('div', 'spinner'));
    const jobs = await ctx.callRaw('actionsJobs', { runId: run.id });
    if (picked !== run.id) return;
    detail.lastChild?.remove();
    if (!jobs.ok) return void detail.append(el('div', 'err', jobs.error));
    for (const job of jobs.data) {
      const card = el('div', `gact-job ${job.verdict}`);
      const jh = el('div', 'gact-jhead');
      jh.append(mark(job.verdict), el('b', 'grow', job.name), el('span', 'hint', durationText(job.durationSec)));
      const steps = el('div', 'gact-steps');
      for (const s of job.steps) {
        const row = el('div', `gact-step ${s.verdict}`);
        row.append(mark(s.verdict), el('span', 'grow', s.name));
        steps.append(row);
      }
      card.append(jh, steps);
      if (job.verdict === 'failure') {
        const logBox = el('div', 'gact-logbox');
        card.append(logBox);
        void showLog(job, logBox);
      }
      detail.append(card);
    }
    if (jobs.data.length === 0) detail.append(el('div', 'dim pad', 'No jobs yet.'));
  }

  function notifyFinished(runs: readonly RunView[]): void {
    for (const r of runs) {
      if (!wasRunning.has(r.id) || r.verdict === 'running' || r.verdict === 'queued') continue;
      const text = `${r.workflow} · ${r.branch} ${VERDICT_WORD[r.verdict].toLowerCase()} in ${durationText(r.durationSec)}`;
      ctx.say(text, r.verdict === 'failure');
      try {
        new Notification('GitHub Actions', { body: text, silent: true });
      } catch {
        /* 알림을 못 띄워도 화면 줄은 남는다 */
      }
    }
    wasRunning = new Set(runs.filter((r) => r.verdict === 'running' || r.verdict === 'queued').map((r) => r.id));
  }

  async function refresh(): Promise<void> {
    clearTimeout(timer);
    reload.disabled = true;
    const r = await ctx.callRaw('actionsRuns', undefined as never);
    reload.disabled = false;
    if (!r.ok) {
      runsBox.replaceChildren(el('div', 'err pad', r.error));
      return;
    }
    signedIn = r.data.signedIn;
    title.textContent = `GitHub Actions · ${r.data.slug}${signedIn ? '' : ' · not signed in (public info only)'}`;
    notifyFinished(r.data.runs);
    runsBox.replaceChildren();
    if (r.data.runs.length === 0) runsBox.append(el('div', 'dim pad', 'No workflow runs yet.'));
    for (const run of r.data.runs) {
      const row = el('button', `gact-run${run.id === picked ? ' on' : ''}`);
      row.type = 'button';
      row.setAttribute('data-id', String(run.id));
      const text = el('span', 'gact-rtext');
      text.append(el('b', undefined, run.title || run.workflow), el('span', 'hint', `${run.workflow} · ${run.event === 'push' ? '' : `${run.event} · `}${run.branch} · ${run.actor}`));
      const side = el('span', 'gact-rside');
      side.append(el('span', 'hint', durationText(run.durationSec)), el('span', 'hint', ago(Math.floor(Date.parse(run.startedAt) / 1000), Math.floor(Date.now() / 1000))));
      row.append(mark(run.verdict), text, side);
      row.addEventListener('click', () => void showRun(run));
      runsBox.append(row);
    }
    const live = r.data.runs.some((x) => x.verdict === 'running' || x.verdict === 'queued');
    if (live && root.isConnected) timer = setTimeout(() => void refresh(), LIVE_MS);
    const again = r.data.runs.find((x) => x.id === picked);
    if (again !== undefined && live) void showRun(again);
  }

  reload.addEventListener('click', () => void refresh());
  return { root, refresh };
}
