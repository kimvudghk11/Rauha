import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const preload = readFileSync(join(__dirname, '..', 'preload', 'preload.ts'), 'utf8') + readFileSync(join(__dirname, '..', 'preload', 'usage-bridge.ts'), 'utf8');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });

describe('창 설정과 이동 제한(main.ts 소스 검사)', () => {
  it('화면은 격리·샌드박스·노드 끔이고 보안을 낮추는 옵션이 없다', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
    for (const bad of [/webSecurity:\s*false/, /allowRunningInsecureContent/, /nodeIntegrationInSubFrames:\s*true/, /nodeIntegrationInWorker:\s*true/, /webviewTag:\s*true/, /enableRemoteModule/, /contextIsolation:\s*false/, /sandbox:\s*false/, /--no-sandbox/, /disable-web-security/]) {
      expect(main).not.toMatch(bad);
    }
  });
  it('새 창 열기·이동·리다이렉트·웹뷰 붙이기를 막고 권한 요청·확인은 모두 거절한다', () => {
    expect(main).toContain('setWindowOpenHandler');
    expect(main).toContain("action: 'deny'");
    expect(main).toContain("'will-navigate'");
    expect(main).toContain("'will-redirect'");
    expect(main).toContain("'will-attach-webview'");
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toContain('setPermissionCheckHandler');
  });
  it('바깥 링크는 openExternal 에 넘기기 전에 externalUrlOf 로 다듬은 주소만 연다', () => {
    const calls = [...main.matchAll(/shell\.openExternal\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['safe']);
    expect(main).toContain('externalUrlOf(');
  });
  it('모든 IPC 처리기는 보낸 곳을 확인하는 감싸기를 거친다', () => {
    expect(main).toContain('guardIpcMain(ipcMain');
    // 감싸기가 첫 handle 등록보다 앞에 있어야 한다
    expect(main.indexOf('guardIpcMain(ipcMain')).toBeLessThan(main.indexOf('ipcMain.handle('));
  });
});

describe('preload ↔ main 채널 짝', () => {
  const keys = (text: string, re: RegExp): Set<string> => new Set([...text.matchAll(re)].map((m) => `${m[1]}.${m[2]}`));
  const mainSources = walk(join(__dirname))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const used = keys(preload, /ipcRenderer\.(?:invoke|send)\(\s*([A-Z_]+)\.(\w+)/g);
  const handled = keys(mainSources, /\.(?:handle|on)\(\s*([A-Z_]+)\.(\w+)/g);

  it('preload 가 부르는 채널은 모두 main 에 받는 곳이 있다', () => {
    expect([...used].filter((k) => !handled.has(k))).toEqual([]);
  });
  it('main 이 받는 채널은 모두 preload 의 좁은 함수가 쓴다(받기만 하고 화면에서 못 쓰는 채널 없음)', () => {
    expect([...handled].filter((k) => !used.has(k))).toEqual([]);
  });
  it('preload 는 ipcRenderer 자체나 임의 채널 호출 함수를 화면에 내놓지 않는다', () => {
    expect(preload).not.toMatch(/exposeInMainWorld\(\s*['"][^'"]+['"]\s*,\s*ipcRenderer/);
    expect(preload).not.toMatch(/invoke:\s*\(?\s*channel/);
    expect(preload).not.toMatch(/ipcRenderer\.(invoke|send|on)\(\s*(channel|name)\s*[,)]/);
    expect(preload).not.toMatch(/require\(/);
  });
});
