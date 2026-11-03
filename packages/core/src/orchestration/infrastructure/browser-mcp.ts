import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

/** SDK에 붙이는 MCP 서버 이름. 도구 이름이 mcp__browser__<도구>가 된다. */
export const BROWSER_SERVER = 'browser';
export const BROWSER_TOOL_PREFIX = `mcp__${BROWSER_SERVER}__`;

/**
 * 팀원이 쓸 수 있는 브라우저 도구. 페이지를 열고 읽고 눌러 보는 것까지만 허락한다.
 * 페이지에서 임의 코드를 돌리는 도구(browser_evaluate, browser_run_code_unsafe)와 파일 올리기는 뺐다.
 */
export const BROWSER_TOOLS: readonly string[] = [
  'navigate', 'navigate_back', 'snapshot', 'take_screenshot', 'click', 'type', 'press_key', 'hover', 'select_option',
  'fill_form', 'wait_for', 'tabs', 'resize', 'console_messages', 'network_requests', 'network_request', 'handle_dialog', 'close',
].map((name) => `${BROWSER_TOOL_PREFIX}browser_${name}`);

const INSTALLED: Readonly<Record<string, readonly { channel: string; path: string }[]>> = {
  win32: [
    { channel: 'chrome', path: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    { channel: 'chrome', path: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' },
    { channel: 'msedge', path: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
    { channel: 'msedge', path: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe' },
  ],
  darwin: [
    { channel: 'chrome', path: '/Applications/Google Chrome.app' },
    { channel: 'msedge', path: '/Applications/Microsoft Edge.app' },
  ],
  linux: [
    { channel: 'chrome', path: '/opt/google/chrome/chrome' },
    { channel: 'msedge', path: '/opt/microsoft/msedge/msedge' },
  ],
};

/** 쓸 브라우저. RAUHA_BROWSER가 있으면 그것, 아니면 설치된 Chrome, 그다음 Edge. 둘 다 없으면 null(Playwright 기본값). */
export function browserChannel(env: Record<string, string | undefined>, platform: string, exists: (path: string) => boolean = existsSync): string | null {
  const chosen = env['RAUHA_BROWSER']?.trim();
  if (chosen) return chosen;
  return (INSTALLED[platform] ?? []).find((b) => exists(b.path))?.channel ?? null;
}

export interface BrowserServerOptions {
  readonly channel: string | null;
  /** 화면 기록(.yml)·스크린샷을 둘 곳. 기본값은 작업 폴더라 사용자 저장소를 더럽힌다. */
  readonly outputDir: string;
  readonly cli: string;
  readonly node: string;
}

/**
 * Playwright MCP 서버 설정. 창을 띄우지 않고(사용자 화면을 가리지 않게),
 * 프로필은 메모리에만 둔다(동시에 도는 팀원이나 사용자의 브라우저와 프로필이 겹치지 않게).
 */
export function browserMcpServer(options: BrowserServerOptions): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: options.node,
    args: [options.cli, '--headless', '--isolated', '--output-dir', options.outputDir, ...(options.channel !== null ? ['--browser', options.channel] : [])],
  };
}

/** 이 PC에서 쓸 브라우저 서버. 패키지는 cli.js를 내보내지 않아서 package.json 옆에서 찾는다. */
export function localBrowserServer(env: Record<string, string | undefined>): McpStdioServerConfig {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  return browserMcpServer({ channel: browserChannel(env, process.platform), outputDir: join(tmpdir(), 'rauha-browser'), cli, node: process.execPath });
}
