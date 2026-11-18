import { matchRepos } from './workspace-tools.js';

/** rauha 가 git·파일로 직접 읽은 저장소 하나의 최근 변경 */
export interface DigestRepo {
  readonly name: string;
  readonly root: string;
  /** 지금 브랜치. 모르면 null */
  readonly branch: string | null;
  /** 최근 태그(새것부터) */
  readonly tags: readonly string[];
  /** 최근 커밋(새것부터, 모든 브랜치, 병합 제외) */
  readonly commits: readonly { readonly hash: string; readonly at: string; readonly author: string; readonly subject: string }[];
  /** 저장소 루트 기준 CHANGELOG 경로와 앞부분. 없으면 null */
  readonly changelog: { readonly path: string; readonly head: string } | null;
}

const ASKS = /체인지\s*로그|change\s*-?\s*log|커밋|commit|릴리[스즈]|release|변경\s*(내역|사항|이력|점|된)|업데이트\s*(내역|사항)|히스토리|history|뭐가?\s*바뀌|무엇이\s*바뀌|최근\s*(작업|변경|업데이트)/i;
/** 묶음 전체 길이 상한(약 2만 토큰). 저장소가 많으면 저장소마다 실을 양을 나눠 줄인다. */
const TOTAL_CHARS = 80_000;
const MIN_PER_REPO = 1_500;
const MAX_PER_REPO = 6_000;

/**
 * "모든 레포 체인지로그·커밋 봐줘"면 팀원이 레포를 하나씩 뒤지게 두지 않고, rauha 가 모든 저장소의 최근 커밋·태그·CHANGELOG 앞부분을
 * 먼저 모아(모델 호출 없음) 한 묶음으로 준다. 팀원은 빠진 저장소 없이 그 사실로 답하고, 더 깊은 것만 직접 연다.
 */
export class RepoDigest {
  private constructor() {}

  static asks(text: string): boolean {
    return ASKS.test(text);
  }

  static block(repos: readonly DigestRepo[]): string {
    if (repos.length === 0) return '';
    const budget = Math.max(MIN_PER_REPO, Math.min(MAX_PER_REPO, Math.floor(TOTAL_CHARS / repos.length)));
    const head = [
      `<repo_digest>`,
      `rauha 가 git 과 파일로 직접 읽은 저장소 ${repos.length}개 전부의 최근 커밋·태그·CHANGELOG 앞부분입니다(빠진 저장소 없음).`,
      '- 저장소를 하나도 빠뜨리지 말고 모두 다루세요. asks 에는 저장소마다 한 항목을 넣으세요.',
      '- 여기 있는 것은 다시 열 필요가 없습니다. 더 오래된 기록이나 diff 가 꼭 필요할 때만 git -C <root> 로 더 보세요.',
      '- 여기 없는 변경을 지어내지 마세요. CHANGELOG 가 없는 저장소는 커밋으로만 말하세요.',
    ].join('\n');
    const sections = repos.map((r) => RepoDigest.section(r, budget));
    return `${head}\n\n${sections.join('\n\n')}\n</repo_digest>`;
  }

  /**
   * 팀원이 도구로 고른 저장소만, since(YYYY-MM-DD)가 있으면 그날부터의 커밋만 남긴다.
   * names 는 이름(대소문자 무시) 또는 루트 경로 끝으로 맞춘다. 비었으면 모든 저장소. 맞는 것이 없으면 빈 배열.
   */
  static pick(repos: readonly DigestRepo[], names: readonly string[] = [], since: string | null = null): DigestRepo[] {
    return matchRepos(repos, names).map((r) => (since === null ? r : { ...r, commits: r.commits.filter((c) => c.at.slice(0, 10) >= since) }));
  }

  /** 저장소 목록 한 줄씩: 이름·루트·브랜치·가장 최근 커밋·태그 */
  static list(repos: readonly DigestRepo[]): string {
    if (repos.length === 0) return '작업 공간에 저장소가 없어요.';
    const lines = repos.map((r) => {
      const last = r.commits[0];
      const parts = [r.branch !== null ? `브랜치 ${r.branch}` : null, last !== undefined ? `최근 커밋 ${last.at} ${last.subject}` : '커밋 없음', r.tags.length > 0 ? `태그 ${r.tags[0]}` : null, r.changelog !== null ? `CHANGELOG ${r.changelog.path}` : null];
      return `- ${r.name} (${r.root}) · ${parts.filter((p) => p !== null).join(' · ')}`;
    });
    return `작업 공간의 저장소 ${repos.length}개(빠짐없이 전부):\n${lines.join('\n')}`;
  }

  /** 이 묶음으로 rauha 가 이미 본 곳: 저장소 루트와 CHANGELOG 경로(요청 항목 표의 "안 본 곳"에서 뺀다) */
  static seen(repos: readonly DigestRepo[]): string[] {
    return repos.flatMap((r) => [r.root, ...(r.changelog !== null ? [`${r.root.replace(/[\\/]+$/, '')}/${r.changelog.path}`] : [])]);
  }

  private static section(r: DigestRepo, budget: number): string {
    const state = [r.branch !== null ? `브랜치 ${r.branch}` : null, r.tags.length > 0 ? `태그 ${r.tags.join(', ')}` : null].filter((s) => s !== null).join(' · ');
    const title = `■ ${r.name} (${r.root})${state !== '' ? ` ${state}` : ''}`;
    // 커밋 몫을 먼저 잡고 남는 만큼 CHANGELOG 를 싣는다(CHANGELOG 가 없거나 짧으면 커밋을 더 싣는다)
    const commitLines = r.commits.map((c) => `- ${c.hash} ${c.at} ${c.author}: ${c.subject}`);
    const commitBudget = r.changelog === null ? budget : Math.floor(budget / 2);
    const commits = RepoDigest.fit(commitLines, commitBudget);
    const left = Math.max(0, budget - commits.text.length);
    const log = r.changelog === null ? 'CHANGELOG 없음' : `CHANGELOG (${r.changelog.path}, 앞부분):\n${RepoDigest.cut(r.changelog.head.trim(), left)}`;
    const commitPart = commitLines.length === 0 ? '최근 커밋 없음' : `최근 커밋 ${commits.count}개(새것부터${commits.count < commitLines.length ? `, ${commitLines.length - commits.count}개 생략` : ''}):\n${commits.text}`;
    return [title, log, commitPart].join('\n');
  }

  private static fit(lines: readonly string[], budget: number): { text: string; count: number } {
    const kept: string[] = [];
    let size = 0;
    for (const line of lines) {
      if (kept.length > 0 && size + line.length + 1 > budget) break;
      kept.push(line);
      size += line.length + 1;
    }
    return { text: kept.join('\n'), count: kept.length };
  }

  private static cut(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max))}\n…(이하 생략)`;
  }
}
