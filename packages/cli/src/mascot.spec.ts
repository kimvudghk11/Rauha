import { describe, expect, it } from 'vitest';
import { ansi256, beside, box, displayWidth, mascotView, paintDelfi, paintMiniDelfiScaled, toAnsi } from './mascot.js';

const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');

describe('Delfi 그림', () => {
  it('터미널 한 줄에 픽셀 위아래 두 개를 담는다', () => {
    const lines = toAnsi(paintDelfi('hello'), 24);
    expect(lines).toHaveLength(7);
    expect(new Set(lines.map((l) => visible(l).length))).toEqual(new Set([22]));
  });

  it('위아래 모두 비면 공백, 위만 색이면 ▀, 아래만 색이면 ▄, 둘 다면 위는 글자색 아래는 배경색', () => {
    const [line] = toAnsi([[null, '#FF0000', null, '#FF0000'], [null, null, '#00FF00', '#00FF00']], 24);
    expect(visible(line!)).toBe(' ▀▄▀');
    // 글자색과 배경색은 코드를 따로 쓴다. 한 코드에 묶으면 Ink가 다시 쓸 때 배경색을 닫지 않는다.
    expect(line).toContain('\x1b[38;2;255;0;0m\x1b[48;2;0;255;0m▀');
    expect(line).not.toMatch(/38;2;[\d;]*;48;2/);
  });

  it('위아래 색이 같으면 배경색 빈칸으로 칠한다 (macOS 터미널에서 블록 글자 사이에 줄 틈이 보이지 않게)', () => {
    const [line] = toAnsi([['#FF0000'], ['#FF0000']], 24);
    expect(visible(line!)).toBe(' ');
    expect(line).toContain('\x1b[48;2;255;0;0m ');
  });

  it('256색 터미널에서는 가장 가까운 xterm 색 번호를 쓴다', () => {
    expect(ansi256('#000000')).toBe(16);
    expect(ansi256('#FFFFFF')).toBe(231);
    expect(ansi256('#8FD3F7')).toBe(117);
    expect(toAnsi([['#FFFFFF'], [null]], 8)[0]).toContain('38;5;231m▀');
  });

  it('표정마다 그림이 다르고, 완료 표정에는 반짝이가 있다', () => {
    const faces = (['hello', 'done', 'stuck', 'ask'] as const).map((f) => JSON.stringify(paintDelfi(f)));
    expect(new Set(faces).size).toBe(4);
    expect(paintDelfi('done').flat()).toContain('#FFDB7A');
    expect(paintDelfi('hello').flat()).not.toContain('#FFDB7A');
  });
});

describe('box', () => {
  it('한글은 두 칸으로 세서, 한글이 섞여도 오른쪽 테두리가 한 줄에 맞는다', () => {
    expect(displayWidth('한글ab')).toBe(6);
    expect(displayWidth('\x1b[1mab\x1b[0m')).toBe(2);
    const lines = box(['rauha v0', '오늘도 신나게'], '#8FD3F7', 24);
    expect(new Set(lines.map(displayWidth)).size).toBe(1);
    expect(visible(lines[0]!)).toMatch(/^ ▁+ $/);
    expect(visible(lines[2]!)).toBe('▕ 오늘도 신나게 ▏');
    expect(visible(lines[3]!)).toMatch(/^ ▔+ $/);
  });

  it('윗변·아랫변은 양옆 세로선 사이 칸을 정확히 채운다', () => {
    const [top, middle, bottom] = box(['ab'], '#8FD3F7', 24).map(visible);
    expect(top!.indexOf('▁')).toBe(middle!.indexOf('▕') + 1);
    expect(top!.lastIndexOf('▁')).toBe(middle!.indexOf('▏') - 1);
    expect(bottom!.replace(/▔/g, '▁')).toBe(top);
  });
});

describe('beside', () => {
  it('그림 오른쪽에 글을 붙이고, 그림을 세로 가운데에 맞춘다', () => {
    expect(beside(['AA', 'BB', 'CC'], ['x'])).toEqual(['AA', 'BB  x', 'CC']);
    expect(beside(['AA'], ['x', 'y', 'z'])).toEqual(['    x', 'AA  y', '    z']);
  });
});

describe('mascotView', () => {
  it('256색 미만 터미널에서는 캐릭터를 쓰지 않는다', () => {
    expect(mascotView(4, 'v0', '[personal]')).toBeNull();
    expect(mascotView(1, 'v0', '[personal]')).toBeNull();
  });

  it('팀원 진행 줄은 팀원마다 다른 색 표시를 붙이고, 그 밖의 줄은 흐리게 쓴다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const lead = view.step('팀장 접수 작업 중…', 'intake');
    const tester = view.step('테스트 팀원 작업 중…', 'tester');
    const plain = view.step('검증 묶음을 실행합니다');
    expect(visible(lead)).toBe('  ◆ 팀장 접수 작업 중…');
    expect(lead).not.toBe(tester.replace('테스트 팀원', '팀장 접수'));
    expect(visible(plain)).toBe('  · 검증 묶음을 실행합니다');
  });

  it('찍히는 모든 줄은 마지막 글자에 배경색이 없다 (cmd 창은 크기가 바뀌면 마지막 글자 배경을 줄 끝까지 늘린다)', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const request = { role: 'tester', tool: 'Bash', detail: 'rm -rf dist', reason: '지웁니다' } as const;
    const screens = [view.banner('E:\\work', 120), view.finale('complete'), view.finale('stopped'), view.permission(request, 80)];
    for (const line of screens.flatMap((s) => s.split('\n'))) {
      const last = line.split(/(?=\x1b\[)/).filter((seg) => visible(seg).trim() !== '').at(-1);
      if (last === undefined) continue;
      expect(last, JSON.stringify(line)).not.toMatch(/48;/);
    }
  });

  it('시작 화면은 Delfi·rauha·인사말·작업 폴더를 한 박스에 담는다 (rauha 아래 줄이 인사말)', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    const lines = view.banner('E:\\work', 120).split('\n').map(visible);
    expect(lines[0]).toMatch(/^ ▁+ $/);
    expect(lines.at(-1)).toMatch(/^ ▔+ $/);
    const inner = lines.slice(1, -1);
    for (const line of inner) expect(line).toMatch(/^▕ .*▏$/);
    const title = inner.findIndex((l) => /rauha v0\.0\.0 +\[personal\]/.test(l));
    expect(inner[title + 1]).toContain('오늘도 신나게 헤엄쳐요');
    expect(inner.join('\n')).toContain('E:\\work');
    expect(inner.join('\n')).toMatch(/[▀▄]/);
    expect(new Set(lines.map(displayWidth)).size).toBe(1);
    expect(lines.join('\n')).not.toContain('Delfi:');
  });

  it('작업 폴더가 길면 가운데를 줄여서 박스가 터미널 너비를 넘지 않는다', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    const lines = view.banner(`C:\\${'a'.repeat(200)}\\shop`, 80).split('\n');
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(80);
    expect(lines.map(visible).join('\n')).toMatch(/C:\\a+\.\.\.a*\\shop/);
  });

  it('넓은 터미널에서도 시작 박스는 60칸을 넘지 않는다', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    for (const line of view.banner(`C:\\${'a'.repeat(200)}`, 200).split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(60);
  });

  it('시작 화면은 어떤 터미널 너비에서도 마지막 칸까지 차지 않는다 (꽉 차면 터미널이 줄을 접는다)', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    for (let columns = 10; columns <= 120; columns++) {
      for (const line of view.banner(`C:\\Users\\kimbo\\${'a'.repeat(40)}\\shop`, columns).split('\n')) {
        expect(displayWidth(line), `${columns}칸: ${JSON.stringify(visible(line))}`).toBeLessThan(columns);
      }
    }
  });

  it('Delfi 옆에 글을 둘 자리가 없으면 Delfi 아래에 글을 둔다', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    const lines = view.banner('E:\\work', 40).split('\n').map(visible);
    expect(lines[0]).toMatch(/^ ▁+ $/);
    const title = lines.findIndex((l) => l.includes('rauha v0.0.0'));
    const lastArt = lines.findLastIndex((l) => /[▀▄]/.test(l));
    expect(title).toBeGreaterThan(lastArt);
    expect(lines[title + 1]).toContain('오늘도 신나게 헤엄쳐요');
  });

  it('Delfi도 못 들어갈 만큼 좁으면 박스 없이 글만 쓴다', () => {
    const view = mascotView(24, 'v0.0.0', '[personal]')!;
    const text = view.banner('E:\\work', 20).split('\n').map(visible).join('\n');
    expect(text).not.toMatch(/[▀▄▁▔▕▏]/);
    expect(text).toContain('rauha');
  });

  it('Delfi는 테두리나 왼쪽 끝에 붙지 않는다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    for (const line of view.banner('E:\\work', 120).split('\n').slice(1, -1)) expect(visible(line)).toMatch(/^▕ {3}/);
    for (const screen of [view.finale('complete'), view.finale('stopped')]) {
      for (const line of screen.split('\n')) expect(visible(line)).toMatch(/^ {2}/);
    }
  });

  it('허락 화면은 누가·어떤 도구로·무엇을·왜 하는지 박스에 담고, 긴 명령은 자르지 않고 접는다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const command = `rm -rf ${'build/'.repeat(30)}`;
    const lines = view
      .permission({ role: 'implementer', tool: 'Bash', detail: command, reason: '파일이나 폴더를 지웁니다' }, 80)
      .split('\n')
      .map(visible);
    const boxed = lines.slice(lines.findIndex((l) => /^ ▁+ $/.test(l)));
    expect(new Set(boxed.map(displayWidth)).size).toBe(1);
    for (const line of boxed) expect(displayWidth(line)).toBeLessThanOrEqual(80);
    expect(boxed.join('\n')).toContain('구현 팀원');
    expect(boxed.join('\n')).toContain('Bash');
    expect(boxed.join('\n')).toContain('파일이나 폴더를 지웁니다');
    expect(boxed.join('').replace(/[ ▕▏]/g, '')).toContain(command.replace(/ /g, ''));
  });

  it('허락·추측 확인 박스도 터미널 마지막 칸까지 차지 않는다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const request = { role: 'implementer', tool: 'Bash', detail: `rm -rf ${'build/'.repeat(30)}`, reason: '지웁니다' } as const;
    for (const columns of [40, 60, 77, 120]) {
      const boxes = [view.permission(request, columns), view.factCheck('응답 필드 이름은 email이다 '.repeat(5), columns)];
      for (const screen of boxes) {
        const lines = screen.split('\n');
        for (const line of lines.slice(lines.findIndex((l) => /^ ▁+ $/.test(visible(l))))) expect(displayWidth(line)).toBeLessThan(columns);
      }
    }
  });

  it('낮은 창을 위한 짧은 질문 화면은 Delfi 없이 상자만 담고, 줄 수가 훨씬 적다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const request = { role: 'implementer', tool: 'Bash', detail: 'rm -rf dist', reason: '지웁니다' } as const;
    const full = view.permission(request, 80).split('\n');
    const compact = view.permission(request, 80, true).split('\n');
    expect(compact.length).toBeLessThan(full.length - 5);
    expect(compact.map(visible).join('\n')).not.toMatch(/[▀▄]/);
    expect(compact.map(visible).join('\n')).toContain('rm -rf dist');
    expect(compact.map(visible).join('\n')).toContain('위험할 수 있는 동작');
    expect(view.factCheck('필드는 email', 80, true).split('\n').length).toBeLessThan(view.factCheck('필드는 email', 80).split('\n').length - 5);
    expect(view.pastPick(80, true).split('\n')).toHaveLength(1);
  });

  it('작업 중 줄은 팀원 색 스피너와 경과 시간을, 끝난 줄은 ◆와 걸린 시간을 보여 준다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    expect(visible(view.working('▘', '팀장 접수 작업 중…', 'intake', '12초'))).toBe('  ▘ 팀장 접수 작업 중… 12초');
    expect(visible(view.done('팀장 접수 작업 중…', 'intake', '34초'))).toBe('  ◆ 팀장 접수 34초');
  });

  it('추측 확인 화면은 주장과 확인하지 못했다는 말을 박스에 담는다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const lines = view.factCheck('응답 필드 이름은 email이다', 80).split('\n').map(visible);
    const boxed = lines.slice(lines.findIndex((l) => /^ ▁+ $/.test(l)));
    expect(new Set(boxed.map(displayWidth)).size).toBe(1);
    expect(boxed.join('\n')).toContain('응답 필드 이름은 email이다');
    expect(lines.join('\n')).toContain('근거를 확인하지 못했어요');
  });

  it('작업 결과 카드는 상태·바뀐 파일·확인할 것을 한 박스에 담고 창 너비를 넘지 않는다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const card = {
      status: 'complete' as const,
      title: '할인 기능 추가',
      elapsed: '1분 51초',
      stopMessage: null,
      files: [
        { path: 'src/money.ts', kind: 'modified' as const },
        { path: 'src/money.spec.ts', kind: 'added' as const },
      ],
      decided: ['반올림은 내림'],
      todo: ['응답 필드 이름은 email이다 '.repeat(4)],
    };
    for (const columns of [40, 80, 120]) {
      const lines = view.resultCard(card, columns).split('\n').map(visible);
      expect(lines[0]).toMatch(/^ ▁+ $/);
      for (const line of lines) expect(displayWidth(line)).toBeLessThan(columns);
      const text = lines.join('\n');
      expect(text).toContain('완료');
      expect(text).toContain('할인 기능 추가');
      expect(text).toContain('~ src/money.ts');
      expect(text).toContain('+ src/money.spec.ts');
      expect(text).toContain('확인할 것');
      expect(text).toContain('알아서 정한 것 1개');
      expect(text).toContain('반올림은 내림');
      expect(text).toContain('/guide');
      // '·'는 한글 글꼴 cmd에서 두 칸이라 박스 안에 쓰면 오른쪽 테두리가 밀린다.
      expect(text).not.toContain('·');
    }
  });

  it('제목이 길어 첫 줄이 접혀도 걸린 시간("3분 5초")은 한 줄에 붙어 있다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const card = { status: 'complete' as const, title: '쿠폰 할인 적용 — Order.applyCoupon 추가와 결제 금액 재계산', elapsed: '3분 5초', stopMessage: null, files: [], decided: [], todo: [] };
    const lines = view.resultCard(card, 80).split('\n').map(visible);
    expect(lines.some((l) => /3분[  ]5초/.test(l))).toBe(true);
  });

  it('멈춘 작업의 Delfi 말은 이유가 바로 아래 카드에 있다고 한다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    expect(visible(view.finale('stopped'))).toContain('이유는 아래에');
  });

  it('멈춘 결과 카드에는 멈춘 이유를 쓰고, 바뀐 파일이 많으면 몇 개만 보여 준다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, kind: 'modified' as const }));
    const text = view
      .resultCard({ status: 'stopped', title: 't', elapsed: '3초', stopMessage: '로그인이 필요해서 멈췄습니다.', files, decided: [], todo: [] }, 80)
      .split('\n')
      .map(visible)
      .join('\n');
    expect(text).toContain('멈춤');
    expect(text).toContain('로그인이 필요해서 멈췄습니다.');
    expect(text).toContain('외 3개');
    expect(text).not.toContain('확인할 것');
  });

  it('대화 화면의 작업 중 줄은 작은 Delfi 옆에 그린다 (마지막 글자에 배경색 없음)', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const lines = view.workingDelfi('▖', '접수 > 테스트 중…', 'tester', '12초', 0).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines.map(visible).join('\n')).toContain('▖ 접수 > 테스트 중… 12초');
    expect(lines.map(visible).join('\n')).toMatch(/[▀▄]/);
  });

  it('작업 중 Delfi는 틱마다 움직인다: 위아래로 둥실, 눈 깜빡임, 올라가는 물방울', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const frames = Array.from({ length: 48 }, (_, tick) => view.workingDelfi('▖', '작업', 'tester', '1초', tick));
    // 한 바퀴 안에 서로 다른 그림이 여럿이고, 같은 틱은 언제나 같은 그림이다.
    expect(new Set(frames).size).toBeGreaterThanOrEqual(6);
    expect(view.workingDelfi('▖', '작업', 'tester', '1초', 7)).toBe(frames[7]);
    // 움직여도 높이는 늘 같다(줄 수가 바뀌면 입력창 자리가 흔들린다).
    for (const frame of frames) expect(frame.split('\n')).toHaveLength(5);
    // 둥실: 몸이 위아래로 움직여 첫 줄에 몸이 있는 틱과 없는 틱이 모두 있다.
    // 몸은 0~7칸, 물방울은 8·9칸이라 앞 10글자(들여쓰기 2 + 몸 8칸)만 본다.
    const topHasBody = frames.map((f) => /[▀▄]/.test(visible(f.split('\n')[0]!).slice(0, 10)));
    expect(topHasBody).toContain(true);
    expect(topHasBody).toContain(false);
    // 모든 틱의 모든 줄: 마지막으로 칠한 글자에 배경색이 없다(cmd 창 크기를 바꿀 때 번지지 않게).
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const last = line.split(/(?=\x1b\[)/).filter((seg) => visible(seg).trim() !== '').at(-1);
        if (last !== undefined) expect(last, JSON.stringify(visible(line))).not.toMatch(/48;/);
      }
    }
  });

  it('작업 중 Delfi가 움직여도 한 줄의 너비는 같다 (물방울이 줄 길이를 흔들지 않게)', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const widths = new Set<number>();
    for (let tick = 0; tick < 48; tick++) {
      // 글이 붙은 줄은 길이가 달라서 빼고, 그림만 있는 줄(들여쓰기 2 + 10칸)의 너비를 본다.
      for (const line of view.workingDelfi('▖', '작업', 'tester', '1초', tick).split('\n')) {
        if (!visible(line).includes('작업')) widths.add(displayWidth(visible(line)));
      }
    }
    expect([...widths]).toEqual([12]);
  });

  it('사용률 막대는 사용률이 높을수록 색이 달라지고, 글자는 색을 빼면 같다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    const low = view.gauge(10, 10);
    const warn = view.gauge(80, 10);
    const critical = view.gauge(95, 10);
    expect(visible(low)).toBe('▄▁▁▁▁▁▁▁▁▁');
    expect(visible(warn)).toBe('▄▄▄▄▄▄▄▄▁▁');
    const fillColor = (bar: string) => /\x1b\[38;[0-9;]*m/.exec(bar)?.[0];
    expect(new Set([fillColor(low), fillColor(warn), fillColor(critical)]).size).toBe(3);
    // 막대 뒤에 글이 이어지므로 배경색은 쓰지 않는다
    for (const bar of [low, warn, critical]) expect(bar).not.toMatch(/48;/);
  });

  it('끝 인사는 결과에 따라 다르다', () => {
    const view = mascotView(24, 'v0', '[personal]')!;
    expect(visible(view.finale('complete'))).not.toBe(visible(view.finale('stopped')));
  });
});

describe('Delfi 그림 키우기', () => {
  const view = mascotView(24, 'v0.0.0', '[personal]')!;
  const lines = (columns: number, rows?: number) => view.banner('E:\work', columns, rows).split('\n');

  it('창이 넓고 높으면 시작 화면의 Delfi가 정수 배로 커진다', () => {
    const small = lines(120, 24);
    const big = lines(160, 60);
    expect(big.length).toBeGreaterThan(small.length * 1.5);
    expect(Math.max(...big.map(displayWidth))).toBeGreaterThan(Math.max(...small.map(displayWidth)));
    for (const line of big) expect(displayWidth(line)).toBeLessThanOrEqual(159);
  });

  it('창이 낮으면 넓어도 키우지 않는다', () => {
    expect(lines(200, 20)).toEqual(lines(200));
  });

  it('높이를 모르면 키우지 않는다 (-p의 한 줄 진행 표시 등)', () => {
    expect(lines(200).length).toBe(lines(80).length);
  });

  it('커진 Delfi도 박스 모양은 그대로다', () => {
    const big = lines(160, 60).map(visible);
    expect(big[0]).toMatch(/^ ▁+ $/);
    expect(big.at(-1)).toMatch(/^ ▔+ $/);
    expect(new Set(big.map(displayWidth)).size).toBe(1);
  });
});

describe('일하는 중 작은 Delfi 키우기', () => {
  const view = mascotView(24, 'v0.0.0', '[personal]')!;

  it('2배로 키우면 줄 수가 두 배가 된다', () => {
    const one = view.workingDelfi('▖', '작업 중…', 'implementer', '3초', 0).split('\n');
    const two = view.workingDelfi('▖', '작업 중…', 'implementer', '3초', 0, 2).split('\n');
    expect(one).toHaveLength(5);
    expect(two).toHaveLength(10);
  });

  it('키운 그림도 줄마다 마지막으로 칠한 칸은 위아래 중 하나만 칠한다 (cmd에서 배경이 번지지 않게)', () => {
    for (const tick of [0, 3, 6, 9, 13]) {
      const px = paintMiniDelfiScaled(tick, 2);
      for (let y = 0; y < px.length; y += 2) {
        const last = Math.max(...[px[y]!, px[y + 1]!].map((row) => row.findLastIndex((c) => c !== null)));
        if (last >= 0) expect(px[y]![last] !== null && px[y + 1]![last] !== null).toBe(false);
      }
    }
  });
});

describe('사용자 입력 말풍선', () => {
  const view = mascotView(24, 'v0.0.0', '[personal]')!;
  const lines = (text: string, columns = 60) => view.userTurn(text, columns).split('\n').map(visible);

  it('흐린 가로줄 아래에 입력을 세로 막대와 함께 보여 준다 (지난 답과 새 질문의 경계)', () => {
    const [rule, ...body] = lines('Money에 할인 넣어줘');
    expect(rule).toMatch(/^▁+$/);
    expect(body).toEqual(['▍ Money에 할인 넣어줘']);
  });

  it('여러 줄 입력은 줄마다 막대를 붙인다', () => {
    expect(lines('첫째\n둘째').slice(1)).toEqual(['▍ 첫째', '▍ 둘째']);
  });

  it('긴 입력이 창 너비에서 접혀도 이어지는 줄에 막대가 붙고 너비를 넘지 않는다', () => {
    const out = lines('가나다라 마바사아 자차카타 파하 '.repeat(4), 30);
    expect(out.length).toBeGreaterThan(3);
    for (const line of out) expect(displayWidth(line)).toBeLessThanOrEqual(29);
    for (const line of out.slice(1)) expect(line.startsWith('▍ ')).toBe(true);
  });

  it('가로줄은 창 너비를 따라가되 너무 길어지지 않는다', () => {
    expect(displayWidth(lines('a', 200)[0]!)).toBe(76);
    expect(displayWidth(lines('a', 40)[0]!)).toBe(39);
  });
});
