import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { LocalTarget } from '../../shared/api-test.js';
import { sendPrepared } from './api-sender.js';
import type { AutoApiDeps } from './auto-api-check.js';
import { FsProjectReader } from './project-reader.js';
import { launchServer } from './server-launch.js';
import { probeServer } from './server-probe.js';

const TEST_TIMEOUT_MS = 15_000;
const TEXT_MAX = 256 * 1024;

/** 프로젝트 안의 작은 글 파일만(밖으로 나가는 경로·큰 파일은 null) */
async function readSmall(root: string, rel: string): Promise<string | null> {
  const base = resolve(root);
  const path = resolve(base, rel);
  if (path !== base && !path.startsWith(base + sep)) return null;
  try {
    if ((await stat(path)).size > TEXT_MAX) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 자동 API 점검의 바깥 부품(파일 읽기·서버 확인·이 컴퓨터로만 보내기·서버 띄우기)을 모은다.
 * 허락 묻기·팀 대화·모델 호출은 부르는 쪽(작업)이 넘긴다.
 */
export function autoApiDeps(o: { readonly ask: AutoApiDeps['ask']; readonly say: AutoApiDeps['say']; readonly plan: AutoApiDeps['plan']; readonly fixes: AutoApiDeps['fixes'] }): AutoApiDeps {
  const resolveHost = async (host: string): Promise<string[]> => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  return {
    reader: new FsProjectReader(),
    readText: readSmall,
    listRoot: async (root) => (await readdir(root).catch(() => [])).slice(0, 500),
    probe: (url) => probeServer(url),
    send: (prepared, signal) => sendPrepared(prepared, { signal, resolve: resolveHost, timeoutMs: TEST_TIMEOUT_MS, stayOn: (url) => LocalTarget.isLocal(url) }),
    plan: o.plan,
    fixes: o.fixes,
    launch: (root, how, baseUrl) => launchServer(root, how, baseUrl, (u) => probeServer(u)),
    ask: o.ask,
    say: o.say,
    newId: () => randomUUID().slice(0, 8),
    now: () => new Date(),
    platform: process.platform,
  };
}
