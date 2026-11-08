import type { AccountCheck } from './account-state.js';
import { scrub } from './record-book.js';

/**
 * "진단 정보 복사"의 규칙(순수). 개발자가 맥 화면을 못 봐도 원인을 짐작하도록 앱 상태를 마크다운 한 덩어리로 만든다.
 * 홈 경로·사용자 이름·이메일·토큰·달러 금액은 여기서 가린다(수집하는 쪽이 아니라 이 규칙이 책임진다).
 */

export const LOG_RING_MAX = 200;
export const LOG_TAIL = 50;
const LOG_LINE_MAX = 300;
/** 이 길이를 넘으면 앱 오류 로그 파일을 돌려 쓴다 */
export const LOG_FILE_MAX_BYTES = 1024 * 1024;

const USER_MIN = 3;
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const OTHER_HOME = /(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s"'<>:]+/gi;

/** 이메일은 앞 2글자와 ***만 남긴다(도메인도 지운다). */
export function maskEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return `${local.slice(0, 2)}***`;
}

/** 경로·글에서 홈 폴더와 사용자 이름, 이메일, 비밀 값을 가린다. */
export class Redactor {
  private constructor(
    private readonly homeRe: RegExp | null,
    private readonly userRe: RegExp | null,
  ) {}

  static of(home: string, user: string): Redactor {
    const segments = home.split(/[\\/]+/).filter((s) => s !== '');
    const homeRe = segments.length === 0 ? null : new RegExp(`${home.startsWith('/') ? '/' : ''}${segments.map(escapeRe).join('[\\\\/]+')}(?![A-Za-z0-9_-])`, 'gi');
    const userRe = user.length >= USER_MIN ? new RegExp(`(?<![A-Za-z0-9_])${escapeRe(user)}(?![A-Za-z0-9_])`, 'gi') : null;
    return new Redactor(homeRe, userRe);
  }

  /** 경로 하나: 홈은 ~로, 사용자 이름은 지우고, 역슬래시는 슬래시로 보인다. 모르면 "없음". */
  path(path: string | null): string {
    if (path === null || path === '') return '없음';
    return this.names(this.homes(path)).replace(/\\/g, '/');
  }

  /** 글 한 줄: 경로·이메일·사용자 이름·비밀·달러 금액을 가린다. 몇 번 거쳐도 결과가 같다. */
  text(text: string): string {
    return scrub(this.names(this.homes(text).replace(EMAIL, (m) => maskEmail(m))));
  }

  private homes(text: string): string {
    const own = this.homeRe === null ? text : text.replace(this.homeRe, '~');
    return own.replace(OTHER_HOME, '~');
  }

  private names(text: string): string {
    return this.userRe === null ? text : text.replace(this.userRe, '<user>');
  }
}

/** 오류 한 건을 로그 줄로 만든다. 줄마다 나누고 첫 줄에만 시각과 출처를 붙이며, 너무 긴 줄은 자른다. */
export function logLinesOf(at: string, source: string, message: string): string[] {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .map((l) => (l.length > LOG_LINE_MAX ? `${l.slice(0, LOG_LINE_MAX - 1)}…` : l));
  return lines.map((l, i) => (i === 0 ? `${at} [${source}] ${l}` : l));
}

/** 최근 로그 줄을 메모리에 200줄까지만 들고 있는다. */
export class LogRing {
  private readonly buffer: string[] = [];

  push(line: string): void {
    this.buffer.push(line);
    if (this.buffer.length > LOG_RING_MAX) this.buffer.splice(0, this.buffer.length - LOG_RING_MAX);
  }

  all(): readonly string[] {
    return this.buffer;
  }

  tail(count: number): readonly string[] {
    return this.buffer.slice(-count);
  }
}

export interface DiagnosticSnapshot {
  readonly collectedAt: string;
  readonly app: { readonly version: string; readonly packaged: boolean };
  readonly os: { readonly platform: string; readonly version: string; readonly arch: string; readonly chip: string | null };
  readonly runtime: { readonly electron: string; readonly node: string; readonly chrome: string };
  readonly workFolder: { readonly path: string | null; readonly exists: boolean | null };
  /** 작업 폴더에서 찾은 레포 수(못 셌으면 null) */
  readonly repoCount: number | null;
  readonly claude: { readonly path: string | null; readonly exists: boolean; readonly executable: boolean };
  /** `auth status`를 읽은 결과(안 읽었으면 null) */
  readonly auth: AccountCheck | null;
  readonly tools: readonly { readonly name: string; readonly path: string | null }[];
  readonly usage: { readonly lastReadAt: string | null; readonly failure: string | null };
  readonly update: { readonly checkedAt: string | null; readonly latest: string | null; readonly newer: boolean; readonly failed: boolean } | null;
  readonly logs: readonly string[];
  readonly window: { readonly width: number; readonly height: number; readonly displays: number } | null;
  /** 맥일 때만 */
  readonly mac: { readonly titleBarStyle: string; readonly trafficLight: { readonly x: number; readonly y: number } | null; readonly fullScreen: boolean } | null;
}

const OS_NAMES: Readonly<Record<string, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const yesNo = (value: boolean): string => (value ? '예' : '아니요');

/** 진단 결과 한 덩어리. 만들 때 가림 규칙을 받아 마크다운으로 바꾼다. */
export class DiagnosticReport {
  private constructor(
    private readonly snap: DiagnosticSnapshot,
    private readonly redact: Redactor,
  ) {}

  static of(snapshot: DiagnosticSnapshot, redactor: Redactor): DiagnosticReport {
    return new DiagnosticReport(snapshot, redactor);
  }

  toMarkdown(): string {
    const s = this.snap;
    const r = this.redact;
    const out: string[] = ['# Rauha 진단 정보', '', `- 만든 때: ${s.collectedAt}`, ''];

    out.push('## 앱', `- 버전: ${s.app.version} (${s.app.packaged ? '설치본' : '개발 실행'})`, '');

    const osName = OS_NAMES[s.os.platform] ?? s.os.platform;
    out.push('## 컴퓨터', `- OS: ${osName} ${s.os.version}`, `- 칩: ${s.os.chip === null ? '모름' : s.os.chip} (${s.os.arch})`, `- 실행 환경: Electron ${s.runtime.electron} · Node ${s.runtime.node} · Chrome ${s.runtime.chrome}`, '');

    const folder = s.workFolder.path === null ? '안 골랐어요' : `${r.path(s.workFolder.path)} (${s.workFolder.exists === null ? '있는지 모름' : s.workFolder.exists ? '있음' : '없음'})`;
    out.push('## 작업 폴더', `- 경로: ${folder}`, `- 작업 폴더에서 찾은 레포: ${s.repoCount === null ? '못 셌어요' : `레포 ${s.repoCount}개`}`, '');

    const claude = s.claude.path === null ? '찾지 못함' : `${r.path(s.claude.path)} (${!s.claude.exists ? '파일 없음' : s.claude.executable ? '있음 · 실행 가능' : '있음 · 실행 권한 없음'})`;
    out.push('## Claude', `- 실행 파일: ${claude}`, `- 로그인: ${this.authLine()}`);
    if (s.auth?.configDir != null) out.push(`- 계정 폴더: ${r.path(s.auth.configDir)}`);
    out.push('');

    out.push('## 도구(PATH)', ...s.tools.map((t) => `- ${t.name}: ${t.path === null ? '못 찾음' : r.path(t.path)}`), '');

    out.push('## 한도 읽기', `- 마지막 성공: ${s.usage.lastReadAt ?? '아직 없음'}`);
    if (s.usage.failure !== null) out.push(`- 실패 이유: ${r.text(s.usage.failure)}`);
    out.push('');

    out.push('## 업데이트 확인', ...this.updateLines(), '');

    out.push('## 창', s.window === null ? '- 창 없음' : `- 크기: ${s.window.width}x${s.window.height} · 모니터 ${s.window.displays}개`, '');

    if (s.mac !== null) {
      const light = s.mac.trafficLight === null ? '기본값' : `x ${s.mac.trafficLight.x}, y ${s.mac.trafficLight.y}`;
      out.push('## 맥 창 모양', `- titleBarStyle: ${s.mac.titleBarStyle}`, `- trafficLightPosition: ${light}`, `- 전체 화면: ${yesNo(s.mac.fullScreen)}`, '');
    }

    const tail = s.logs.slice(-LOG_TAIL).map((l) => r.text(l));
    out.push(tail.length === 0 ? '## 최근 앱 오류 로그' : `## 최근 앱 오류 로그 (${tail.length}줄)`);
    out.push(...(tail.length === 0 ? ['오류 기록 없음'] : ['```', ...tail, '```']));
    return `${out.join('\n')}\n`;
  }

  private authLine(): string {
    const check = this.snap.auth;
    if (check === null) return '확인 안 함';
    const state = check.state;
    switch (state.kind) {
      case 'signed-in':
        return `로그인됨 (${state.who.includes('@') ? maskEmail(state.who) : this.redact.text(state.who)})`;
      case 'signed-out':
        return '로그인 안 됨';
      case 'unknown':
        return `확인 못 함 - ${this.redact.text(state.reason).replace(/\s+/g, ' ')}`;
    }
  }

  private updateLines(): string[] {
    const u = this.snap.update;
    if (u === null) return ['- 확인하지 않았어요(꺼져 있거나 개발 실행)'];
    const lines = [`- 마지막 확인: ${u.checkedAt ?? '아직 없음'}`, `- 알려진 최신 버전: ${u.latest ?? '모름'}${u.newer ? ' (새 버전 있음)' : ''}`];
    if (u.failed) lines.push('- 방금 확인 실패');
    return lines;
  }
}
