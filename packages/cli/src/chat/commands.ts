import type { Cadence } from '@rauha/core';
import { displayWidth } from '../text-width.js';

type CommandName = 'clear' | 'status' | 'usage' | 'guide' | 'review' | 'design' | 'repo' | 'update' | 'retry' | 'queue' | 'copy' | 'team' | 'company' | 'routine' | 'learn' | 'help' | 'exit';

export type ChatCommand =
  | { readonly kind: Exclude<CommandName, 'review' | 'repo' | 'design' | 'queue' | 'routine'> }
  /** request: 설계부터 시작할 요청. 요청 없이 /design만 치면 null(안내) */
  | { readonly kind: 'design'; readonly request: string | null }
  /** target: 비교할 브랜치·커밋. null = 커밋하지 않은 변경 */
  | { readonly kind: 'review'; readonly target: string | null }
  /** 일하는 중에 쌓아 둔 입력 보기·비우기 */
  | { readonly kind: 'queue'; readonly action: 'show' | 'clear' }
  /** 모델을 거치지 않고 바로 실행할 명령(!로 시작). 명령이 없으면 null(안내) */
  | { readonly kind: 'shell'; readonly command: string | null }
  | { readonly kind: 'repo'; readonly action: 'list' }
  | { readonly kind: 'repo'; readonly action: 'select'; readonly name: string }
  | { readonly kind: 'repo'; readonly action: 'add'; readonly path: string }
  /** 정기 업무: 보기 · 때가 된 것 실행 · 등록 · 지우기. usage = 형식이 틀려 사용법 안내 */
  | { readonly kind: 'routine'; readonly action: 'list' | 'run' | 'usage' }
  | { readonly kind: 'routine'; readonly action: 'add'; readonly cadence: Cadence; readonly request: string }
  | { readonly kind: 'routine'; readonly action: 'remove'; readonly number: number }
  | { readonly kind: 'unknown'; readonly name: string };

export interface CommandHelp {
  readonly name: string;
  readonly help: string;
}

/** 명령과 설명. /help와 '/'를 쳤을 때 뜨는 목록이 같은 것을 쓴다. */
type CommandGroup = '대화' | '작업' | '팀·회사' | 'rauha';
const GROUPS: readonly CommandGroup[] = ['대화', '작업', '팀·회사', 'rauha'];

const COMMANDS: readonly { readonly kind: CommandName; readonly group: CommandGroup; readonly help: string }[] = [
  { kind: 'clear', group: '대화', help: '화면과 지금 대화를 비워요. 지난 작업 기억은 남아요.' },
  { kind: 'status', group: '대화', help: '지금 세션 상태(대화 수, 이어 일할 파일)' },
  { kind: 'usage', group: '대화', help: '구독 사용률(세션 5시간 · 주간)과 이번 대화 호출 수' },
  { kind: 'guide', group: '대화', help: '지난 작업의 자세한 읽기 안내서' },
  { kind: 'review', group: '작업', help: '내 변경(커밋 안 한 것, 또는 /review <브랜치>로 그 브랜치와 갈라진 뒤)을 리뷰어가 검토해요. 파일은 고치지 않아요.' },
  { kind: 'design', group: '작업', help: '/design <요청>: 라우터를 거치지 않고 설계 대화부터 시작해요. 충분히 이야기해 설계를 승인하면 작업을 나눠 진행해요.' },
  { kind: 'repo', group: '작업', help: '작업 공간 저장소 보기 · /repo <이름>으로 지금 저장소 바꾸기 · /repo add <경로>로 더하기' },
  { kind: 'retry', group: '대화', help: '마지막 요청을 한 번 더 보내요 (멈췄거나 마음에 안 들 때)' },
  { kind: 'queue', group: '대화', help: '일하는 중에 쌓아 둔 입력 보기 · /queue clear로 비우기' },
  { kind: 'copy', group: '대화', help: '마지막 답(작업이었다면 읽기 안내서)을 클립보드에 복사해요' },
  { kind: 'team', group: '팀·회사', help: '팀 구성: 팀원마다 모델·노력 수준·할 수 있는 일' },
  { kind: 'company', group: '팀·회사', help: '회사가 이미 정한 것(기획·마케팅·디자인 등 부서별 가장 최근 결과의 요약)' },
  { kind: 'routine', group: '작업', help: '정기 업무: /routine add 매일|매주 <요일> <요청> · 목록 · run(때가 된 것 실행) · remove <번호>. 자동으로 돌지 않아요.' },
  { kind: 'learn', group: '팀·회사', help: '학습 노트: 내 코드에서 쓰인 디자인 패턴·아키텍처와 쓴 이유를 패턴별로 모아 복습해요' },
  { kind: 'update', group: 'rauha', help: '최신 버전으로 갱신하고 rauha를 다시 띄워요 (지난 작업 기억은 남아요)' },
  { kind: 'help', group: 'rauha', help: '이 안내' },
  { kind: 'exit', group: 'rauha', help: '끝내기 (Ctrl+C 두 번도 됨)' },
];

/** `/`로 시작하는 입력을 명령으로 읽는다. 명령이 아니면 null(요청으로 보낸다). */
export function parseCommand(text: string): ChatCommand | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('!')) return { kind: 'shell', command: trimmed.slice(1).trim() || null };
  if (!trimmed.startsWith('/')) return null;
  const [name, ...rest] = trimmed.split(/\s+/) as [string, ...string[]];
  const known = COMMANDS.find((c) => `/${c.kind}` === name.toLowerCase());
  if (known === undefined) return { kind: 'unknown', name };
  if (known.kind === 'review') return { kind: 'review', target: rest[0] ?? null };
  if (known.kind === 'queue') return { kind: 'queue', action: rest[0]?.toLowerCase() === 'clear' ? 'clear' : 'show' };
  if (known.kind === 'design') return { kind: 'design', request: rest.length === 0 ? null : rest.join(' ') };
  if (known.kind === 'repo') {
    if (rest.length === 0) return { kind: 'repo', action: 'list' };
    // 경로에는 띄어쓰기가 있을 수 있어 add 뒤 전체를 경로로 본다.
    if (rest[0]!.toLowerCase() === 'add' && rest.length > 1) return { kind: 'repo', action: 'add', path: trimmed.replace(/^\/repo\s+add\s+/i, '') };
    return { kind: 'repo', action: 'select', name: rest.join(' ') };
  }
  if (known.kind === 'routine') return parseRoutine(rest);
  return { kind: known.kind };
}

const WEEKDAY_CHARS = '일월화수목금토';

function parseRoutine(rest: string[]): ChatCommand {
  const usage: ChatCommand = { kind: 'routine', action: 'usage' };
  const action = rest[0]?.toLowerCase();
  if (action === undefined) return { kind: 'routine', action: 'list' };
  if (action === 'run') return { kind: 'routine', action: 'run' };
  if (action === 'remove') {
    const number = Number(rest[1]);
    return Number.isInteger(number) ? { kind: 'routine', action: 'remove', number } : usage;
  }
  if (action !== 'add') return usage;
  if (rest[1] === '매일') return rest.length > 2 ? { kind: 'routine', action: 'add', cadence: { kind: 'daily' }, request: rest.slice(2).join(' ') } : usage;
  if (rest[1] !== '매주') return usage;
  const weekday = WEEKDAY_CHARS.indexOf(rest[2]?.[0] ?? '?');
  return weekday >= 0 && rest.length > 3 ? { kind: 'routine', action: 'add', cadence: { kind: 'weekly', weekday }, request: rest.slice(3).join(' ') } : usage;
}

/** 입력창에 '/'로 시작하는 글을 치는 동안 보여 줄 명령 후보. 띄어쓰기가 들어가면 다 친 것으로 본다. */
export function suggestCommands(text: string): CommandHelp[] {
  if (!text.startsWith('/') || /\s/.test(text)) return [];
  return COMMANDS.filter((c) => `/${c.kind}`.startsWith(text.toLowerCase())).map((c) => ({ name: `/${c.kind}`, help: c.help }));
}

/**
 * /help: 명령을 쓰임새별로 묶는다. 이름 뒤를 두 칸 이상 띄워 두면 좁은 창에서 접혀도 설명 칸에 맞춰진다(fitLines).
 */
export function helpLines(): string[] {
  // 한글은 두 칸이라 글자 수가 아니라 화면 칸으로 맞춘다('!<명령>').
  const width = Math.max(...COMMANDS.map((c) => c.kind.length + 1), displayWidth('!<명령>'));
  const row = (name: string, help: string) => `    ${name}${' '.repeat(width - displayWidth(name))}  ${help}`;
  return [
    ...GROUPS.flatMap((group) => ['', `  ${group}`, ...COMMANDS.filter((c) => c.group === group).map((c) => row(`/${c.kind}`, c.help))]),
    '',
    '  바로 실행',
    row('!<명령>', '모델을 거치지 않고 바로 실행해요 (예: !aws s3 ls, !git status)'),
    '',
    '  입력 요령',
    '    - 그 밖의 글은 요청이나 질문으로 보내요.',
    '    - 줄바꿈은 Alt+Enter, Ctrl+J 또는 줄 끝 \\ 뒤 Enter',
    '    - @를 치면 파일 후보, Tab으로 채워요',
    '    - 일하는 중에는 Esc로 멈추고, 그동안 친 입력은 줄을 서요',
    '',
  ];
}
