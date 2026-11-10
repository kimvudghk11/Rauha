import { MONEY_PATTERNS, SECRET_PATTERNS } from './record-book.js';

/**
 * 공개용 가림. 블로그에 올릴 글(정리 노트, 모델에 보내는 입력)은 모두 이 함수를 거친다.
 * 회사·레포 이름, 도메인, IP, 계정 번호, 리전, ARN, 토큰·키, 이메일, 사용자 이름, 홈 경로, 달러 금액, 비밀 파일 이름을 가린다.
 * 같은 이름은 글이 달라도 같은 일반 이름("서비스 A", "레포 A")으로 바뀐다. 몇 번 거쳐도 결과가 같다.
 * 사용자는 이름·도메인·IP 같은 항목은 되돌릴 수 있고(keep), 토큰·키·비밀 파일·금액은 되돌릴 수 없다.
 */

export type RedactKind = 'secret' | 'secretFile' | 'arn' | 'email' | 'domain' | 'ip' | 'account' | 'company' | 'repo' | 'region' | 'home' | 'user' | 'money';

export interface RedactContext {
  /** 작업 폴더의 레포·폴더 이름과 기록의 레포 이름 */
  readonly repoNames: readonly string[];
  /** 사용자가 설정에 적은 회사·서비스 이름 */
  readonly companyNames: readonly string[];
  readonly userName: string;
  readonly homePath: string;
}

export interface RedactChange {
  readonly kind: RedactKind;
  readonly original: string;
  readonly replacement: string;
  readonly count: number;
  readonly revertible: boolean;
  /** 사용자가 되돌려서 원래 값이 그대로 남아 있다 */
  readonly kept: boolean;
}

export interface Redacted {
  readonly text: string;
  readonly changes: readonly RedactChange[];
}

const HIDDEN = '[값 가림]';
const SECRET_FILE_LABEL = '[비밀 파일]';
const MONEY_LABEL = '[금액 생략]';
const MIN_NAME = 2;

/** 폴더 이름으로는 흔한 낱말이라 글 속 보통 낱말까지 바꾸게 되는 것들 */
const GENERIC_NAMES = new Set(['app', 'api', 'web', 'src', 'lib', 'bin', 'doc', 'docs', 'test', 'tests', 'main', 'core', 'common', 'server', 'client', 'backend', 'frontend', 'build', 'dist', 'packages', 'scripts', 'config', 'public', 'static', 'assets', 'utils', 'shared', 'infra', 'tools', 'example', 'examples', 'demo', 'sample', 'temp', 'tmp', 'project', 'projects', 'code', 'work', 'repo', 'data', 'service', 'services']);

/** 폴더 이름 목록에서 가림 이름으로 쓸 만한 것만 남긴다(너무 짧거나 흔한 낱말은 뺀다). */
export function usableRepoNames(names: readonly string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3 && !GENERIC_NAMES.has(n.toLowerCase())))];
}

const SECRET_FILE_RE =
  /(?<![\w.-])(?:[\w~.-]+[/\\])*(?:\.env(?:\.(?!(?:example|sample|template)\b)[\w.-]+)?|[\w.-]*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|ed25519|ecdsa|dsa)[\w.-]*|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|secrets?\.(?:json|ya?ml))(?![\w-]|\.\w)/gi;
const ENV_LINE = /^\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*\S/;

/** 사용자가 붙여 넣은 코드 조각을 글에 넣어도 되는지. 비밀 파일 이름이 있거나 환경 변수 파일 모양이면 안 된다. */
export function snippetAllowed(snippet: string): boolean {
  SECRET_FILE_RE.lastIndex = 0;
  if (SECRET_FILE_RE.test(snippet)) return false;
  return snippet.split('\n').filter((l) => ENV_LINE.test(l)).length < 2;
}

const ARN_RE = /\barn:aws[a-z-]*:[A-Za-z0-9-]*:[A-Za-z0-9-]*:[0-9]*:?[^\s,;()"'`]*/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const DOMAIN_RE = /(?<![\w@-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?:com|net|org|io|kr|co|dev|cloud|internal|local|corp|lan|intra|biz|info|xyz|tech|site|jp|app|ai|me|us|de|uk|fr|cn|tv|cc|pro|run|page|link|work|team|company|group|systems|software|solutions)(?![\w-])/gi;
const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?(?![\d.]*\d)/g;
const IPV6_RE = /(?<![\w:])(?=[0-9A-Fa-f:]*[0-9A-Fa-f]:)[0-9A-Fa-f:]{6,}(?![\w:])/g;
const ACCOUNT_RE = /(?<!\d)(?:\d{12}|\d{4}[- ]\d{4}[- ]\d{4})(?!\d)/g;
const REGION_RE = /\b(?:us|eu|ap|sa|ca|me|af|il|mx|cn)(?:-gov)?-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d\b/g;
const HOME_GENERIC = [/[A-Za-z]:\\Users\\[^\\/\s]+/g, /\/Users\/[^/\s]+/g, /\/home\/[^/\s]+/g];

/**
 * 가림을 피하려고 끼워 넣은 눈에 안 보이는 글자(너비 0·소프트 하이픈)를 지우고 전각 영숫자·기호(ＡＢＣ１２３＠．)를 보통 글자로 바꾼다.
 * 가림 규칙은 이 접은 글자 위에서 돈다(올릴 글만 해당하고 원본 메모는 그대로다).
 */
export function foldLookalikes(text: string): string {
  return text
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u00ad\ufeff]/g, '')
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
const letter = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : String(n + 1));

function validIpv6(s: string): boolean {
  if (!s.includes(':')) return false;
  const colons = s.split(':').length - 1;
  if (!(s.includes('::') || colons === 7)) return false;
  return s.split(':').every((g) => g.length <= 4);
}

const validIpv4 = (s: string): boolean => s.split('/')[0]!.split('.').every((o) => Number(o) <= 255);

interface Entry {
  readonly kind: RedactKind;
  readonly original: string;
  readonly replacement: string;
  count: number;
  readonly revertible: boolean;
  kept: boolean;
}

/** 가림 하나를 맡는 값. 여러 글을 같은 가림이로 거치면 같은 이름이 같은 일반 이름으로 바뀐다. */
export class BlogRedactor {
  private readonly entries = new Map<string, Entry>();
  private readonly letters = new Map<string, Map<string, string>>();
  private readonly names: ReadonlyMap<string, { kind: 'company' | 'repo'; name: string }>;
  private nameRe: RegExp | null = null;

  private constructor(
    private readonly ctx: RedactContext,
    private readonly keep: ReadonlySet<string>,
  ) {
    const names = new Map<string, { kind: 'company' | 'repo'; name: string }>();
    for (const n of ctx.repoNames) if (n.trim().length >= MIN_NAME) names.set(key(n), { kind: 'repo', name: n.trim() });
    for (const n of ctx.companyNames) if (n.trim().length >= MIN_NAME) names.set(key(n), { kind: 'company', name: n.trim() });
    this.names = names;
    if (names.size > 0) {
      const parts = [...names.values()].map((v) => v.name).sort((a, b) => b.length - a.length).map((n) => n.split(/\s+/).map(escapeRe).join('\\s+'));
      this.nameRe = new RegExp(`(?<![A-Za-z0-9_])(?:${parts.join('|')})(?![A-Za-z0-9_])`, 'gi');
    }
  }

  static create(ctx: RedactContext, keep: readonly string[]): BlogRedactor {
    return new BlogRedactor(ctx, new Set(keep));
  }

  /** 지금까지 거친 모든 글에서 바뀐 목록(처음 나온 순서) */
  changes(): RedactChange[] {
    return [...this.entries.values()].map((e) => ({ kind: e.kind, original: e.original, replacement: e.replacement, count: e.count, revertible: e.revertible, kept: e.kept }));
  }

  apply(text: string): Redacted {
    const held: string[] = [];
    let out = this.secrets(foldLookalikes(text));
    out = this.secretFiles(out);
    out = this.sub(out, ARN_RE, 'arn', () => 'ARN', held, (m) => m, true);
    out = this.sub(out, EMAIL_RE, 'email', (m) => this.label('email', m, '이메일'), held);
    out = this.sub(out, DOMAIN_RE, 'domain', (m) => this.label('domain', m, '도메인'), held);
    out = this.sub(out, IPV4_RE, 'ip', (m) => this.label('ip', m, 'IP'), held, undefined, true, validIpv4);
    out = this.sub(out, IPV6_RE, 'ip', (m) => this.label('ip', m, 'IP'), held, undefined, true, validIpv6);
    out = this.sub(out, ACCOUNT_RE, 'account', () => '계정 번호', held);
    out = this.home(out, held);
    out = this.namesIn(out, held);
    out = this.sub(out, REGION_RE, 'region', (m) => this.label('region', m, '리전'), held);
    out = this.user(out, held);
    for (const pattern of MONEY_PATTERNS) out = this.sub(out, pattern, 'money', () => MONEY_LABEL, held, undefined, false);
    // 되돌린 값은 자리표시자로 지켜 두었다가 마지막에 돌려놓는다(뒤 단계가 건드리지 못하게)
    return { text: out.replace(/(\d+)/g, (_m, i: string) => held[Number(i)] ?? ''), changes: this.changes() };
  }

  private label(kind: string, original: string, word: string): string {
    const map = this.letters.get(kind) ?? new Map<string, string>();
    this.letters.set(kind, map);
    const k = key(original);
    let found = map.get(k);
    if (found === undefined) {
      found = `${word} ${letter(map.size)}`;
      map.set(k, found);
    }
    return found;
  }

  private note(kind: RedactKind, original: string, replacement: string, revertible: boolean): Entry {
    const id = `${kind}\u0000${original}`;
    let entry = this.entries.get(id);
    if (entry === undefined) {
      entry = { kind, original, replacement, count: 0, revertible, kept: false };
      this.entries.set(id, entry);
    }
    entry.count += 1;
    return entry;
  }

  /** 정규식으로 찾은 값을 바꾼다. 되돌리기로 지정된 값은 자리표시자로 둔다. */
  private sub(text: string, pattern: RegExp, kind: RedactKind, to: (m: string) => string, held: string[], shown?: (m: string) => string, revertible = true, valid?: (m: string) => boolean): string {
    void shown;
    return text.replace(pattern, (m: string) => {
      if (valid !== undefined && !valid(m)) return m;
      const replacement = to(m);
      const entry = this.note(kind, m, replacement, revertible);
      if (revertible && this.keep.has(m)) {
        entry.kept = true;
        held.push(m);
        return `${held.length - 1}`;
      }
      return replacement;
    });
  }

  private secrets(text: string): string {
    let out = text;
    for (const [pattern, to] of SECRET_PATTERNS) {
      out = out.replace(pattern, (...args: unknown[]) => {
        const m = args[0] as string;
        const groups = args.slice(1, -2) as (string | undefined)[];
        this.note('secret', `${m.slice(0, 4)}…(${m.length}자)`, HIDDEN, false);
        return to.replace(/\$(\d)/g, (_x, d: string) => groups[Number(d) - 1] ?? '');
      });
    }
    return out;
  }

  private secretFiles(text: string): string {
    return text.replace(SECRET_FILE_RE, (m) => {
      this.note('secretFile', m, SECRET_FILE_LABEL, false);
      return SECRET_FILE_LABEL;
    });
  }

  private home(text: string, held: string[]): string {
    let out = text;
    const home = this.ctx.homePath.trim().replace(/[\\/]+$/, '');
    if (home.length > 3) {
      const re = new RegExp(home.split(/[\\/]+/).map(escapeRe).join('[\\\\/]'), 'gi');
      out = this.sub(out, re, 'home', () => '~', held);
    }
    for (const re of HOME_GENERIC) out = this.sub(out, re, 'home', () => '~', held);
    return out;
  }

  private user(text: string, held: string[]): string {
    const name = this.ctx.userName.trim();
    if (name.length < MIN_NAME) return text;
    return this.sub(text, new RegExp(`(?<![A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`, 'gi'), 'user', () => '사용자', held);
  }

  private namesIn(text: string, held: string[]): string {
    const re = this.nameRe;
    if (re === null) return text;
    return text.replace(re, (m: string) => {
      const hit = this.names.get(key(m));
      if (hit === undefined) return m;
      const replacement = this.label(hit.kind, hit.name, hit.kind === 'company' ? '서비스' : '레포');
      const entry = this.note(hit.kind, hit.name, replacement, true);
      if (this.keep.has(hit.name)) {
        entry.kept = true;
        held.push(m);
        return `${held.length - 1}`;
      }
      return replacement;
    });
  }
}
