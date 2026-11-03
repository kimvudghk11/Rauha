import { describe, expect, it } from 'vitest';
import { describeTurn } from './describe-turn.js';

const claim = (text: string, isGuess: boolean) => ({ kind: 'fact' as const, text, evidence: [], verified: isGuess ? [] : [{ kind: 'record' as const, text: 'x' }], isGuess });

describe('describeTurn — 알림', () => {
  it('팀원을 부르지 않은 알림은 두 칸 들여 한 줄로 보여 준다', () => {
    expect(describeTurn({ kind: 'notice', message: '저장소마다 나눠서 요청해 주세요.' }, null)).toEqual(['', '  저장소마다 나눠서 요청해 주세요.', '']);
  });
});

describe('describeTurn — 읽은 기준', () => {
  it('답 아래에 읽은 기준을 한 줄 보여 준다', () => {
    const text = describeTurn({ kind: 'answer', answer: '네.', checked: [], costUsd: 0, durationMs: 1000, basis: 'main (a1b2c3d)' }, null).join('\n');
    expect(text).toContain('읽은 기준: main (a1b2c3d)');
  });

  it('기준을 모르면(지식 없음) 그 줄을 쓰지 않는다', () => {
    expect(describeTurn({ kind: 'answer', answer: '네.', checked: [], costUsd: 0, durationMs: 1000, basis: null }, null).join('\n')).not.toContain('읽은 기준');
  });
});

describe('describeTurn — /review', () => {
  const review = (over: Record<string, unknown> = {}) => ({ kind: 'review' as const, target: null, files: ['src/money.ts'], checked: [], summary: '요약', durationMs: 3000, ...over });

  it('바뀐 파일이 없으면 검토할 변경이 없다고만 한다', () => {
    expect(describeTurn(review({ files: [] }), null).join('\n')).toContain('검토할 변경이 없어요.');
  });

  it('근거가 확인된 지적만 보여 주고, 뺀 지적은 개수만 알린다', () => {
    const text = describeTurn(review({ target: 'develop', checked: [claim('add가 빼기를 한다 (src/money.ts:1)', false), claim('예전에도 그랬다', true)] }), null).join('\n');
    expect(text).toContain('검토 대상: develop와 갈라진 뒤의 변경 · 파일 1개');
    expect(text).toContain('- add가 빼기를 한다 (src/money.ts:1)');
    expect(text).not.toContain('예전에도 그랬다');
    expect(text).toContain('근거를 확인하지 못한 지적 1개는 뺐어요.');
  });

  it('확인된 지적이 없으면 문제가 없다고 한다', () => {
    const text = describeTurn(review(), null).join('\n');
    expect(text).toContain('검토 대상: 커밋하지 않은 변경 · 파일 1개');
    expect(text).toContain('근거가 확인된 문제는 없어요.');
  });
});

describe('describeTurn', () => {
  it('답은 답 글과 확인된 근거 수만 보여 주고, 추측 목록은 쓰지 않는다', () => {
    const text = describeTurn({ kind: 'answer', basis: null, answer: '정한 해석 때문입니다.', checked: [claim('floor를 쓴다', false), claim('예전엔 round였다', true)], costUsd: 0.01, durationMs: 9000 }, null).join('\n');
    expect(text).toContain('정한 해석 때문입니다.');
    expect(text).toContain('근거 확인됨 1개');
    expect(text).not.toContain('$');
    expect(text).not.toContain('추정');
    expect(text).not.toContain('추측');
    expect(text).not.toContain('예전엔 round였다');
  });

  it('답 글은 두 칸 들여 쓰고, ■ 제목 줄은 강조한다', () => {
    const view = { highlight: (t: string) => `<${t}>`, step: (m: string) => `◆ ${m}` } as unknown as Parameters<typeof describeTurn>[1];
    const lines = describeTurn({ kind: 'answer', basis: null, answer: '요약입니다.\n\n■ 관리 주체\n- EC2는 직접 관리합니다.', checked: [], costUsd: 0, durationMs: 0 }, view);
    expect(lines).toContain('◆ rauha');
    expect(lines).toContain('  요약입니다.');
    expect(lines).toContain('  <▍ 관리 주체>');
    expect(lines).toContain('  - EC2는 직접 관리합니다.');
  });

  it('실제로 열어 확인한 웹 문서는 맨 아래 출처로 한 번씩 짧게 보여 준다', () => {
    const web = (url: string) => ({ kind: 'fact' as const, text: 't', evidence: [], verified: [{ kind: 'web' as const, url, quote: 'q' }], isGuess: false });
    const url = 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/launch_types.html';
    const text = describeTurn({ kind: 'answer', basis: null, answer: '답', checked: [web(url), web(url), claim('x', true)], costUsd: 0, durationMs: 0 }, null).join('\n');
    expect(text).toContain('출처');
    expect(text.match(/docs\.aws\.amazon\.com › /g)).toHaveLength(1);
    expect(text).toContain('docs.aws.amazon.com › AmazonECS/latest/developerguide/launch_types.html');
  });

  it('확인된 근거가 없으면 "근거 확인됨 0개"를 쓰지 않고 걸린 시간만 쓴다', () => {
    const text = describeTurn({ kind: 'answer', basis: null, answer: '오후 11:40입니다.', checked: [claim('x', true)], costUsd: 0, durationMs: 5000 }, null).join('\n');
    expect(text).not.toContain('근거 확인됨');
    expect(text).toContain('5초');
  });

  it('한도면 한도 문장을 그대로 보여 준다', () => {
    expect(describeTurn({ kind: 'blocked', reason: 'usage-limit', message: "You've hit your session limit · resets 9:40pm" }, null).join('\n')).toContain('resets 9:40pm');
  });

  it('직접 멈췄으면 멈췄다고만 짧게 알린다', () => {
    expect(describeTurn({ kind: 'blocked', reason: 'cancelled', message: 'x' }, null).join('\n')).toContain('멈췄어요');
  });

  it('로그인이 안 됐으면 로그인하는 명령을 알려 준다', () => {
    expect(describeTurn({ kind: 'blocked', reason: 'login', message: 'x' }, null).join('\n')).toContain('rauha login');
  });
});

describe('describeTurn — 작업', () => {
  it('작업이 끝나면 긴 안내서 대신 결과 카드를 창 너비로 그린다', () => {
    const cards: unknown[] = [];
    const view = {
      finale: () => 'FINALE',
      resultCard: (card: unknown, columns: number) => (cards.push(card), `CARD ${columns}`),
    } as unknown as Parameters<typeof describeTurn>[1];
    const guide = { toMarkdown: () => 'LONG GUIDE', stopMessage: () => null };
    const outcome = {
      status: 'complete',
      title: '할인',
      durationMs: 111_000,
      guide,
      changedInRun: [{ path: 'src/a.ts', kind: 'modified' }],
      assumptions: [{ question: '반올림?', chosen: '내림', alternatives: [], confirmed: false }],
      facts: { unconfirmed: [{ text: '필드 이름은 email' }] },
    };
    const lines = describeTurn({ kind: 'work', outcome } as unknown as Parameters<typeof describeTurn>[0], view);
    const card = lines.find((l) => typeof l === 'function') as (columns: number) => string;
    expect(card(80)).toBe('CARD 80');
    expect(cards[0]).toMatchObject({ status: 'complete', title: '할인', elapsed: '1분 51초', files: [{ path: 'src/a.ts' }], decided: ['반올림? → 내림'], todo: ['필드 이름은 email'] });
    expect(lines.filter((l) => typeof l === 'string').join('\n')).not.toContain('LONG GUIDE');
  });

  it('대화 화면의 안내서는 하이퍼링크 없이 쓴다 (Ink가 링크 글자를 지운다)', () => {
    const guide = { toTerminal: () => '\u001b]8;;file:///E:/a.ts\u001b\\a.ts\u001b]8;;\u001b\\', toMarkdown: () => 'a.ts' };
    const turn = { kind: 'work', outcome: { status: 'complete', guide } } as unknown as Parameters<typeof describeTurn>[0];
    const text = describeTurn(turn, null).join('\n');
    expect(text).toContain('a.ts');
    expect(text).not.toContain('\u001b]8;;');
  });
});

describe('describeTurn — 설계', () => {
  const done = { changedInRun: [{ path: 'src/coupon.ts', kind: 'added' as const }], guide: { stopMessage: () => null } };
  const stopped = { changedInRun: [], guide: { stopMessage: () => '구현 시니어까지 실패했습니다.' } };
  const design = (tasks: unknown[]) =>
    describeTurn({ kind: 'design', title: '쿠폰 할인', path: 'C:/designs/a.md', durationMs: 120_000, tasks: tasks as never }, null).join('\n');

  it('설계 문서 경로와 작업별 결과를 보여 준다', () => {
    const text = design([
      { id: 't1', title: 'Coupon 값 객체', status: 'complete', outcome: done },
      { id: 't2', title: '주문에 쿠폰 적용', status: 'stopped', outcome: stopped },
      { id: 't3', title: '쿠폰 화면', status: 'skipped', outcome: null },
    ]);
    expect(text).toContain('설계 "쿠폰 할인" · 작업 3개 중 1개 완료');
    expect(text).toContain('설계 문서: C:/designs/a.md');
    expect(text).toContain('✓ Coupon 값 객체');
    expect(text).toContain('✗ 주문에 쿠폰 적용');
    expect(text).toContain('구현 시니어까지 실패했습니다.');
    expect(text).toContain('· 쿠폰 화면');
    expect(text).toContain('앞 작업이 멈춰서 하지 않았어요');
    expect(text).toContain('src/coupon.ts');
  });

  it('모두 끝나면 끝났다고만 하고 멈춘 작업 안내는 쓰지 않는다', () => {
    const text = design([{ id: 't1', title: 'Coupon 값 객체', status: 'complete', outcome: done }]);
    expect(text).toContain('작업 1개 중 1개 완료');
    expect(text).not.toContain('✗');
  });
});

describe('describeTurn — 여러 저장소', () => {
  const outcome = (title: string, files: string[], status: 'complete' | 'stopped' = 'complete') =>
    ({ status, title, changedInRun: files.map((path) => ({ path, kind: 'modified' })), guide: { stopMessage: () => (status === 'stopped' ? '테스트가 계속 실패했어요' : null) } }) as never;

  it('먼저 만든 저장소부터 결과·바뀐 파일·약속 검사·rauha가 정한 것을 보여 준다', () => {
    const text = describeTurn(
      {
        kind: 'repos',
        durationMs: 300_000,
        decisions: ['할인액은 원 단위 정수'],
        repos: [
          { repo: 'shop-api', status: 'complete', outcome: outcome('쿠폰 할인액 응답', ['src/order.dto.ts']), fixed: null, note: null },
          { repo: 'shop-web', status: 'complete', outcome: outcome('할인 줄', ['src/a.tsx']), fixed: outcome('약속에 맞춤', ['src/order.tsx']), note: null },
          { repo: 'shop-app', status: 'skipped', outcome: null, fixed: null, note: '기다리던 저장소가 멈춰서 하지 않았어요' },
        ],
        contract: [{ what: '쿠폰 할인액', checked: true, ok: false, evidence: 'src/order.tsx:9 order.coupon_discount', fixedIn: 'shop-web' }],
      },
      null,
    ).join('\n');
    expect(text).toContain('저장소 3곳 중 2곳 완료');
    expect(text.indexOf('shop-api')).toBeLessThan(text.indexOf('shop-web'));
    expect(text).toContain('✓ shop-api · 쿠폰 할인액 응답');
    expect(text).toContain('src/order.dto.ts');
    expect(text).toContain('약속에 맞춤 (약속에 맞게 한 번 더 고침)');
    expect(text).toContain('src/order.tsx');
    expect(text).toContain('· shop-app');
    expect(text).toContain('기다리던 저장소가 멈춰서 하지 않았어요');
    expect(text).toContain('✗ 쿠폰 할인액 → shop-web에서 고침');
    expect(text).toContain('할인액은 원 단위 정수');
  });
});
