/**
 * docker CLI 출력(`--format '{{json .}}'`)을 값 객체로 읽는다. 깨진 줄·모르는 필드·빠진 필드는 건너뛰거나 기본값으로 둔다.
 * 화면으로는 toView()의 일반 객체만 넘어간다(IPC는 클래스를 옮기지 못한다).
 */

type Rec = Readonly<Record<string, unknown>>;

const str = (r: Rec, key: string): string => {
  const v = r[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};

/** 줄마다 JSON 한 개(docker ps/images/volume/network)이거나 JSON 배열 하나(docker compose ls/ps)인 출력을 읽는다. 깨진 줄은 센다. */
export function parseRecords(text: string): { readonly rows: readonly Rec[]; readonly skipped: number } {
  const t = text.trim();
  if (t === '') return { rows: [], skipped: 0 };
  const rows: Rec[] = [];
  let skipped = 0;
  const take = (v: unknown): void => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) rows.push(v as Rec);
    else skipped++;
  };
  if (t.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(t);
      if (Array.isArray(arr)) arr.forEach(take);
      else skipped++;
      return { rows, skipped };
    } catch {
      return { rows: [], skipped: 1 };
    }
  }
  for (const line of t.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      take(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

// ── 상태 ──

export type ContainerState = 'running' | 'unhealthy' | 'paused' | 'restarting' | 'exited' | 'created' | 'other';

/** `State`(running/exited…)와 `Status`("Up 2 hours (unhealthy)")를 함께 보고 하나로 가른다. */
export function classifyState(state: string, status: string): ContainerState {
  const s = state.trim().toLowerCase();
  const st = status.trim().toLowerCase();
  if (s === 'paused' || st.includes('(paused)')) return 'paused';
  if (s === 'restarting' || st.startsWith('restarting')) return 'restarting';
  if (s === 'running' || (s === '' && st.startsWith('up'))) return st.includes('(unhealthy)') ? 'unhealthy' : 'running';
  if (s === 'exited' || s === 'dead' || (s === '' && st.startsWith('exited'))) return 'exited';
  if (s === 'created') return 'created';
  return 'other';
}

export const STATE_LABEL: Readonly<Record<ContainerState, string>> = {
  running: 'Running',
  unhealthy: 'Unhealthy',
  paused: 'Paused',
  restarting: 'Restarting',
  exited: 'Exited',
  created: 'Created',
  other: 'Other',
};

/** 칩 색(ui.css chip 이름) */
export function stateTone(state: ContainerState): 'green' | 'yellow' | 'red' | 'blue' | '' {
  switch (state) {
    case 'running':
      return 'green';
    case 'unhealthy':
      return 'red';
    case 'paused':
    case 'restarting':
      return 'yellow';
    case 'created':
      return 'blue';
    default:
      return '';
  }
}

// ── 포트 ──

export interface PortMapping {
  /** 내보내는 쪽 "주소:포트" 또는 "포트". 밖으로 열리지 않았으면 null */
  readonly host: string | null;
  readonly container: string;
  readonly proto: string;
}

/**
 * "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 5432/tcp" 를 읽는다.
 * IPv6로 같은 포트를 또 여는 줄은 한 개로 합치고, 모르는 모양의 조각은 버린다.
 */
export function parsePorts(text: string): readonly PortMapping[] {
  const out: PortMapping[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const piece = raw.trim();
    if (piece === '') continue;
    const m = /^(?:(.*):)?(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(\w+)$/.exec(piece);
    const bare = /^(\d+(?:-\d+)?)\/(\w+)$/.exec(piece);
    let port: PortMapping;
    if (m !== null) {
      const ip = m[1] ?? '';
      const open = ip === '' || ip === '0.0.0.0' || ip.startsWith('[') || ip.includes(':');
      port = { host: open ? m[2]! : `${ip}:${m[2]!}`, container: m[3]!, proto: m[4]! };
      const key = `${port.host}>${port.container}/${port.proto}`;
      if (seen.has(key)) continue;
      seen.add(key);
    } else if (bare !== null) port = { host: null, container: bare[1]!, proto: bare[2]! };
    else continue;
    out.push(port);
  }
  return out;
}

/** "8080→80/tcp" 처럼 한 포트를 한 줄로. 밖으로 열리지 않으면 "80/tcp". */
export function portLabel(p: PortMapping): string {
  return p.host === null ? `${p.container}/${p.proto}` : `${p.host}→${p.container}/${p.proto}`;
}

// ── 크기·시간 ──

const UNITS: Readonly<Record<string, number>> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** "1.23GB"·"512kB"·"0B" → 바이트. 읽지 못하면 null. */
export function parseSize(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b)\s*$/i.exec(text);
  if (m === null) return null;
  const unit = UNITS[m[2]!.toLowerCase()];
  return unit === undefined ? null : Math.round(Number(m[1]) * unit);
}

/** 바이트를 "1.2 GB" 처럼(10진 단위, docker 와 같은 표기). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const steps = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < steps.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${steps[i]}`;
}

/** "2024-05-01 10:00:00 +0900 KST" 또는 RFC3339 → 초 단위 시각. 읽지 못하면 null. */
export function parseCreatedAt(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?/.exec(t);
  const iso = m === null ? t : `${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** "5m ago" 같은 짧은 표시. 미래이거나 모르면 "-". */
export function agoLabel(atSec: number | null, nowSec: number): string {
  if (atSec === null) return '-';
  const d = nowSec - atSec;
  if (d < 0) return '-';
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo ago`;
  return `${Math.floor(d / (86400 * 365))}y ago`;
}

// ── 컨테이너 ──

export interface ContainerView {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: ContainerState;
  /** docker 가 쓴 그대로의 상태 글("Up 2 hours") */
  readonly status: string;
  readonly ports: readonly string[];
  readonly createdAt: number | null;
  /** compose 로 만든 컨테이너면 프로젝트 이름 */
  readonly project: string | null;
  readonly canStart: boolean;
  readonly canStop: boolean;
}

function labelOf(labels: string, key: string): string | null {
  for (const part of labels.split(',')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === key) return part.slice(i + 1) || null;
  }
  return null;
}

export class ContainerInfo {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly image: string,
    readonly state: ContainerState,
    readonly status: string,
    readonly ports: readonly PortMapping[],
    readonly createdAt: number | null,
    readonly project: string | null,
  ) {}

  /** `docker ps -a --format '{{json .}}'` 한 줄. ID 가 없으면 null. */
  static from(r: Rec): ContainerInfo | null {
    const id = str(r, 'ID');
    if (id === '') return null;
    const name = str(r, 'Names').split(',')[0]!.trim();
    const status = str(r, 'Status');
    return new ContainerInfo(id, name === '' ? id : name, str(r, 'Image'), classifyState(str(r, 'State'), status), status, parsePorts(str(r, 'Ports')), parseCreatedAt(str(r, 'CreatedAt')), labelOf(str(r, 'Labels'), 'com.docker.compose.project'));
  }

  /** 켜져 있는 것(멈추거나 재시작할 수 있다) */
  isUp(): boolean {
    return this.state === 'running' || this.state === 'unhealthy' || this.state === 'restarting' || this.state === 'paused';
  }
  canStart(): boolean {
    return !this.isUp();
  }
  canStop(): boolean {
    return this.isUp();
  }

  toView(): ContainerView {
    return { id: this.id, name: this.name, image: this.image, state: this.state, status: this.status, ports: this.ports.map(portLabel), createdAt: this.createdAt, project: this.project, canStart: this.canStart(), canStop: this.canStop() };
  }
}

/** 상태 거르기 칩 */
export type StateFilter = 'all' | 'running' | 'stopped' | 'problem';

/** 검색어(이름·이미지·ID·포트)와 상태 거르기가 이 컨테이너에 맞는지 */
export function containerMatches(c: ContainerView, query: string, filter: StateFilter): boolean {
  if (filter === 'running' && !(c.state === 'running' || c.state === 'unhealthy')) return false;
  if (filter === 'stopped' && c.state !== 'exited' && c.state !== 'created') return false;
  if (filter === 'problem' && c.state !== 'unhealthy' && c.state !== 'restarting') return false;
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [c.name, c.image, c.id, c.project ?? '', ...c.ports].some((s) => s.toLowerCase().includes(q));
}

// ── 이미지 ──

export interface ImageView {
  readonly id: string;
  readonly repository: string;
  readonly tag: string;
  /** 지우거나 pull 할 때 쓰는 이름("repo:tag", 이름이 없으면 ID) */
  readonly ref: string;
  readonly size: string;
  readonly sizeBytes: number | null;
  readonly createdAt: number | null;
  readonly inUse: boolean;
}

export class ImageInfo {
  private constructor(
    readonly id: string,
    readonly repository: string,
    readonly tag: string,
    readonly size: string,
    readonly createdAt: number | null,
  ) {}

  static from(r: Rec): ImageInfo | null {
    const id = str(r, 'ID');
    if (id === '') return null;
    const clean = (v: string): string => (v === '<none>' ? '' : v);
    return new ImageInfo(id, clean(str(r, 'Repository')), clean(str(r, 'Tag')), str(r, 'Size'), parseCreatedAt(str(r, 'CreatedAt')));
  }

  get ref(): string {
    return this.repository === '' ? this.id : this.tag === '' ? this.repository : `${this.repository}:${this.tag}`;
  }

  /** 컨테이너 중 하나라도 이 이미지(이름 또는 ID 앞부분)로 만들어졌는가 */
  isUsedBy(containers: readonly { readonly image: string }[]): boolean {
    const ids = [this.id, `sha256:${this.id}`];
    return containers.some((c) => c.image !== '' && (c.image === this.ref || (this.tag === 'latest' && c.image === this.repository) || ids.some((i) => i.startsWith(c.image) || c.image.startsWith(i))));
  }

  toView(containers: readonly { readonly image: string }[]): ImageView {
    return { id: this.id, repository: this.repository, tag: this.tag, ref: this.ref, size: this.size, sizeBytes: parseSize(this.size), createdAt: this.createdAt, inUse: this.isUsedBy(containers) };
  }
}

// ── 볼륨·네트워크 ──

export interface VolumeView {
  readonly name: string;
  readonly driver: string;
  readonly mountpoint: string;
}
export interface NetworkView {
  readonly id: string;
  readonly name: string;
  readonly driver: string;
  readonly scope: string;
  /** docker 가 기본으로 만들어 두는 네트워크(bridge·host·none)는 지울 수 없다 */
  readonly builtin: boolean;
}

export const VolumeInfo = {
  from(r: Rec): VolumeView | null {
    const name = str(r, 'Name');
    return name === '' ? null : { name, driver: str(r, 'Driver'), mountpoint: str(r, 'Mountpoint') };
  },
};
export const NetworkInfo = {
  from(r: Rec): NetworkView | null {
    const name = str(r, 'Name');
    if (name === '') return null;
    return { id: str(r, 'ID'), name, driver: str(r, 'Driver'), scope: str(r, 'Scope'), builtin: name === 'bridge' || name === 'host' || name === 'none' };
  },
};

// ── compose ──

export interface ComposeProjectView {
  readonly name: string;
  /** "running(2)" 같은 docker 의 상태 글 */
  readonly status: string;
  readonly running: boolean;
  readonly files: readonly string[];
}
export interface ComposeServiceView {
  readonly name: string;
  readonly service: string;
  readonly state: ContainerState;
  readonly status: string;
  readonly image: string;
}

export const ComposeInfo = {
  /** `docker compose ls --all --format json` 한 항목 */
  project(r: Rec): ComposeProjectView | null {
    const name = str(r, 'Name');
    if (name === '') return null;
    const status = str(r, 'Status');
    return { name, status, running: /running/i.test(status), files: str(r, 'ConfigFiles').split(',').map((f) => f.trim()).filter((f) => f !== '') };
  },
  /** `docker compose ps --format json` 한 항목 */
  service(r: Rec): ComposeServiceView | null {
    const name = str(r, 'Name');
    if (name === '') return null;
    return { name, service: str(r, 'Service'), state: classifyState(str(r, 'State'), str(r, 'Status')), status: str(r, 'Status'), image: str(r, 'Image') };
  },
};

/** 한 번에 읽는 목록 결과 */
export interface Parsed<T> {
  readonly items: readonly T[];
  readonly skipped: number;
}

function parseWith<T>(text: string, one: (r: Rec) => T | null): Parsed<T> {
  const { rows, skipped } = parseRecords(text);
  const items: T[] = [];
  let bad = skipped;
  for (const r of rows) {
    const v = one(r);
    if (v === null) bad++;
    else items.push(v);
  }
  return { items, skipped: bad };
}

export const parseContainers = (text: string): Parsed<ContainerInfo> => parseWith(text, (r) => ContainerInfo.from(r));
export const parseImages = (text: string): Parsed<ImageInfo> => parseWith(text, (r) => ImageInfo.from(r));
export const parseVolumes = (text: string): Parsed<VolumeView> => parseWith(text, (r) => VolumeInfo.from(r));
export const parseNetworks = (text: string): Parsed<NetworkView> => parseWith(text, (r) => NetworkInfo.from(r));
export const parseComposeProjects = (text: string): Parsed<ComposeProjectView> => parseWith(text, (r) => ComposeInfo.project(r));
export const parseComposeServices = (text: string): Parsed<ComposeServiceView> => parseWith(text, (r) => ComposeInfo.service(r));
