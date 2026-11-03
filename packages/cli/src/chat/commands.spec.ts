import { describe, expect, it } from 'vitest';
import { displayWidth } from '../text-width.js';
import { helpLines, parseCommand, suggestCommands } from './commands.js';

describe('parseCommand', () => {
  it('/로 시작하지 않으면 명령이 아니다', () => {
    expect(parseCommand('Money에 할인 넣어줘')).toBeNull();
  });

  it('알려진 명령을 읽는다 (대소문자·앞뒤 공백 무시)', () => {
    expect(parseCommand('/clear')).toEqual({ kind: 'clear' });
    expect(parseCommand('  /STATUS ')).toEqual({ kind: 'status' });
    expect(parseCommand('/usage')).toEqual({ kind: 'usage' });
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/exit')).toEqual({ kind: 'exit' });
    expect(parseCommand('/update')).toEqual({ kind: 'update' });
  });

  it('알 수 없는 명령은 요청으로 보내지 않고 알 수 없는 명령으로 본다', () => {
    expect(parseCommand('/deploy now')).toEqual({ kind: 'unknown', name: '/deploy' });
  });
});

describe('/review', () => {
  it('/review는 커밋 안 한 변경, /review <브랜치>는 그 브랜치와 갈라진 뒤의 변경을 검토한다', () => {
    expect(parseCommand('/review')).toEqual({ kind: 'review', target: null });
    expect(parseCommand('/review develop')).toEqual({ kind: 'review', target: 'develop' });
  });
});

describe('/repo', () => {
  it('/repo는 목록, /repo <이름>은 지금 저장소 바꾸기, /repo add <경로>는 더하기', () => {
    expect(parseCommand('/repo')).toEqual({ kind: 'repo', action: 'list' });
    expect(parseCommand('/repo shop-api')).toEqual({ kind: 'repo', action: 'select', name: 'shop-api' });
    expect(parseCommand('/repo add E:\\work\\my lib')).toEqual({ kind: 'repo', action: 'add', path: 'E:\\work\\my lib' });
  });
});

describe('/guide', () => {
  it('/guide는 지난 작업의 읽기 안내서를 여는 명령이다', () => {
    expect(parseCommand('/guide')).toEqual({ kind: 'guide' });
  });
});

describe('suggestCommands', () => {
  it('/만 치면 모든 명령을, 더 치면 앞이 맞는 명령만 설명과 함께 보여 준다', () => {
    expect(suggestCommands('/').map((c) => c.name)).toEqual(['/clear', '/status', '/usage', '/guide', '/review', '/design', '/repo', '/retry', '/queue', '/copy', '/team', '/company', '/routine', '/learn', '/update', '/help', '/exit']);
    expect(suggestCommands('/us')).toEqual([{ name: '/usage', help: expect.stringContaining('구독 사용률') }]);
    expect(suggestCommands('/up')).toEqual([{ name: '/update', help: expect.stringContaining('최신') }]);
  });

  it('명령이 아닌 글이나 띄어쓰기가 들어간 뒤에는 보여 주지 않는다', () => {
    expect(suggestCommands('안녕')).toEqual([]);
    expect(suggestCommands('/usage ')).toEqual([]);
    expect(suggestCommands('')).toEqual([]);
  });
});

describe('/design', () => {
  it('/design <요청>은 라우터를 거치지 않고 설계부터 시작하는 요청이다', () => {
    expect(parseCommand('/design 쿠폰 기능 만들어줘')).toEqual({ kind: 'design', request: '쿠폰 기능 만들어줘' });
    expect(parseCommand('/DESIGN   로그인 페이지  ')).toEqual({ kind: 'design', request: '로그인 페이지' });
  });

  it('요청 없이 /design만 치면 안내 대상이다', () => {
    expect(parseCommand('/design')).toEqual({ kind: 'design', request: null });
  });

  it('입력창에서 /de를 치면 후보에 /design이 뜬다', () => {
    expect(suggestCommands('/de').map((c) => c.name)).toContain('/design');
  });
});

describe('/retry', () => {
  it('/retry는 마지막 요청을 다시 보내는 명령이다', () => {
    expect(parseCommand('/retry')).toEqual({ kind: 'retry' });
    expect(suggestCommands('/re').map((c) => c.name)).toContain('/retry');
  });
});

describe('/queue', () => {
  it('/queue는 대기 중인 입력을 보여 주고, /queue clear는 비운다', () => {
    expect(parseCommand('/queue')).toEqual({ kind: 'queue', action: 'show' });
    expect(parseCommand('/queue clear')).toEqual({ kind: 'queue', action: 'clear' });
    expect(parseCommand('/queue 비워')).toEqual({ kind: 'queue', action: 'show' });
  });
});

describe('/copy', () => {
  it('/copy는 마지막 답을 복사하는 명령이다', () => {
    expect(parseCommand('/copy')).toEqual({ kind: 'copy' });
  });
});

describe('/team', () => {
  it('/team은 팀 구성을 보여 주는 명령이다', () => {
    expect(parseCommand('/team')).toEqual({ kind: 'team' });
    expect(suggestCommands('/te').map((c) => c.name)).toContain('/team');
  });
});

describe('! 직접 실행', () => {
  it('!로 시작하면 모델을 거치지 않고 바로 실행할 명령이다', () => {
    expect(parseCommand('!aws s3 ls')).toEqual({ kind: 'shell', command: 'aws s3 ls' });
    expect(parseCommand('  ! git status  ')).toEqual({ kind: 'shell', command: 'git status' });
  });

  it('! 뒤에 명령이 없으면 안내 대상이다', () => {
    expect(parseCommand('!')).toEqual({ kind: 'shell', command: null });
  });
});

describe('/company', () => {
  it('/company는 회사가 이미 정한 것을 보여 주는 명령이다', () => {
    expect(parseCommand('/company')).toEqual({ kind: 'company' });
    expect(suggestCommands('/co').map((c) => c.name)).toContain('/company');
  });
});

describe('/routine', () => {
  it('/routine은 목록, run은 때가 된 것 실행', () => {
    expect(parseCommand('/routine')).toEqual({ kind: 'routine', action: 'list' });
    expect(parseCommand('/routine run')).toEqual({ kind: 'routine', action: 'run' });
  });

  it('add는 매일 또는 매주 요일과 요청을 읽는다', () => {
    expect(parseCommand('/routine add 매일 릴리스 노트 초안 써줘')).toEqual({ kind: 'routine', action: 'add', cadence: { kind: 'daily' }, request: '릴리스 노트 초안 써줘' });
    expect(parseCommand('/routine add 매주 월 지표 점검해줘')).toEqual({ kind: 'routine', action: 'add', cadence: { kind: 'weekly', weekday: 1 }, request: '지표 점검해줘' });
    expect(parseCommand('/routine add 매주 일요일 회고 정리')).toEqual({ kind: 'routine', action: 'add', cadence: { kind: 'weekly', weekday: 0 }, request: '회고 정리' });
  });

  it('형식이 틀린 add는 사용법 안내 대상이다', () => {
    expect(parseCommand('/routine add')).toEqual({ kind: 'routine', action: 'usage' });
    expect(parseCommand('/routine add 매주 해줘')).toEqual({ kind: 'routine', action: 'usage' });
    expect(parseCommand('/routine add 매일')).toEqual({ kind: 'routine', action: 'usage' });
  });

  it('remove는 번호를 읽는다', () => {
    expect(parseCommand('/routine remove 2')).toEqual({ kind: 'routine', action: 'remove', number: 2 });
    expect(parseCommand('/routine remove x')).toEqual({ kind: 'routine', action: 'usage' });
  });
});

describe('helpLines', () => {
  it('명령을 쓰임새별로 묶어 보여 주고, 모든 명령과 ! 명령·입력 요령을 빠뜨리지 않는다', () => {
    const text = helpLines().join('\n');
    for (const group of ['대화', '작업', '팀·회사', 'rauha']) expect(text).toContain(`  ${group}`);
    for (const name of suggestCommands('/').map((c) => c.name)) expect(text).toContain(name);
    expect(text).toContain('!<명령>');
    expect(text).toContain('Alt+Enter');
    expect(text.indexOf('  대화')).toBeLessThan(text.indexOf('/clear'));
    expect(text.indexOf('  작업')).toBeLessThan(text.indexOf('/review'));
  });

  it('설명은 이름 뒤 두 칸 이상 띄워, 창이 좁아 접혀도 설명 칸에 맞춰진다', () => {
    expect(helpLines().find((l) => l.includes('/review'))).toMatch(/^ {4}\/review {2,}\S/);
  });
});

describe('helpLines 정렬', () => {
  it('한글이 든 이름(!<명령>)도 다른 명령과 같은 칸에서 설명이 시작한다', () => {
    const at = (line: string) => displayWidth(line.slice(0, line.search(/ {2,}\S/))) + line.slice(line.search(/ {2,}\S/)).search(/\S/);
    const lines = helpLines();
    expect(at(lines.find((l) => l.includes('!<명령>'))!)).toBe(at(lines.find((l) => l.includes('/review'))!));
  });
});
