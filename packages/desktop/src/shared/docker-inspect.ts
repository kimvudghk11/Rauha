import type { ContainerDetail } from './docker-api.js';

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/**
 * `docker inspect <id>` 출력(JSON 배열 하나)에서 화면에 보일 것만 추린다.
 * 환경 변수(Config.Env)는 비밀이 들어 있을 수 있어 읽지 않는다. 읽지 못하면 null.
 */
export function parseInspect(output: string): ContainerDetail | null {
  let root: unknown;
  try {
    root = JSON.parse(output);
  } catch {
    return null;
  }
  const c = Array.isArray(root) ? root[0] : root;
  if (!isObj(c) || text(c['Id']) === '') return null;
  const config = isObj(c['Config']) ? c['Config'] : {};
  const state = isObj(c['State']) ? c['State'] : {};
  const health = isObj(state['Health']) ? text(state['Health']['Status']) : '';
  const net = isObj(c['NetworkSettings']) ? c['NetworkSettings'] : {};
  const ports = isObj(net['Ports']) ? net['Ports'] : {};
  const networks = isObj(net['Networks']) ? net['Networks'] : {};
  const portLines: string[] = [];
  for (const [container, bindings] of Object.entries(ports)) {
    const hosts = list(bindings).filter(isObj);
    if (hosts.length === 0) portLines.push(container);
    for (const b of hosts) portLines.push(`${text(b['HostPort'])}→${container}`);
  }
  const mounts = list(c['Mounts']).filter(isObj).map((m) => `${text(m['Name']) || text(m['Source'])} → ${text(m['Destination'])}${m['RW'] === false ? ' (ro)' : ''}`);
  const command = [text(c['Path']), ...list(c['Args']).map(text)].filter((p) => p !== '').join(' ') || list(config['Cmd']).map(text).join(' ');
  const restarts = c['RestartCount'];
  return {
    id: text(c['Id']).slice(0, 12),
    name: text(c['Name']).replace(/^\//, ''),
    image: text(config['Image']),
    command,
    status: text(state['Status']),
    startedAt: text(state['StartedAt']).startsWith('0001-') ? '' : text(state['StartedAt']),
    restartCount: typeof restarts === 'number' && Number.isFinite(restarts) ? restarts : 0,
    health: health === '' ? null : health,
    ports: portLines,
    mounts,
    networks: Object.entries(networks).map(([name, v]) => (isObj(v) && text(v['IPAddress']) !== '' ? `${name} (${text(v['IPAddress'])})` : name)),
  };
}
