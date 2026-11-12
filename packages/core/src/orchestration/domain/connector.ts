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

interface PresetSpec {
  readonly id: string;
  readonly label: string;
  /** 화면에 보일 한 줄(무엇을 다루는지) */
  readonly covers: string;
  readonly url: string | null;
  /** 아직 버튼 하나로 연결할 수 없는 이유. 연결할 수 있으면 null */
  readonly unavailable: string | null;
}

const PRESETS: readonly PresetSpec[] = [
  { id: 'notion', label: 'Notion', covers: 'Pages and databases', url: 'https://mcp.notion.com/mcp', unavailable: null },
  { id: 'atlassian', label: 'Confluence · Jira', covers: 'Atlassian Confluence pages and Jira issues', url: 'https://mcp.atlassian.com/v2/mcp', unavailable: null },
  {
    id: 'google',
    label: 'Google Docs · Sheets · Drive',
    covers: 'Docs, Sheets and Drive files',
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
  get url(): string | null {
    return this.spec.url;
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

  verdict(input: Record<string, unknown>): ToolVerdict {
    if (this.access() === 'read') return { decision: 'allow', reason: null };
    const preview = JSON.stringify(input).slice(0, PREVIEW_CHARS);
    return { decision: 'ask', reason: `${this.server}에 쓰기 (${this.name}) ${preview}` };
  }
}
