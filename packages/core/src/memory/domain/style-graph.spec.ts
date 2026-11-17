import { describe, expect, it } from 'vitest';
import { StyleGraph, StyleSignal, mergeClaudeMd, mergeLanguageSetting, STYLE_BEGIN, STYLE_END } from './style-graph.js';

const pref = (key: string, text: string, over: Partial<{ topic: string; quote: string; value: string | null }> = {}) => ({
  key,
  topic: (over.topic ?? 'format') as 'format',
  text,
  quote: over.quote ?? text,
  value: over.value ?? null,
});

describe('StyleGraph — 사용자 말투·형식 취향 그래프', () => {
  it('처음 배운 취향은 활성 취향이 되고 주제 점에 이어진다', () => {
    const g = StyleGraph.empty().learn([pref('answer-length', '답은 짧게 핵심만')], '2026-11-17T10:00:00Z');
    expect(g.active().map((n) => n.text)).toEqual(['답은 짧게 핵심만']);
    expect(g.edges()).toContainEqual(expect.objectContaining({ kind: 'about', to: 'topic:format' }));
  });

  it('같은 키·같은 말을 다시 들으면 새 점을 만들지 않고 무게만 올린다', () => {
    const g = StyleGraph.empty()
      .learn([pref('answer-length', '답은 짧게 핵심만')], '2026-11-17T10:00:00Z')
      .learn([pref('answer-length', '답은 짧게 핵심만')], '2026-11-17T11:00:00Z');
    expect(g.active()).toHaveLength(1);
    expect(g.active()[0]).toMatchObject({ weight: 2, lastAt: '2026-11-17T11:00:00Z' });
  });

  it('같은 키에 다른 말이 오면 새 취향이 옛 취향을 대신하고 replaces 선을 남긴다', () => {
    const g = StyleGraph.empty()
      .learn([pref('answer-length', '답은 짧게')], '2026-11-17T10:00:00Z')
      .learn([pref('answer-length', '답은 자세하게, 근거까지')], '2026-11-17T12:00:00Z');
    expect(g.active().map((n) => n.text)).toEqual(['답은 자세하게, 근거까지']);
    expect(g.edges()).toContainEqual(expect.objectContaining({ kind: 'replaces' }));
  });

  it('무게가 큰 것, 그다음 최근 것이 앞이고 상한까지만 쓴다', () => {
    let g = StyleGraph.empty();
    for (let i = 0; i < 30; i += 1) g = g.learn([pref(`k-${i}`, `취향 ${i}`)], `2026-11-17T10:${String(i).padStart(2, '0')}:00Z`);
    g = g.learn([pref('k-3', '취향 3')], '2026-11-17T11:00:00Z');
    expect(g.active()).toHaveLength(20);
    expect(g.active()[0]!.text).toBe('취향 3');
    expect(g.active()[1]!.text).toBe('취향 29');
  });

  it('이상한 키·빈 말·너무 긴 말은 배우지 않는다', () => {
    const g = StyleGraph.empty().learn([pref('Bad Key!', 'x'), pref('ok', '   '), pref('long', 'a'.repeat(400))], '2026-11-17T10:00:00Z');
    expect(g.active()).toEqual([]);
  });

  it('지운 취향은 활성에서 빠지고, 그 키를 다시 들으면 새로 배운다', () => {
    const g = StyleGraph.empty().learn([pref('tone', '반말 금지')], '2026-11-17T10:00:00Z');
    const id = g.active()[0]!.id;
    const gone = g.forget(id);
    expect(gone.active()).toEqual([]);
    expect(gone.learn([pref('tone', '반말 금지')], '2026-11-17T11:00:00Z').active()).toHaveLength(1);
  });

  it('팀원 프롬프트에 넣을 글은 활성 취향 목록이고, 없으면 빈 글이다', () => {
    expect(StyleGraph.empty().promptBlock()).toBe('');
    const g = StyleGraph.empty().learn([pref('accuracy', '추측하지 말고 확인한 것만')], '2026-11-17T10:00:00Z');
    expect(g.promptBlock()).toContain('- 추측하지 말고 확인한 것만');
  });

  it('언어 취향(key=language)의 값은 소문자 영어 단어만 settings.json 언어로 쓴다', () => {
    const g = StyleGraph.empty().learn([pref('language', '답은 한국어로', { topic: 'language', value: 'korean' })], '2026-11-17T10:00:00Z');
    expect(g.language()).toBe('korean');
    expect(StyleGraph.empty().learn([pref('language', 'x', { topic: 'language', value: 'Korean; rm' })], 'z').language()).toBeNull();
  });

  it('저장했다 읽어도 같고, 깨진 저장본은 빈 그래프로 연다', () => {
    const g = StyleGraph.empty().learn([pref('tone', '존댓말')], '2026-11-17T10:00:00Z');
    expect(StyleGraph.from(JSON.parse(JSON.stringify(g.toJSON()))).active()).toEqual(g.active());
    expect(StyleGraph.from('junk').active()).toEqual([]);
    expect(StyleGraph.from({ nodes: [{ id: 1 }], edges: 'x' }).active()).toEqual([]);
  });
});

describe('StyleSignal — 취향을 말한 것 같은 문장만 모델에 보낸다', () => {
  it.each(['앞으로는 답을 짧게 해줘', '추측 말고 확인한 것만 말해', '항상 한국어로 답해줘', '이런 말투 싫어', '표로 정리해 주면 좋겠어', 'from now on answer in English'])('%j 는 취향 신호다', (text) => {
    expect(StyleSignal.likely(text)).toBe(true);
  });

  it.each(['Money.add 고쳐줘', 'README 에 설치 방법 추가', '결제가 왜 두 번 깎여?', ''])('%j 는 아니다', (text) => {
    expect(StyleSignal.likely(text)).toBe(false);
  });
});

describe('CLAUDE.md 의 rauha 구역', () => {
  const block = `${STYLE_BEGIN}\n- 짧게\n${STYLE_END}`;

  it('구역이 없으면 사용자 글은 그대로 두고 끝에 붙인다', () => {
    expect(mergeClaudeMd('# 내 규칙\n- 커밋은 한국어\n', block)).toBe(`# 내 규칙\n- 커밋은 한국어\n\n${block}\n`);
    expect(mergeClaudeMd('', block)).toBe(`${block}\n`);
  });

  it('구역이 있으면 그 사이만 바꾼다', () => {
    const before = `위\n\n${STYLE_BEGIN}\n- 옛것\n${STYLE_END}\n\n아래\n`;
    expect(mergeClaudeMd(before, block)).toBe(`위\n\n${block}\n\n아래\n`);
  });

  it('비울 때(취향이 없을 때)는 구역만 지운다', () => {
    expect(mergeClaudeMd(`위\n\n${STYLE_BEGIN}\n- 옛것\n${STYLE_END}\n`, '')).toBe('위\n');
  });
});

describe('settings.json 의 language', () => {
  it('비어 있으면 넣고 rauha 가 넣었다고 기억한다', () => {
    expect(mergeLanguageSetting({ model: 'x' }, 'korean', false)).toEqual({ settings: { model: 'x', language: 'korean' }, owned: true });
  });

  it('사용자가 직접 정한 다른 언어는 덮지 않는다', () => {
    expect(mergeLanguageSetting({ language: 'japanese' }, 'korean', false)).toBeNull();
  });

  it('rauha 가 넣은 값이면 바꿀 수 있고, 같으면 바꾸지 않는다', () => {
    expect(mergeLanguageSetting({ language: 'english' }, 'korean', true)).toEqual({ settings: { language: 'korean' }, owned: true });
    expect(mergeLanguageSetting({ language: 'korean' }, 'korean', true)).toBeNull();
  });

  it('설정 파일이 객체가 아니면 건드리지 않는다', () => {
    expect(mergeLanguageSetting([], 'korean', false)).toBeNull();
    expect(mergeLanguageSetting(null, 'korean', false)).toEqual({ settings: { language: 'korean' }, owned: true });
  });
});
