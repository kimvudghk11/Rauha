import type { MemberRole } from './member-role.js';

/** 메인 채팅 Claude(지배인)가 Agent 도구로 넘길 수 있는 팀원 한 명 */
export interface CrewMate {
  readonly role: MemberRole;
  /** 언제 이 팀원에게 넘길지(Agent 도구 설명에 그대로 보인다) */
  readonly description: string;
}

const MATES: readonly CrewMate[] = [
  { role: 'surveyor', description: 'Reads the codebase to answer "where/how does X work" before changing anything. Read-only; returns the files and facts found.' },
  { role: 'implementer', description: 'Writes or changes production code for a clearly scoped task, following the project\'s existing patterns.' },
  { role: 'tester', description: 'Writes or fixes automated tests for a behaviour, runs them and reports pass/fail with output.' },
  { role: 'reviewer', description: 'Reviews a finished change (diff or files) for bugs, missed requirements and risky code. Read-only.' },
  { role: 'debugger', description: 'Finds the root cause of an error, failing test or unexpected behaviour by reproducing and reading code.' },
  { role: 'designer', description: 'Plans the design of a larger change (structure, files to touch, steps) before implementation. Read-only.' },
  { role: 'writer', description: 'Writes or updates documentation (README, guides, specs, changelogs) in Markdown.' },
  { role: 'securitychecker', description: 'Checks a change or area for security problems (secrets, injection, auth, permissions). Read-only.' },
];

/**
 * 사용자 말은 그대로 Claude 에 가고(2026-11-24 결정), 그 Claude 가 일이 크면 사용자가 꾸린 팀원에게 넘긴다.
 * 팀원 이름은 rauha 역할 id 그대로(Agent 도구의 subagent_type).
 */
export class DirectCrew {
  private constructor() {}

  static readonly mates: readonly CrewMate[] = MATES;

  static roleOf(agent: string | undefined): MemberRole | null {
    return MATES.find((m) => m.role === agent)?.role ?? null;
  }
}

/** 화면 진행 줄 한 줄: 누가(role) 무엇을 */
export interface CrewStep {
  readonly role: MemberRole;
  readonly text: string;
}

export interface SeenToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
/** 화면에 보일 필요 없는 내부 도구 */
const QUIET_TOOLS = new Set(['TodoWrite', 'TodoRead', 'StructuredOutput', 'ToolSearch']);
const LINE_MAX = 80;

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= LINE_MAX ? flat : `${flat.slice(0, LINE_MAX - 1)}…`;
};
const fileName = (path: unknown): string => (typeof path === 'string' ? (path.split(/[\\/]/).filter((p) => p !== '').pop() ?? path) : '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * 지배인 세션 안에서 일어나는 일(팀원에게 넘김·도구 사용·돌아옴)을 진행 줄로 바꾼다.
 * 시간만 늘고 무엇을 하는지 안 보이던 것을 고친다(2026-11-24 사용자 지적).
 */
export class CrewWatch {
  /** Agent 도구 호출 id → 넘겨받은 팀원(팀원이 아니면 null) */
  private readonly handed = new Map<string, MemberRole | null>();

  private constructor() {}

  static start(): CrewWatch {
    return new CrewWatch();
  }

  /** parent: 이 도구를 쓴 서브에이전트를 연 Agent 호출 id(지배인이 직접 썼으면 null) */
  toolUse(use: SeenToolUse, parent: string | null): CrewStep | null {
    const by: MemberRole = (parent !== null ? this.handed.get(parent) : null) ?? 'direct';
    if (AGENT_TOOLS.has(use.name)) {
      const mate = DirectCrew.roleOf(str(use.input['subagent_type']));
      this.handed.set(use.id, mate);
      const what = oneLine(str(use.input['description']));
      return mate !== null ? { role: mate, text: oneLine(`넘겨받았어요: ${what}`) } : { role: by, text: oneLine(`도우미에게 맡겼어요: ${what}`) };
    }
    const text = describe(use);
    return text === null ? null : { role: by, text };
  }

  /** 팀원에게 넘긴 일이 끝났으면 지배인에게 돌아온 한 줄 */
  toolResult(toolUseId: string): CrewStep | null {
    if (!this.handed.has(toolUseId)) return null;
    const mate = this.handed.get(toolUseId) ?? null;
    this.handed.delete(toolUseId);
    return { role: 'direct', text: mate === null ? '도우미 일 받았어요' : `${MATE_WORK[mate] ?? '일'} 받았어요` };
  }
}

const MATE_WORK: Partial<Record<MemberRole, string>> = {
  surveyor: '조사',
  implementer: '구현',
  tester: '테스트',
  reviewer: '리뷰',
  debugger: '원인 분석',
  designer: '설계',
  writer: '문서',
  securitychecker: '보안 점검',
};

function describe(use: SeenToolUse): string | null {
  const i = use.input;
  if (QUIET_TOOLS.has(use.name)) return null;
  if (use.name === 'Read') return oneLine(`읽는 중: ${fileName(i['file_path'])}`);
  if (use.name === 'Edit' || use.name === 'Write' || use.name === 'NotebookEdit') return oneLine(`고치는 중: ${fileName(i['file_path'] ?? i['notebook_path'])}`);
  if (use.name === 'Bash' || use.name === 'PowerShell') return oneLine(`실행: ${str(i['command'])}`);
  if (use.name === 'Grep') return oneLine(`찾는 중: ${str(i['pattern'])}`);
  if (use.name === 'Glob') return oneLine(`파일 찾는 중: ${str(i['pattern'])}`);
  if (use.name === 'WebFetch') return oneLine(`웹 읽는 중: ${str(i['url'])}`);
  if (use.name === 'WebSearch') return oneLine(`웹 검색: ${str(i['query'])}`);
  if (use.name === 'Skill') return oneLine(`스킬: ${str(i['skill'])}`);
  const mcp = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(use.name);
  return oneLine(`도구: ${mcp !== null ? mcp[1]! : use.name}`);
}
