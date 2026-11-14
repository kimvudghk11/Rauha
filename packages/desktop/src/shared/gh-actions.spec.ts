import { describe, expect, it } from 'vitest';
import { durationText, GithubRepo, jobsFromApi, logTail, runsFromApi, runVerdict } from './gh-actions.js';

describe('GitHub 저장소 주소 값 객체', () => {
  it('https · ssh · git@ 주소에서 owner/repo 를 읽는다', () => {
    expect(GithubRepo.fromRemote('https://github.com/kimvudghk11/rauha.git')?.slug).toBe('kimvudghk11/rauha');
    expect(GithubRepo.fromRemote('git@github.com:a-b/c.d.git')?.slug).toBe('a-b/c.d');
    expect(GithubRepo.fromRemote('ssh://git@github.com/o/r')?.slug).toBe('o/r');
  });
  it('GitHub 가 아니거나 이상한 이름이면 null', () => {
    expect(GithubRepo.fromRemote('https://gitlab.com/o/r.git')).toBeNull();
    expect(GithubRepo.fromRemote('https://github.com/o/../x')).toBeNull();
    expect(GithubRepo.fromRemote('C:/work/remote.git')).toBeNull();
  });
});

const apiRun = { id: 43571915982, name: 'desktop', display_title: 'release: v0.2.4', event: 'push', head_branch: 'v0.2.4', status: 'completed', conclusion: 'success', run_number: 120, run_attempt: 1, run_started_at: '2026-11-14T07:00:00Z', updated_at: '2026-11-14T07:18:02Z', html_url: 'https://github.com/o/r/actions/runs/43571915982', actor: { login: 'me' } };

describe('실행 목록 바꾸기', () => {
  it('화면에 필요한 값만 꺼낸다', () => {
    const [r] = runsFromApi({ workflow_runs: [apiRun] });
    expect(r).toMatchObject({ id: 43571915982, workflow: 'desktop', title: 'release: v0.2.4', branch: 'v0.2.4', verdict: 'success', durationSec: 1082, url: 'https://github.com/o/r/actions/runs/43571915982', actor: 'me' });
  });
  it('모양이 틀린 줄은 버리고, github.com 이 아닌 주소는 비운다', () => {
    const rows = runsFromApi({ workflow_runs: [{ id: 'x' }, { ...apiRun, html_url: 'https://evil.example/x' }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('');
  });
  it('목록이 아니면 빈 배열', () => {
    expect(runsFromApi(null)).toEqual([]);
  });
});

describe('상태 하나로 줄이기', () => {
  it('진행·대기·성공·실패·취소', () => {
    expect(runVerdict('in_progress', null)).toBe('running');
    expect(runVerdict('queued', null)).toBe('queued');
    expect(runVerdict('completed', 'success')).toBe('success');
    expect(runVerdict('completed', 'failure')).toBe('failure');
    expect(runVerdict('completed', 'timed_out')).toBe('failure');
    expect(runVerdict('completed', 'cancelled')).toBe('cancelled');
    expect(runVerdict('completed', 'skipped')).toBe('skipped');
  });
});

describe('작업(job)과 단계', () => {
  it('단계까지 꺼내고 실패한 단계를 표시한다', () => {
    const [j] = jobsFromApi({ jobs: [{ id: 7, name: 'desktop (windows-latest)', status: 'completed', conclusion: 'failure', started_at: '2026-11-14T07:00:00Z', completed_at: '2026-11-14T07:10:00Z', html_url: 'https://github.com/o/r/actions/runs/1/job/7', steps: [{ number: 1, name: 'Checkout', status: 'completed', conclusion: 'success' }, { number: 2, name: 'Test', status: 'completed', conclusion: 'failure' }] }] });
    expect(j).toMatchObject({ id: 7, verdict: 'failure', durationSec: 600 });
    expect(j?.steps.map((s) => s.verdict)).toEqual(['success', 'failure']);
  });
});

describe('걸린 시간 · 로그 끝부분', () => {
  it('초를 사람 말로', () => {
    expect(durationText(42)).toBe('42s');
    expect(durationText(1082)).toBe('18m 2s');
    expect(durationText(3725)).toBe('1h 2m');
    expect(durationText(null)).toBe('');
  });
  it('로그는 앞의 시각을 떼고 마지막 n줄만, 오류 줄을 표시한다', () => {
    const raw = ['2026-11-14T07:00:00.1234567Z ##[group]Run yarn test', '2026-11-14T07:00:01.0000000Z  ✓ a', '2026-11-14T07:00:02.0000000Z ##[error]Process completed with exit code 1.'].join('\n');
    expect(logTail(raw, 2)).toEqual([{ text: ' ✓ a', error: false }, { text: 'Process completed with exit code 1.', error: true }]);
  });
});
