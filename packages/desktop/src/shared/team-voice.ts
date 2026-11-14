/**
 * 팀원 진행 글을 캐릭터 대화처럼(순수 규칙). 실제로 일어난 일(진행 글)은 바꾸지 않고 그대로 넣고,
 * 역할 성격은 앞뒤 말투로만 입힌다. 없던 일을 지어내지 않는다. 같은 입력이면 늘 같은 말(다시 그려도 그대로).
 */
type Voice = readonly ((m: string) => string)[];

const VOICES: Readonly<Record<string, Voice>> = {
  intake: [(m) => `좋아요, ${m}. 차근차근 가 볼게요.`, (m) => `${m}. 무엇을 바라는지부터 정확히 잡을게요.`, (m) => `${m}. 팀에 잘 나눠 줄게요.`],
  chief: [(m) => `${m}. 큰 그림부터 볼게요.`, (m) => `${m}. 방향은 제가 잡을게요.`],
  planner: [(m) => `${m}. 순서를 정리해 둘게요.`, (m) => `${m}. 할 일을 작게 쪼개 볼게요.`],
  tester: [(m) => `${m}. 실패하는 걸 먼저 봐야 안심돼요!`, (m) => `${m}. 빈틈이 없는지 찔러 볼게요.`, (m) => `${m}. 테스트가 말해 줄 거예요.`],
  implementer: [(m) => `${m}! 손이 근질근질했어요.`, (m) => `${m}. 바로 고쳐 볼게요.`, (m) => `${m}. 깔끔하게 맞춰 놓을게요.`],
  reviewer: [(m) => `${m}… 꼼꼼히 볼게요.`, (m) => `${m}. 놓친 데가 없는지 한 번 더 볼게요.`, (m) => `${m}. 읽는 사람 입장에서 볼게요.`],
  debugger: [(m) => `${m}. 단서를 따라가 볼게요.`, (m) => `${m}. 어디서 어긋났는지 찾는 중이에요.`],
  riskchecker: [(m) => `${m}. 위험한 건 없는지 볼게요.`, (m) => `${m}. 되돌릴 수 있는지도 확인할게요.`],
  securitychecker: [(m) => `${m}. 비밀이 새는 데는 없는지 볼게요.`, (m) => `${m}. 문단속은 제 몫이에요.`],
  releaser: [(m) => `${m}. 내보낼 준비 중이에요.`, (m) => `${m}. 버전과 기록을 맞춰 둘게요.`],
  publisher: [(m) => `${m}. 바깥에 보일 모습을 챙길게요.`],
  writer: [(m) => `${m}. 문장을 다듬는 중이에요.`, (m) => `${m}. 쉬운 말로 풀어 볼게요.`],
  designer: [(m) => `${m}. 보기 좋게 맞춰 볼게요.`],
  uxdesigner: [(m) => `${m}. 쓰는 사람 손이 덜 가게요.`],
  brand: [(m) => `${m}. 우리다운 느낌을 지킬게요.`],
  surveyor: [(m) => `${m}. 주변부터 살펴볼게요.`, (m) => `${m}. 비슷한 코드가 있는지 볼게요.`],
  router: [(m) => `${m}. 누가 맡으면 좋을지 볼게요.`],
  answerer: [(m) => `${m}. 바로 답해 볼게요.`],
  operator: [(m) => `${m}. 돌아가는 걸 지켜볼게요.`],
  splitter: [(m) => `${m}. 나눠서 맡길게요.`],
  bm: [(m) => `${m}. 돈이 되는 쪽으로 볼게요.`],
  marketer: [(m) => `${m}. 어떻게 알릴지도 생각해 둘게요.`],
  growth: [(m) => `${m}. 숫자로 확인해 볼게요.`],
};

const tidy = (m: string): string => m.trim().replace(/[.!…。]+$/, '');

/** 한 줄 말: 역할 성격의 말투 + 실제 진행 글(그대로). index 로 말투를 돌려 쓴다 */
export function voiceOf(role: string, message: string, index: number): string {
  const m = tidy(message);
  const v = VOICES[role];
  if (v === undefined || v.length === 0) return `${m}.`;
  return v[Math.abs(index) % v.length]!(m);
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

/** 진행 글들을 팀 대화 줄로: 팀원 줄만, 마지막 max 개, 담당이 바뀌면 "○○, 이어받을게요." 를 앞에 */
export function teamChat(notes: readonly NoteLike[], max = 14): ChatLine[] {
  const team = notes.filter((n): n is NoteLike & { role: string; roleName: string } => n.role !== null && n.roleName !== null);
  const out: ChatLine[] = [];
  team.forEach((n, i) => {
    const prev = team[i - 1];
    const handoff = prev !== undefined && prev.role !== n.role ? `${prev.roleName}, 이어받을게요. ` : '';
    out.push({ role: n.role, who: n.roleName, text: handoff + voiceOf(n.role, n.message, i) });
  });
  return out.slice(-max);
}
