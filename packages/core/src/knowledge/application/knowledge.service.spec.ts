import { describe, expect, it } from 'vitest';
import type { MemberCall, MemberResult, TeamMemberPort } from '../../orchestration/application/ports.js';
import { RoleSettingsDto } from '../../orchestration/application/dto/role-settings.dto.js';
import type { RepoFacts, RepoKnowledge } from '../domain/repo-knowledge.js';
import { RepoRef } from '../domain/repo-ref.js';
import { KnowledgeService } from './knowledge.service.js';
import type { KnowledgeStorePort, RepoReaderPort } from './ports.js';

const ref = (c: string, dirty = false) => RepoRef.of({ branch: 'main', commit: c.padEnd(40, '0'), dirty });

class FakeReader implements RepoReaderPort {
  ref: RepoRef | null = ref('a1');
  // 파일 1개를 바꿔도 "너무 많이 바뀜"(30%)에 걸리지 않을 만큼.
  fileList = ['src/domain/money.ts', 'src/domain/cart.ts', 'src/domain/order.ts', 'src/shared/format.ts', 'src/shared/errors.ts', 'package.json', 'README.md', 'tsconfig.json'];
  changed: { paths: string[] } | 'rebuild' = { paths: [] };
  async current() {
    return this.ref;
  }
  async files() {
    return [...this.fileList];
  }
  async facts(files: readonly string[]): Promise<RepoFacts> {
    const areas = [...new Set(files.map((f) => (f.includes('/') ? f.split('/').slice(0, 2).join('/') : '.')))].sort();
    return { totalFiles: files.length, dirs: areas.map((path) => ({ path, files: files.filter((f) => (f.includes('/') ? f.split('/').slice(0, 2).join('/') : '.') === path).length })), packageManager: 'yarn', scripts: {}, instructionFiles: [], testPattern: null };
  }
  async symbolsOf(paths: readonly string[]) {
    return new Map(paths.map((p) => [p, this.fileList.includes(p) ? (p.endsWith('.ts') ? ['X'] : []) : null] as const));
  }
  async changedSince() {
    return this.changed;
  }
  /** 내용 해시. 기본은 경로와 같은 값, 바꾸고 싶으면 content에 넣는다. */
  readonly content = new Map<string, string>();
  async hashes(paths: readonly string[]) {
    return new Map(paths.map((p) => [p, this.fileList.includes(p) ? (this.content.get(p) ?? `h:${p}`) : null] as const));
  }
}

class FakeStore implements KnowledgeStorePort {
  saved: RepoKnowledge | null = null;
  saves = 0;
  async load() {
    return this.saved;
  }
  async save(k: RepoKnowledge) {
    this.saved = k;
    this.saves += 1;
  }
}

class FakeTeam implements TeamMemberPort {
  readonly calls: MemberCall[] = [];
  constructor(private readonly reply: (call: MemberCall) => Partial<MemberResult> = (call) => ({ output: { notes: areasIn(call).map((area) => ({ area, text: `${area} 메모`, sources: [] })) } })) {}
  async run(call: MemberCall): Promise<MemberResult> {
    this.calls.push(call);
    return { output: null, error: null, fetched: [], usage: { model: 'haiku', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' }, ...this.reply(call) };
  }
}

/** 메시지의 <areas> 안에서 "## <영역>" 줄을 읽는다. */
function areasIn(call: MemberCall): string[] {
  return [...call.userMessage.matchAll(/^## (.+)$/gm)].map((m) => m[1] as string);
}

function service(reader = new FakeReader(), store = new FakeStore(), team = new FakeTeam()) {
  const steps: string[] = [];
  const svc = new KnowledgeService({ reader, store, team, roles: RoleSettingsDto.defaults(), progress: { step: (m) => void steps.push(m) }, repoName: 'shop' });
  return { svc, reader, store, team, steps };
}

describe('KnowledgeService', () => {
  it('처음에는 코드로 사실과 심볼을 만들고 조사 팀원에게 모든 영역 메모를 맡긴다', async () => {
    const { svc, store, team, steps } = service();
    const got = await svc.current();
    expect(team.calls.map((c) => c.role)).toEqual(['surveyor']);
    expect(areasIn(team.calls[0]!)).toEqual(['.', 'src/domain', 'src/shared']);
    expect(store.saves).toBe(1);
    expect(got?.block).toContain('basis="main (a100000)"');
    expect(got?.block).toContain('src/domain 메모');
    expect(steps).toContain('저장소를 처음 파악하는 중이에요');
    // 조사 팀원 토큰(입력 1 + 출력 1)을 센다. bench가 지식을 만드는 데 든 토큰을 따로 보여 준다.
    expect(svc.spentTokens()).toBe(2);
  });

  it('기준과 같고 바뀐 게 없으면 팀원을 부르지 않고 저장도 하지 않는다', async () => {
    const { svc, store, team } = service();
    await svc.current();
    await svc.current();
    expect(team.calls).toHaveLength(1);
    expect(store.saves).toBe(1);
  });

  it('커밋 안 한 변경이 그대로 남아 있으면 다시 조사하지 않는다', async () => {
    const { svc, reader, team } = service(undefined, undefined, new FakeTeam((call) => ({ output: { notes: areasIn(call).map((area) => ({ area, text: '메모', sources: [`${area}/money.ts`] })) } })));
    await svc.current();
    reader.ref = ref('a1', true);
    reader.fileList.push('src/domain/coupon.ts');
    reader.changed = { paths: ['src/domain/coupon.ts'] };
    await svc.current();
    await svc.current();
    expect(team.calls).toHaveLength(2);
  });

  it('바뀐 파일의 영역만 다시 조사한다', async () => {
    const { svc, reader, team } = service(undefined, undefined, new FakeTeam((call) => ({ output: { notes: areasIn(call).map((area) => ({ area, text: '메모', sources: [`${area}/money.ts`, `${area}/format.ts`] })) } })));
    await svc.current();
    reader.ref = ref('b2');
    reader.fileList.push('src/domain/coupon.ts');
    reader.changed = { paths: ['src/domain/coupon.ts'] };
    const got = await svc.current();
    expect(areasIn(team.calls[1]!)).toEqual(['src/domain']);
    expect(got?.basis.label()).toBe('main (b200000)');
  });

  it('기준 커밋이 사라졌으면 처음부터 다시 만든다', async () => {
    const { svc, reader, team } = service();
    await svc.current();
    reader.ref = ref('c3');
    reader.changed = 'rebuild';
    await svc.current();
    expect(areasIn(team.calls[1]!)).toEqual(['.', 'src/domain', 'src/shared']);
  });

  it('조사 팀원이 막히거나 실패해도 지식 묶음은 돌려준다', async () => {
    const { svc } = service(undefined, undefined, new FakeTeam(() => ({ output: null, error: 'x', blocked: { reason: 'usage-limit', message: '한도' } })));
    const got = await svc.current();
    expect(got?.block).toContain('src/domain 3');
  });

  it('git 저장소가 아니면 null', async () => {
    const reader = new FakeReader();
    reader.ref = null;
    expect(await service(reader).svc.current()).toBeNull();
  });

  it('작업이 끝나 바뀐 파일을 알리면 모델 없이 기준과 심볼만 고친다', async () => {
    const { svc, reader, store, team } = service();
    await svc.current();
    reader.ref = ref('d4', true);
    await svc.noteChanged(['src/domain/money.ts']);
    expect(team.calls).toHaveLength(1);
    expect(store.saved?.basis.label()).toBe('main (d400000) + 작업 트리 변경');
  });
});

describe('KnowledgeService.stored', () => {
  it('저장된 지식이 없으면 저장소를 읽지도 조사 팀원을 부르지도 않고 null을 돌려준다', async () => {
    const { svc, team, store } = service();
    expect(await svc.stored()).toBeNull();
    expect(team.calls).toEqual([]);
    expect(store.saves).toBe(0);
  });

  it('저장된 지식이 있으면 낡은 영역이 있어도 조사 없이 저장된 그대로 돌려준다', async () => {
    const { svc, team, reader } = service();
    await svc.current();
    const callsAfterBuild = team.calls.length;
    reader.ref = ref('b2');
    reader.changed = { paths: ['src/domain/money.ts'] };
    reader.content.set('src/domain/money.ts', 'changed');
    const got = await svc.stored();
    expect(got?.block).toContain('src/domain 메모');
    expect(team.calls.length).toBe(callsAfterBuild);
  });
});
