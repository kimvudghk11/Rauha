import type { CodeFail } from '../../../shared/code-api.js';
import { MAX_OPEN_BYTES } from '../../../shared/code-text.js';
import { groupLocations, isTsLikePath, lineColToOffset, type DefinitionResult, type DiagnosticsResult, type NavFail, type NavLocation, type ReferencesResult } from '../../../shared/ts-nav.js';
import type { CodeFiles } from '../code-files.js';
import { cleanRelative } from '../code-path.js';
import { MAX_TS_REFERENCES, type TsRequest } from './ts-protocol.js';
import type { TsRunner } from './ts-runner.js';

const PASS: readonly CodeFail[] = ['bad-path', 'outside', 'secret', 'missing', 'no-folder'];
/** 파일 검사가 거절한 까닭을 이 기능의 말로 */
const navFailOf = (reason: CodeFail): NavFail => (PASS.includes(reason) ? (reason as NavFail) : 'error');

/** 화면이 보낸 요청을 믿지 않고 검사해 worker 요청으로 바꾼다. */
export class NavRequestDto {
  private constructor(
    readonly path: string,
    readonly text: string,
    readonly line: number,
    readonly column: number,
  ) {}

  static from(input: unknown): NavRequestDto | NavFail {
    if (typeof input !== 'object' || input === null) return 'bad-path';
    const o = input as Record<string, unknown>;
    const path = cleanRelative(o['path']);
    if (path === null || path === '') return 'bad-path';
    if (typeof o['text'] !== 'string') return 'bad-path';
    if (o['text'].length > MAX_OPEN_BYTES) return 'too-big';
    const line = o['line'];
    const column = o['column'];
    if (typeof line !== 'number' || typeof column !== 'number' || !Number.isInteger(line) || !Number.isInteger(column)) return 'bad-position';
    return new NavRequestDto(path, o['text'], line, column);
  }

  /** 글 안의 위치. 줄·칸이 글 밖이면 null */
  offset(): number | null {
    return lineColToOffset(this.text, this.line, this.column);
  }

  toRequest(op: 'definition' | 'references', offset: number): TsRequest;
  toRequest(op: 'diagnostics'): TsRequest;
  toRequest(op: 'definition' | 'references' | 'diagnostics', offset = 0): TsRequest {
    return op === 'diagnostics' ? { op, file: this.path, text: this.text } : { op, file: this.path, text: this.text, offset };
  }
}

/**
 * 정의로 이동·참조 찾기·진단. 파일 검사(작업 폴더 안 실제 경로, 비밀 파일 거절)는 코드 탭의 읽기와 같은 길(CodeFiles.locate)을 쓴다.
 * 언어 도구가 돌려준 위치도 한 번 더 걸러서 비밀 파일·작업 폴더 밖·.git 은 화면에 보내지 않는다.
 */
export class TsNavService {
  constructor(
    private readonly deps: { readonly files: CodeFiles; readonly runner: TsRunner },
  ) {}

  private async prepare(input: unknown): Promise<{ dto: NavRequestDto; root: string } | NavFail> {
    const dto = NavRequestDto.from(input);
    if (typeof dto === 'string') return dto;
    if (!isTsLikePath(dto.path)) return 'unsupported';
    const located = await this.deps.files.locate(dto.path);
    if (!located.ok) return navFailOf(located.reason);
    return { dto, root: located.value.rootReal };
  }

  async definition(input: unknown): Promise<DefinitionResult> {
    const p = await this.prepare(input);
    if (typeof p === 'string') return { ok: false, reason: p };
    const offset = p.dto.offset();
    if (offset === null) return { ok: false, reason: 'bad-position' };
    const out = await this.deps.runner.request(p.root, p.dto.toRequest('definition', offset));
    if (!out.ok) return { ok: false, reason: out.reason };
    if (out.res.op !== 'definition') return { ok: false, reason: 'error' };
    return { ok: true, locations: await this.safe(out.res.locations) };
  }

  async references(input: unknown): Promise<ReferencesResult> {
    const p = await this.prepare(input);
    if (typeof p === 'string') return { ok: false, reason: p };
    const offset = p.dto.offset();
    if (offset === null) return { ok: false, reason: 'bad-position' };
    const out = await this.deps.runner.request(p.root, p.dto.toRequest('references', offset));
    if (!out.ok) return { ok: false, reason: out.reason };
    if (out.res.op !== 'references') return { ok: false, reason: 'error' };
    const grouped = groupLocations(await this.safe(out.res.locations), MAX_TS_REFERENCES);
    return { ok: true, files: grouped.files, truncated: grouped.truncated || out.res.truncated };
  }

  async diagnostics(input: unknown): Promise<DiagnosticsResult> {
    const p = await this.prepare(input);
    if (typeof p === 'string') return { ok: false, reason: p };
    const out = await this.deps.runner.request(p.root, p.dto.toRequest('diagnostics'));
    if (!out.ok) return { ok: false, reason: out.reason };
    if (out.res.op !== 'diagnostics') return { ok: false, reason: 'error' };
    return { ok: true, items: out.res.items, truncated: out.res.truncated, semantic: out.res.semantic };
  }

  /** 열 수 있는 파일의 위치만 남긴다(링크를 풀어도 작업 폴더 안, 비밀 파일 아님) */
  private async safe(locations: readonly NavLocation[]): Promise<NavLocation[]> {
    const ok = new Map<string, boolean>();
    const kept: NavLocation[] = [];
    for (const loc of locations) {
      let allowed = ok.get(loc.path);
      if (allowed === undefined) {
        allowed = cleanRelative(loc.path) !== null && (await this.deps.files.locate(loc.path)).ok;
        ok.set(loc.path, allowed);
      }
      if (allowed) kept.push(loc);
    }
    return kept;
  }
}
