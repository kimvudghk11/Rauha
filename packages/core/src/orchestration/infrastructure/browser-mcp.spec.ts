import { describe, expect, it } from 'vitest';
import { BROWSER_TOOLS, browserChannel, browserMcpServer } from './browser-mcp.js';

describe('browserChannel', () => {
  it('RAUHA_BROWSER로 정한 브라우저를 먼저 쓴다', () => {
    expect(browserChannel({ RAUHA_BROWSER: 'msedge' }, 'win32', () => true)).toBe('msedge');
  });

  it('설치된 Chrome을 쓰고, 없으면 Edge를 쓴다', () => {
    expect(browserChannel({}, 'win32', () => true)).toBe('chrome');
    expect(browserChannel({}, 'win32', (path) => path.includes('Edge'))).toBe('msedge');
    expect(browserChannel({}, 'darwin', (path) => path.includes('Google Chrome'))).toBe('chrome');
  });

  it('둘 다 없으면 정하지 않는다 (Playwright 기본값)', () => {
    expect(browserChannel({}, 'linux', () => false)).toBeNull();
  });
});

describe('browserMcpServer', () => {
  it('사용자 화면을 가리지 않게 창 없이, 다른 실행과 겹치지 않게 프로필은 메모리에 띄우고 작업 폴더에 파일을 남기지 않는다', () => {
    const server = browserMcpServer({ channel: 'chrome', outputDir: 'C:/tmp/rauha-browser', cli: 'E:/cli.js', node: 'node' });
    expect(server).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['E:/cli.js', '--headless', '--isolated', '--output-dir', 'C:/tmp/rauha-browser', '--browser', 'chrome'],
    });
  });

  it('위험한 도구(코드 실행·파일 올리기)는 허락 목록에 없다', () => {
    expect(BROWSER_TOOLS).toContain('mcp__browser__browser_navigate');
    expect(BROWSER_TOOLS).toContain('mcp__browser__browser_snapshot');
    expect(BROWSER_TOOLS.some((t) => /run_code|evaluate|file_upload/.test(t))).toBe(false);
  });

  it('Electron 앱에서는 node 자리 실행 파일이 node처럼 돌도록 환경 변수를 켠다', () => {
    const server = browserMcpServer({ channel: null, outputDir: '/o', cli: '/c.js', node: '/app/electron', runAsNode: true });
    expect(server).toMatchObject({ env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(browserMcpServer({ channel: null, outputDir: '/o', cli: '/c.js', node: 'node' })).not.toHaveProperty('env');
  });
});
