import { describe, expect, it } from 'vitest';
import { ConnectorBook, ConnectorBookDto } from '@rauha/core';
import type { ConnectorListView, SdkServerStatus } from '../../shared/connector-api.js';
import { ConnectorService, type ConnectorProbe } from './connector-service.js';

/** 가짜 Claude Code: 이름별 상태를 차례로 돌려주고, 로그인하면 열 주소를 준다. */
function fakeProbe(script: Record<string, SdkServerStatus[]>, authUrl: string | null = 'https://mcp.notion.com/authorize?state=x') {
  const calls: string[] = [];
  const opened: Record<string, unknown>[] = [];
  const probe = async (servers: Record<string, unknown>): Promise<ConnectorProbe> => {
    opened.push(servers);
    return {
      status: async (name) => {
        calls.push(`status:${name}`);
        const list = script[name] ?? ['missing'];
        return list.length > 1 ? list.shift()! : list[0]!;
      },
      authenticate: async (name) => {
        calls.push(`auth:${name}`);
        return { authUrl };
      },
      clearAuth: async (name) => {
        calls.push(`clear:${name}`);
      },
      close: () => calls.push('close'),
    };
  };
  return { probe, calls, opened };
}

function memoryStore(initial: ConnectorBook = ConnectorBook.empty()) {
  let file: unknown = ConnectorBookDto.fromEntity(initial).toFile();
  return {
    load: async () => ConnectorBookDto.from(file).toEntity(),
    save: async (book: ConnectorBook) => {
      file = ConnectorBookDto.fromEntity(book).toFile();
    },
    file: () => file,
  };
}

function service(script: Record<string, SdkServerStatus[]>, authUrl?: string | null) {
  const fake = fakeProbe(script, authUrl);
  const store = memoryStore();
  const browser: string[] = [];
  const views: ConnectorListView[] = [];
  const svc = new ConnectorService({ store, openProbe: fake.probe, openExternal: async (url) => void browser.push(url), notify: (v) => void views.push(v), pollMs: 1, timeoutMs: 500 });
  return { svc, fake, store, browser, views };
}

describe('ConnectorService', () => {
  it('프리셋 목록에 노션·컨플루언스·Linear·Figma·Sentry 는 연결 가능, Slack·GitHub·Google 은 준비 중으로 보인다', async () => {
    const { svc } = service({});
    const view = await svc.list();
    expect(view.presets.map((p) => [p.id, p.unavailable === null])).toEqual([
      ['notion', true],
      ['atlassian', true],
      ['linear', true],
      ['slack', false],
      ['figma', true],
      ['sentry', true],
      ['github', false],
      ['google', false],
    ]);
  });

  it('연결 안 된 프리셋에도 업무 설명과 예시 요청이 보인다', async () => {
    const { svc } = service({});
    const notion = (await svc.list()).presets.find((p) => p.id === 'notion')!;
    expect(notion.summary).toMatch(/Notion/);
    expect(notion.examples[0]).toMatch(/노션/);
  });

  it('노션을 더하면 로그인이 필요할 때 시스템 브라우저로 로그인 주소를 열고, 끝나면 연결됨이 된다', async () => {
    const { svc, fake, browser, store } = service({ notion: ['pending', 'needs-auth', 'needs-auth', 'connected'] });
    const reply = await svc.addPreset('notion');
    expect(reply.ok).toBe(true);
    await svc.settled('notion');
    expect(browser).toEqual(['https://mcp.notion.com/authorize?state=x']);
    expect(fake.calls).toContain('auth:notion');
    expect(fake.calls[fake.calls.length - 1]).toBe('close');
    expect((await svc.list()).connectors).toEqual([{ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', preset: 'notion', status: 'connected', note: null }]);
    expect(JSON.stringify(store.file())).not.toMatch(/token/i);
  });

  it('로그인 서버와 팀원 실행이 같은 서버 설정(이름·주소)을 쓴다', async () => {
    const { svc, fake } = service({ notion: ['connected'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    expect(fake.opened[0]).toEqual({ notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } });
  });

  it('이미 로그인돼 있으면 브라우저를 열지 않는다', async () => {
    const { svc, browser } = service({ notion: ['connected'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    expect(browser).toEqual([]);
  });

  it('https 가 아닌 로그인 주소는 열지 않고 실패로 둔다', async () => {
    const { svc, browser } = service({ notion: ['needs-auth'] }, 'javascript:alert(1)');
    await svc.addPreset('notion');
    await svc.settled('notion');
    expect(browser).toEqual([]);
    expect((await svc.list()).connectors[0]!.status).toBe('failed');
  });

  it('제한 시간 안에 로그인을 끝내지 않으면 로그인 필요로 돌아간다', async () => {
    const { svc } = service({ notion: ['needs-auth'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    const row = (await svc.list()).connectors[0]!;
    expect(row.status).toBe('needs-auth');
    expect(row.note).toMatch(/sign-in/i);
  });

  it('준비 중인 Google 은 더할 수 없고 이유를 돌려준다', async () => {
    const { svc } = service({});
    const reply = await svc.addPreset('google');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error).toMatch(/Google/);
  });

  it('사용자 정의 주소도 더할 수 있고, 잘못된 주소는 거절한다', async () => {
    const { svc } = service({ custom1: ['connected'] });
    expect((await svc.addCustom({ label: 'Linear', url: 'https://mcp.linear.app/mcp' })).ok).toBe(true);
    expect((await svc.addCustom({ label: 'x', url: 'http://plain.example.com' })).ok).toBe(false);
    expect((await svc.addCustom('nope')).ok).toBe(false);
  });

  it('빼면 Claude Code 에 저장된 로그인도 지우고 목록에서 뺀다', async () => {
    const { svc, fake } = service({ notion: ['connected'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    const reply = await svc.remove('notion');
    expect(reply.ok).toBe(true);
    expect(fake.calls).toContain('clear:notion');
    expect((await svc.list()).connectors).toEqual([]);
  });

  it('팀원 실행에는 연결된 커넥터만 붙인다', async () => {
    const { svc } = service({ notion: ['connected'], atlassian: ['needs-auth'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    await svc.addPreset('atlassian');
    await svc.settled('atlassian');
    expect(svc.servers().names).toEqual(['notion']);
  });

  it('새로 고치면 모든 연결의 상태를 다시 읽는다', async () => {
    const { svc } = service({ notion: ['connected', 'failed'] });
    await svc.addPreset('notion');
    await svc.settled('notion');
    const view = await svc.refresh();
    expect(view.connectors[0]!.status).toBe('failed');
  });
});
