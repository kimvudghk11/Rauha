import { describe, expect, it } from 'vitest';
import { asLead, handoffLine, stageBubble, teamChat, voiceOf } from './team-voice.js';

describe('팀원 말투(실제 진행 글은 그대로, 성격은 말투로만)', () => {
  it('역할마다 성격이 다르고, 진행 글이 문장 안에 그대로 들어 있다', () => {
    const msg = '재현 테스트를 쓰는 중';
    const tester = voiceOf('tester', msg, 0);
    const reviewer = voiceOf('reviewer', '변경을 검토하는 중', 0);
    expect(tester).toContain(msg);
    expect(reviewer).toContain('변경을 검토하는 중');
    expect(tester).not.toBe(voiceOf('implementer', msg, 0));
  });
  it('같은 입력이면 같은 말(다시 그려도 바뀌지 않음), 순서마다 말투가 조금씩 다름', () => {
    expect(voiceOf('tester', 'a', 3)).toBe(voiceOf('tester', 'a', 3));
    expect(new Set([0, 1, 2].map((i) => voiceOf('implementer', 'x', i))).size).toBeGreaterThan(1);
  });
  it('모르는 역할은 진행 글을 그대로', () => {
    expect(voiceOf('nobody', '읽는 중', 0)).toBe('읽는 중.');
  });
});

describe('팀 대화 줄', () => {
  it('담당이 바뀌면 앞 사람을 부르며 넘겨받는 말이 붙고, 같은 팀원이 이어 말하면 안 붙는다', () => {
    const lines = teamChat([
      { role: 'intake', roleName: '델피', message: '요청을 읽는 중' },
      { role: 'tester', roleName: '집게', message: '재현 테스트를 쓰는 중' },
      { role: 'tester', roleName: '집게', message: '테스트가 실패하는지 확인' },
    ]);
    expect(lines.map((l) => l.who)).toEqual(['델피', '집게', '집게']);
    expect(lines[1]!.text.startsWith('델피')).toBe(true);
    expect(lines[1]!.text).toContain('재현 테스트를 쓰는 중');
    expect(lines[2]!.text.startsWith('델피')).toBe(false);
  });

  it('만든 것을 확인 팀원이 넘겨받으면 장난스럽게 따지거나, 만드는 팀원이 넘겨받으면 반기며 더 해 보겠다고 한다', () => {
    const fromBuilder = Array.from({ length: 40 }, (_, i) => i).map((seed) => teamChat([{ role: 'implementer', roleName: '토비', message: '구현' }, { role: 'reviewer', roleName: '루루', message: '검토' }], 14, { seed })[1]!.text);
    expect(fromBuilder.some((t) => t.includes('왜 이렇게 했어요'))).toBe(true);
    const toMaker = Array.from({ length: 40 }, (_, i) => i).map((seed) => teamChat([{ role: 'planner', roleName: '보리', message: '계획' }, { role: 'implementer', roleName: '토비', message: '구현' }], 14, { seed })[1]!.text);
    expect(toMaker.some((t) => /좋은데요/.test(t) && /제가 더/.test(t))).toBe(true);
  });

  it('작업(seed)마다 말이 달라지고, 같은 작업이면 다시 그려도 같다', () => {
    const notes = [{ role: 'intake', roleName: '델피', message: '읽는 중' }, { role: 'implementer', roleName: '토비', message: '고치는 중' }, { role: 'reviewer', roleName: '루루', message: '보는 중' }];
    const texts = [1, 2, 3, 4, 5, 6, 7].map((seed) => teamChat(notes, 14, { seed }).map((l) => l.text).join('|'));
    expect(new Set(texts).size).toBeGreaterThan(3);
    expect(teamChat(notes, 14, { seed: 9 })).toEqual(teamChat(notes, 14, { seed: 9 }));
  });

  it('컨셉(스킨)에 맞는 말투가 섞인다: 카페는 주문, 우주는 교신, 왕국은 퀘스트', () => {
    const say = (set: string) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((seed) => voiceOf('implementer', '고치는 중', 0, { set, seed })).join(' ');
    expect(say('cafe')).toMatch(/주문/);
    expect(say('space')).toMatch(/교신|궤도/);
    expect(say('fantasy')).toMatch(/퀘스트|길드/);
  });

  it('새 부서 팀원도 자기 말투가 있다(진행 글은 그대로)', () => {
    for (const role of ['copywriter', 'video', 'md', 'ecommerce', 'logistics', 'productdesigner', 'graphic', 'pm', 'qa', 'frontend', 'legal']) {
      const t = voiceOf(role, '읽는 중', 0);
      expect(t, role).toContain('읽는 중');
      expect(t, role).not.toBe('읽는 중.');
    }
  });

  it('무대 말풍선: 끝·멈춤 말이 컨셉마다 다르고 작업마다 고른다', () => {
    expect(stageBubble('cafe', 'done', 0)).not.toBe(stageBubble('space', 'done', 0));
    expect(new Set([0, 1, 2, 3].map((s) => stageBubble('ocean', 'done', s))).size).toBeGreaterThan(1);
    expect(stageBubble('office', 'stopped', 1).length).toBeGreaterThan(0);
  });
  it('팀원이 아닌 줄(role 없음)은 빼고, 마지막 n 개만', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: 'implementer', roleName: '토비', message: `단계 ${i}` }));
    expect(teamChat([{ role: null, roleName: null, message: 'system' }, ...many], 12)).toHaveLength(12);
  });
});

describe('넘겨받는 말', () => {
  const lines = (from: string, name: string, to: string): string[] => Array.from({ length: 60 }, (_, i) => handoffLine(from, name, to, i % 7, i));

  it('계획을 받아 만드는 팀원은 받지도 않은 지적에 고마워하지 않는다', () => {
    for (const line of lines('planner', '기획', 'implementer')) expect(line).not.toMatch(/지적|고쳐/);
  });

  it('확인 팀원이 넘기면 만드는 팀원은 지적을 받아 고치겠다고 한다', () => {
    expect(lines('reviewer', '리뷰어', 'implementer').some((l) => /고치|고쳐|손볼/.test(l))).toBe(true);
  });

  it('만든 것을 확인 팀원이 받으면 가끔 "왜 이렇게 했어요!!" 하고 따진다', () => {
    expect(lines('implementer', '구현', 'reviewer').some((l) => l.includes('왜 이렇게 했어요!!'))).toBe(true);
  });

  it('테스트 팀원이 실패하는 테스트를 넘기면 구현 팀원은 지적이 아니라 빨간불·초록불로 받는다', () => {
    const got = lines('tester', '맛봄', 'implementer');
    for (const line of got) expect(line).not.toMatch(/지적/);
    expect(got.some((l) => /빨간불|초록불|테스트/.test(l))).toBe(true);
  });

  it('이름 뒤 조사는 받침에 맞춘다(기획이·나래가)', () => {
    const all = [...lines('planner', '기획', 'implementer'), ...lines('planner', '나래', 'implementer')].join('\n');
    expect(all).not.toMatch(/기획가|나래이/);
    expect(all).toMatch(/기획이 |나래가 /);
  });
});

describe('작업마다 다른 말', () => {
  it('작업(seed)이 바뀌면 같은 팀원도 같은 순서에서 다른 말투를 쓴다(홀수 작업끼리도)', () => {
    for (const role of ['qa', 'legal', 'bm', 'growth', 'pm', 'md', 'sales', 'planner', 'implementer', 'reviewer', 'tester', 'intake']) {
      const said = new Set([1, 3, 5, 7, 9, 11].map((seed) => voiceOf(role, '진행 중', 0, { seed })));
      expect(said.size, role).toBeGreaterThan(1);
    }
  });
});

describe('무대 말풍선', () => {
  it('같은 시간대(seed % 3 이 같은 작업)라도 끝 말풍선이 늘 같지는 않다', () => {
    const night = [2, 5, 8, 11, 14, 17, 20, 23].map((seed) => stageBubble('ocean', 'done', seed));
    expect(new Set(night).size).toBeGreaterThan(1);
  });
});

describe('컨셉 말끝', () => {
  it('바로 앞 줄과 같은 컨셉 말끝을 연달아 붙이지 않는다', () => {
    const roles = ['intake', 'tester', 'implementer', 'reviewer', 'writer', 'planner', 'qa', 'md', 'graphic', 'copywriter'];
    const spices = ['파도 오기 전에 끝낼게요.', '물살 타고 갑니다.', '산호 옆에서 정리할게요.'];
    for (let seed = 0; seed < 40; seed++) {
      const notes = roles.map((role) => ({ role, roleName: role, message: '진행 중' }));
      const chat = teamChat(notes, 20, { set: 'ocean', seed });
      const tail = chat.map((l) => spices.find((s) => l.text.endsWith(s)) ?? null);
      tail.forEach((s, i) => {
        if (s !== null && i > 0) expect(tail[i - 1], `seed ${seed} line ${i}`).not.toBe(s);
      });
    }
  });
});

describe('메인 채팅 Claude 진행 줄', () => {
  it('Claude(direct) 줄은 팀장(지배인) 줄로 그리고 다른 팀원 줄은 그대로 둔다', () => {
    const notes = asLead([
      { role: 'direct', roleName: 'Claude', message: '읽는 중: a.ts' },
      { role: 'tester', roleName: '테스트', message: '넘겨받았어요: 테스트' },
      { role: null, roleName: null, message: '작업 중…' },
    ]);
    expect(notes.map((n) => n.role)).toEqual(['intake', 'tester', null]);
    expect(notes[0]!.roleName).toBe('팀장');
    expect(teamChat(notes).length).toBe(2);
  });
});
