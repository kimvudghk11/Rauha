import { relativeToRoot } from '../../shared/path-pattern.js';

export type ToolDecision = 'allow' | 'ask' | 'deny';

export interface ToolVerdict {
  readonly decision: ToolDecision;
  readonly reason: string | null;
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/** rauha는 커밋하지 않는다. 커밋은 언제나 사용자가 직접 한다. */
const GIT_ALWAYS_DENY = new Set(['commit', 'push', 'send-pack', 'http-push']);
/** 안에 다른 명령(git push 같은)을 품을 수 있는 git 하위 명령 */
const GIT_NESTING = new Set(['submodule', 'rebase', 'bisect', 'filter-branch']);
/** 만들어 두면 다음 git 실행 때 명령이 돌아가는 git 설정(별칭, ssh·pager·fsmonitor·hooks·자격 증명 도우미) */
const GIT_EXEC_CONFIG = /^(alias\.|core\.(sshcommand|fsmonitor|hookspath|pager|editor|askpass)|credential\.helper|gpg\.program)/i;
/** .git 안의 hooks·config를 만지는 셸 명령 */
const GIT_INTERNALS = /(^|[\s"'=<>/\\])\.git[/\\](hooks|config)\b/i;
const GIT_WRITES = new Set([
  'reset', 'checkout', 'restore', 'switch', 'clean', 'stash', 'rebase', 'merge', 'cherry-pick',
  'revert', 'tag', 'rm', 'mv', 'am', 'apply', 'update-ref', 'filter-branch', 'gc', 'prune',
]);
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'unlink', 'shred', 'remove-item', 'ri']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const ALLOW: ToolVerdict = { decision: 'allow', reason: null };
const ask = (reason: string): ToolVerdict => ({ decision: 'ask', reason });
const deny = (reason: string): ToolVerdict => ({ decision: 'deny', reason });

/** 다른 명령을 인자로 받아 실행하는 프로그램. 뒤따르는 단어들을 하나의 명령으로 다시 검사한다. */
const WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'cmd', 'powershell', 'pwsh', 'env', 'xargs', 'nohup', 'time', 'npx', 'exec', 'eval',
  'timeout', 'command', 'builtin', 'nice', 'ionice', 'setsid', 'doas', 'stdbuf', 'watch', 'busybox', 'unbuffer',
  'iex', 'invoke-expression', 'invoke-command', 'icm', 'start-process', 'start', 'call',
]);
/** 값을 하나 받는 git 전역 옵션. 하위 명령을 찾을 때 그 값까지 건너뛴다. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

/**
 * `a && b; c | d & e` → 조각마다 단어 목록. 괄호·`$(…)`·백틱은 경계로, 따옴표는 공백으로 본다.
 * 따옴표 안의 명령(`bash -c "git commit"`)도 같은 규칙으로 검사하기 위해서다.
 */
function segments(command: string): string[][] {
  return command
    // 공백이 든 따옴표 경로의 git("C:\Program Files\Git\cmd\git.exe")는 공백을 붙여 한 단어로 읽는다
    .replace(/"([^"]*[\\/]git(?:\.exe)?)"/gi, (_, path: string) => path.replace(/\s+/g, ''))
    .replace(/\$\(|[()`]/g, ' ; ')
    .replace(/["']/g, ' ')
    .split(/&&|\|\||;|\||&|\n/)
    .map((part) => part.trim().split(/\s+/).filter((word) => word !== ''))
    .map((words) => {
      let i = 0;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string)) i += 1;
      return words.slice(i);
    })
    .filter((words) => words.length > 0);
}

/** `git -c alias.p=push p origin` → 풀어 쓴 명령 [git, push, origin]. 별칭이 아니면 null. */
function aliasOf(args: readonly string[], sub: string): readonly string[] | null {
  const at = args.indexOf(sub);
  for (let i = 0; i + 1 < at; i += 1) {
    const m = args[i] === '-c' ? /^alias\.([^=]+)=(.*)$/i.exec(args[i + 1] as string) : null;
    if (m === null || m[1] !== sub) continue;
    const value = (m[2] as string).trim();
    // 따옴표가 공백으로 바뀐 뒤라 값이 여러 단어로 흩어져 있을 수 있다: 하위 명령 앞 단어들이 전부 별칭 값이다
    const words = value.startsWith('!') ? value.slice(1).split(/\s+/) : ['git', ...value.split(/\s+/)];
    return [...words.filter((w) => w !== ''), ...args.slice(at + 1)];
  }
  return null;
}

/** `/usr/bin/git.exe` → `git` */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() as string).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

function gitSubcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (GIT_VALUE_OPTIONS.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

/** 값을 하나 받는 aws 전역 옵션. 서비스·명령을 찾을 때 그 값까지 건너뛴다. */
const AWS_VALUE_OPTIONS = new Set(['--profile', '--region', '--output', '--endpoint-url', '--query', '--cli-input-json', '--cli-input-yaml', '--color', '--ca-bundle', '--cli-read-timeout', '--cli-connect-timeout']);
/** 이 말로 시작하는 aws 명령은 읽기만 한다(describe-instances, list-buckets, get-caller-identity …). */
const AWS_READ_PREFIXES = ['describe-', 'list-', 'get-', 'head-', 'lookup-', 'batch-get-', 'search-'];
const AWS_READ_EXACT = new Set(['ls', 'scan', 'query', 'help', 'wait']);
const INFRA_WRITES: Readonly<Record<string, ReadonlySet<string>>> = {
  terraform: new Set(['apply', 'destroy', 'import', 'taint', 'untaint', 'refresh', 'state', 'force-unlock']),
  cdk: new Set(['deploy', 'destroy', 'bootstrap', 'import']),
};
const KUBECTL_READS = new Set(['get', 'describe', 'logs', 'top', 'explain', 'version', 'api-resources', 'api-versions', 'cluster-info', 'diff', 'events', 'config']);

const firstWord = (args: readonly string[]): string => args.find((a) => !a.startsWith('-')) ?? '';

/** 자격 증명 값이 든 설정 이름(`profile.dev.aws_secret_access_key`처럼 프로필이 앞에 붙기도 한다) */
const AWS_SECRET_KEYS = /(^|\.)(aws_access_key_id|aws_secret_access_key|aws_session_token)$/;
/** 설정을 읽기만 하는 aws configure 명령 */
const CONFIGURE_READS = new Set(['list', 'list-profiles', 'get']);

/**
 * aws configure: 설정된 프로필·리전은 읽어야 어느 계정으로 일할지 안다. 비밀 값은 읽지도 쓰지도 않고,
 * 키를 입력받는 대화형 설정(`aws configure`, `aws configure sso`)은 rauha에서 끝나지 않으니 사용자에게 맡긴다.
 */
function assessConfigure(operation: string | undefined, key: string | undefined): ToolVerdict {
  const yourself = 'aws configure: 키 입력은 rauha가 하지 않아요. 터미널에서 직접 설정해 주세요';
  if (operation === undefined || operation === 'sso') return deny(yourself);
  if (operation === 'export-credentials') return deny('aws configure export-credentials: 자격 증명 값은 rauha가 보지 않아요');
  if ((operation === 'get' || operation === 'set') && key !== undefined && AWS_SECRET_KEYS.test(key)) return deny('aws configure: 자격 증명 값은 rauha가 읽거나 쓰지 않아요');
  if (CONFIGURE_READS.has(operation)) return ALLOW;
  return ask(`AWS 설정 바꾸기 (aws configure ${operation})`);
}

/** aws <서비스> <명령>: 조회는 허용하고 변경은 묻는다. */
function assessAws(args: readonly string[]): ToolVerdict {
  const words: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (AWS_VALUE_OPTIONS.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) words.push(arg);
  }
  const [service, operation, key] = words;
  if (service === undefined) return ALLOW;
  if (service === 'configure') return assessConfigure(operation, key);
  if (service === 'sso' && operation === 'login') return ask('AWS SSO 로그인 (브라우저에서 승인이 필요해요)');
  if (operation === undefined) return ALLOW;
  if (AWS_READ_EXACT.has(operation) || AWS_READ_PREFIXES.some((p) => operation.startsWith(p))) return ALLOW;
  return ask(`AWS 변경 (aws ${service} ${operation})`);
}

function worst(verdicts: readonly ToolVerdict[]): ToolVerdict {
  return verdicts.reduce((acc, next) => (RANK[next.decision] > RANK[acc.decision] ? next : acc), ALLOW);
}

function assessSegment(words: readonly string[]): ToolVerdict {
  const program = programName(words[0] as string);
  const args = words.slice(1);

  // 감싸는 프로그램(bash -c, cmd /c, xargs …)은 옵션을 건너뛰고 나머지를 명령으로 다시 본다.
  // 옵션 값(timeout 30, nice -n 5)이 끼어 있어도 놓치지 않게 뒤쪽 어느 단어부터든 명령으로 읽어 본다.
  if (WRAPPERS.has(program) || program === 'sudo') {
    const rest = args.filter((a) => !/^[-/][A-Za-z]+$/.test(a));
    const inner = rest.map((_, i) => assessSegment(rest.slice(i)));
    return worst(program === 'sudo' ? [ask('sudo 실행'), ...inner] : inner);
  }
  if (DELETE_COMMANDS.has(program)) return ask(`파일 지우기 (${program})`);
  if (program === 'find') {
    if (args.includes('-delete')) return ask('파일 지우기 (find -delete)');
    const exec = args.findIndex((a) => a === '-exec' || a === '-execdir');
    if (exec >= 0 && args[exec + 1] !== undefined) return worst([assessSegment(args.slice(exec + 1))]);
  }

  if (program === 'git') {
    const sub = gitSubcommand(args);
    if (sub === undefined) return ALLOW;
    // 한 줄짜리 별칭(-c alias.p=push p, 또는 !명령)은 풀어서 다시 본다.
    const alias = aliasOf(args, sub);
    if (alias !== null) return assessSegment(alias);
    if (GIT_ALWAYS_DENY.has(sub)) return deny(`git ${sub}: 커밋과 push는 사용자가 직접 합니다`);
    if (sub === 'config' && args.some((a) => GIT_EXEC_CONFIG.test(a))) return ask('git 설정: 다음 git 실행 때 명령이 돌아갈 수 있는 값이에요');
    if (GIT_NESTING.has(sub)) {
      const after = args.slice(args.indexOf(sub) + 1);
      const nested = after.flatMap((w, i) => (programName(w) === 'git' ? [assessSegment(after.slice(i))] : []));
      const own: ToolVerdict = GIT_WRITES.has(sub) ? ask(`git 쓰기 (git ${sub})`) : ALLOW;
      return worst([own, ...nested]);
    }
    if (GIT_WRITES.has(sub)) return ask(`git 쓰기 (git ${sub})`);
    if (sub === 'branch' && args.some((a) => /^-(d|D|-delete)$/.test(a))) return ask('git 쓰기 (브랜치 삭제)');
    return ALLOW;
  }

  if (program === 'aws') return assessAws(args);
  if (program === 'terraform' || program === 'tofu') return INFRA_WRITES.terraform!.has(firstWord(args)) ? ask(`인프라 변경 (${program} ${firstWord(args)})`) : ALLOW;
  if (program === 'kubectl') return KUBECTL_READS.has(firstWord(args)) || firstWord(args) === '' ? ALLOW : ask(`쿠버네티스 변경 (kubectl ${firstWord(args)})`);
  if (program === 'cdk') return INFRA_WRITES.cdk!.has(firstWord(args)) ? ask(`인프라 변경 (cdk ${firstWord(args)})`) : ALLOW;

  if (PACKAGE_MANAGERS.has(program)) {
    if (args.includes('publish')) return ask(`배포 (${program} publish)`);
    if (args.includes('-g') || args.includes('--global') || args[0] === 'global') return ask(`전역 설치 (${program})`);
  }
  return ALLOW;
}

const RANK: Readonly<Record<ToolDecision, number>> = { allow: 0, ask: 1, deny: 2 };

/**
 * 팀원의 도구 호출 위험도. 기본은 허용하고, 정말 위험한 동작만 묻는다.
 * 역할별 쓰기 권한(WritePolicy)은 이것과 별개로 검사한다.
 */
export class ToolRisk {
  private constructor() {}

  static assess(tool: string, input: Record<string, unknown>, root: string): ToolVerdict {
    if (WRITE_TOOLS.has(tool)) {
      const path = input['file_path'] ?? input['notebook_path'];
      if (typeof path === 'string' && path.split(/[\\/]/).some((part) => part.toLowerCase() === '.git')) return deny('.git 안쪽(hooks·설정)은 팀원이 쓰지 않아요. 다음 git 실행 때 명령이 돌아갈 수 있어요');
      if (typeof path === 'string' && relativeToRoot(root, path) === null) {
        return ask(`작업 폴더 밖에 쓰기 (${path})`);
      }
      return ALLOW;
    }
    if (tool === 'Bash' || tool === 'PowerShell') {
      const command = input['command'];
      if (typeof command !== 'string') return ALLOW;
      return worst([GIT_INTERNALS.test(command) ? ask('.git 안쪽(hooks·설정)을 건드리는 명령') : ALLOW, ...segments(command).map(assessSegment)]);
    }
    return ALLOW;
  }
}
