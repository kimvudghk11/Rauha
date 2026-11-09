import type { DeskHost } from './desk-host.js';
import { WriterReportDto } from './dto/writer-report.dto.js';
import { WRITER_SCHEMA } from './dto/schemas.js';
import type { MemberResult, ProgressPort } from './ports.js';
import { stoppedMember } from './member-stop-note.js';
import { conversationBlock } from './prompt-blocks.js';
import type { TurnOutcome } from './turn-outcome.js';

/** 저장소가 이 수를 넘으면 문서 팀원 한 명이 다 읽지 않고, 저장소마다 나눠 읽은 요약을 모아 쓴다. */
const GATHER_ABOVE = 4;
/** 저장소를 나눠 읽을 때 동시에 돌리는 수 */
const GATHER_PARALLEL = 4;

export interface DocumentDeps {
  readonly today: () => string;
  readonly progress: ProgressPort;
  /** 작업 공간에서 이 세션의 저장소 이름 */
  readonly repoName?: string | undefined;
  /** 작업 공간 폴더와 그 안의 저장소들 */
  readonly folder: () => { readonly root: string; readonly repos: readonly { readonly name: string; readonly root: string }[] } | undefined;
}

export interface DocumentHost extends DeskHost {
  /** 마지막 작업 이름(다음 대화의 "그 작업"이 가리킨다) */
  titled(title: string): void;
  /** 문서 팀원이 보고한 파일. 세션이 이어 일할 파일로 등록한다. */
  wrote(files: readonly string[]): Promise<void>;
}

/**
 * 코드가 아닌 결과물(포트폴리오·보고서·정리 문서). 테스트로 확인할 것이 없어 TDD 대신 문서 팀원이 읽고 쓴다.
 * 크기로 돌려보내지 않는다. 문서 팀원은 .md만 쓸 수 있다.
 */
export class DocumentDesk {
  constructor(
    private readonly host: DocumentHost,
    private readonly deps: DocumentDeps,
  ) {}

  async write(input: string, conversation: string | null, also: readonly { readonly name: string; readonly root: string }[], started: number): Promise<TurnOutcome> {
    const costBefore = this.host.spent();
    const current = this.deps.repoName ?? '이 저장소';
    const repos = [`- ${current} (지금 작업 폴더, 문서는 여기에)`, ...also.map((r) => `- ${r.name}: ${r.root}`)];
    const folderRoot = this.deps.folder()?.root;
    const dirs = [...also.map((r) => r.root), ...(folderRoot !== undefined ? [folderRoot] : [])];

    let digests = '';
    if (also.length + 1 > GATHER_ABOVE) {
      const gathered = await this.gather(input, [{ name: current, root: this.deps.folder()?.repos.find((r) => r.name === current)?.root ?? null }, ...also]);
      if ('blocked' in gathered) return { kind: 'blocked', ...gathered.blocked };
      digests = gathered.digests;
    }
    const result = await this.host.member(
      'writer',
      [
        conversationBlock(conversation),
        `<today>${this.deps.today()}</today>`,
        this.host.workspaceBlock(),
        `<repos>\n${repos.join('\n')}\n</repos>`,
        digests !== '' ? `<digests>\n${digests}\n</digests>` : '',
        `<request>\n${input}\n</request>`,
      ],
      WRITER_SCHEMA,
      { dirs, canWrite: (path) => /\.md$/i.test(path) },
    );
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const report = WriterReportDto.read(result.output);
    this.host.titled(input.slice(0, 60));
    await this.host.wrote(report.files);
    const stop = stoppedMember(result);
    if (stop !== null) return this.host.settle('문서를 끝내지 못함', input, stop.report(result.partial ?? null), stop.turnNote(result.partial ?? null), started, costBefore);
    return this.host.settle('문서', input, report.toAnswer(), report.files.join(', ') || '없음', started, costBefore, report.files);
  }

  /**
   * 저장소가 많은 문서 요청: 저장소마다 싼 모델이 자기 저장소만 읽고 요약을 낸다(동시에 몇 개씩).
   * 문서 팀원 한 명이 수십 개를 다 읽다 시간·턴이 모자라는 것을 피한다. 읽지 못한 저장소는 표시해서 넘긴다.
   */
  private async gather(
    input: string,
    repos: readonly { name: string; root: string | null }[],
  ): Promise<{ digests: string } | { blocked: NonNullable<MemberResult['blocked']> }> {
    const digests: string[] = new Array(repos.length).fill('');
    let blocked: MemberResult['blocked'] = undefined;
    let next = 0;
    let finished = 0;
    const worker = async () => {
      while (blocked === undefined) {
        const at = next;
        next += 1;
        const repo = repos[at];
        if (repo === undefined) return;
        const result = await this.host.member(
          'writer',
          [
            `<today>${this.deps.today()}</today>`,
            `<gather repo="${repo.name}"${repo.root !== null ? ` root="${repo.root}"` : ''}/>`,
            `<request>\n${input}\n</request>`,
          ],
          WRITER_SCHEMA,
          { dirs: repo.root !== null ? [repo.root] : [], canWrite: () => false, tier: 'haiku', quiet: true },
        );
        if (result.blocked) {
          blocked = result.blocked;
          return;
        }
        const report = WriterReportDto.read(result.output);
        digests[at] = `<repo name="${repo.name}">\n${result.output === null ? '(읽지 못했어요)' : report.summary}\n</repo>`;
        finished += 1;
        this.deps.progress.step(`저장소 읽는 중 ${finished}/${repos.length}`, 'writer');
      }
    };
    await Promise.all(Array.from({ length: Math.min(GATHER_PARALLEL, repos.length) }, worker));
    return blocked !== undefined ? { blocked } : { digests: digests.join('\n') };
  }
}
