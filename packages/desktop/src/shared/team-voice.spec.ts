import { describe, expect, it } from 'vitest';
import { teamChat, voiceOf } from './team-voice.js';

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
  it('담당이 바뀌면 넘겨받는 말이 붙고, 같은 팀원이 이어 말하면 안 붙는다', () => {
    const lines = teamChat([
      { role: 'intake', roleName: '델피', message: '요청을 읽는 중' },
      { role: 'tester', roleName: '집게', message: '재현 테스트를 쓰는 중' },
      { role: 'tester', roleName: '집게', message: '테스트가 실패하는지 확인' },
    ]);
    expect(lines.map((l) => l.who)).toEqual(['델피', '집게', '집게']);
    expect(lines[1]!.text.startsWith('델피, 이어받을게요.')).toBe(true);
    expect(lines[2]!.text.includes('이어받을게요')).toBe(false);
  });
  it('팀원이 아닌 줄(role 없음)은 빼고, 마지막 n 개만', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: 'implementer', roleName: '토비', message: `단계 ${i}` }));
    expect(teamChat([{ role: null, roleName: null, message: 'system' }, ...many], 12)).toHaveLength(12);
  });
});
