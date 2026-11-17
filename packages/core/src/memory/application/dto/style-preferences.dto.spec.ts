import { describe, expect, it } from 'vitest';
import { StylePreferencesDto } from './style-preferences.dto.js';

const said = '앞으로는 추측 말고 확인한 것만 말해줘. 답은 한국어로!';

describe('StylePreferencesDto', () => {
  it('사용자 말에 실제로 있는 근거(quote)를 가진 취향만 받는다', () => {
    const dto = StylePreferencesDto.from(
      {
        preferences: [
          { key: 'accuracy', topic: 'accuracy', text: '추측하지 말고 확인한 것만 말한다', quote: '추측 말고 확인한 것만', value: null },
          { key: 'language', topic: 'language', text: '답은 한국어로', quote: '답은  한국어로', value: 'Korean' },
          { key: 'tone', topic: 'tone', text: '반말로', quote: '반말로 해줘', value: null },
        ],
      },
      said,
    );
    expect(dto.preferences.map((p) => p.key)).toEqual(['accuracy', 'language']);
    expect(dto.preferences[1]!.value).toBe('korean');
  });

  it('모양이 틀리거나 주제를 모르면 버린다', () => {
    expect(StylePreferencesDto.from({ preferences: [{ key: 1 }, { key: 'k', topic: 'mood', text: 't', quote: '추측', value: null }] }, said).preferences).toEqual([]);
    expect(StylePreferencesDto.from('x', said).preferences).toEqual([]);
  });
});
