import { isDelegation, type Design } from '../domain/design.js';
import type { AccountBlock, ProgressPort, TeamMemberPort } from '../../orchestration/application/ports.js';
import type { ModelTier } from '../../orchestration/domain/team.js';
import { ToolKits } from '../../orchestration/domain/tool-kit.js';
import type { RoleSettingsDto } from '../../orchestration/application/dto/role-settings.dto.js';
import { stoppedMember } from '../../orchestration/application/member-stop-note.js';
import { DomainError } from '../../shared/domain-error.js';
import { DESIGN_SCHEMA } from './dto/design-schema.js';
import { DesignDocDto, DesignReplyDto, type DesignReply } from './dto/design.dto.js';
import type { DesignStorePort, DesignUserPort } from './ports.js';

export type { DesignApproval, DesignPlan, DesignQuestion, DesignStorePort, DesignUserPort } from './ports.js';

/** 사용자에게 한 번에 하나씩 묻는 질문 수 상한. 넘으면 모르는 것은 추천값으로 정하고 설계안을 쓰게 한다. */
const MAX_QUESTIONS = 8;
/** 설계안을 보고 사용자가 고쳐 달라고 할 수 있는 횟수 상한 */
const MAX_REVISIONS = 5;
/** 설계 팀원 호출 수 안전 상한(질문 8 + 고치기 5 + 형식 재시도) */
const MAX_CALLS = 20;

export interface DesignInput {
  readonly request: string;
  readonly repo: string;
  /** 저장소 지식 묶음, 지난 작업 기억, 앞 대화. 없으면 null */
  readonly knowledge: string | null;
  readonly memory: string | null;
  readonly conversation: string | null;
  /** 읽은 기준(`main (a1b2c3d)`). 모르면 null */
  readonly basis: string | null;
}

export interface DesignCost {
  readonly calls: number;
  readonly costUsd: number;
  readonly tier: ModelTier;
}

export type DesignResult = (
  | { readonly kind: 'approved'; readonly design: Design; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }
  /** 설계 팀원이 한도·도구 거절로 멈춤. message는 SDK가 준 이유와 부분 결과 */
  | { readonly kind: 'stopped'; readonly message: string }
  | { readonly kind: 'blocked'; readonly block: AccountBlock }
) & { readonly cost: DesignCost };

/** 대화 세션이 부르는 쪽. DesignService가 구현한다. */
export interface DesignPort {
  run(input: DesignInput): Promise<DesignResult>;
}

export interface DesignServiceDeps {
  readonly team: Pick<TeamMemberPort, 'run'>;
  readonly roles: RoleSettingsDto;
  readonly user: DesignUserPort;
  readonly store: DesignStorePort;
  readonly progress: ProgressPort;
  readonly today: () => string;
}

interface Dialog {
  readonly qa: { q: string; a: string }[];
  /** 마지막 설계안 문서와 사용자가 말한 고칠 점 */
  draft: string | null;
  note: string | null;
}

/**
 * 설계 대화: 설계 팀원이 한 번에 질문 하나씩 묻고, 충분하면 설계안을 내면, 문서로 저장해 사용자에게 승인받는다.
 * 고칠 점을 말하면 그것을 반영해 다시 쓴다. 승인된 설계만 돌려준다(작업으로 나누어 실행하는 일은 대화 세션이 한다).
 */
export class DesignService implements DesignPort {
  constructor(private readonly deps: DesignServiceDeps) {}

  async run(input: DesignInput): Promise<DesignResult> {
    const { team, roles, user, store, progress, today } = this.deps;
    const setting = roles.get('designer');
    const cost = { calls: 0, costUsd: 0, tier: setting.tier };
    const total = () => ({ ...cost });
    const dialog: Dialog = { qa: [], draft: null, note: null };
    let asked = 0;
    let revisions = 0;
    let feedback: string | null = null;
    let retried = false;

    while (cost.calls < MAX_CALLS) {
      progress.step('설계를 정리하는 중…', 'designer');
      const result = await team.run({
        role: 'designer',
        setting,
        outputSchema: DESIGN_SCHEMA,
        canWrite: () => false,
        kits: ToolKits.for('designer', input.request),
        userMessage: this.message(input, dialog, asked >= MAX_QUESTIONS, feedback),
      });
      cost.calls += 1;
      cost.costUsd += result.usage.costUsd;
      if (result.blocked) return { kind: 'blocked', block: result.blocked, cost: total() };
      const halt = stoppedMember(result);
      if (halt !== null) return { kind: 'stopped', message: halt.report(result.partial ?? null), cost: total() };

      let reply: DesignReply;
      try {
        reply = DesignReplyDto.from(result.output);
        if (reply.kind === 'ask' && asked >= MAX_QUESTIONS) throw new DomainError('TOO_MANY_QUESTIONS', '질문 한도를 넘었습니다. 더 묻지 말고 설계안을 쓰세요.');
        feedback = null;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        if (retried) return { kind: 'failed', message: error.message, cost: total() };
        retried = true;
        feedback = error.message;
        continue;
      }

      if (reply.kind === 'ask') {
        const answer = await user.discuss({ question: reply.question, suggestion: reply.suggestion, round: asked + 1 });
        if (answer === null) return { kind: 'cancelled', cost: total() };
        const delegated = answer.trim() === '' || isDelegation(answer);
        dialog.qa.push({ q: reply.question, a: delegated ? `rauha가 추천값으로 정함: ${reply.suggestion ?? '(추천 없음 — 이 코드베이스에 가장 맞는 쪽으로)'}` : answer.trim() });
        asked += 1;
        dialog.note = null;
        continue;
      }

      const markdown = DesignDocDto.toMarkdown(reply.design, { repo: input.repo, basis: input.basis, date: today(), request: input.request });
      const path = await store.save(fileName(reply.design.title, today()), markdown);
      const decision = await user.approve({ title: reply.design.title, summary: DesignDocDto.summary(reply.design), path });
      if (decision.kind === 'approve') return { kind: 'approved', design: reply.design, path, cost: total() };
      if (decision.kind === 'cancel') return { kind: 'cancelled', cost: total() };
      revisions += 1;
      if (revisions > MAX_REVISIONS) return { kind: 'cancelled', cost: total() };
      dialog.draft = markdown;
      dialog.note = decision.note;
    }
    return { kind: 'failed', message: '설계 팀원을 너무 많이 불러서 멈췄어요.', cost: total() };
  }

  private message(input: DesignInput, dialog: Dialog, mustDraft: boolean, feedback: string | null): string {
    return [
      `<today>${this.deps.today()}</today>`,
      input.knowledge ?? '',
      input.memory ?? '',
      input.conversation !== null ? `<conversation>\n${input.conversation}\n</conversation>` : '',
      `<request>\n${input.request}\n</request>`,
      dialog.qa.length > 0 ? `<dialog>\n${dialog.qa.map((x, i) => `질문 ${i + 1}: ${x.q}\n답: ${x.a}`).join('\n\n')}\n</dialog>` : '',
      dialog.draft !== null ? `<last_draft>\n${dialog.draft}\n</last_draft>` : '',
      dialog.note !== null ? `<revision>\n사용자가 설계안을 보고 말한 고칠 점입니다. 반영해서 설계안을 다시 쓰세요.\n${dialog.note}\n</revision>` : '',
      mustDraft ? '<limits>\n더 묻지 말고 지금까지의 답으로 설계안을 쓰세요. 모르는 것은 추천값으로 정하고 decisions에 by "rauha"로 남기세요.\n</limits>' : '',
      feedback !== null ? `<previous_attempt>\n지난 답이 거부됐습니다: ${feedback}\n</previous_attempt>` : '',
    ]
      .filter((p) => p !== '')
      .join('\n\n');
  }
}

/** `2026-10-29-쿠폰-할인.md` 같은 설계 문서 이름 */
function fileName(title: string, date: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${date}-${slug === '' ? 'design' : slug}.md`;
}
