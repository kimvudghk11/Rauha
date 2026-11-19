/**
 * 팀원 진행 글을 캐릭터 대화처럼(순수 규칙). 실제로 일어난 일(진행 글)은 바꾸지 않고 그대로 넣고,
 * 역할 성격·컨셉(스킨) 분위기는 앞뒤 말투로만 입힌다. 없던 일을 지어내지 않는다.
 * 작업(seed)마다 고르는 말이 달라지고, 같은 작업·같은 입력이면 늘 같은 말이다(다시 그려도 그대로).
 */
type Say = (m: string) => string;

/** 역할 무리: 넘겨받는 말(반응)을 고를 때 쓴다 */
type Group = 'build' | 'check' | 'make' | 'plan' | 'run';
const GROUP: Readonly<Record<string, Group>> = {
  implementer: 'build', frontend: 'build', backend: 'build', ios: 'build', android: 'build', crossplatform: 'build', splitter: 'build', dataengineer: 'build', debugger: 'build',
  tester: 'check', reviewer: 'check', qa: 'check', riskchecker: 'check', securitychecker: 'check', legal: 'check',
  writer: 'make', designer: 'make', uxdesigner: 'make', brand: 'make', productdesigner: 'make', graphic: 'make', copywriter: 'make', content: 'make', video: 'make', pr: 'make', marketer: 'make',
  intake: 'plan', chief: 'plan', planner: 'plan', pm: 'plan', bm: 'plan', md: 'plan', router: 'plan', surveyor: 'plan', answerer: 'plan', analyst: 'plan', growth: 'plan', performance: 'plan', sales: 'plan', recruiter: 'plan',
  operator: 'run', releaser: 'run', publisher: 'run', accountant: 'run', finops: 'run', ecommerce: 'run', logistics: 'run', support: 'run', voc: 'run',
};

const VOICES: Readonly<Record<string, readonly Say[]>> = {
  intake: [(m) => `좋아요, ${m}. 차근차근 가 볼게요.`, (m) => `${m}. 무엇을 바라는지부터 정확히 잡을게요.`, (m) => `${m}. 팀에 잘 나눠 줄게요.`, (m) => `${m}. 누가 제일 잘할지 보고 있어요.`],
  chief: [(m) => `${m}. 큰 그림부터 볼게요.`, (m) => `${m}. 방향은 제가 잡을게요.`, (m) => `${m}. 꼭 필요한 사람만 부를게요.`],
  planner: [(m) => `${m}. 순서를 정리해 둘게요.`, (m) => `${m}. 할 일을 작게 쪼개 볼게요.`, (m) => `${m}. 뭐부터 할지 줄 세워 볼게요.`, (m) => `${m}. 큰 덩어리부터 나눠 둘게요.`],
  tester: [(m) => `${m}. 실패하는 걸 먼저 봐야 안심돼요!`, (m) => `${m}. 빈틈이 없는지 찔러 볼게요.`, (m) => `${m}. 테스트가 말해 줄 거예요.`, (m) => `${m}. 경계값은 못 참죠.`],
  implementer: [(m) => `${m}! 손이 근질근질했어요.`, (m) => `${m}. 바로 고쳐 볼게요.`, (m) => `${m}. 깔끔하게 맞춰 놓을게요.`, (m) => `${m}. 초록불 보러 갑니다.`],
  reviewer: [(m) => `${m}… 꼼꼼히 볼게요.`, (m) => `${m}. 놓친 데가 없는지 한 번 더 볼게요.`, (m) => `${m}. 읽는 사람 입장에서 볼게요.`, (m) => `${m}. 이름 하나도 그냥 안 넘어가요.`],
  debugger: [(m) => `${m}. 단서를 따라가 볼게요.`, (m) => `${m}. 어디서 어긋났는지 찾는 중이에요.`, (m) => `${m}. 범인은 이 근처에 있어요.`],
  riskchecker: [(m) => `${m}. 위험한 건 없는지 볼게요.`, (m) => `${m}. 되돌릴 수 있는지도 확인할게요.`],
  securitychecker: [(m) => `${m}. 비밀이 새는 데는 없는지 볼게요.`, (m) => `${m}. 문단속은 제 몫이에요.`],
  releaser: [(m) => `${m}. 내보낼 준비 중이에요.`, (m) => `${m}. 버전과 기록을 맞춰 둘게요.`],
  publisher: [(m) => `${m}. 바깥에 보일 모습을 챙길게요.`, (m) => `${m}. 커밋 메시지도 예쁘게요.`],
  writer: [(m) => `${m}. 문장을 다듬는 중이에요.`, (m) => `${m}. 쉬운 말로 풀어 볼게요.`, (m) => `${m}. 한 번에 읽히게 써 볼게요.`],
  designer: [(m) => `${m}. 보기 좋게 맞춰 볼게요.`, (m) => `${m}. 경계를 어디에 둘지 그려 볼게요.`, (m) => `${m}. 큰 틀부터 그려 볼게요.`],
  uxdesigner: [(m) => `${m}. 쓰는 사람 손이 덜 가게요.`, (m) => `${m}. 한 번 더 누르게 하면 안 되죠.`],
  brand: [(m) => `${m}. 우리다운 느낌을 지킬게요.`, (m) => `${m}. 이름 하나에도 성격이 있어요.`],
  surveyor: [(m) => `${m}. 주변부터 살펴볼게요.`, (m) => `${m}. 비슷한 코드가 있는지 볼게요.`, (m) => `${m}. 지도부터 그려 둘게요.`],
  router: [(m) => `${m}. 누가 맡으면 좋을지 볼게요.`, (m) => `${m}. 딱 맞는 사람한테 넘길게요.`],
  answerer: [(m) => `${m}. 바로 답해 볼게요.`, (m) => `${m}. 확인한 것만 말할게요.`, (m) => `${m}. 짧고 정확하게 갈게요.`],
  operator: [(m) => `${m}. 돌아가는 걸 지켜볼게요.`, (m) => `${m}. 서버들 표정부터 볼게요.`],
  splitter: [(m) => `${m}. 나눠서 맡길게요.`],
  bm: [(m) => `${m}. 돈이 되는 쪽으로 볼게요.`, (m) => `${m}. 숫자가 맞아야 사업이죠.`],
  marketer: [(m) => `${m}. 어떻게 알릴지도 생각해 둘게요.`, (m) => `${m}. 누구한테 말할지가 먼저예요.`],
  growth: [(m) => `${m}. 숫자로 확인해 볼게요.`, (m) => `${m}. 실험 하나 걸어 볼까요.`],
  pm: [(m) => `${m}. 문제부터 또렷하게 잡을게요.`, (m) => `${m}. 이번에 안 할 것도 정할게요.`, (m) => `${m}. 성공 지표부터 정해 둘게요.`],
  md: [(m) => `${m}. 원가랑 마진부터 따져 볼게요.`, (m) => `${m}. 잘 팔릴 구성을 짜 볼게요.`],
  accountant: [(m) => `${m}. 영수증 한 장도 그냥 안 넘겨요.`, (m) => `${m}. 계정부터 맞춰 둘게요.`],
  finops: [(m) => `${m}. 새는 비용부터 막을게요.`, (m) => `${m}. 청구서를 한 줄씩 볼게요.`],
  analyst: [(m) => `${m}. 데이터가 뭐라는지 들어 볼게요.`, (m) => `${m}. 쿼리 한 번 돌려 볼게요.`],
  dataengineer: [(m) => `${m}. 데이터 길을 깔끔하게 닦을게요.`],
  legal: [(m) => `${m}. 문장 하나에도 책임이 있어요.`, (m) => `${m}. 조항부터 확인할게요.`, (m) => `${m}. 나중에 문제 될 문장은 지금 고쳐요.`],
  support: [(m) => `${m}. 고객 마음부터 읽을게요.`, (m) => `${m}. 친절하지만 정확하게요.`],
  voc: [(m) => `${m}. 목소리 큰 것보다 많은 것부터요.`],
  sales: [(m) => `${m}. 상대가 원하는 걸 먼저 볼게요.`, (m) => `${m}. 제안서는 짧고 굵게요.`, (m) => `${m}. 다음 미팅까지 이어지게요.`],
  recruiter: [(m) => `${m}. 좋은 사람 알아보는 눈 켤게요.`],
  qa: [(m) => `${m}. 출시 전에 다 눌러 볼게요.`, (m) => `${m}. 회귀는 제가 막아요.`, (m) => `${m}. 사용자처럼 엉뚱하게도 눌러 볼게요.`],
  frontend: [(m) => `${m}. 화면이 버벅이면 못 참죠.`, (m) => `${m}. 컴포넌트부터 볼게요.`],
  backend: [(m) => `${m}. 트랜잭션부터 챙길게요.`, (m) => `${m}. API 모양을 잡아 볼게요.`],
  ios: [(m) => `${m}. 심사 걸릴 데부터 볼게요.`, (m) => `${m}. SwiftUI 로 그려 볼게요.`],
  android: [(m) => `${m}. 기기별로 다 챙길게요.`, (m) => `${m}. Compose 로 가 볼게요.`],
  crossplatform: [(m) => `${m}. 한 번 짜서 두 군데서 돌게요.`],
  content: [(m) => `${m}. 저장하고 싶은 글로 만들게요.`, (m) => `${m}. 캘린더에 꽂아 둘게요.`],
  performance: [(m) => `${m}. ROAS 부터 볼게요.`, (m) => `${m}. 예산은 아껴 쓸게요.`],
  pr: [(m) => `${m}. 기자가 읽고 싶게요.`],
  copywriter: [(m) => `${m}. 첫 줄에서 멈추게 만들게요.`, (m) => `${m}. 한 단어씩 깎아 볼게요.`],
  video: [(m) => `${m}. 첫 2초에 붙잡을게요.`, (m) => `${m}. 콘티부터 그려 볼게요.`],
  productdesigner: [(m) => `${m}. 손에 쥐었을 때 느낌까지 볼게요.`, (m) => `${m}. 상세페이지 흐름을 잡을게요.`],
  graphic: [(m) => `${m}. 눈에 확 띄게 가 볼게요.`, (m) => `${m}. 사이즈별로 다 맞출게요.`],
  ecommerce: [(m) => `${m}. 스토어 노출부터 챙길게요.`, (m) => `${m}. 수수료 계산기 두드려 볼게요.`],
  logistics: [(m) => `${m}. 박스 하나까지 계산할게요.`, (m) => `${m}. 재고가 비면 안 되죠.`],
};

/** 컨셉(스킨) 분위기: 가끔 말끝에 붙는다 */
const SPICE: Readonly<Record<string, readonly string[]>> = {
  ocean: ['파도 오기 전에 끝낼게요.', '물살 타고 갑니다.', '산호 옆에서 정리할게요.'],
  forest: ['모닥불 꺼지기 전에 할게요.', '도토리 하나 걸고 해요.', '숲길 따라 가 볼게요.'],
  farm: ['해 지기 전에 거둘게요.', '밭 갈러 갑니다.', '닭 울기 전에 끝내요.'],
  space: ['교신 완료, 진행합니다.', '궤도에 올려 둘게요.', '관제탑, 들리나요?'],
  office: ['넵, 확인했습니다.', '회의 전까지 정리할게요.', '커피 한 잔 하고 갑니다.'],
  school: ['쉬는 시간 전까지 할게요!', '선생님, 저 할게요!', '필기 꼼꼼히 해 둘게요.'],
  cafe: ['주문 들어갑니다!', '샷 추가로 갈게요.', '따뜻할 때 드릴게요.'],
  fantasy: ['길드의 이름으로!', '이번 퀘스트도 깰게요.', '검 갈아 두겠습니다.'],
};

/** 넘겨받는 말. {p} 는 앞 사람 이름, {p이} 는 이름 + 받침에 맞는 이/가 */
const HANDOFF: Readonly<Record<'checkBuild' | 'planToBuild' | 'testToBuild' | 'fixAfterCheck' | 'toMake' | 'any', readonly string[]>> = {
  // 만든 것을 확인 팀원이 받을 때: 장난스럽게 따지기도 한다(사실 판정은 진행 글이 한다)
  checkBuild: ['{p}, 왜 이렇게 했어요!! …농담이고요, 꼼꼼히 볼게요.', '{p}님 거 넘겨받았어요. 냉정하게 볼게요!', '{p}, 이거 받았어요. 빈틈부터 찔러 볼게요.', '{p}, 오 생각보다 괜찮은데요? 그래도 봐야죠.'],
  // 계획을 받아 만드는 팀원이 받을 때
  planToBuild: ['오 {p}, 이거 좋은데요? 제가 더 만들어 볼게요.', '{p}, 받았어요! 바로 손댈게요.', '{p이} 잡아 준 대로 만들어 볼게요.', '{p}, 계획 깔끔하네요. 이대로 갑니다!'],
  // TDD: 테스트 팀원이 실패하는 테스트를 넘길 때
  testToBuild: ['{p}, 빨간불 잘 받았어요! 초록불로 바꿔 볼게요.', '{p이} 써 준 테스트대로 가 볼게요.', '{p}, 실패하는 거 확인했어요. 이제 제 차례!'],
  // 확인 팀원이 짚은 것을 받아 다시 만드는 팀원이 받을 때
  fixAfterCheck: ['{p}, 지적 고마워요. 제가 더 고쳐 볼게요.', '앗 {p}, 거기 놓쳤네요! 바로 고칠게요.', '{p} 말이 맞아요. 다시 손볼게요.'],
  // 쓰고 꾸미는 팀원이 받을 때
  toMake: ['오 이거 좋은데요, {p}! 제가 더 다듬어 볼게요.', '{p}, 재료 좋네요. 제가 살려 볼게요.', '{p}, 받았어요. 예쁘게 만들어 볼게요.'],
  any: ['{p}, 이어받을게요.', '{p}, 바통 받았어요!', '{p}, 수고했어요. 여기서부터 제가 할게요.', '{p}, 넘겨준 거 잘 받았어요.'],
};

/** 무대 말풍선(끝·멈춤): 컨셉마다 */
const BUBBLE: Readonly<Record<string, { readonly done: readonly string[]; readonly stopped: readonly string[] }>> = {
  ocean: { done: ['항구 도착!', '끝! 파도 탔다!', '그물 다 올렸어요!'], stopped: ['물살이 세요…', '닻 내렸어요'] },
  forest: { done: ['오늘 일 끝!', '도토리 다 모았다!', '숲 정리 끝!'], stopped: ['길을 잃었어요…', '잠깐 쉬어요'] },
  farm: { done: ['수확 끝!', '창고 가득!', '밭일 끝!'], stopped: ['비가 와요…', '트랙터 멈춤'] },
  space: { done: ['착륙 완료!', '임무 성공!', '교신 끝!'], stopped: ['신호 끊김…', '궤도 이탈'] },
  office: { done: ['결재 완료!', '퇴근각!', '보고 끝!'], stopped: ['보류됐어요', '회의 중…'] },
  school: { done: ['숙제 끝!', '참 잘했어요!', '종 쳤다!'], stopped: ['선생님 질문이요…', '쉬는 시간'] },
  cafe: { done: ['주문 나왔습니다!', '한 잔 완성!', '마감 끝!'], stopped: ['재료가 떨어졌어요', '잠시 준비 중'] },
  fantasy: { done: ['퀘스트 완료!', '승리했다!', '보물 획득!'], stopped: ['후퇴!', '마나 부족…'] },
};

const tidy = (m: string): string => m.trim().replace(/[.!…。]+$/, '');

/** 문자열·숫자로 만드는 고른 수(같은 입력이면 같은 값) */
function pick(...parts: readonly (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface VoiceOptions {
  /** 캐릭터 컨셉(스킨) id */
  readonly set?: string;
  /** 작업마다 다른 수(작업 id 로 만든다). 없으면 0 */
  readonly seed?: number;
}

/** 한 줄 말: 역할 성격의 말투 + 실제 진행 글(그대로) + 가끔 컨셉 분위기. index·seed 로 말투를 돌려 쓴다 */
export function voiceOf(role: string, message: string, index: number, options: VoiceOptions = {}): string {
  const m = tidy(message);
  const v = VOICES[role];
  if (v === undefined || v.length === 0) return `${m}.`;
  const seed = options.seed ?? 0;
  // 작업마다 역할별로 다른 자리에서 돌기 시작한다(seed 를 그냥 더하면 말투가 둘뿐인 팀원은 홀수 작업끼리 늘 같은 말이었다)
  const base = v[(Math.abs(index) + pick(role, seed, 'v')) % v.length]!(m);
  const spice = options.set === undefined ? undefined : SPICE[options.set];
  if (spice === undefined || pick(role, index, seed, 's') % 3 !== 0) return base;
  return `${base} ${spice[pick(role, index, seed) % spice.length]}`;
}

function handoffKind(from: string, to: string): keyof typeof HANDOFF {
  const a = GROUP[from];
  const b = GROUP[to];
  if (b === 'check' && (a === 'build' || a === 'make')) return 'checkBuild';
  if (b === 'build' && a === 'plan') return 'planToBuild';
  if (b === 'build' && from === 'tester') return 'testToBuild';
  if (b === 'build' && a === 'check') return 'fixAfterCheck';
  if (b === 'make') return 'toMake';
  return 'any';
}

/** 담당이 바뀔 때 넘겨받는 말(앞 사람 이름을 부른다) */
export function handoffLine(from: string, fromName: string, to: string, index: number, seed = 0): string {
  const kind = handoffKind(from, to);
  const list = HANDOFF[kind];
  // 반응 말은 셋 중 둘 꼴로, 나머지는 평범하게 이어받는다(늘 같은 반응이면 금방 질린다)
  const use = kind !== 'any' && pick(from, to, index, seed, 'k') % 3 === 0 ? HANDOFF.any : list;
  return use[pick(from, to, index, seed) % use.length]!.replace('{p이}', withSubject(fromName)).replace('{p}', fromName);
}

/** 이름 + 주격 조사(받침이 있으면 이, 없거나 한글이 아니면 가): 기획이 · 나래가 · MD가 */
function withSubject(name: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
  return `${name}${batchim ? '이' : '가'}`;
}

/** 무대 말풍선: 끝·멈춤 말을 컨셉마다 작업(seed)마다 고른다 */
export function stageBubble(set: string, status: 'done' | 'stopped', seed: number): string {
  const b = BUBBLE[set] ?? BUBBLE['ocean']!;
  const list = b[status];
  // 시간대(seed % 3)와 따로 고른다: 그냥 seed % 3 이면 밤 무대는 늘 같은 말풍선이었다
  return list[pick(set, status, seed) % list.length]!;
}

/** 작업 id 같은 글을 seed 수로 */
export function seedOf(text: string): number {
  return pick(text);
}

export interface NoteLike {
  readonly role: string | null;
  readonly roleName: string | null;
  readonly message: string;
}

export interface ChatLine {
  readonly role: string;
  readonly who: string;
  readonly text: string;
}

/** 진행 글들을 팀 대화 줄로: 팀원 줄만, 마지막 max 개, 담당이 바뀌면 앞 사람을 부르며 넘겨받는 말을 앞에 */
export function teamChat(notes: readonly NoteLike[], max = 14, options: VoiceOptions = {}): ChatLine[] {
  const team = notes.filter((n): n is NoteLike & { role: string; roleName: string } => n.role !== null && n.roleName !== null);
  const seed = options.seed ?? 0;
  const out: ChatLine[] = [];
  team.forEach((n, i) => {
    const prev = team[i - 1];
    const handoff = prev !== undefined && prev.role !== n.role ? `${handoffLine(prev.role, prev.roleName, n.role, i, seed)} ` : '';
    out.push({ role: n.role, who: n.roleName, text: handoff + voiceOf(n.role, n.message, i, options) });
  });
  return out.slice(-max);
}
