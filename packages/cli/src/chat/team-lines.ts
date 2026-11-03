import { Department, ROLE_INFO, type MemberRole, type RoleSettingsDto } from '@rauha/core';
import { displayWidth } from '../text-width.js';

/** 개발부와 회사 공통은 작업 흐름이 따로 있어 부서 정의(Department)에 없다. */
const DEVELOPMENT: readonly MemberRole[] = ['intake', 'tester', 'implementer', 'reviewer'];
const COMMON: readonly { readonly role: MemberRole; readonly title?: string }[] = [{ role: 'router', title: '대표 (라우터)' }, { role: 'answerer' }, { role: 'surveyor' }, { role: 'writer' }, { role: 'designer' }, { role: 'splitter' }];

/** 팀원이 할 수 있는 일을 한 마디로. 명령 실행이 있으면 그것이 가장 큰 차이라 먼저 말한다. */
function ability(role: MemberRole, tools: readonly string[]): string {
  const edits = tools.includes('Edit') || tools.includes('Write');
  // 운영 팀원만 인프라를 바꾸는 명령을 실행한다(위험한 명령은 허락을 묻는다). 나머지 팀원의 명령은 프롬프트로 읽기용에 묶여 있다.
  if (tools.includes('Bash')) return edits ? '파일 수정 · 명령 실행' : role === 'operator' ? '명령 실행' : '읽기 + 조회 명령';
  if (edits) return '파일 수정';
  return tools.length === 0 ? '도구 없음' : '읽기만';
}

/**
 * /team: 회사 구성. 부서마다 부서장과 팀원의 모델·노력 수준·할 수 있는 일을 묶어 보여 준다.
 * 모델은 환경 변수로 고정한 값이 반영된 기본값이고, 작업 중에는 상태 머신이 올리기도 한다.
 */
export function teamLines(roles: RoleSettingsDto, columns = Number.POSITIVE_INFINITY): string[] {
  const row = (role: MemberRole, title?: string) => {
    const s = roles.get(role);
    return { name: title ?? ROLE_INFO[role].name, detail: `${s.tier} · ${s.effort}`, ability: ability(role, s.tools) };
  };
  const groups: { readonly title: string; readonly rows: ReturnType<typeof row>[] }[] = [
    { title: '개발부', rows: DEVELOPMENT.map((r) => row(r)) },
    ...Department.all().map((d) => ({ title: d.label, rows: [row('chief', '부서장'), ...d.members.map((m) => row(m.role))] })),
    { title: '회사 공통', rows: COMMON.map((c) => row(c.role, c.title)) },
  ];
  const all = groups.flatMap((g) => g.rows);
  const nameWidth = Math.max(...all.map((r) => displayWidth(r.name)));
  const detailWidth = Math.max(...all.map((r) => displayWidth(r.detail)));
  const pad = (s: string, width: number) => s + ' '.repeat(width - displayWidth(s));
  // 한 줄에 안 들어가면(좁은 창) 할 수 있는 일을 다음 줄의 모델 칸 자리로 내린다. 터미널이 접으면 맨 앞으로 떨어져 표가 깨진다.
  const rowLines = (r: ReturnType<typeof row>) => {
    const head = `    ${pad(r.name, nameWidth)}  `;
    const one = `${head}${pad(r.detail, detailWidth)}  ${r.ability}`;
    return displayWidth(one) <= columns - 1 ? [one] : [`${head}${r.detail}`, `${' '.repeat(displayWidth(head))}${r.ability}`];
  };
  return ['', '  rauha 회사 구성 (부서장은 7년차 이상의 판단을 하는 상위 모델로, 넓은 요청에서만 부르고 작은 요청은 팀원이 바로 해요)', ...groups.flatMap((g) => ['', `  ${g.title}`, ...g.rows.flatMap(rowLines)]), ''];
}
