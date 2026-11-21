import { ToolKits } from '../domain/tool-kit.js';
import { CONTINUE_NOTE, type DeskHost } from './desk-host.js';
import { WriterReportDto } from './dto/writer-report.dto.js';
import { CoverageDto } from './dto/coverage.dto.js';
import type { RequestCoverage } from '../domain/request-coverage.js';
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
  /** 저장소 이름 → rauha 가 저장해 둔 그 저장소 지식(없으면 null). 나눠 읽을 때 구조를 다시 훑지 않게 준다. */
  readonly knownOf?: (name: string) => Promise<string | null>;
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

  /**
   * facts: 체인지로그·커밋 문서면 rauha 가 모든 저장소에서 모은 최근 변경 묶음(block)과 그것으로 이미 본 곳(seen).
   * 묶음이 있으면 저장소마다 요약하는 호출을 하지 않는다(사실은 이미 다 모였다).
   */
  async write(input: string, conversation: string | null, also: readonly { readonly name: string; readonly root: string }[], started: number, facts: { readonly block: string; readonly seen: readonly string[] } | null = null): Promise<TurnOutcome> {
    const costBefore = this.host.spent();
    const current = this.deps.repoName ?? '이 저장소';
    const repos = [`- ${current} (지금 작업 폴더, 문서는 여기에)`, ...also.map((r) => `- ${r.name}: ${r.root}`)];
    const folderRoot = this.deps.folder()?.root;
    const dirs = [...also.map((r) => r.root), ...(folderRoot !== undefined ? [folderRoot] : [])];

    let digests = '';
    if (facts === null && also.length + 1 > GATHER_ABOVE) {
      const gathered = await this.gather(input, [{ name: current, root: this.deps.folder()?.repos.find((r) => r.name === current)?.root ?? null }, ...also]);
      if ('blocked' in gathered) return { kind: 'blocked', ...gathered.blocked };
      digests = gathered.digests;
    }
    const parts = [
      conversationBlock(conversation),
      `<today>${this.deps.today()}</today>`,
      this.host.workspaceBlock(),
      `<repos>\n${repos.join('\n')}\n</repos>`,
      digests !== '' ? `<digests>\n${digests}\n</digests>` : '',
      facts?.block ?? '',
      `<request>\n${input}\n</request>`,
    ];
    const send = (more: readonly string[], from?: string) =>
      this.host.member(
        'writer',
        from !== undefined ? [...more, CONTINUE_NOTE] : [...parts, ...more],
        WRITER_SCHEMA,
        // 노션·컨플루언스 같은 업무 도구에 정리하라는 요청이면 커넥터를 붙이고, 시킨 쓰기는 묻지 않게 요청을 넘긴다
        { dirs, canWrite: (path) => /\.md$/i.test(path), kits: ToolKits.for('writer', input), ...(ToolKits.for('writer', input).includes('connectors') ? { request: input } : {}), ...(from !== undefined ? { continueFrom: from } : {}) },
      );
    const first = await send([]);
    // 빠진 항목 마저 채우기는 같은 세션을 잇는다(읽은 파일을 다시 읽지 않게). 이어 하기가 안 되면 처음처럼 모두 보낸다.
    const call = async (more: readonly string[]) => {
      if (first.sessionId !== undefined) {
        const continued = await send(more, first.sessionId);
        if (continued.output !== null || continued.blocked) return continued;
      }
      return send(more);
    };
    if (first.blocked) return { kind: 'blocked', ...first.blocked };
    const { result, coverage, earlierFiles } = await this.finishAsks(first, call, facts?.seen ?? []);
    const report = WriterReportDto.read(result.output);
    const files = [...new Set([...earlierFiles, ...report.files])];
    this.host.titled(input.slice(0, 60));
    await this.host.wrote(files);
    const stop = stoppedMember(result);
    if (stop !== null) return this.host.settle('문서를 끝내지 못함', input, stop.report(result.partial ?? null), stop.turnNote(result.partial ?? null), started, costBefore);
    const table = coverage.toText();
    const answer = WriterReportDto.read({ ...(result.output as object), files }).toAnswer();
    return this.host.settle('문서', input, table === '' ? answer : `${answer}\n\n${table}`, files.join(', ') || '없음', started, costBefore, files, result.usage.tools);
  }

  /**
   * 요청 항목 표에 팀이 더 하면 끝나는 항목이나 읽겠다고 하고 열지 않은 곳이 있으면, 같은 문서를 마저 채우게 한 번 더 부른다.
   * 다시 부른 결과를 읽지 못하거나 막히면 처음 결과를 쓴다.
   */
  private async finishAsks(
    first: MemberResult,
    call: (more: readonly string[]) => Promise<MemberResult>,
    seen: readonly string[],
  ): Promise<{ result: MemberResult; coverage: RequestCoverage; earlierFiles: readonly string[] }> {
    const coverage = CoverageDto.read(first.output, [...seen, ...(first.opened ?? [])]);
    const followUp = first.output !== null ? coverage.followUp() : null;
    if (followUp === null) return { result: first, coverage, earlierFiles: [] };
    const before = WriterReportDto.read(first.output);
    this.deps.progress.step('빠진 항목을 마저 채울게요', 'writer');
    const again = await call([`<previous_report>\n${before.summary}\n이미 쓴 문서: ${before.files.join(', ') || '없음'}. 새 파일을 만들지 말고 이 문서를 고쳐 채우세요.\n</previous_report>`, followUp]);
    if (again.blocked || again.output === null) return { result: first, coverage, earlierFiles: [] };
    return { result: again, coverage: CoverageDto.read(again.output, [...seen, ...(first.opened ?? []), ...(again.opened ?? [])]), earlierFiles: before.files };
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
        const known = (await this.deps.knownOf?.(repo.name).catch(() => null)) ?? null;
        const result = await this.host.member(
          'writer',
          [
            `<today>${this.deps.today()}</today>`,
            `<gather repo="${repo.name}"${repo.root !== null ? ` root="${repo.root}"` : ''}/>`,
            known !== null ? `${known}\n위는 rauha 가 전에 읽고 저장해 둔 이 저장소 지식입니다. 여기 있는 내용은 다시 열지 말고, 요청에 필요한데 빠진 것만 여세요.` : '',
            `<request>\n${input}\n</request>`,
          ],
          WRITER_SCHEMA,
          { dirs: repo.root !== null ? [repo.root] : [], canWrite: () => false, quiet: true },
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
