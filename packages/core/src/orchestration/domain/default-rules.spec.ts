import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { DefaultRulesDto } from '../application/dto/default-rules.dto.js';
import { DEFAULT_RULES, DefaultRuleSet } from './default-rules.js';
import { RuleBook } from './rule-book.js';
import { ToolRisk } from './tool-risk.js';

const book = (set: DefaultRuleSet): RuleBook => RuleBook.of(set.toRules());
const bash = (command: string) => ({ command });
const ROOT = 'E:/work/app';

describe('기본 규칙', () => {
  it('요구한 기본 규칙이 처음부터 모두 들어 있다', () => {
    const text = DEFAULT_RULES.map((r) => r.text).join('\n');
    for (const word of ['비밀 파일', '달러', '모름', 'aws configure', '보호 브랜치', '운영 인프라']) expect(text).toContain(word);
    expect(new Set(DEFAULT_RULES.map((r) => r.id)).size).toBe(DEFAULT_RULES.length);
  });

  it('처음 상태는 모두 켜져 있고 고친 것이 없다', () => {
    expect(DefaultRuleSet.initial().entries().every((e) => e.enabled && !e.edited)).toBe(true);
  });

  it('항상 지킬 것 기본 규칙은 팀원 프롬프트에 들어갈 글이 된다', () => {
    const texts = book(DefaultRuleSet.initial()).alwaysTexts(ROOT);
    expect(texts.some((t) => t.includes('달러'))).toBe(true);
    expect(texts.some((t) => t.includes('모름'))).toBe(true);
  });

  it('보호 브랜치 push·merge와 운영 인프라 변경은 꼭 허락받는다', () => {
    const b = book(DefaultRuleSet.initial());
    expect(b.verdictFor('Bash', 'git push origin main', ROOT)).toBe('ask');
    expect(b.verdictFor('Bash', 'git merge release', ROOT)).toBe('ask');
    expect(b.verdictFor('Bash', 'terraform apply -var env=prod', ROOT)).toBe('ask');
    expect(b.verdictFor('Bash', 'aws ec2 terminate-instances --instance-ids i-1', ROOT)).toBe('ask');
    expect(b.verdictFor('Bash', 'kubectl delete pod web', ROOT)).toBe('ask');
  });

  it('기본 git·aws 조회·검사 명령은 묻지 않는 쪽이다', () => {
    const b = book(DefaultRuleSet.initial());
    expect(b.verdictFor('Bash', 'git status', ROOT)).toBe('allow');
    expect(b.verdictFor('Bash', 'aws ec2 describe-instances --profile dev', ROOT)).toBe('allow');
    expect(b.verdictFor('Bash', 'yarn test', ROOT)).toBe('allow');
    expect(b.verdictFor('mcp__playwright__browser_navigate', 'mcp__playwright__browser_navigate', ROOT)).toBe('allow');
  });

  it('"꼭 허락"이 "묻지 않음"보다 앞선다(조회와 삭제가 한 규칙에 같이 맞아도 허락을 묻는다)', () => {
    expect(book(DefaultRuleSet.initial()).verdictFor('Bash', 'aws ec2 describe-instances && aws ec2 terminate-instances', ROOT)).toBe('ask');
  });

  it('기본 규칙의 "묻지 않음"은 기본 위험 판정(ToolRisk)이 묻는 명령을 풀어 주지 않는다', () => {
    const b = book(DefaultRuleSet.initial());
    // 기본 규칙 "묻지 않음"에 맞는 명령은 모두 ToolRisk도 허용한다(규칙이 있든 없든 같은 결과)
    const samples = ['git status', 'git diff HEAD~1', 'git log --oneline', 'git add src/a.ts', 'git fetch origin', 'aws ec2 describe-instances --profile dev', 'aws sts get-caller-identity', 'aws configure list', 'yarn test', 'yarn typecheck', 'yarn build', 'yarn lint', 'npm test', 'npm run test', 'npm run build', 'npm run lint', 'pnpm test', 'npx vitest run', 'npx tsc --noEmit', 'git show HEAD', 'git blame a.ts', 'aws iam list-users', 'claude auth status', 'claude mcp list', 'claude --version'];
    for (const command of samples) {
      expect(b.verdictFor('Bash', command, ROOT)).toBe('allow');
      expect(ToolRisk.assess('Bash', bash(command), ROOT).decision).toBe('allow');
    }
    // 규칙의 "묻지 않음" 경우마다 위 예시가 하나는 있어야 한다(새 경우를 더하면 예시도 더한다)
    const allowVariants = DEFAULT_RULES.filter((r) => r.bucket === 'allow').flatMap((r) => r.variants.filter((v) => v.tools.includes('Bash')));
    for (const v of allowVariants) expect(samples.some((s) => v.includes.every((w) => s.includes(w)))).toBe(true);
  });

  it('기본 규칙의 "꼭 허락"은 ToolRisk가 묻거나 거절하는 쪽과 같은 방향이다(풀어 주는 일이 없다)', () => {
    for (const command of ['terraform apply', 'terraform destroy', 'cdk deploy', 'kubectl delete pod x', 'aws ec2 terminate-instances', 'git merge main']) {
      expect(ToolRisk.assess('Bash', bash(command), ROOT).decision).not.toBe('allow');
    }
    expect(ToolRisk.assess('Bash', bash('git push origin main'), ROOT).decision).toBe('deny');
  });

  it('화면에 보이는 글에 달러 금액 표기를 쓰지 않는다(달러를 쓰지 말라는 규칙 글만 예외)', () => {
    for (const r of DEFAULT_RULES.filter((x) => x.id !== 'default:no-dollar')) expect(`${r.text}${r.note ?? ''}`).not.toMatch(/\$|달러/);
  });
});

describe('끄기·고치기·되돌리기', () => {
  it('끈 기본 규칙은 엔진 규칙에서 빠진다', () => {
    const off = DefaultRuleSet.initial().setEnabled('default:ask-infra', false);
    expect(book(off).verdictFor('Bash', 'terraform apply', ROOT)).toBeNull();
  });

  it('글과 찾을 글을 고치면 고친 모양으로 엔진에 간다', () => {
    const edited = DefaultRuleSet.initial().edit('default:ask-infra', { text: 'terraform apply만 허락', variants: [{ tools: ['Bash'], includes: ['terraform apply'] }] });
    expect(book(edited).verdictFor('Bash', 'terraform apply', ROOT)).toBe('ask');
    expect(book(edited).verdictFor('Bash', 'kubectl delete pod x', ROOT)).toBeNull();
    expect(edited.entries().find((e) => e.rule.id === 'default:ask-infra')).toMatchObject({ edited: true });
  });

  it('찾을 글 없이 고치거나 글을 비우면 막는다(항상 지킬 것은 글만)', () => {
    const set = DefaultRuleSet.initial();
    expect(() => set.edit('default:ask-infra', { text: 'x', variants: [] })).toThrow(DomainError);
    expect(() => set.edit('default:unknown', { text: ' ', variants: [] })).toThrow(DomainError);
    expect(() => set.edit('default:unknown', { text: '새 글', variants: [] })).not.toThrow();
  });

  it('하나만 되돌리거나 전부 되돌린다', () => {
    const set = DefaultRuleSet.initial().setEnabled('default:unknown', false).edit('default:no-dollar', { text: '다른 글', variants: [] });
    expect(set.restoreOne('default:unknown').disabledIds).toEqual([]);
    expect(set.restoreOne('default:unknown').editedEntries.size).toBe(1);
    const all = set.restoreAll();
    expect(all.disabledIds).toEqual([]);
    expect(all.editedEntries.size).toBe(0);
  });

  it('없는 기본 규칙은 다루지 않는다', () => {
    expect(() => DefaultRuleSet.initial().setEnabled('default:nope', false)).toThrow(DomainError);
  });
});

describe('DefaultRulesDto', () => {
  it('저장했다 읽어도 같다', () => {
    const set = DefaultRuleSet.initial().setEnabled('default:unknown', false).edit('default:ask-infra', { text: '내 글', variants: [{ tools: ['Bash'], includes: ['terraform apply'] }] });
    const back = DefaultRulesDto.from(JSON.parse(JSON.stringify(DefaultRulesDto.fromEntity(set)))).toEntity();
    expect(back.disabledIds).toEqual(['default:unknown']);
    expect(back.entries().find((e) => e.rule.id === 'default:ask-infra')?.rule.text).toBe('내 글');
  });

  it('깨진 파일은 기본 규칙으로 열고, 모르는 id·맞지 않는 고침은 버린다', () => {
    expect(DefaultRulesDto.from('엉망').toEntity().disabledIds).toEqual([]);
    const set = DefaultRulesDto.from({ disabled: ['default:nope', 'default:unknown'], edits: [{ id: 'default:ask-infra', text: 'x', variants: [] }, { id: 'default:nope', text: 'x', variants: [] }, 7] }).toEntity();
    expect(set.disabledIds).toEqual(['default:unknown']);
    expect(set.editedEntries.size).toBe(0);
  });

  it('화면용 목록에 켜짐·고침·안내 글을 담는다', () => {
    const view = DefaultRulesDto.view(DefaultRuleSet.initial().setEnabled('default:secrets', false));
    expect(view.find((v) => v.id === 'default:secrets')).toMatchObject({ enabled: false, edited: false });
    expect(view.find((v) => v.id === 'default:secrets')?.note).toContain('늘 켜져');
  });
});
