import { describe, expect, it } from 'vitest';
import { SpokenText } from './spoken.js';

describe('받아쓴 말 다듬기', () => {
  it('앞에 이름을 부른 말이면 이름을 떼고 나머지를 명령으로 본다', () => {
    expect(SpokenText.of('델피야, 로그인 버그 좀 고쳐 줘.').afterName()).toEqual({ called: true, rest: '로그인 버그 좀 고쳐 줘.' });
    expect(SpokenText.of(' 테일피아 로그인 버그 좀 고쳐져').afterName()).toEqual({ called: true, rest: '로그인 버그 좀 고쳐져' });
    expect(SpokenText.of('야 델피 오늘 할 일 정리해 줘').afterName()).toEqual({ called: true, rest: '오늘 할 일 정리해 줘' });
    expect(SpokenText.of('Delphi!').afterName()).toEqual({ called: true, rest: '' });
  });

  it('이름이 없으면 부른 것이 아니다', () => {
    expect(SpokenText.of('오늘 할 일 정리해 줘').afterName().called).toBe(false);
    expect(SpokenText.of('델리 만쥬 먹고 싶다').afterName().called).toBe(false);
  });

  it('받아쓰기 모델이 조용할 때 지어내는 말은 빈 말로 본다', () => {
    expect(SpokenText.of(' 시청해 주셔서 감사합니다.').isEmpty).toBe(true);
    expect(SpokenText.of('감사합니다.').isEmpty).toBe(true);
    expect(SpokenText.of('...').isEmpty).toBe(true);
    expect(SpokenText.of('MBC 뉴스 김철수입니다.').isEmpty).toBe(true);
    expect(SpokenText.of('오늘 할 일 정리해줘.').isEmpty).toBe(false);
  });

  it('취소하는 말을 알아듣는다', () => {
    expect(SpokenText.of('취소').isCancel).toBe(true);
    expect(SpokenText.of('아니야 됐어.').isCancel).toBe(true);
    expect(SpokenText.of('아무것도 아니야').isCancel).toBe(true);
    expect(SpokenText.of('취소 버튼 색 바꿔 줘').isCancel).toBe(false);
  });

  it('맡길 글은 앞뒤 공백과 끝 마침표 하나만 정리한다', () => {
    expect(SpokenText.of('  오늘 할 일 정리해줘.  ').forTask()).toBe('오늘 할 일 정리해줘');
  });
});
