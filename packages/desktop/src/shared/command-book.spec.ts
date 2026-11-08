import { describe, expect, it } from 'vitest';
import { argsOf, BUILTIN_COMMANDS, CommandBook, CommandError } from './command-book.js';
import { CommandBookDto } from './command-dto.js';

let n = 0;
const newId = () => `c${(n += 1)}`;
const draft = (name: string, template = '{{요청}}을 점검해줘', description = '점검') => ({ name, description, template });

describe('기본 명령', () => {
  it('터미널판 슬래시 명령이 처음부터 모두 들어 있다', () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    for (const name of ['review', 'design', 'repo', 'learn', 'routine', 'clear', 'status', '설치', '업데이트', '개선', 'usage', 'guide', 'retry', 'queue', 'copy', 'team', 'company', '진단', 'help', 'exit']) expect(names).toContain(name);
  });

  it('모든 기본 명령에 이름·설명·무엇을 하는지가 있고 이름은 겹치지 않는다', () => {
    for (const c of BUILTIN_COMMANDS) {
      expect(c.description).not.toBe('');
      expect(c.detail).not.toBe('');
    }
    expect(new Set(BUILTIN_COMMANDS.map((c) => c.name)).size).toBe(BUILTIN_COMMANDS.length);
  });

  it('화면에 달러 금액을 보이지 않는다', () => {
    for (const c of BUILTIN_COMMANDS) expect(`${c.description}${c.detail}`).not.toMatch(/\$|달러/);
  });
});

describe('별칭', () => {
  const book = CommandBook.initial();

  it('/install과 /설치, /update와 /업데이트, /improve와 /개선은 같은 명령이다', () => {
    expect(book.resolve('/install')).toMatchObject({ kind: 'app', action: 'install' });
    expect(book.resolve('/설치')).toMatchObject({ kind: 'app', action: 'install' });
    expect(book.resolve('/UPDATE')).toMatchObject({ kind: 'app', action: 'update' });
    expect(book.resolve('/업데이트')).toMatchObject({ kind: 'app', action: 'update' });
    expect(book.resolve('/improve rauha 보안')).toMatchObject({ kind: 'send' });
  });

  it('/진단과 /diagnose는 같은 앱 동작(진단 정보 복사)이다', () => {
    expect(book.resolve('/진단')).toMatchObject({ kind: 'app', action: 'diagnose' });
    expect(book.resolve('/diagnose')).toMatchObject({ kind: 'app', action: 'diagnose' });
  });

  it('별칭으로도 자동완성에 나오고, 내 명령 이름이 별칭과 겹치면 막는다', () => {
    expect(book.suggest('/inst').map((c) => c.name)).toEqual(['설치']);
    expect(() => book.add(draft('improve'), newId)).toThrow(/이미 있는 이름/);
  });

  it('/개선은 대상과 요청을 받아 3단계를 한 작업으로 보내고 파괴 동작과 비밀 파일·push를 막는다', () => {
    const r = book.resolve('/개선 rauha 로그인 보안 강화');
    const text = r.kind === 'send' ? r.text : '';
    expect(text).toContain('rauha에서');
    expect(text).toContain('로그인 보안 강화');
    for (const word of ['1단계', '2단계', '3단계', '모의 해킹', '파괴 동작', '비밀 파일', 'push']) expect(text).toContain(word);
    expect(book.resolve('/개선 rauha')).toMatchObject({ kind: 'usage', missing: ['요청'] });
  });
});

describe('인자', () => {
  it('템플릿의 {{x}}는 꼭 필요한 인자, {{x|기본값}}은 없어도 되는 인자다', () => {
    expect(argsOf('{{요청}}과 {{브랜치|main}}, 다시 {{요청}}')).toEqual([
      { name: '요청', required: true, fallback: null },
      { name: '브랜치', required: false, fallback: 'main' },
    ]);
  });

  it('사용법은 꼭 필요한 인자를 <>로, 없어도 되는 인자를 []로 보인다', () => {
    expect(BUILTIN_COMMANDS.find((c) => c.name === 'design')!.usage()).toBe('/design <요청>');
    expect(BUILTIN_COMMANDS.find((c) => c.name === 'review')!.usage()).toBe('/review [브랜치]');
  });
});

describe('resolve', () => {
  const book = CommandBook.initial();

  it('/로 시작하지 않으면 요청 그대로 보낸다', () => {
    expect(book.resolve('결제 원인 찾아줘')).toEqual({ kind: 'text', text: '결제 원인 찾아줘' });
  });

  it('//로 시작하면 슬래시 하나를 떼고 요청으로 보낸다(/usr/bin 같은 글을 보낼 때)', () => {
    expect(book.resolve('//usr/bin 설명해줘')).toEqual({ kind: 'text', text: '/usr/bin 설명해줘' });
  });

  it('/만 치면 명령 목록을 보인다', () => {
    expect(book.resolve('/')).toEqual({ kind: 'list' });
  });

  it('없는 명령은 요청으로 보내지 않고 알 수 없는 명령으로 본다', () => {
    expect(book.resolve('/deploy now')).toEqual({ kind: 'unknown', name: 'deploy' });
  });

  it('앱 동작 명령은 동작 이름을 돌려준다(대소문자·공백 무시)', () => {
    expect(book.resolve('  /CLEAR ')).toMatchObject({ kind: 'app', action: 'clear' });
    expect(book.resolve('/repo')).toMatchObject({ kind: 'app', action: 'tab', tab: 'repos' });
  });

  it('프롬프트 명령은 인자를 템플릿에 넣어 보낼 글을 만든다', () => {
    const r = book.resolve('/design 쿠폰 기능 만들어줘');
    expect(r.kind).toBe('send');
    expect(r.kind === 'send' && r.text).toContain('쿠폰 기능 만들어줘');
  });

  it('없어도 되는 인자는 기본값으로 채운다', () => {
    const none = book.resolve('/review');
    const some = book.resolve('/review develop');
    expect(none.kind === 'send' && none.text).toContain('커밋하지 않은 변경 전체');
    expect(some.kind === 'send' && some.text).toContain('develop');
  });

  it('꼭 필요한 인자가 없으면 빠진 인자와 사용법을 알린다', () => {
    expect(book.resolve('/design')).toMatchObject({ kind: 'usage', missing: ['요청'] });
  });

  it('마지막 인자는 남은 글 전부를 받고, 앞 인자는 한 단어씩 받는다', () => {
    const b = book.add(draft('비교', '{{a}}와 {{b}} 비교'), newId);
    const r = b.resolve('/비교 사과 맛있는 빨간 배');
    expect(r.kind === 'send' && r.text).toBe('사과와 맛있는 빨간 배 비교');
  });
});

describe('끄기와 되돌리기', () => {
  it('끈 기본 명령은 자동완성에서 빠지고 입력하면 꺼져 있다고 알린다', () => {
    const off = CommandBook.initial().setEnabled('builtin:learn', false);
    expect(off.suggest('/learn')).toEqual([]);
    expect(off.resolve('/learn')).toMatchObject({ kind: 'off' });
  });

  it('기본값으로 되돌리면 끈 명령이 다시 켜지고 내 명령은 남는다', () => {
    const book = CommandBook.initial().add(draft('점검'), newId).setEnabled('builtin:learn', false).restoreDefaults();
    expect(book.disabledIds).toEqual([]);
    expect(book.customCommands.map((c) => c.name)).toEqual(['점검']);
  });

  it('내 명령은 끄는 대신 지워야 한다', () => {
    const book = CommandBook.initial().add(draft('점검'), () => 'mine');
    expect(() => book.setEnabled('mine', false)).toThrow(CommandError);
  });
});

describe('내 명령', () => {
  it('더하고 고치고 지운다', () => {
    const added = CommandBook.initial().add(draft('점검'), () => 'a');
    expect(added.resolve('/점검 결제')).toMatchObject({ kind: 'send', text: '결제을 점검해줘' });
    const edited = added.edit('a', draft('점검', '{{요청}}을 꼼꼼히 점검해줘'));
    expect(edited.resolve('/점검 결제')).toMatchObject({ text: '결제을 꼼꼼히 점검해줘' });
    expect(edited.remove('a').resolve('/점검 결제')).toMatchObject({ kind: 'unknown' });
  });

  it('기본 명령이나 다른 내 명령과 이름이 겹치면 막는다(대소문자 무시)', () => {
    const book = CommandBook.initial().add(draft('점검'), () => 'a');
    expect(() => book.add(draft('REVIEW'), newId)).toThrow(/이미 있는 이름/);
    expect(() => book.add(draft('점검'), newId)).toThrow(/이미 있는 이름/);
  });

  it('자기 이름 그대로 고치는 것은 겹침이 아니다', () => {
    const book = CommandBook.initial().add(draft('점검'), () => 'a');
    expect(() => book.edit('a', draft('점검', '다른 {{x}}'))).not.toThrow();
  });

  it('이름·설명·프롬프트 규칙을 지킨다', () => {
    const book = CommandBook.initial();
    expect(() => book.add(draft('두 단어'), newId)).toThrow(CommandError);
    expect(() => book.add(draft('x', ''), newId)).toThrow(/프롬프트/);
    expect(() => book.add(draft('x', '{{열림'), newId)).toThrow(/인자/);
    expect(() => book.add(draft('x', 'a', ' '), newId)).toThrow(/한 줄/);
  });

  it('이름 앞의 /는 떼고 받는다', () => {
    expect(CommandBook.initial().add(draft('/점검'), newId).customCommands[0]!.name).toBe('점검');
  });
});

describe('suggest', () => {
  const book = CommandBook.initial();

  it('/만 치면 켜진 명령을 모두, 글자를 치면 이름이 그 글로 시작하는 것을 먼저 보인다', () => {
    expect(book.suggest('/').length).toBe(BUILTIN_COMMANDS.length);
    expect(book.suggest('/re').map((c) => c.name).slice(0, 3)).toEqual(['review', 'repo', 'retry']);
  });

  it('띄어쓰기가 들어가면 다 친 것으로 보고 후보를 비운다', () => {
    expect(book.suggest('/design 쿠폰')).toEqual([]);
    expect(book.suggest('그냥 글')).toEqual([]);
  });

  it('이름에 없어도 설명에 들어 있으면 뒤쪽에 보인다', () => {
    expect(book.suggest('/사용률').map((c) => c.name)).toEqual(['usage']);
  });
});

describe('CommandBookDto', () => {
  it('저장했다 읽어도 같다(끈 것·내 명령)', () => {
    const book = CommandBook.initial().add(draft('점검'), () => 'a').setEnabled('builtin:copy', false);
    const back = CommandBookDto.from(JSON.parse(JSON.stringify(CommandBookDto.fromEntity(book)))).toEntity();
    expect(back.disabledIds).toEqual(['builtin:copy']);
    expect(back.customCommands.map((c) => [c.id, c.name])).toEqual([['a', '점검']]);
  });

  it('깨진 파일은 기본 상태로 열고, 깨진 항목만 건너뛴다', () => {
    expect(CommandBookDto.from('엉망').toEntity().entries().length).toBe(BUILTIN_COMMANDS.length);
    const book = CommandBookDto.from({ custom: [{ id: 'x', name: '두 단어', description: 'a', template: 'b' }, { id: 'y', name: 'ok', description: 'a', template: 'b' }, 7], disabled: ['builtin:nope', 'builtin:help'] }).toEntity();
    expect(book.customCommands.map((c) => c.name)).toEqual(['ok']);
    expect(book.disabledIds).toEqual(['builtin:help']);
  });
});
