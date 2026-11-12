import { DomainError } from '../../shared/domain-error.js';
import type { ToolVerdict } from './tool-risk.js';

/**
 * 커넥터: 팀원이 업무 도구(노션, 컨플루언스·지라 …)를 읽고 쓰게 붙이는 원격 MCP 서버.
 * rauha는 주소와 이름만 기억한다. 로그인(OAuth)과 토큰은 Claude Code가 계정의 설정 폴더(CLAUDE_CONFIG_DIR)에 직접 둔다.
 */

/** 연결 목록 상한(도구 설명이 늘고 팀원이 띄울 때 접속이 늘어서) */
const MAX_CONNECTORS = 12;
const CUSTOM_PREFIX = 'custom';
/** 주소에 비밀이 실려 오면 평문으로 저장하게 되므로 받지 않는다 */
const SECRET_QUERY = /token|key|secret|password|passwd|auth|signature|sig$|credential/i;
const SERVER_NAME = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_LABEL = 40;

/** 서버가 자동 클라이언트 등록을 받지 않을 때 쓰는, 서비스가 공개한 OAuth 클라이언트(비밀 아님) */
export interface ConnectorOAuth {
  readonly clientId: string;
  readonly callbackPort: number;
}

interface PresetSpec {
  readonly id: string;
  readonly label: string;
  /** 화면에 보일 한 줄(무엇을 다루는지) */
  readonly covers: string;
  /** 업무에서 무엇을 해 주는지 한 줄. 그 서버의 도구가 실제로 하는 일만 적는다. */
  readonly summary: string;
  /** 채팅에 바로 쓸 수 있는 예시 요청(한국어, 1~2개) */
  readonly examples: readonly string[];
  readonly url: string | null;
  readonly oauth?: ConnectorOAuth;
  /** 아직 버튼 하나로 연결할 수 없는 이유. 연결할 수 있으면 null */
  readonly unavailable: string | null;
}

/**
 * 공식 원격 MCP 주소가 확인된 것만 둔다(서비스 문서·공식 플러그인 설정, 그리고 Claude Code 로 로그인 주소까지 받아 확인).
 * 자동 등록을 받지 않아 버튼 하나로 로그인할 수 없는 것은 '준비 중'으로 이유와 함께 둔다.
 */
const PRESETS: readonly PresetSpec[] = [
  {
    id: 'notion',
    label: 'Notion',
    covers: 'Pages and databases',
    summary: 'Search and read Notion pages and databases, and create or update pages and comments when you ask.',
    examples: ['이번 주 회의록 노션 페이지 요약해줘', '이 대화 내용을 노션에 회의록으로 정리해줘'],
    url: 'https://mcp.notion.com/mcp',
    unavailable: null,
  },
  {
    id: 'atlassian',
    label: 'Confluence · Jira',
    covers: 'Atlassian Confluence pages and Jira issues',
    summary: 'Search and read Confluence pages and Jira issues, and create or update pages, issues and comments when you ask.',
    examples: ['컨플루언스 결제 API 문서에서 환불 조건 찾아줘', '지라에서 나한테 배정된 이슈 목록 보여줘'],
    url: 'https://mcp.atlassian.com/v2/mcp',
    unavailable: null,
  },
  {
    id: 'linear',
    label: 'Linear',
    covers: 'Issues, projects and cycles',
    summary: 'Search and read Linear issues and projects, and create or update issues and comments when you ask.',
    examples: ['리니어에서 이번 사이클 내 이슈 정리해줘', '이 버그로 리니어 이슈 만들어줘'],
    url: 'https://mcp.linear.app/mcp',
    unavailable: null,
  },
  {
    id: 'slack',
    label: 'Slack',
    covers: 'Channels, threads and messages',
    summary: 'Search and read Slack channels and threads, and send messages when you ask.',
    examples: ['슬랙 #release 채널 오늘 대화 요약해줘', '슬랙에서 결제 오류 얘기한 스레드 찾아줘'],
    // Slack 서버는 자동 등록을 받지 않는다. 다른 앱(Slack 공식 Claude Code 플러그인)의 OAuth 클라이언트를 허락 없이 빌려 쓰지 않는다.
    url: null,
    unavailable: "Slack's MCP server does not allow automatic sign-in; it needs an OAuth app registered for rauha, which is not ready yet.",
  },
  {
    id: 'figma',
    label: 'Figma',
    covers: 'Design files and frames',
    summary: 'Read Figma frames: layout, components, variables and screenshots, to explain a design or build the screen from it.',
    examples: ['이 피그마 프레임 링크 보고 화면 구조 설명해줘', '피그마 디자인에서 색상·간격 값 뽑아줘'],
    url: 'https://mcp.figma.com/mcp',
    unavailable: null,
  },
  {
    id: 'sentry',
    label: 'Sentry',
    covers: 'Errors, issues and traces',
    summary: 'Look up Sentry issues, error events and stack traces to find where a failure comes from.',
    examples: ['센트리에서 오늘 가장 많이 난 에러 알려줘', '센트리 이 이슈 링크 보고 원인 분석해줘'],
    url: 'https://mcp.sentry.dev/mcp',
    unavailable: null,
  },
  {
    id: 'github',
    label: 'GitHub',
    covers: 'Issues and pull requests',
    summary: 'Read and manage GitHub issues and pull requests.',
    examples: ['깃허브에 열린 이슈 목록 정리해줘'],
    url: null,
    unavailable: "GitHub's remote MCP server needs a personal access token or your own GitHub OAuth app; it does not allow automatic sign-in. Teammates already use git and the gh CLI in your project.",
  },
  {
    id: 'google',
    label: 'Google Docs · Sheets · Drive · Gmail · Calendar',
    covers: 'Docs, Sheets, Drive files, mail and calendar',
    summary: 'Read and write Google Docs and Sheets, find Drive files, and read mail and calendar events.',
    examples: ["이 쿼리 결과를 '주간 지표' 시트에 붙여줘", '내일 일정 알려줘'],
    url: null,
    unavailable: "Google's MCP servers are in Developer Preview: they need your organization's enrollment and your own Google Cloud OAuth client, and they do not allow automatic client registration, so one-click sign-in is not possible yet.",
  },
];

export class ConnectorPreset {
  private constructor(private readonly spec: PresetSpec) {}

  static all(): ConnectorPreset[] {
    return PRESETS.map((p) => new ConnectorPreset(p));
  }

  static of(id: string): ConnectorPreset {
    const spec = PRESETS.find((p) => p.id === id);
    if (spec === undefined) throw new DomainError('UNKNOWN_CONNECTOR', `모르는 커넥터입니다: ${id}`);
    return new ConnectorPreset(spec);
  }

  get id(): string {
    return this.spec.id;
  }
  get label(): string {
    return this.spec.label;
  }
  get covers(): string {
    return this.spec.covers;
  }
  get summary(): string {
    return this.spec.summary;
  }
  get examples(): readonly string[] {
    return this.spec.examples;
  }
  get url(): string | null {
    return this.spec.url;
  }
  get oauth(): ConnectorOAuth | null {
    return this.spec.oauth ?? null;
  }
  get unavailableReason(): string | null {
    return this.spec.unavailable;
  }

  isAvailable(): boolean {
    return this.spec.url !== null && this.spec.unavailable === null;
  }
}

/** 원격 MCP 주소. https만 받고(로컬 개발 서버는 http://localhost 허용), 사용자 정보·토큰 쿼리가 든 주소는 받지 않는다. */
export function checkConnectorUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DomainError('INVALID_CONNECTOR_URL', '주소를 읽을 수 없습니다.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new DomainError('INVALID_CONNECTOR_URL', 'https 주소만 연결할 수 있습니다.');
  if (url.username !== '' || url.password !== '') throw new DomainError('INVALID_CONNECTOR_URL', '주소에 아이디·비밀번호를 넣지 마세요. 로그인은 브라우저에서 합니다.');
  if ([...url.searchParams.keys()].some((k) => SECRET_QUERY.test(k))) throw new DomainError('INVALID_CONNECTOR_URL', '주소에 토큰·키를 넣지 마세요. 로그인은 브라우저에서 합니다.');
  url.hash = '';
  return url.href;
}

export interface ConnectorFields {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly preset: string | null;
}

export class Connector {
  private constructor(
    readonly serverName: string,
    readonly label: string,
    readonly url: string,
    /** 프리셋으로 더했으면 그 id, 사용자가 주소를 넣었으면 null */
    readonly preset: string | null,
  ) {}

  /** 저장된 값으로 되살린다. 저장 파일도 바깥 입력이라 같은 규칙으로 검사한다. */
  static restore(fields: ConnectorFields): Connector {
    if (!SERVER_NAME.test(fields.id)) throw new DomainError('INVALID_INPUT', `커넥터 이름이 올바르지 않습니다: ${fields.id}`);
    const preset = fields.preset === null ? null : ConnectorPreset.of(fields.preset);
    const url = preset?.url ?? checkConnectorUrl(fields.url);
    return new Connector(fields.id, cleanLabel(fields.label), url, preset?.id ?? null);
  }

  static fromPreset(preset: ConnectorPreset): Connector {
    if (!preset.isAvailable() || preset.url === null) throw new DomainError('CONNECTOR_UNAVAILABLE', preset.unavailableReason ?? `${preset.label}은(는) 아직 연결할 수 없습니다.`);
    return new Connector(preset.id, preset.label, preset.url, preset.id);
  }

  static custom(serverName: string, label: string, url: string): Connector {
    return new Connector(serverName, cleanLabel(label), checkConnectorUrl(url), null);
  }

  /** 프리셋이 정한 공개 OAuth 클라이언트(Slack). 없으면 null(Claude Code 가 자동 등록한다). */
  oauth(): ConnectorOAuth | null {
    return this.preset === null ? null : ConnectorPreset.of(this.preset).oauth;
  }

  toFields(): ConnectorFields {
    return { id: this.serverName, label: this.label, url: this.url, preset: this.preset };
  }
}

function cleanLabel(label: string): string {
  const text = label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
  if (text === '') throw new DomainError('INVALID_INPUT', '커넥터 이름이 비어 있습니다.');
  return text;
}

/** 이 PC(앱)에 더한 커넥터 목록. 서버 이름과 주소는 겹치지 않는다. */
export class ConnectorBook {
  private constructor(private readonly items: Connector[]) {}

  static empty(): ConnectorBook {
    return new ConnectorBook([]);
  }

  static of(items: readonly Connector[]): ConnectorBook {
    const book = ConnectorBook.empty();
    for (const item of items) book.push(item);
    return book;
  }

  list(): readonly Connector[] {
    return [...this.items];
  }

  find(serverName: string): Connector {
    const found = this.items.find((c) => c.serverName === serverName);
    if (found === undefined) throw new DomainError('UNKNOWN_CONNECTOR', `연결 목록에 없는 커넥터입니다: ${serverName}`);
    return found;
  }

  serverNames(): string[] {
    return this.items.map((c) => c.serverName);
  }

  addPreset(preset: ConnectorPreset): Connector {
    return this.push(Connector.fromPreset(preset));
  }

  addCustom(label: string, url: string): Connector {
    let n = 1;
    while (this.items.some((c) => c.serverName === `${CUSTOM_PREFIX}${n}`)) n += 1;
    return this.push(Connector.custom(`${CUSTOM_PREFIX}${n}`, label, url));
  }

  remove(serverName: string): Connector {
    const found = this.find(serverName);
    this.items.splice(this.items.indexOf(found), 1);
    return found;
  }

  private push(item: Connector): Connector {
    if (this.items.some((c) => c.serverName === item.serverName || c.url === item.url)) throw new DomainError('CONNECTOR_EXISTS', `${item.label}은(는) 이미 연결 목록에 있습니다.`);
    if (this.items.length >= MAX_CONNECTORS) throw new DomainError('TOO_MANY_CONNECTORS', `커넥터는 ${MAX_CONNECTORS}개까지 연결할 수 있습니다.`);
    this.items.push(item);
    return item;
  }
}

export type ConnectorAccess = 'read' | 'write';

/** 이 낱말이 하나라도 있으면 쓰기(바깥 문서를 바꾼다) */
const WRITE_WORDS = new Set([
  'create', 'update', 'edit', 'delete', 'remove', 'move', 'duplicate', 'add', 'transition', 'write', 'append', 'insert', 'set',
  'post', 'publish', 'archive', 'upload', 'share', 'rename', 'replace', 'assign', 'link', 'restore', 'trash', 'send', 'put', 'patch', 'clear', 'copy', 'import', 'merge', 'close', 'reopen',
]);
/** 쓰기 낱말이 없고 이 낱말이 있으면 읽기 */
const READ_WORDS = new Set(['get', 'search', 'fetch', 'list', 'read', 'lookup', 'query', 'find', 'view', 'info', 'describe', 'retrieve', 'download', 'export', 'whoami']);
/** 쓰기 카드에 보일 입력 미리보기 길이 */
const PREVIEW_CHARS = 160;

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w !== '');
}

/** 커넥터 서버의 도구 하나(mcp__<서버>__<도구>). 읽기는 그냥 쓰고, 쓰기는 사용자에게 묻는다. */
export class ConnectorTool {
  private constructor(
    readonly server: string,
    readonly name: string,
  ) {}

  /** 연결한 커넥터 서버의 도구가 아니면 null(브라우저·AWS 같은 다른 도구 묶음은 여기서 다루지 않는다) */
  static parse(tool: string, servers: readonly string[]): ConnectorTool | null {
    const match = /^mcp__([^_].*?)__(.+)$/.exec(tool);
    if (match === null || !servers.includes(match[1]!)) return null;
    return new ConnectorTool(match[1]!, match[2]!);
  }

  /** 읽기인지 알 수 없으면 쓰기로 본다(묻는 쪽이 안전하다) */
  access(): ConnectorAccess {
    const list = words(this.name);
    if (list.some((w) => WRITE_WORDS.has(w))) return 'write';
    return list.some((w) => READ_WORDS.has(w)) ? 'read' : 'write';
  }

  /** 지우기·옮기기·보관처럼 되돌리기 어려운 쓰기. 사용자가 쓰라고 시켰어도 묻는다. */
  isDestructive(): boolean {
    return words(this.name).some((w) => DESTRUCTIVE_WORDS.has(w));
  }

  /** 읽기는 그냥 쓴다. 쓰기는 사용자가 이번 요청에서 업무 도구에 쓰라고 시켰으면 그냥 하고(지우기·옮기기는 빼고), 아니면 묻는다. */
  verdict(input: Record<string, unknown>, intent: ConnectorWriteIntent = ConnectorWriteIntent.none()): ToolVerdict {
    if (this.access() === 'read') return { decision: 'allow', reason: null };
    if (intent.allowsWrite() && !this.isDestructive()) return { decision: 'allow', reason: '사용자가 요청에서 시킨 쓰기입니다.' };
    const preview = JSON.stringify(input).slice(0, PREVIEW_CHARS);
    return { decision: 'ask', reason: `${this.server}에 ${this.isDestructive() ? '지우기·옮기기' : '쓰기'} (${this.name}) ${preview}` };
  }
}

const DESTRUCTIVE_WORDS = new Set(['delete', 'remove', 'move', 'archive', 'trash', 'purge', 'clear', 'close']);

/** 업무 도구를 가리키는 말 */
const SERVICE = '노션|notion|컨플루언스|confluence|컨플|위키|wiki|지라|jira|리니어|linear|슬랙|slack|피그마|figma|센트리|sentry|시트|sheets?|스프레드\\s?시트|구글\\s?(?:독스|문서)|google\\s?docs?';
const SERVICE_WORD = new RegExp(SERVICE, 'i');
/** "노션에", "시트에", "채널에", "페이지로"처럼 쓸 곳을 가리키는 말("문서에서"는 읽는 곳이라 뺀다) */
const DESTINATION = new RegExp(`(?:${SERVICE}|페이지|채널|이슈|티켓|문서|데이터베이스|database|channel|page)\\s*(?:에다가?|에|으로|로)(?!서)|\\b(?:to|into|in)\\s+(?:the\\s+)?(?:${SERVICE})`, 'i');
/** 무엇을 만들지 가리키는 말(지라 "이슈", 노션 "페이지" …) */
const OBJECT = /이슈|페이지|문서|티켓|메시지|댓글|코멘트|카드|issue|page|ticket|message|comment/i;
/** 그 자체로 만들기·보내기인 동사 */
const STRONG_VERB = /만들어|생성|작성|올려|등록|보내|게시|create|post|send|publish|file\s+an?/i;
/** 쓸 곳이 함께 있어야 쓰기로 보는 동사("정리해줘"는 채팅에 정리하라는 뜻일 때가 많다) */
const WEAK_VERB = /정리|적어|써\s?줘|써\s?놔|추가|기록|남겨|업데이트|수정|바꿔|반영|붙여|write|add|update|append/i;
/** 하지 말라는 말이 하나라도 있으면 시킨 것으로 보지 않는다(묻는 쪽이 안전하다) */
const NEGATION = /지\s*(?:는|도)?\s*(?:마|말|않)|하지\s*마|금지|\bdon'?t\b|\bdo\s+not\b|\bnever\b|\bwithout\b/i;

/**
 * 사용자가 이번 요청에서 업무 도구(노션·컨플루언스·지라·슬랙 …)에 쓰라고 시켰는지. GitPublishIntent 와 같은 생각이다:
 * 시켰으면 팀원이 그대로 쓰고, 시키지 않았으면 허락 카드로 묻는다.
 */
export class ConnectorWriteIntent {
  private constructor(private readonly write: boolean) {}

  static none(): ConnectorWriteIntent {
    return new ConnectorWriteIntent(false);
  }

  static from(request: string): ConnectorWriteIntent {
    if (!SERVICE_WORD.test(request) || NEGATION.test(request)) return ConnectorWriteIntent.none();
    const strong = STRONG_VERB.test(request) && OBJECT.test(request);
    const toPlace = DESTINATION.test(request) && (STRONG_VERB.test(request) || WEAK_VERB.test(request));
    return new ConnectorWriteIntent(strong || toPlace);
  }

  allowsWrite(): boolean {
    return this.write;
  }
}
