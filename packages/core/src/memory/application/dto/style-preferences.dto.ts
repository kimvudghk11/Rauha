import { STYLE_TOPICS, type StylePreference, type StyleTopic } from '../../domain/style-graph.js';

export const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    preferences: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          topic: { type: 'string', enum: [...STYLE_TOPICS] },
          text: { type: 'string' },
          quote: { type: 'string' },
          value: { type: ['string', 'null'] },
        },
        required: ['key', 'topic', 'text', 'quote', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['preferences'],
  additionalProperties: false,
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 모델이 뽑은 취향(바깥 입력). 모양이 틀린 항목은 버리고, 근거(quote)가 사용자 말에 실제로 없으면 지어낸 것으로 보고 버린다.
 * 키·길이 같은 규칙 검사는 StyleGraph.learn 이 한 번 더 한다.
 */
export class StylePreferencesDto {
  private constructor(readonly preferences: readonly StylePreference[]) {}

  static from(raw: unknown, said: string): StylePreferencesDto {
    const list = isObject(raw) && Array.isArray(raw['preferences']) ? raw['preferences'] : [];
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const heard = norm(said);
    const out: StylePreference[] = [];
    for (const p of list.slice(0, 5)) {
      if (!isObject(p)) continue;
      const { key, topic, text, quote, value } = p;
      if (typeof key !== 'string' || typeof text !== 'string' || typeof quote !== 'string') continue;
      if (!STYLE_TOPICS.includes(topic as StyleTopic)) continue;
      if (quote.trim() === '' || !heard.includes(norm(quote))) continue;
      out.push({ key: key.trim(), topic: topic as StyleTopic, text, quote, value: typeof value === 'string' ? value.trim().toLowerCase() : null });
    }
    return new StylePreferencesDto(out);
  }
}
