import { matchesPattern, relativeToRoot } from '../../shared/path-pattern.js';
import { commandVariants, DECODE_AND_RUN, expandBraces, isShortNameOf, shellGlobMatches } from './shell-words.js';

/** 언제나 막는 비밀 파일. 이름(어느 폴더에 있든)으로 맞춘다. */
const DEFAULT_NAMES: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_rsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  'credentials.json',
];

/** glob 하나가 기본 비밀 파일을 겨누는지 볼 때 맞춰 보는 대표 이름 */
const DEFAULT_SAMPLES: readonly string[] = ['.env', '.env.local', 'server.pem', 'server.key', 'cert.p12', 'cert.pfx', 'app.keystore', 'id_rsa', 'id_ed25519', '.npmrc', '.pypirc', 'credentials.json'];

/** 설정 방법을 알려 주는 예시 파일은 기본 목록에서 뺀다(`.env.example` 등). */
const EXAMPLE_SUFFIXES = ['.example', '.sample', '.template'];

/** 셸 명령을 단어로 나누는 경계. 따옴표·파이프·리다이렉트·`=`(옵션 값)는 모두 경계다. */
const WORD_BOUNDARY = /[\s"'|;&<>()`=]+/;
const SEGMENT_BOUNDARY = /&&|\|\||[|;&\n]/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

/** 내용을 폴더째 뒤지는 셸 검색. 비밀 파일이 있는 저장소에서는 막고 Grep 도구(가드가 지킨다)를 쓰게 한다. */
const RECURSIVE_SEARCH: Readonly<Record<string, (args: readonly string[]) => string | null>> = {
  grep: (args) => args.find((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive') ?? null,
  egrep: (args) => args.find((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive') ?? null,
  rg: () => '',
  ag: () => '',
  ack: () => '',
  findstr: (args) => args.find((a) => /^\/s$/i.test(a)) ?? null,
};

/** `name`: 이름이나 폴더 이름이 어디서든 맞으면, `path`: 저장소 루트 기준 경로(그 폴더 안 전체 포함), `dir`: 폴더 이름이 어디서든 맞으면 */
interface Rule {
  readonly kind: 'name' | 'path' | 'dir';
  readonly glob: string;
}

/** 검사할 때 넘기는 작업 맥락. root: 작업 폴더(절대 경로), secretFiles: 그 아래 실제로 있는 비밀 파일(작업 폴더 기준) */
export interface SecretContext {
  readonly root: string;
  readonly secretFiles: readonly string[];
}

function normalize(path: string): string {
  return path.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/** `.gitignore`처럼 쓴 한 줄 → 규칙. `/x`는 루트 기준, `x/`는 폴더, `/`가 없으면 어디서든. */
function ruleOf(line: string): Rule {
  let glob = normalize(line.trim());
  const anchored = glob.startsWith('/');
  if (anchored) glob = glob.slice(1);
  const dirOnly = glob.endsWith('/');
  if (dirOnly) glob = glob.replace(/\/+$/, '');
  if (anchored || glob.includes('/')) return { kind: 'path', glob };
  return { kind: dirOnly ? 'dir' : 'name', glob };
}

function ruleMatches(rule: Rule, path: string): boolean {
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? path;
  const dirs = segments.slice(0, -1);
  if (rule.kind === 'path') return matchesPattern(rule.glob, path) || matchesPattern(`${rule.glob}/**`, path);
  if (rule.kind === 'dir') return dirs.some((d) => matchesPattern(rule.glob, d));
  return matchesPattern(rule.glob, name) || dirs.some((d) => matchesPattern(rule.glob, d));
}

/**
 * 팀원과 rauha가 읽지도 쓰지도 않는 비밀 파일 규칙. 기본 목록에 저장소 루트의 `.rauhaignore` 줄을 더한다.
 * 경로는 작업 폴더 기준으로 받는다. base는 저장소 루트에서 작업 폴더까지의 경로라, `.rauhaignore`의
 * 루트 기준 줄을 하위 폴더에서 띄워도 맞출 수 있다. Windows 구분자와 대소문자 차이는 같은 파일로 본다.
 */
export class SecretPolicy {
  private constructor(
    private readonly rules: readonly Rule[],
    private readonly base: string,
  ) {}

  static defaults(): SecretPolicy {
    return new SecretPolicy([], '');
  }

  /** extraLines: `.rauhaignore`의 줄들. base: 저장소 루트 → 작업 폴더 상대 경로('' = 루트) */
  static of(extraLines: readonly string[], base = ''): SecretPolicy {
    return new SecretPolicy(extraLines.map(ruleOf), normalize(base).replace(/\/+$/, ''));
  }

  isSecret(relPath: string): boolean {
    const path = normalize(relPath);
    const name = path.split('/').pop() ?? path;
    const example = EXAMPLE_SUFFIXES.some((suffix) => name.endsWith(suffix));
    if (!example && DEFAULT_NAMES.some((glob) => ruleMatches({ kind: 'name', glob }, path))) return true;
    const fromRoot = this.base === '' ? path : `${this.base}/${path}`;
    return this.rules.some((rule) => ruleMatches(rule, fromRoot));
  }

  /** glob(Grep의 glob, 셸의 와일드카드)이 비밀 파일을 겨누는지. 실제로 있는 비밀 파일과 기본 목록의 대표 이름에 맞춰 본다. */
  globTargetsSecret(glob: string, secretFiles: readonly string[]): boolean {
    const g = normalize(glob);
    return [...DEFAULT_SAMPLES, ...secretFiles.map(normalize)].some((f) => shellGlobMatches(g, f) || shellGlobMatches(g, f.split('/').pop() ?? f));
  }

  /**
   * 셸 명령이 비밀 파일을 건드리는지. 건드리면 걸린 단어(명령에 쓰인 그대로), 아니면 null.
   * 파일 이름, 와일드카드, 절대 경로, `git show <ref>:<경로>`, `--옵션=<경로>`, 그리고
   * 비밀 파일이 있는 저장소에서 내용을 폴더째 뒤지는 검색(grep -r, rg, git grep …)을 잡는다.
   */
  secretIn(command: string, ctx: SecretContext): string | null {
    if (ctx.secretFiles.length > 0) {
      const search = this.recursiveSearch(command);
      if (search !== null) return search;
    }
    const decoding = ctx.secretFiles.length > 0 ? DECODE_AND_RUN.exec(command)?.[0] : undefined;
    if (decoding !== undefined) return decoding.trim();
    // 따옴표·역슬래시·16진 표기·중괄호로 이름을 쪼개 써도 이어 붙여 본다.
    for (const variant of commandVariants(command)) {
      for (const word of variant.split(WORD_BOUNDARY)) {
        if (word === '') continue;
        for (const expanded of expandBraces(word)) if (this.wordTouchesSecret(expanded, ctx)) return word;
      }
    }
    return null;
  }

  private wordTouchesSecret(word: string, ctx: SecretContext): boolean {
    const candidates = [word];
    if (!WINDOWS_DRIVE.test(word) && word.includes(':')) candidates.push(word.slice(word.lastIndexOf(':') + 1));
    // Windows 대체 데이터 스트림(.env::$DATA)은 같은 파일이다
    const stream = word.replace(/(:[^\\/:]*)+$/, '');
    if (stream !== '' && stream !== word) candidates.push(stream);
    const rel = relativeToRoot(ctx.root, word);
    if (rel !== null && rel !== '') candidates.push(rel);
    const touches = candidates.some((c) => c !== '' && (this.isSecret(c) || (/[*?[]/.test(c) && this.globTargetsSecret(c, ctx.secretFiles))));
    return touches || isShortNameOf(word, [...DEFAULT_SAMPLES, ...ctx.secretFiles]);
  }

  private recursiveSearch(command: string): string | null {
    for (const segment of command.split(SEGMENT_BOUNDARY)) {
      const words = segment.trim().split(/\s+/).filter((w) => w !== '');
      const program = (words[0]?.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
      if (program === 'git' && words[1] === 'grep') return 'git grep';
      const flag = RECURSIVE_SEARCH[program]?.(words.slice(1));
      if (flag !== undefined && flag !== null) return flag === '' ? program : `${program} ${flag}`;
    }
    return null;
  }
}
