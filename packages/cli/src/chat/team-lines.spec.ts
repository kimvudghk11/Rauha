import { RoleSettingsDto } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { teamLines } from './team-lines.js';

describe('teamLines', () => {
  it('가장 긴 모델·노력 수준(sonnet · medium) 뒤에도 두 칸을 띄워 할 수 있는 일과 붙지 않는다', () => {
    const lines = teamLines(RoleSettingsDto.defaults());
    const rows = lines.filter((l) => / · (low|medium|high|xhigh|max)/.test(l));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row).toMatch(/(low|medium|high|xhigh|max) {2,}\S/);
  });

  it('팀원마다 이름·모델·노력 수준·쓰는 도구 종류를 한 줄씩 보여 준다', () => {
    const lines = teamLines(RoleSettingsDto.defaults());
    expect(lines.some((l) => l.includes('팀장') && l.includes('sonnet'))).toBe(true);
    expect(lines.some((l) => l.includes('운영 팀원') && l.includes('명령 실행'))).toBe(true);
  });

  it('파일을 고치는 팀원과 읽기만 하는 팀원을 구분해 적는다', () => {
    const lines = teamLines(RoleSettingsDto.defaults());
    expect(lines.find((l) => l.includes('구현 팀원'))).toContain('파일 수정');
    expect(lines.find((l) => l.includes('리뷰어'))).toContain('읽기만');
  });

  it('환경 변수로 고정한 모델이 반영된다', () => {
    const lines = teamLines(RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_TESTER: 'opus:high' }));
    expect(lines.find((l) => l.includes('테스트 팀원'))).toMatch(/opus.*high/);
  });
});

describe('teamLines — 부서별', () => {
  const lines = teamLines(RoleSettingsDto.defaults());
  const at = (text: string) => lines.findIndex((l) => l.includes(text));

  it('부서마다 제목 아래에 부서장과 팀원을 묶어 보여 준다', () => {
    for (const title of ['개발부', '기획·전략부', '마케팅·그로스부', '디자인부', '품질·보안부', '운영·유지보수부']) expect(at(title)).toBeGreaterThan(-1);
    expect(at('마케팅·그로스부')).toBeLessThan(at('마케팅 팀원'));
    expect(at('마케팅 팀원')).toBeLessThan(at('디자인부'));
  });

  it('부서장은 7년차 이상의 판단을 하는 상위 모델이라고 밝힌다', () => {
    expect(lines.some((l) => l.includes('부서장') && l.includes('opus'))).toBe(true);
  });

  it('개발부에는 접수 팀장과 테스트·구현·리뷰가, 회사 공통에는 대표(라우터)가 있다', () => {
    expect(at('개발부')).toBeLessThan(at('테스트 팀원'));
    expect(at('개발부')).toBeLessThan(at('구현 팀원'));
    expect(lines.some((l) => l.includes('대표') && l.includes('라우터'))).toBe(true);
  });

  it('모든 역할이 한 번씩 나온다', () => {
    for (const name of ['팀장', '디버깅 팀원', '위험 점검 팀원', '기획 팀원', '사업 모델 팀원', '그로스 팀원', 'UX 디자인 팀원', '브랜드 팀원', '보안 점검 팀원', '릴리스 팀원', '운영 팀원', '문서 팀원', '설계 팀원', '답변 팀원', '저장소 파악']) {
      expect(lines.filter((l) => l.includes(name)).length).toBeGreaterThan(0);
    }
  });
});

describe('teamLines — 할 수 있는 일 표현', () => {
  const lines = teamLines(RoleSettingsDto.defaults());

  it('읽기 전용 명령만 쓰는 팀원은 명령 실행이 아니라 조회 명령이라고 적는다', () => {
    for (const name of ['디버깅 팀원', '위험 점검 팀원', '보안 점검 팀원', '릴리스 팀원']) expect(lines.find((l) => l.includes(name)), name).toContain('읽기 + 조회 명령');
  });

  it('운영 팀원만 인프라를 바꾸는 명령 실행이라고 적는다', () => {
    expect(lines.find((l) => l.includes('운영 팀원'))).toContain('명령 실행');
    expect(lines.find((l) => l.includes('운영 팀원'))).not.toContain('조회');
  });
});

describe('teamLines 좁은 창', () => {
  it('한 줄에 안 들어가는 창에서는 할 수 있는 일을 다음 줄에 모델 칸에 맞춰 내리고, 어느 줄도 창을 넘지 않는다', async () => {
    const { displayWidth } = await import('../text-width.js');
    const lines = teamLines(RoleSettingsDto.defaults(), 60);
    const tester = lines.findIndex((l) => l.includes('테스트 팀원'));
    expect(lines[tester]).not.toContain('파일 수정');
    expect(lines[tester + 1]!.trim()).toBe('파일 수정 · 명령 실행');
    // 한글은 두 칸이라 글자 자리가 아니라 화면 칸으로 비교한다.
    expect(lines[tester + 1]!.indexOf('파일')).toBe(displayWidth(lines[tester]!.slice(0, lines[tester]!.indexOf('haiku'))));
    for (const line of lines.filter((l) => l.startsWith('    '))) expect(displayWidth(line)).toBeLessThanOrEqual(59);
  });

  it('넓은 창에서는 한 줄씩 그대로다', () => {
    const lines = teamLines(RoleSettingsDto.defaults(), 120);
    expect(lines.find((l) => l.includes('테스트 팀원'))).toContain('파일 수정 · 명령 실행');
  });
});
