import { describe, expect, it } from 'vitest';
import { BlogService } from './blog-service.js';

const ctx = { repoNames: ['bridge-backend'], companyNames: ['Acme'], userName: 'kimbo', homePath: '/Users/kimbo' };

function make(over: { draft?: (note: string) => Promise<string>; pick?: string | null } = {}) {
  const calls = { drafts: [] as string[], writes: [] as { path: string; text: string }[], picks: [] as string[] };
  const service = new BlogService({
    context: () => ctx,
    draft: async (note) => {
      calls.drafts.push(note);
      return over.draft ? over.draft(note) : '초안';
    },
    pickPath: async (name) => {
      calls.picks.push(name);
      return over.pick === undefined ? '/tmp/out/글' : over.pick;
    },
    write: async (path, text) => {
      calls.writes.push({ path, text });
    },
  });
  return { service, calls };
}

describe('블로그 서비스', () => {
  it('초안은 모델을 정확히 한 번 부르고 가린 글만 보낸다', async () => {
    const { service, calls } = make();
    const res = await service.draft({ note: 'Acme 와 bridge-backend 와 10.1.1.1', tone: 'plain' });
    expect(res).toEqual({ ok: true, text: '초안' });
    expect(calls.drafts).toHaveLength(1);
    for (const leak of ['Acme', 'bridge-backend', '10.1.1.1']) expect(calls.drafts[0]).not.toContain(leak);
  });

  it('잘못된 요청이면 모델을 부르지 않는다', async () => {
    const { service, calls } = make();
    expect((await service.draft({ note: '', tone: 'plain' })).ok).toBe(false);
    expect((await service.draft({ note: '글', tone: '이상한' })).ok).toBe(false);
    expect(calls.drafts).toHaveLength(0);
  });

  it('모델이 이름을 되살려 돌려줘도 한 번 더 가린다', async () => {
    const { service } = make({ draft: async () => 'Acme 서버 10.2.2.2 이야기' });
    const res = await service.draft({ note: '글', tone: 'friendly' });
    expect(res.ok && res.text).not.toMatch(/Acme|10\.2\.2\.2/);
  });

  it('모델 호출이 실패하면 오류 글을 돌려주고 내부 메시지는 새지 않는다', async () => {
    const { service } = make({ draft: async () => { throw new Error('token sk-abcdefghijklmnopqrstuvwxyz 거절'); } });
    const res = await service.draft({ note: '글', tone: 'plain' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('초안을 쓰지 못했어요') });
    expect(JSON.stringify(res)).not.toContain('sk-');
  });

  it('저장은 사용자가 고른 경로에 가린 글을 .md로 쓴다', async () => {
    const { service, calls } = make({ pick: '/home/u/글' });
    const res = await service.save({ markdown: '# 제목\nAcme 10.3.3.3', keep: [] });
    expect(res).toEqual({ ok: true, saved: true, name: '글.md' });
    expect(calls.picks).toEqual(['제목.md']);
    expect(calls.writes[0]?.path).toBe('/home/u/글.md');
    expect(calls.writes[0]?.text).not.toMatch(/Acme|10\.3\.3\.3/);
  });

  it('저장 대화상자를 닫으면 아무것도 쓰지 않는다', async () => {
    const { service, calls } = make({ pick: null });
    expect(await service.save({ markdown: '글' })).toEqual({ ok: true, saved: false, name: null });
    expect(calls.writes).toHaveLength(0);
  });
});
