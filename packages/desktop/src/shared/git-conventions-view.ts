import type { RepoConventions } from './repo-conventions.js';

/** 커밋·브랜치 입력 화면에 보여 줄 "이 레포의 기존 방식" 안내 */
export interface ConventionsView {
  readonly commit: {
    /** 읽어 낸 방식이 있다(없으면 text는 "아직 몰라요") */
    readonly known: boolean;
    readonly text: string;
    /** 제목 칸 placeholder에 쓰는 예시 */
    readonly example: string;
    /** 눌러서 제목 앞에 넣는 말머리 */
    readonly chips: readonly string[];
  };
  readonly branch: {
    /** 이 레포의 기존 브랜치에서 읽은 접두어인가(아니면 흔한 말머리 제안) */
    readonly fromRepo: boolean;
    readonly prefixes: readonly string[];
  };
}

const COMMON_PREFIXES = ['feature/', 'fix/', 'chore/'];

/** 도메인 값(RepoConventions)을 화면용 모양으로 바꾼다 */
export function conventionsView(c: RepoConventions): ConventionsView {
  const own = c.branch.prefix !== null && c.branch.prefix !== '';
  const branch = { fromRepo: own, prefixes: own ? [c.branch.prefix as string] : COMMON_PREFIXES };
  const s = c.commit;
  const word = (kind: 'ko' | 'en') => (kind === 'ko' ? 'Korean' : 'English');
  const sample = (kind: 'ko' | 'en') => (kind === 'ko' ? '로그인 버튼 추가' : 'add login button');
  switch (s.kind) {
    case 'conventional': {
      const top = s.types[0] ?? 'feat';
      const shape = s.scope ? `${top}(scope): text` : `${top}: text`;
      return {
        commit: {
          known: true,
          text: `This repo uses \`${shape}\` (${word(s.lang)}).`,
          example: s.scope ? `${top}(login): ${sample(s.lang)}` : `${top}: ${sample(s.lang)}`,
          chips: s.types.slice(0, 6).map((t) => (s.scope ? `${t}(` : `${t}: `)),
        },
        branch,
      };
    }
    case 'bracket':
      return { commit: { known: true, text: `This repo uses \`[${s.tag}] text\` (${word(s.lang)}).`, example: `[${s.tag}] ${sample(s.lang)}`, chips: [`[${s.tag}] `] }, branch };
    case 'ticket':
      return { commit: { known: true, text: `This repo starts with a ticket number (e.g. ${s.sample}).`, example: `${s.sample} ${sample(s.lang)}`, chips: [] }, branch };
    case 'plain':
      return { commit: { known: true, text: `This repo writes one line in ${word(s.lang)} with no prefix.`, example: sample(s.lang), chips: [] }, branch };
    case 'default':
      return { commit: { known: false, text: 'This repo\'s commit style is not known yet.', example: 'What changed, in one line', chips: [] }, branch };
  }
}
