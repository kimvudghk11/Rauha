import { readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { relativeToRoot } from '../../shared/path-pattern.js';
import { InfraRiskDto, type InfraRisk } from '../application/dto/infra-risk.dto.js';
import type { MemberRole } from '../application/dto/role-settings.dto.js';
import type { SecretPolicy } from '../domain/secret-policy.js';
import { GitPublishIntent } from '../domain/git-publish-intent.js';
import { ToolRisk } from '../domain/tool-risk.js';
import { shellWriteTargets } from '../domain/shell-writes.js';
import { ConnectorTool, ConnectorWriteIntent } from '../domain/connector.js';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/** 사용자에게 허락을 구하는 위험 동작 하나. */
export interface PermissionRequest {
  readonly role: MemberRole;
  readonly tool: string;
  /** 명령 문자열이나 파일 경로 */
  readonly detail: string;
  /** 왜 위험한지 */
  readonly reason: string;
  /** 운영 팀원이 명령 설명(description) 끝에 적어 둔 위험도. 없으면 생략 */
  readonly risk?: InfraRisk;
}

/** allow-always: 이번 실행 동안 같은 도구·같은 명령은 다시 묻지 않는다. note: 거절하며 팀원에게 전할 말. */
export type PermissionAnswer = { readonly kind: 'allow' } | { readonly kind: 'allow-always' } | { readonly kind: 'deny'; readonly note: string | null };

/** 물을 화면이 없으면 { kind: 'deny', note: null }을 돌려준다. */
export type PermissionAsker = (request: PermissionRequest) => Promise<PermissionAnswer>;

export interface ToolGuardOptions {
  readonly root: string;
  readonly role: MemberRole;
  /** 범위 없이 파일 전체를 읽는 Read 를 처음 이 줄 수만 읽게 바꾼다(읽은 줄은 다음 턴마다 다시 읽힌다). 없으면 그대로. */
  readonly readCap?: number;
  /** 작업 폴더 기준 상대 경로를 이 역할이 쓸 수 있는지(WritePolicy). */
  readonly canWrite: (relPath: string) => boolean;
  readonly ask: PermissionAsker;
  /** 이번 실행 동안 계속 허락한 '도구 + 명령'. 팀원 호출마다 가드가 새로 만들어지므로 밖에서 하나를 넘겨 공유한다. */
  readonly remembered: Set<string>;
  /** 읽지도 쓰지도 않는 비밀 파일 규칙(기본 목록 + .rauhaignore). */
  readonly secrets: SecretPolicy;
  /** 작업 폴더 아래 실제로 있는 비밀 파일(작업 폴더 기준). 폴더째 내용 검색을 막을지 정할 때 쓴다. */
  readonly secretFiles: () => readonly string[];
  /** 작업 폴더 밖에서 함께 열어 준 폴더(다른 저장소, 작업 공간 폴더). 그 안의 쓰기는 묻지 않고 그 폴더 기준으로 역할 권한만 본다. */
  readonly extraRoots?: readonly string[];
  /** 사용자 규칙 판정(규칙 탭). allow = 묻지 않고 진행, ask = 꼭 허락받기, null = 규칙에 안 맞음. 비밀 파일·역할 권한 거절은 규칙보다 앞선다. 규칙의 ask(보호 브랜치 push 등)는 시킨 일이어도 이긴다. */
  readonly rules?: (tool: string, detail: string) => 'allow' | 'ask' | null;
  /** 사용자가 이번 요청에서 커밋·push·PR을 시켰는지. 호출 때마다 읽는다(미리 띄운 프로세스는 요청이 나중에 정해진다). 없으면 시키지 않은 것. */
  readonly publishIntent?: () => GitPublishIntent;
  /** 이 호출에 붙인 커넥터(노션·컨플루언스 …) MCP 서버 이름. 그 서버의 읽기 도구는 그냥 쓰고, 쓰기 도구는 허락 카드로 묻는다. */
  readonly connectors?: readonly string[];
  /** 사용자가 이번 요청에서 업무 도구에 쓰라고 시켰는지. 시켰으면 쓰기를 묻지 않는다(지우기·옮기기는 묻는다). 없으면 시키지 않은 것. */
  readonly connectorIntent?: () => ConnectorWriteIntent;
}

/** 파일 경로를 받는 도구와 그 경로가 든 입력 이름 */
const PATH_INPUTS: Readonly<Record<string, readonly string[]>> = {
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Grep: ['path'],
  Glob: ['path'],
};

/** 작업 폴더 안의 심볼릭 링크가 비밀 파일을 가리키는지(링크 이름은 평범해도 실제 파일이 비밀이면 막는다). 없는 파일이면 false. */
async function linksToSecret(options: ToolGuardOptions, path: string): Promise<boolean> {
  try {
    const real = (await realpath(isAbsolute(path) ? path : resolve(options.root, path))).replaceAll('\\', '/');
    const realRoot = (await realpath(options.root)).replaceAll('\\', '/');
    return options.secrets.isSecret(relativeToRoot(realRoot, real) ?? real);
  } catch {
    return false;
  }
}

/** 도구 입력에서 비밀 파일을 찾는다. 경로는 작업 폴더 기준으로 바꿔 본다. 없으면 null. */
async function secretTouched(options: ToolGuardOptions, tool: string, toolInput: Record<string, unknown>): Promise<string | null> {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = toolInput['command'];
    return typeof command === 'string' ? options.secrets.secretIn(command, { root: options.root, secretFiles: options.secretFiles() }) : null;
  }
  for (const key of PATH_INPUTS[tool] ?? []) {
    const value = toolInput[key];
    if (typeof value !== 'string') continue;
    const rel = relativeToRoot(options.root, value) ?? value;
    if (options.secrets.isSecret(rel)) return value;
    if (await linksToSecret(options, value)) return value;
  }
  return tool === 'Grep' ? grepIntoSecrets(options, toolInput) : null;
}

/**
 * Grep이 비밀 파일 내용을 보여 줄 수 있으면 그 대상. glob이 비밀 파일을 겨누거나, 내용을 보여 주는
 * 검색(output_mode content)이 비밀 파일이 있는 폴더를 통째로 뒤지면 막는다. 파일 이름만 찾는 검색은 둔다.
 */
function grepIntoSecrets(options: ToolGuardOptions, toolInput: Record<string, unknown>): string | null {
  const glob = toolInput['glob'];
  const secretFiles = options.secretFiles();
  if (typeof glob === 'string' && options.secrets.globTargetsSecret(glob, secretFiles)) return glob;
  if (toolInput['output_mode'] !== 'content') return null;
  const path = toolInput['path'];
  const target = typeof path === 'string' ? (relativeToRoot(options.root, path) ?? path).replace(/\\/g, '/').replace(/^\.\/?|\/+$/g, '') : '';
  const inside = secretFiles.some((f) => target === '' || f === target || f.startsWith(`${target}/`));
  return inside ? (target === '' ? '저장소 전체 검색' : `${target} 폴더 검색`) : null;
}

/** 명령 여러 개를 이은 글인지(&& || ; | & 줄바꿈 $( 백틱) */
const isChained = (detail: string): boolean => /&&|\|\||[;|&\n\r`]|\$\(|[<>]\(/.test(detail);

function decide(permissionDecision: 'allow' | 'deny', reason: string) {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision, permissionDecisionReason: reason },
  };
}

/**
 * 팀원의 모든 도구 호출 앞에서 도는 PreToolUse 훅.
 * 0) 비밀 파일은 읽기·쓰기·셸 모두 묻지 않고 거절한다.
 * 1) 역할 권한(잠긴 테스트, 범위 밖)은 묻지 않고 거절한다 — 판정의 공정성 문제라서.
 * 2) 위험 동작은 사용자에게 묻는다. git commit·push·gh pr은 사용자가 요청에서 시켰으면 그냥 하고,
 *    시키지 않았으면 묻는다(강제 push는 시켜도 묻는다).
 * 3) 나머지는 결정을 내리지 않고 SDK의 기본 흐름(allowedTools)에 맡긴다.
 */
export function createToolGuard(options: ToolGuardOptions): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;

    const secret = await secretTouched(options, input.tool_name, toolInput);
    if (secret !== null) {
      return decide('deny', `비밀 파일(${secret})은 rauha 팀원이 읽거나 쓸 수 없습니다(.rauhaignore와 기본 목록). 그 값 없이 할 수 있는 방법을 쓰세요.`);
    }

    if (WRITE_TOOLS.has(input.tool_name)) {
      const path = toolInput['file_path'] ?? toolInput['notebook_path'];
      const rel = typeof path === 'string' ? relativeToRoot(options.root, path) : null;
      if (rel !== null && !options.canWrite(rel)) {
        return decide('deny', `이 역할은 ${rel}을(를) 쓸 수 없습니다(잠긴 테스트이거나 업무 범위 밖). 범위 안의 다른 파일로 해결하세요.`);
      }
      if (rel === null && typeof path === 'string') {
        const inExtra = (options.extraRoots ?? []).map((root) => relativeToRoot(root, path)).find((r): r is string => r !== null);
        if (inExtra !== undefined) {
          return options.canWrite(inExtra) ? {} : decide('deny', `이 역할은 ${inExtra}을(를) 쓸 수 없습니다(문서 팀원은 .md 문서만 씁니다).`);
        }
      }
    }

    // 셸로 파일을 쓰는 것도 같은 권한으로 막는다(실측: 테스트 팀원이 `cat >> src/cart.js` 로 구현 파일을 썼다)
    if ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && typeof toolInput['command'] === 'string') {
      const command = toolInput['command'];
      const cd = /(?:^|[;&|]\s*)(?:cd|Set-Location)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(command);
      // 루트 모양(E:/… 이면 Windows 규칙)으로 경로를 푼다 — 맥에서 Windows 루트를 상대 경로로 보지 않게
      const p = /^[A-Za-z]:[\\/]/.test(options.root) ? win32 : { resolve, isAbsolute };
      const base = cd === null ? options.root : p.resolve(options.root, cd[1] ?? cd[2] ?? cd[3] ?? '.');
      for (const target of shellWriteTargets(command)) {
        const rel = relativeToRoot(options.root, p.isAbsolute(target) ? target : p.resolve(base, target));
        if (rel !== null && rel !== '' && !options.canWrite(rel)) {
          return decide('deny', `이 역할은 ${rel}을(를) 쓸 수 없습니다(잠긴 테스트이거나 업무 범위 밖, 또는 이 역할이 쓸 파일이 아님). 셸 리디렉션으로도 쓸 수 없습니다. 맡은 파일만 Write/Edit 로 고치세요.`);
        }
      }
    }

    const connector = ConnectorTool.parse(input.tool_name, options.connectors ?? []);
    const base = connector !== null ? connector.verdict(toolInput, options.connectorIntent?.() ?? ConnectorWriteIntent.none()) : ToolRisk.assess(input.tool_name, toolInput, options.root, options.publishIntent?.() ?? GitPublishIntent.none());
    if (base.decision === 'deny') return decide('deny', base.reason ?? '거절된 동작입니다.');
    const detail = typeof toolInput['command'] === 'string' ? toolInput['command'] : String(toolInput['file_path'] ?? input.tool_name);
    const rule = options.rules?.(input.tool_name, detail) ?? null;
    // 여러 명령을 이은 글(a && b)은 "묻지 않음" 규칙으로 통째로 풀어 주지 않는다. 규칙에 맞는 한 조각 때문에 위험한 다른 조각이 묻지 않고 지나가면 안 된다.
    // 강제 push처럼 firm 한 물음은 규칙으로 풀지 않는다(규칙 "git push 묻지 마"가 --force 까지 풀면 안 된다)
    if (rule === 'allow' && base.decision === 'ask' && base.firm !== true && !isChained(detail)) return decide('allow', '사용자 규칙(묻지 않고 할 것)에 맞는 동작입니다.');
    const verdict = rule === 'ask' && base.decision !== 'ask' ? { decision: 'ask' as const, reason: '내 규칙(꼭 허락받을 것)에 걸린 동작입니다.' } : base;
    if (verdict.decision === 'ask') {
      const key = `${input.tool_name}\n${detail}`;
      if (options.remembered.has(key)) return decide('allow', '사용자가 이번 실행 동안 허락한 동작입니다.');
      const reason = verdict.reason ?? '위험할 수 있는 동작입니다.';
      const risk = InfraRiskDto.fromNote(toolInput['description']);
      const answer = await options.ask({ role: options.role, tool: input.tool_name, detail, reason, ...(risk !== null ? { risk } : {}) });
      if (answer.kind === 'allow-always') options.remembered.add(key);
      if (answer.kind !== 'deny') return decide('allow', '사용자가 허락했습니다.');
      const note = answer.note === null ? '' : ` 사용자가 남긴 말: "${answer.note}"`;
      return decide('deny', `사용자가 허락하지 않았습니다: ${reason}.${note} 더 안전한 방법을 쓰세요.`);
    }
    return capRead(options.readCap, input.tool_name, toolInput);
  };
}

/** 줄 수를 정하지 않은 내용 검색(Grep content)에 붙이는 줄 한도. 기본 250줄이 다음 턴마다 다시 읽혔다 */
const GREP_CAP = 80;

/**
 * 거절·물음 검사를 모두 지난 읽기가 범위 없이 크게 읽으면 줄 수를 정해 주고, 그 사실을 팀원에게 알린다.
 * Read: 처음 cap 줄만. Grep(내용 보기): 처음 GREP_CAP 줄만.
 */
/** 줄이 긴 문서(SPEC 처럼 한 줄이 문단)는 줄 수 한도로는 안 막혀서 글자 수로도 자른다 */
export const READ_CHAR_CAP = 6000;

/** 처음부터 몇 줄까지 읽으면 글자 한도에 닿는지(못 읽으면 null) */
export function linesWithin(content: string, chars: number): number | null {
  if (content.length <= chars) return null;
  let used = 0;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    used += lines[i]!.length + 1;
    if (used > chars) return Math.max(20, i);
  }
  return null;
}

function capRead(cap: number | undefined, tool: string, toolInput: Record<string, unknown>) {
  if (cap === undefined) return {};
  if (tool === 'Read' && toolInput['limit'] === undefined && toolInput['offset'] === undefined) {
    const path = typeof toolInput['file_path'] === 'string' ? toolInput['file_path'] : '';
    let byChars: number | null = null;
    if (/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(path)) {
      try {
        byChars = linesWithin(readFileSync(path, 'utf8'), READ_CHAR_CAP);
      } catch {
        byChars = null;
      }
    }
    if (byChars !== null && byChars < cap)
      return capped({ ...toolInput, limit: byChars }, `문서 읽기 한도 ${byChars}줄`, `rauha: 긴 문서라 처음 ${byChars}줄만 읽었습니다. 다른 절이 필요하면 Grep 으로 "^#" 제목이나 낱말의 줄 번호를 찾은 뒤 Read 의 offset·limit 으로 그 절만 읽으세요.`);
    return capped({ ...toolInput, limit: cap }, `읽기 줄 한도 ${cap}줄`, `rauha: 이 Read 는 처음 ${cap}줄만 읽었습니다. 파일이 더 길 수 있으니, 더 필요하면 Grep 으로 줄 번호를 찾은 뒤 Read 의 offset·limit 으로 그 부분만 이어 읽으세요.`);
  }
  if (tool === 'Grep' && toolInput['output_mode'] === 'content' && toolInput['head_limit'] === undefined)
    return capped({ ...toolInput, head_limit: GREP_CAP }, `검색 줄 한도 ${GREP_CAP}줄`, `rauha: 이 Grep 은 처음 ${GREP_CAP}줄만 보여 줍니다. 더 있으면 path·glob 으로 좁혀 다시 찾으세요.`);
  return {};
}

function capped(updatedInput: Record<string, unknown>, reason: string, note: string) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'allow' as const, permissionDecisionReason: reason, updatedInput, additionalContext: note } };
}
