import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { relativeToRoot } from '../../shared/path-pattern.js';
import { InfraRiskDto, type InfraRisk } from '../application/dto/infra-risk.dto.js';
import type { MemberRole } from '../application/dto/role-settings.dto.js';
import type { SecretPolicy } from '../domain/secret-policy.js';
import { ToolRisk } from '../domain/tool-risk.js';

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
  /** 사용자 규칙 판정(규칙 탭). allow = 묻지 않고 진행, ask = 꼭 허락받기, null = 규칙에 안 맞음. 비밀 파일·역할 권한·git push 거절은 규칙보다 앞선다. */
  readonly rules?: (tool: string, detail: string) => 'allow' | 'ask' | null;
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
 * 2) 위험 동작은 사용자에게 묻고, git commit·push는 언제나 거절한다.
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

    const base = ToolRisk.assess(input.tool_name, toolInput, options.root);
    if (base.decision === 'deny') return decide('deny', base.reason ?? '거절된 동작입니다.');
    const detail = typeof toolInput['command'] === 'string' ? toolInput['command'] : String(toolInput['file_path'] ?? input.tool_name);
    const rule = options.rules?.(input.tool_name, detail) ?? null;
    // 여러 명령을 이은 글(a && b)은 "묻지 않음" 규칙으로 통째로 풀어 주지 않는다. 규칙에 맞는 한 조각 때문에 위험한 다른 조각이 묻지 않고 지나가면 안 된다.
    if (rule === 'allow' && base.decision === 'ask' && !isChained(detail)) return decide('allow', '사용자 규칙(묻지 않고 할 것)에 맞는 동작입니다.');
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
    return {};
  };
}
