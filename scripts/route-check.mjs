// 실제 모델로 라우터만 불러, 요청이 맞는 흐름·부서·팀원으로 가는지 본다(파일은 쓰지 않는다. 라우터는 sonnet·low 라 싸다).
// 쓰는 법: yarn workspace @rauha/core build && node scripts/route-check.mjs
// router.md 를 고친 뒤 돌려서 새 규칙이 옛 길을 깨지 않았는지 확인한다.
const core = await import(new URL('../packages/core/dist/index.js', import.meta.url).href);
const { ROUTE_SCHEMA } = await import(new URL('../packages/core/dist/orchestration/application/dto/schemas.js', import.meta.url).href);

const env = { ...process.env };
for (const k of Object.keys(env)) if (k === 'ELECTRON_RUN_AS_NODE' || k.startsWith('CLAUDECODE')) delete env[k];
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const prompts = await core.PromptLibrary.load(new URL('../prompts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const team = new core.AgentSdkTeamMember({ cwd: root, env, prompts, ask: async () => ({ kind: 'deny', note: null }), secrets: core.SecretPolicy.defaults(), secretFiles: () => [] });
const roles = core.RoleSettingsDto.defaults();

/** [요청, 흐름, 부서, 팀원] — 부서·팀원은 company 일 때만 */
const CASES = [
  ['AWS 이번 달 인프라 비용 얼마 나오는지 계산해줘', 'company', 'finance', 'finops'],
  ['이번 달 카드 지출 비용처리 어떻게 해야 해?', 'company', 'finance', 'accountant'],
  ['이 기능 PRD 써줘', 'company', 'planning', 'pm'],
  ['iOS 앱스토어 심사 준비 뭐 해야 해', 'company', 'engineering', 'ios'],
  ['플러터랑 리액트 네이티브 중에 뭐로 앱 만들까', 'company', 'engineering', 'crossplatform'],
  ['개인정보처리방침 초안 써줘', 'company', 'legal', 'legal'],
  ['메타 광고 예산 어떻게 짜', 'company', 'marketing', 'performance'],
  ['백엔드 개발자 채용 공고 써줘', 'company', 'people', 'recruiter'],
  ['앱 리뷰들 분석해서 뭐 고쳐야 할지 알려줘', 'company', 'customer', 'voc'],
  ['B2B 제안서 써줘', 'company', 'sales', 'sales'],
  ['출시 전 QA 체크리스트 짜줘', 'company', 'quality', 'qa'],
  ['가입 전환율 분석해줘', 'company', 'data', 'analyst'],
  ['앱스토어 설명 써줘', 'company', 'marketing', 'marketer'],
  ['내 S3 버킷 목록 보여줘', 'ops'],
  ['EC2 인스턴스 하나 중지해줘', 'ops'],
  ['README 정리해줘', 'task'],
  ['내 커밋 모아서 포폴 md 만들어줘', 'task'],
  ['PRD 써서 docs/prd.md 로 저장해줘', 'task'],
  ['결제 모듈에 할인 쿠폰 기능 추가해줘', 'feature'],
  ['Money.add 에서 반올림 버그 고쳐줘', 'work'],
  ['이 함수 어디서 써?', 'question'],
  ['테스트가 왜 깨져?', 'debug'],
];

let ok = 0;
for (const [text, mode, dept, member] of CASES) {
  const r = await team.run({ role: 'router', setting: roles.get('router'), userMessage: `<message>\n${text}\n</message>`, outputSchema: ROUTE_SCHEMA, canWrite: () => false });
  const o = r.output ?? {};
  const hit = o.mode === mode && (mode !== 'company' || (o.department === dept && o.member === member));
  if (hit) ok += 1;
  console.log(`${hit ? 'OK' : 'XX'}  ${text} -> ${o.mode}/${o.department}/${o.member}${r.error ? ` (${r.error})` : ''}`);
}
console.log(`${ok}/${CASES.length}`);
team.close();
process.exitCode = ok === CASES.length ? 0 : 1;
