import { describe, expect, it } from 'vitest';
import { Verification } from '../../domain/verification.js';
import { ExplanationDto } from './explanation.dto.js';
import { ReadingGuideDto, type ReadingGuideProps } from './reading-guide.dto.js';

const explanation = ExplanationDto.from({
  decisions: [{ what: 'discount를 Money 메서드로 둠', why: 'add·multiply와 같은 자리', rejected: '유틸 함수' }],
  readingOrder: [
    { path: 'src/domain/money.ts', line: 30, note: '새 메서드' },
    { path: 'src/domain/money.spec.ts', note: '보장하는 것' },
  ],
  manualChecks: ['Money.of(10000).discount(10) → 9,000원'],
  untested: ['소수점 반올림'],
});

const verdict = Verification.of([
  { name: 'locked-tests', status: 'pass', failures: [], command: 'npx vitest run src/domain/money.spec.ts', summary: '통과 4' },
  { name: 'tests', status: 'fail', failures: ['old broken'], command: 'npm run test', summary: '통과 20 / 실패 1' },
  { name: 'lint', status: 'skip', failures: [], command: null, summary: '스크립트 없음' },
]).judge(Verification.of([{ name: 'tests', status: 'fail', failures: ['old broken'], command: null, summary: '' }]));

const base: ReadingGuideProps = {
  badge: '[personal]',
  title: 'Money 할인 적용',
  status: 'complete',
  stopReason: null,
  durationMs: 134_000,
  costUsd: 0.0123,
  tierCalls: { haiku: 2, sonnet: 1, opus: 0 },
  explanation,
  verdict,
  changes: [
    { path: 'src/domain/money.ts', kind: 'modified' },
    { path: 'src/domain/money.spec.ts', kind: 'added' },
  ],
  logDir: 'C:/Users/me/.rauha/profiles/personal/runs/x',
  assumptions: [],
};

describe('ReadingGuideDto', () => {
  it('안내서는 읽는 순서·결정·직접 해 볼 것·검증 결과를 담는다', () => {
    const md = ReadingGuideDto.create(base).toMarkdown();
    expect(md).not.toContain('작업 기준');
    expect(md).toContain('[personal] Money 할인 적용 · 완료(리뷰 전) · 2분 14초 · haiku 2회, sonnet 1회');
    expect(md).toContain('1. src/domain/money.ts:30');
    expect(md).toContain('새 메서드');
    expect(md).toContain('discount를 Money 메서드로 둠');
    expect(md).toContain('버린 안: 유틸 함수');
    expect(md).toContain('Money.of(10000).discount(10)');
    expect(md).toContain('소수점 반올림');
    expect(md).toContain('✓ npx vitest run src/domain/money.spec.ts');
    expect(md).toContain('원래 깨져 있던 것: old broken');
    // 작업 전부터 실패하던 검사는 통과(✓)처럼 보이지 않게 "변화 없음"으로 적는다.
    expect(md).toContain('· npm run test   작업 전부터 실패, 이번 변경으로 늘어난 실패 없음 (통과 20 / 실패 1)');
    expect(md).toContain('- lint: 스크립트 없음, 건너뜀');
  });

  it('결정 문장 끝의 마침표가 겹치지 않는다', () => {
    const e = ExplanationDto.from({
      decisions: [{ what: '할인액을 버림한다.', why: '테스트가 900을 기대한다.', rejected: null }],
      readingOrder: [{ path: 'a.ts', note: 'n' }, { path: 'a.spec.ts', note: 't' }],
      manualChecks: ['x'],
      untested: [],
    });
    const md = ReadingGuideDto.create({ ...base, explanation: e }).toMarkdown();
    expect(md).toContain('  - 할인액을 버림한다. 테스트가 900을 기대한다.');
    expect(ReadingGuideDto.create({ ...base, basis: 'main (a1b2c3d)' }).toMarkdown()).toContain('작업 기준: main (a1b2c3d) · 고친 곳: 작업 트리(커밋 안 함)');
    expect(md).not.toContain('..');
  });

  it('멈췄을 때 안내서는 이유와 되돌리는 방법을 담는다', () => {
    const md = ReadingGuideDto.create({ ...base, status: 'stopped', stopReason: 'needs-support', explanation: null }).toMarkdown();
    expect(md).toContain('멈춤');
    expect(md).toContain('구현 시니어(sonnet)까지 실패했습니다');
    expect(md).not.toContain('2단계에서 붙입니다');
    expect(md).toContain('git checkout -- src/domain/money.ts');
    expect(md).toContain('git clean -f -- src/domain/money.spec.ts');
  });

  it('터미널 출력은 파일:줄을 하이퍼링크로 감싼다', () => {
    const out = ReadingGuideDto.create(base).toTerminal('E:\\work\\app');
    expect(out).toContain('\u001b]8;;file:///E:/work/app/src/domain/money.ts\u001b\\src/domain/money.ts:30\u001b]8;;\u001b\\');
  });
});

describe('ReadingGuideDto — 가정', () => {
  it('가정은 확인 여부와 함께 안내서 맨 위에 보여 준다', () => {
    const md = ReadingGuideDto.create({
      ...base,
      assumptions: [{ question: '원 미만 처리', chosen: '할인 후 금액을 버림', confirmed: false }],
    }).toMarkdown();
    const lines = md.split('\n');
    expect(lines[2]).toBe('알아서 정한 해석 (추천대로 진행했어요. 다르면 다시 요청해 주세요)');
    expect(lines[3]).toBe('  - 원 미만 처리 → 할인 후 금액을 버림');
  });
});

describe('ReadingGuideDto — 근거와 추측', () => {
  const decisionText = 'discount를 Money 메서드로 둠 — add·multiply와 같은 자리';
  const facts = {
    checked: [
      { kind: 'decision' as const, text: decisionText, evidence: [], verified: [{ kind: 'code' as const, path: 'src/domain/money.ts', line: 12, quote: 'add(other: Money): Money' }], isGuess: false },
      { kind: 'fact' as const, text: '할인율은 정수만 받는다', evidence: [], verified: [], isGuess: true },
      { kind: 'fact' as const, text: '응답 필드 이름은 email이다', evidence: [], verified: [], isGuess: true },
    ],
    reviewerGuesses: [{ kind: 'review' as const, text: '함수 이름이 어색하다', evidence: [], verified: [], isGuess: true }],
    unconfirmed: [{ kind: 'fact' as const, text: '응답 필드 이름은 email이다', evidence: [], verified: [], isGuess: true }],
    reviewRounds: 2,
    reviewMissing: false,
  };

  it('확인된 근거는 결정 옆에 쓰고, 근거 없는 추측 목록은 쓰지 않는다', () => {
    const md = ReadingGuideDto.create({ ...base, facts }).toMarkdown();
    expect(md).toContain('(근거: src/domain/money.ts:12)');
    expect(md).not.toContain('⚠ 추측');
    expect(md).not.toContain('할인율은 정수만 받는다');
  });

  it('확인 필요는 맨 위에 두고, 리뷰어 추측은 쓰지 않는다', () => {
    const md = ReadingGuideDto.create({ ...base, facts }).toMarkdown();
    const lines = md.split('\n');
    expect(lines.findIndex((l) => l.startsWith('⚠ 확인 필요'))).toBeLessThan(lines.findIndex((l) => l.startsWith('읽는 순서')));
    expect(md).not.toContain('리뷰어 추측');
    expect(md).not.toContain('함수 이름이 어색하다');
    expect(md.split('응답 필드 이름은 email이다')).toHaveLength(2);
  });

  it('멈춘 이유 문장을 따로 꺼낼 수 있다 (요약 카드에 쓴다)', () => {
    expect(ReadingGuideDto.create({ ...base, status: 'stopped', stopReason: 'login-required' }).stopMessage()).toContain('rauha login');
    expect(ReadingGuideDto.create(base).stopMessage()).toBeNull();
  });

  it('멈춘 이유마다 다음에 무엇을 하면 되는지 알려 준다', () => {
    const msg = (stopReason: 'invalid-tests' | 'review-loop' | 'escalation-exhausted') => ReadingGuideDto.create({ ...base, status: 'stopped', stopReason }).stopMessage() ?? '';
    expect(msg('invalid-tests')).toContain('한 줄을 덧붙여');
    expect(msg('review-loop')).toContain('확인이 필요한 것');
    expect(msg('escalation-exhausted')).toContain('더 작게 나눠');
    expect(msg('escalation-exhausted')).not.toContain('다음 단계에서 붙입니다');
  });

  it('팀원이 한도·거절로 멈췄으면 그 이유를 멈춘 이유 뒤에 이어 보인다', () => {
    const stopped = { ...base, status: 'stopped' as const, stopReason: 'needs-support' as const, memberStop: '일을 30턴 하다가 턴 한도에 닿아 멈췄어요.' };
    expect(ReadingGuideDto.create(stopped).stopMessage()).toContain('구현 시니어(sonnet)까지 실패했습니다.');
    expect(ReadingGuideDto.create(stopped).stopMessage()).toContain('턴 한도에 닿아 멈췄어요');
    expect(ReadingGuideDto.create(stopped).toMarkdown()).toContain('턴 한도에 닿아 멈췄어요');
  });

  it('끝까지 마친 작업에는 팀원이 멈춘 이유를 붙이지 않는다', () => {
    const done = ReadingGuideDto.create({ ...base, memberStop: '일을 30턴 하다가 턴 한도에 닿아 멈췄어요.' });
    expect(done.stopMessage()).toBeNull();
    expect(done.toMarkdown()).not.toContain('턴 한도');
  });

  it('머리줄에 달러 비용을 쓰지 않는다', () => {
    const head = ReadingGuideDto.create({ ...base, costUsd: 0.123 }).toMarkdown().split('\n')[0]!;
    expect(head).not.toContain('$');
    expect(head).not.toContain('추정');
  });

  it('리뷰를 받았으면 머리줄에 리뷰 횟수를 쓴다', () => {
    expect(ReadingGuideDto.create({ ...base, facts }).toMarkdown().split('\n')[0]).toContain('완료(리뷰 2회)');
    expect(ReadingGuideDto.create(base).toMarkdown().split('\n')[0]).toContain('완료(리뷰 전)');
  });

  it('리뷰어 보고를 읽지 못했으면 알린다', () => {
    expect(ReadingGuideDto.create({ ...base, facts: { ...facts, reviewMissing: true } }).toMarkdown()).toContain('리뷰어 보고를 읽지 못한');
  });
});
