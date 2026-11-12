import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Connector, ConnectorBook, ConnectorPreset, ConnectorTool, ConnectorWriteIntent } from './connector.js';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
};

describe('ConnectorPreset', () => {
  it('노션·컨플루언스(Atlassian)는 공식 원격 MCP 주소로 바로 연결할 수 있다', () => {
    expect(ConnectorPreset.of('notion').url).toBe('https://mcp.notion.com/mcp');
    expect(ConnectorPreset.of('notion').isAvailable()).toBe(true);
    expect(ConnectorPreset.of('atlassian').url).toBe('https://mcp.atlassian.com/v2/mcp');
    expect(ConnectorPreset.of('atlassian').isAvailable()).toBe(true);
  });

  it('Google(Docs·Sheets·Drive)은 준비 중이고 이유를 말한다', () => {
    const google = ConnectorPreset.of('google');
    expect(google.isAvailable()).toBe(false);
    expect(google.unavailableReason).toMatch(/Google/);
  });

  it('모르는 프리셋은 거절한다', () => {
    expect(code(() => ConnectorPreset.of('dropbox'))).toBe('UNKNOWN_CONNECTOR');
  });
});

describe('ConnectorBook', () => {
  it('프리셋을 연결 목록에 더하면 프리셋 이름이 MCP 서버 이름이 된다', () => {
    const book = ConnectorBook.empty();
    const notion = book.addPreset(ConnectorPreset.of('notion'));
    expect(notion.serverName).toBe('notion');
    expect(book.serverNames()).toEqual(['notion']);
  });

  it('같은 프리셋을 두 번 더하지 않는다', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    expect(code(() => book.addPreset(ConnectorPreset.of('notion')))).toBe('CONNECTOR_EXISTS');
  });

  it('준비 중인 프리셋은 더할 수 없다', () => {
    expect(code(() => ConnectorBook.empty().addPreset(ConnectorPreset.of('google')))).toBe('CONNECTOR_UNAVAILABLE');
  });

  it('사용자 정의 원격 MCP는 https 주소만 받고 차례로 custom1, custom2 이름을 붙인다', () => {
    const book = ConnectorBook.empty();
    expect(book.addCustom('사내 위키', 'https://mcp.example.com/mcp').serverName).toBe('custom1');
    expect(book.addCustom('Linear', 'https://mcp.linear.app/mcp').serverName).toBe('custom2');
    expect(code(() => book.addCustom('평문', 'http://mcp.example.com/mcp'))).toBe('INVALID_CONNECTOR_URL');
    expect(code(() => book.addCustom('파일', 'file:///etc/passwd'))).toBe('INVALID_CONNECTOR_URL');
  });

  it('주소에 비밀(사용자 정보·토큰 쿼리)이 들어 있으면 저장하지 않는다', () => {
    const book = ConnectorBook.empty();
    expect(code(() => book.addCustom('a', 'https://user:pw@mcp.example.com/mcp'))).toBe('INVALID_CONNECTOR_URL');
    expect(code(() => book.addCustom('b', 'https://mcp.example.com/mcp?access_token=abc'))).toBe('INVALID_CONNECTOR_URL');
    expect(code(() => book.addCustom('c', 'https://mcp.example.com/mcp?api_key=abc'))).toBe('INVALID_CONNECTOR_URL');
  });

  it('같은 주소는 두 번 더하지 않는다', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    expect(code(() => book.addCustom('노션2', 'https://mcp.notion.com/mcp'))).toBe('CONNECTOR_EXISTS');
  });

  it('빼면 목록에서 사라지고, 없는 것을 빼면 거절한다', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    book.remove('notion');
    expect(book.list()).toEqual([]);
    expect(code(() => book.remove('notion'))).toBe('UNKNOWN_CONNECTOR');
  });

  it('저장된 목록으로 되살릴 때 서버 이름이 겹치면 거절한다', () => {
    const a = Connector.restore({ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', preset: 'notion' });
    expect(code(() => ConnectorBook.of([a, a]))).toBe('CONNECTOR_EXISTS');
  });

  it('연결은 12개까지다', () => {
    const book = ConnectorBook.empty();
    for (let i = 0; i < 12; i += 1) book.addCustom(`c${i}`, `https://mcp${i}.example.com/mcp`);
    expect(code(() => book.addCustom('more', 'https://more.example.com/mcp'))).toBe('TOO_MANY_CONNECTORS');
  });
});

describe('ConnectorTool', () => {
  const servers = ['notion', 'atlassian'];
  const access = (tool: string) => ConnectorTool.parse(tool, servers)?.access() ?? null;

  it('연결한 서버의 도구만 커넥터 도구로 본다', () => {
    expect(ConnectorTool.parse('mcp__aws__aws___search_documentation', servers)).toBeNull();
    expect(ConnectorTool.parse('Read', servers)).toBeNull();
    expect(ConnectorTool.parse('mcp__notion__notion-search', servers)?.server).toBe('notion');
  });

  it('읽기(검색·가져오기·목록·조회)는 묻지 않는다', () => {
    expect(access('mcp__notion__notion-search')).toBe('read');
    expect(access('mcp__notion__notion-fetch')).toBe('read');
    expect(access('mcp__notion__notion-get-comments')).toBe('read');
    expect(access('mcp__atlassian__getConfluencePage')).toBe('read');
    expect(access('mcp__atlassian__searchConfluenceUsingCql')).toBe('read');
    expect(access('mcp__atlassian__atlassianUserInfo')).toBe('read');
    expect(access('mcp__atlassian__getAccessibleAtlassianResources')).toBe('read');
  });

  it('쓰기(만들기·고치기·지우기·옮기기·댓글 달기)는 쓰기로 본다', () => {
    expect(access('mcp__notion__notion-create-pages')).toBe('write');
    expect(access('mcp__notion__notion-update-page')).toBe('write');
    expect(access('mcp__notion__notion-move-pages')).toBe('write');
    expect(access('mcp__notion__notion-create-comment')).toBe('write');
    expect(access('mcp__atlassian__createConfluencePage')).toBe('write');
    expect(access('mcp__atlassian__updateConfluencePage')).toBe('write');
    expect(access('mcp__atlassian__transitionJiraIssue')).toBe('write');
    expect(access('mcp__atlassian__addCommentToJiraIssue')).toBe('write');
  });

  it('읽기인지 알 수 없는 도구는 쓰기로 보고 묻는다', () => {
    expect(access('mcp__notion__notion-sync')).toBe('write');
  });

  it('쓰기 도구는 허락 카드로 묻고, 읽기 도구는 그대로 둔다', () => {
    expect(ConnectorTool.parse('mcp__notion__notion-search', servers)?.verdict({ query: 'x' }).decision).toBe('allow');
    const verdict = ConnectorTool.parse('mcp__notion__notion-create-pages', servers)!.verdict({ title: '회의록' });
    expect(verdict.decision).toBe('ask');
    expect(verdict.reason).toContain('notion');
    expect(verdict.reason).toContain('회의록');
  });
});

describe('ConnectorPreset 확장', () => {
  it('공식 원격 MCP 가 확인된 Linear·Figma·Sentry 는 바로 연결할 수 있다', () => {
    expect(ConnectorPreset.of('linear').url).toBe('https://mcp.linear.app/mcp');
    expect(ConnectorPreset.of('figma').url).toBe('https://mcp.figma.com/mcp');
    expect(ConnectorPreset.of('sentry').url).toBe('https://mcp.sentry.dev/mcp');
    for (const id of ['linear', 'figma', 'sentry']) expect(ConnectorPreset.of(id).isAvailable()).toBe(true);
  });

  it('Slack 은 자동 등록을 받지 않고 다른 앱의 OAuth 클라이언트를 빌려 쓰지 않으므로 준비 중이고 이유를 말한다', () => {
    expect(ConnectorPreset.of('slack').isAvailable()).toBe(false);
    expect(ConnectorPreset.of('slack').oauth).toBeNull();
    expect(ConnectorPreset.of('slack').unavailableReason).toMatch(/sign-in/);
    expect(ConnectorPreset.of('notion').oauth).toBeNull();
  });

  it('GitHub 은 토큰이 필요해 준비 중이고 이유를 말한다', () => {
    expect(ConnectorPreset.of('github').isAvailable()).toBe(false);
    expect(ConnectorPreset.of('github').unavailableReason).toMatch(/token/);
  });

  it('모든 프리셋에 업무 설명 한 줄과 한국어 예시 요청 1~2개가 있다', () => {
    for (const preset of ConnectorPreset.all()) {
      expect(preset.summary.length).toBeGreaterThan(10);
      expect(preset.examples.length).toBeGreaterThanOrEqual(1);
      expect(preset.examples.length).toBeLessThanOrEqual(2);
      for (const example of preset.examples) expect(example).toMatch(/[가-힣]/);
    }
  });
});

describe('ConnectorWriteIntent', () => {
  const allows = (request: string) => ConnectorWriteIntent.from(request).allowsWrite();

  it('업무 도구에 쓰라고 시킨 요청이면 쓰기를 시킨 것으로 본다', () => {
    expect(allows('이 대화 내용을 노션에 회의록으로 정리해줘')).toBe(true);
    expect(allows('컨플루언스에 배포 절차 페이지 만들어줘')).toBe(true);
    expect(allows('지라 이슈 만들어줘')).toBe(true);
    expect(allows('이 버그로 리니어 이슈 생성해줘')).toBe(true);
    expect(allows('슬랙 #release 채널에 배포 끝났다고 보내줘')).toBe(true);
    expect(allows('구글 시트에 적어줘')).toBe(true);
  });

  it('읽기·요약만 시킨 요청은 쓰기를 시킨 것이 아니다', () => {
    expect(allows('노션 회의록 페이지 요약해줘')).toBe(false);
    expect(allows('이 노션 페이지 내용 정리해줘')).toBe(false);
    expect(allows('컨플루언스 결제 API 문서에서 환불 조건 찾아줘')).toBe(false);
    expect(allows('리팩터링해서 함수 만들어줘')).toBe(false);
  });

  it('하지 말라는 말은 시킨 것으로 보지 않는다', () => {
    expect(allows('노션에 올리지는 말고 여기서만 정리해줘')).toBe(false);
    expect(allows("don't post it to Slack, just draft it")).toBe(false);
  });
});

describe('ConnectorTool 시킨 쓰기', () => {
  const tool = (name: string) => ConnectorTool.parse(`mcp__notion__${name}`, ['notion'])!;
  const told = ConnectorWriteIntent.from('노션에 회의록 정리해줘');

  it('사용자가 시킨 쓰기는 묻지 않는다', () => {
    expect(tool('notion-create-pages').verdict({ title: 'A' }, told).decision).toBe('allow');
    expect(tool('notion-update-page').verdict({}, told).decision).toBe('allow');
  });

  it('지우기·옮기기·보관은 시켜도 묻는다', () => {
    expect(tool('notion-move-pages').verdict({}, told).decision).toBe('ask');
    expect(tool('notion-delete-page').verdict({}, told).decision).toBe('ask');
    expect(tool('notion-archive-page').verdict({}, told).decision).toBe('ask');
  });

  it('시키지 않은 쓰기는 묻는다', () => {
    expect(tool('notion-create-pages').verdict({}, ConnectorWriteIntent.none()).decision).toBe('ask');
  });
});
