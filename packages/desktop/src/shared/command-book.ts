/**
 * Slash 탭의 규칙. 입력창에 `/`로 시작하는 글을 치면 이 명령 모음이 읽는다.
 * 터미널판 rauha의 슬래시 명령(/review·/design·/repo·/learn·/routine·/update·/clear …)을 앱 명령으로 옮긴 "기본 명령"과,
 * 사용자가 더한 "내 명령"(이름 + 프롬프트 템플릿 + 인자 {{x}})을 한 모음으로 다룬다. 값은 불변이고, 바꾸면 새 모음을 돌려준다.
 */

/** 앱이 직접 하는 동작. 모델을 부르지 않는다. */
export type AppAction = 'clear' | 'status' | 'usage' | 'guide' | 'retry' | 'queue' | 'copy' | 'update' | 'install' | 'help' | 'close' | 'tab' | 'diagnose';

/** 명령이 하는 일: 팀에 보낼 프롬프트를 만들거나, 앱 동작을 한다. */
export type CommandAction = { readonly kind: 'prompt'; readonly template: string } | { readonly kind: 'app'; readonly action: AppAction; readonly tab?: string };

export type CommandGroup = 'Chat' | 'Work' | 'Team · Company' | 'rauha' | 'My commands';
export const COMMAND_GROUPS: readonly CommandGroup[] = ['Chat', 'Work', 'Team · Company', 'rauha', 'My commands'];

/** 인자 하나. 템플릿의 {{이름}}(꼭 필요) 또는 {{이름|기본값}}(없으면 기본값) */
export interface CommandArg {
  readonly name: string;
  readonly required: boolean;
  readonly fallback: string | null;
}

export class CommandError extends Error {}

const NAME_RULE = /^[A-Za-z0-9가-힣_-]{1,24}$/;
const PLACEHOLDER = /\{\{\s*([^{}|\s]{1,20})\s*(?:\|([^{}]*))?\}\}/g;
export const TEMPLATE_LIMIT = 4000;

export interface CommandProps {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 무엇을 하는지 자세히(Slash 탭에서 펼쳐 보인다) */
  readonly detail: string;
  readonly group: CommandGroup;
  readonly action: CommandAction;
  readonly builtin: boolean;
  /** 같은 일을 하는 다른 이름(예: 설치 = install) */
  readonly aliases?: readonly string[];
  /** 인자 이름 → 설명(없어도 된다) */
  readonly argHelp?: Readonly<Record<string, string>>;
}

/** 명령 하나. 이름·템플릿 규칙을 스스로 지킨다. */
export class Command {
  private constructor(private readonly props: CommandProps, readonly args: readonly CommandArg[]) {}

  static create(props: CommandProps): Command {
    const name = props.name.trim().replace(/^\//, '');
    if (!NAME_RULE.test(name)) throw new CommandError('A command name has no spaces and uses letters, digits, _ or - (up to 24 characters). e.g. deploycheck');
    const description = props.description.trim();
    if (description === '') throw new CommandError('Describe what the command does in one line.');
    if (props.action.kind === 'prompt') {
      const template = props.action.template.trim();
      if (template === '') throw new CommandError('Write the prompt to send to the team.');
      if (template.length > TEMPLATE_LIMIT) throw new CommandError(`A prompt can be up to ${TEMPLATE_LIMIT} characters.`);
      const unclosed = template.replace(PLACEHOLDER, '');
      if (/\{\{|\}\}/.test(unclosed)) throw new CommandError('A {{blank}} is malformed. e.g. {{request}} or {{branch|main}}');
      return new Command({ ...props, name, description, detail: props.detail.trim() === '' ? description : props.detail.trim(), action: { kind: 'prompt', template } }, argsOf(template));
    }
    return new Command({ ...props, name, description, detail: props.detail.trim() === '' ? description : props.detail.trim() }, []);
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get aliases(): readonly string[] {
    return this.props.aliases ?? [];
  }
  /** 이름이나 별칭이 이 글과 같은지(대소문자 무시) */
  called(name: string): boolean {
    const n = name.toLowerCase();
    return this.props.name.toLowerCase() === n || this.aliases.some((a) => a.toLowerCase() === n);
  }
  get description(): string {
    return this.props.description;
  }
  get detail(): string {
    return this.props.detail;
  }
  get group(): CommandGroup {
    return this.props.group;
  }
  get action(): CommandAction {
    return this.props.action;
  }
  get builtin(): boolean {
    return this.props.builtin;
  }
  argHelp(name: string): string | null {
    return this.props.argHelp?.[name] ?? null;
  }

  /** `/review <브랜치>` 같은 사용법 한 줄. 꼭 필요한 인자는 <>, 없어도 되는 인자는 [] */
  usage(): string {
    return `/${this.name}${this.args.map((a) => (a.required ? ` <${a.name}>` : ` [${a.name}]`)).join('')}`;
  }

  /** 친 인자 글을 인자 칸에 나눠 담는다. 마지막 인자는 남은 글 전부를 받는다. */
  fill(argText: string): { readonly ok: true; readonly values: Readonly<Record<string, string>> } | { readonly ok: false; readonly missing: readonly string[] } {
    const values: Record<string, string> = {};
    const text = argText.trim();
    const words = [...text.matchAll(/\S+/g)];
    this.args.forEach((arg, i) => {
      const isLast = i === this.args.length - 1;
      const start = words[i]?.index;
      if (start === undefined) return;
      const raw = isLast ? text.slice(start) : words[i]![0];
      const value = raw.replace(/^(["'])(.*)\1$/s, '$2').trim();
      if (value !== '') values[arg.name] = value;
    });
    const missing = this.args.filter((a) => a.required && values[a.name] === undefined).map((a) => a.name);
    return missing.length > 0 ? { ok: false, missing } : { ok: true, values };
  }

  /** 프롬프트 템플릿에 인자 값을 넣는다. 값이 없으면 기본값을 쓴다. */
  render(values: Readonly<Record<string, string>>): string {
    if (this.props.action.kind !== 'prompt') return '';
    return this.props.action.template.replace(PLACEHOLDER, (_m, name: string, fallback: string | undefined) => values[name] ?? (fallback ?? '').trim());
  }
}

/** 템플릿의 {{…}}에서 인자를 처음 나온 순서대로 뽑는다(같은 이름은 하나). 한 군데라도 기본값 없이 쓰이면 꼭 필요한 인자다. */
export function argsOf(template: string): CommandArg[] {
  const found = new Map<string, CommandArg>();
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    const fallback = m[2] === undefined ? null : m[2].trim();
    const before = found.get(name);
    found.set(name, { name, required: (before?.required ?? false) || fallback === null, fallback: before?.fallback ?? fallback });
  }
  return [...found.values()];
}

const prompt = (template: string): CommandAction => ({ kind: 'prompt', template });
const app = (action: AppAction, tab?: string): CommandAction => ({ kind: 'app', action, ...(tab !== undefined ? { tab } : {}) });

type BuiltinDef = Omit<CommandProps, 'id' | 'builtin'>;

/** 터미널판에서 옮겨 온 기본 명령. 순서는 입력창 자동완성과 Slash 탭의 순서다. */
const BUILTIN_DEFS: readonly BuiltinDef[] = [
  {
    name: 'review', group: 'Work', action: prompt('내 변경을 리뷰어 관점으로 검토해줘. 검토 범위: {{브랜치|커밋하지 않은 변경 전체}} (브랜치 이름이면 그 브랜치와 갈라진 뒤의 변경). 파일은 고치지 말고, 문제와 제안만 알려줘.'),
    description: '내 변경을 리뷰어가 검토해요', detail: '커밋하지 않은 변경(또는 /review <브랜치>로 그 브랜치와 갈라진 뒤의 변경)을 리뷰어 팀원이 검토해요. 파일은 고치지 않고 문제와 제안만 알려줘요.', argHelp: { 브랜치: '비교할 브랜치·커밋. 없으면 커밋하지 않은 변경 전체' },
  },
  {
    name: 'design', group: 'Work', action: prompt('바로 코드를 쓰지 말고 먼저 설계안을 정리해줘. 구조와 내가 정해야 할 점을 짚고, 근거와 함께 추천안을 내줘: {{요청}}'),
    description: '코드 전에 설계부터 정리해요', detail: '요청을 바로 만들지 않고 설계부터 해요. 구조와 내가 정해야 할 점을 짚어 추천안을 내고, 내가 정하면 그다음 작업으로 이어 가요.', argHelp: { 요청: '설계할 기능이나 변경. 예: 쿠폰 기능' },
  },
  {
    name: 'repo', group: 'Work', action: app('tab', 'code'),
    description: 'Repo 탭의 레포 목록을 열어요', detail: '앱이 아는 저장소와 상태가 보이는 Repo 탭으로 가요. 일할 레포는 요청 맨 앞에 @폴더이름을 쓰면 바꿔요.',
  },
  {
    name: 'routine', group: 'Work', action: app('tab', 'todo'),
    description: '정기 업무(Todo 탭)를 열어요', detail: '매일·매주 하는 일을 보고 등록하는 곳(Todo 탭)으로 가요. 자동으로 돌지는 않고, 때가 된 것을 실행해요. Todo 탭이 아직 안 열렸으면 "곧 열려요"가 보여요.',
  },
  {
    name: 'learn', group: 'Team · Company', action: prompt('내 코드({{범위|이 저장소 전체}})에서 쓰인 디자인 패턴과 아키텍처를 패턴별로 모아, 왜 그렇게 썼는지 복습할 수 있게 정리해줘.'),
    description: '내 코드의 패턴·아키텍처를 복습해요', detail: '학습 노트: 내 코드에서 쓰인 디자인 패턴·아키텍처와 쓴 이유를 패턴별로 모아 복습해요.', argHelp: { 범위: '살펴볼 폴더나 기능. 없으면 이 저장소 전체' },
  },
  {
    name: 'company', group: 'Team · Company', action: prompt('회사(부서)가 이미 정한 것을 요약해줘. 기획·마케팅·디자인 등 부서별로 가장 최근 결과만 짧게.'),
    description: '회사가 정한 것을 부서별로 요약해요', detail: '기획·마케팅·디자인 같은 부서별로 가장 최근에 정해진 결과를 요약해서 보여줘요.',
  },
  {
    name: 'team', group: 'Team · Company', action: app('tab', 'settings'),
    description: '팀 설정을 열어요', detail: '팀원 22명의 켜기·끄기, 모델 등급, 도구, 추가 지시, 이름·캐릭터를 바꾸는 설정으로 가요.',
  },
  { name: 'clear', group: 'Chat', action: app('clear'), description: '채팅 화면을 비워요', detail: '채팅 화면의 오래된 말들을 지워요. 돌고 있는 작업과 지난 작업 기억은 그대로 남아요. 저장해 둔 말풍선도 비워져서 앱을 다시 켜도 돌아오지 않아요.' },
  { name: 'status', group: 'Chat', action: app('status'), description: '지금 작업 상태를 보여줘요', detail: '돌고 있는 작업·허락 기다리는 작업·대기 중인 작업 수와 동시에 돌 수 있는 개수를 알려줘요.' },
  { name: 'usage', group: 'Chat', action: app('usage'), description: '구독 사용률을 보여줘요', detail: '구독 한도의 세션(5시간)·주간 사용률을 %로 알려줘요. 돈은 보이지 않아요.' },
  { name: 'guide', group: 'Chat', action: app('guide'), description: '지난 작업의 정리를 열어요', detail: '가장 최근에 끝난 작업의 정리(읽기 안내서)를 팀 상세 화면으로 열어요.' },
  { name: 'retry', group: 'Chat', action: app('retry'), description: '마지막 요청을 한 번 더 보내요', detail: '멈췄거나 마음에 안 들 때 마지막 요청을 그대로 다시 팀에 맡겨요.' },
  { name: 'queue', group: 'Chat', action: app('queue'), description: '기다리는 작업을 보여줘요', detail: '아직 시작하지 못하고 기다리는 작업 목록을 보여줘요. 지우려면 작업 카드의 멈추기를 눌러요.' },
  { name: 'copy', group: 'Chat', action: app('copy'), description: '마지막 답을 복사해요', detail: '가장 최근에 끝난 작업의 답(정리)을 클립보드에 복사해요.' },
  { name: '설치', aliases: ['install'], group: 'rauha', action: app('install'), description: '내 컴퓨터에 설치하는 방법을 보여줘요', detail: '맥은 한 줄 설치 명령(복사 버튼), Windows는 최신 설치 파일 내려받기를 보여줘요. 한 줄 설치는 브라우저로 받지 않아 첫 실행 경고가 뜨지 않아요.' },
  { name: '업데이트', aliases: ['update'], group: 'rauha', action: app('update'), description: '새 버전을 확인하고 업데이트 방법을 보여줘요', detail: 'GitHub에서 새 버전이 있는지 지금 확인하고, 내 컴퓨터(맥·Windows)에 맞는 업데이트 방법을 보여줘요.' },
  {
    name: '개선', aliases: ['improve'], group: 'Work',
    action: prompt('{{대상}}에서 다음 3단계를 차례로 진행해줘. 요청: {{요청}}\n\n1단계 공격적 점검(읽기 중심. 파일을 고치거나 지우거나 외부에 요청을 보내는 파괴 동작은 하지 말 것. 내 소유 프로젝트 안에서만): 약점 분석, 부족한 기능 찾기, 보안 점검, 모의 해킹 관점의 취약점 탐색. 근거(파일·줄)와 함께 목록으로 정리해.\n2단계 개선: 1단계 결과를 근거로 고쳐. 요청과 관련 있는 항목부터, 바꾼 이유를 1단계 항목과 연결해 적어.\n3단계 마무리: 2단계에서 바뀐 것에 필요한 테스트를 더하고 전체 검사를 돌려 통과를 확인한 뒤, 남은 문제와 못 한 것을 정리해.\n각 단계의 결과를 다음 단계의 입력으로 삼아. 비밀 파일은 읽지 않고 commit·push는 하지 않아.'),
    description: '점검 → 개선 → 마무리 3단계로 업데이트해요', detail: '업데이트 요청이 오면 쓰는 3단계예요. 1) 공격적 점검(약점·부족한 기능·보안·모의 해킹 관점, 읽기 중심) 2) 그 결과를 근거로 개선 3) 추가 테스트와 마무리. 한 작업으로 올라가 팀 방에서 단계가 보이고, 허락 카드와 규칙(비밀 파일·push 금지)은 그대로 적용돼요.',
    argHelp: { 대상: '레포 이름이나 폴더(한 단어). 예: rauha', 요청: '무엇을 어떻게 개선할지 한 줄' },
  },
  { name: '진단', aliases: ['diagnose'], group: 'rauha', action: app('diagnose'), description: '문제가 생겼을 때 진단 정보를 복사해요', detail: '앱 버전, 컴퓨터, 로그인·도구 상태, 최근 오류 로그를 한 덩어리로 클립보드에 복사해요. 이메일·홈 경로·키는 가려져요. 문제가 생기면 이걸 개발자에게 붙여 넣어 주세요.' },
  { name: 'help', group: 'rauha', action: app('help'), description: '명령 목록을 보여줘요', detail: '쓸 수 있는 명령과 사용법을 채팅에 보여줘요.' },
  { name: 'exit', group: 'rauha', action: app('close'), description: '창을 닫아요', detail: '이 창을 닫아요. 맥에서는 앱이 계속 떠 있을 수 있어요.' },
];

/** 기본 명령 id는 이름에서 만든다(이름이 곧 열쇠라 저장 파일에 기본 명령 본문을 두지 않는다). */
const builtinId = (name: string): string => `builtin:${name}`;
export const BUILTIN_COMMANDS: readonly Command[] = BUILTIN_DEFS.map((d) => Command.create({ ...d, id: builtinId(d.name), builtin: true }));

/** 입력 글을 읽은 결과 */
export type Resolution =
  /** 명령이 아니다. text를 요청으로 보낸다(`//`로 시작하면 슬래시 하나를 뗀 글) */
  | { readonly kind: 'text'; readonly text: string }
  /** `/`만 쳤다: 명령 목록을 보인다 */
  | { readonly kind: 'list' }
  | { readonly kind: 'unknown'; readonly name: string }
  /** 있지만 꺼 둔 기본 명령 */
  | { readonly kind: 'off'; readonly command: Command }
  | { readonly kind: 'usage'; readonly command: Command; readonly missing: readonly string[] }
  | { readonly kind: 'send'; readonly command: Command; readonly text: string }
  | { readonly kind: 'app'; readonly command: Command; readonly action: AppAction; readonly tab: string | null };

export interface CommandEntry {
  readonly command: Command;
  readonly enabled: boolean;
}

/** 내 명령을 만들거나 고칠 때 받는 입력(바깥 입력이라 검증은 Command.create가 한다) */
export interface CustomDraft {
  readonly name: string;
  readonly description: string;
  readonly template: string;
}

/** 기본 명령(끄고 켤 수 있다) + 내 명령(더하고 고치고 지운다). */
export class CommandBook {
  private constructor(private readonly custom: readonly Command[], private readonly disabled: ReadonlySet<string>) {}

  static initial(): CommandBook {
    return new CommandBook([], new Set());
  }

  /** 저장해 둔 것에서 복원한다. 모르는 기본 명령 id는 버리고, 이름이 겹치는 내 명령은 건너뛴다. */
  static restore(custom: readonly Command[], disabled: Iterable<string>): CommandBook {
    const known = new Set(BUILTIN_COMMANDS.map((c) => c.id));
    const taken = new Set(BUILTIN_COMMANDS.flatMap((c) => [c.name, ...c.aliases]).map((n) => n.toLowerCase()));
    const keep: Command[] = [];
    for (const c of custom) {
      if (c.builtin || taken.has(c.name.toLowerCase())) continue;
      taken.add(c.name.toLowerCase());
      keep.push(c);
    }
    return new CommandBook(keep, new Set([...disabled].filter((id) => known.has(id))));
  }

  get customCommands(): readonly Command[] {
    return this.custom;
  }
  get disabledIds(): readonly string[] {
    return [...this.disabled];
  }

  /** 기본 명령 먼저, 내 명령 뒤에. 켜짐 여부와 함께. */
  entries(): readonly CommandEntry[] {
    return [...BUILTIN_COMMANDS, ...this.custom].map((command) => ({ command, enabled: !this.disabled.has(command.id) }));
  }

  active(): readonly Command[] {
    return this.entries().filter((e) => e.enabled).map((e) => e.command);
  }

  /** 기본 명령을 끄거나 켠다. 내 명령은 지우면 되므로 여기서는 기본 명령만 다룬다. */
  setEnabled(id: string, enabled: boolean): CommandBook {
    if (!BUILTIN_COMMANDS.some((c) => c.id === id)) throw new CommandError('Only default commands can be turned on or off. Delete or edit your own.');
    const next = new Set(this.disabled);
    if (enabled) next.delete(id);
    else next.add(id);
    return new CommandBook(this.custom, next);
  }

  /** 기본 명령을 모두 처음 상태(켬)로 되돌린다. 내 명령은 그대로. */
  restoreDefaults(): CommandBook {
    return new CommandBook(this.custom, new Set());
  }

  add(draft: CustomDraft, newId: () => string): CommandBook {
    const command = this.build(newId(), draft, null);
    return new CommandBook([...this.custom, command], this.disabled);
  }

  edit(id: string, draft: CustomDraft): CommandBook {
    if (!this.custom.some((c) => c.id === id)) throw new CommandError('The command to edit was not found.');
    const command = this.build(id, draft, id);
    return new CommandBook(this.custom.map((c) => (c.id === id ? command : c)), this.disabled);
  }

  remove(id: string): CommandBook {
    return new CommandBook(this.custom.filter((c) => c.id !== id), this.disabled);
  }

  private build(id: string, draft: CustomDraft, ownId: string | null): Command {
    const command = Command.create({ id, name: draft.name, description: draft.description, detail: '', group: 'My commands', action: prompt(draft.template), builtin: false });
    const clash = this.entries().find((e) => e.command.id !== ownId && e.command.called(command.name));
    if (clash !== undefined) throw new CommandError(`/${command.name} already exists.${clash.command.builtin ? ' Default command names cannot be used.' : ''}`);
    return command;
  }

  /** `/`를 치는 동안 보일 후보. 이름이 그 글로 시작하는 것이 먼저, 이름이나 설명에 들어 있는 것이 뒤. 띄어쓰기가 들어가면 다 친 것으로 보고 비운다. */
  suggest(text: string): readonly Command[] {
    if (!text.startsWith('/') || /\s/.test(text)) return [];
    const query = text.slice(1).toLowerCase();
    const active = this.active();
    const names = (c: Command) => [c.name, ...c.aliases].map((n) => n.toLowerCase());
    const starts = active.filter((c) => names(c).some((n) => n.startsWith(query)));
    if (query === '') return starts;
    const contains = active.filter((c) => !starts.includes(c) && (names(c).some((n) => n.includes(query)) || c.description.includes(query)));
    return [...starts, ...contains];
  }

  /** 입력창에 친 글이 무슨 뜻인지. 명령이 아니면 그대로 요청으로 보낸다. */
  resolve(input: string): Resolution {
    const trimmed = input.trim();
    if (trimmed.startsWith('//')) return { kind: 'text', text: trimmed.slice(1) };
    if (!trimmed.startsWith('/')) return { kind: 'text', text: input };
    if (trimmed === '/') return { kind: 'list' };
    const match = /^\/(\S+)\s*([\s\S]*)$/.exec(trimmed)!;
    const name = match[1]!;
    const entry = this.entries().find((e) => e.command.called(name));
    if (entry === undefined) return { kind: 'unknown', name };
    if (!entry.enabled) return { kind: 'off', command: entry.command };
    const { command } = entry;
    if (command.action.kind === 'app') return { kind: 'app', command, action: command.action.action, tab: command.action.tab ?? null };
    const filled = command.fill(match[2]!);
    return filled.ok ? { kind: 'send', command, text: command.render(filled.values) } : { kind: 'usage', command, missing: filled.missing };
  }
}
