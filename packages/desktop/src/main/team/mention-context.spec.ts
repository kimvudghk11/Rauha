import { describe, expect, it } from 'vitest';
import { resolveMentions, type MentionReader } from './mention-context.js';

const reader = (files: Record<string, string | 'too-big' | 'secret'>): MentionReader => ({
  async read(path) {
    const f = files[path];
    if (f === undefined) return { ok: false, reason: 'missing' };
    if (f === 'too-big' || f === 'secret') return { ok: false, reason: f };
    return { ok: true, text: f };
  },
});

describe('resolveMentions', () => {
  it('읽은 파일은 경로·크기·앞부분을 담는다', async () => {
    const [f] = await resolveMentions('@src/a.ts 봐줘', reader({ 'src/a.ts': 'const a = 1;' }));
    expect(f?.path).toBe('src/a.ts');
    expect(f?.head).toBe('const a = 1;');
  });
  it('비밀 파일은 읽히지 않으니 목록에 없고 있다는 사실도 남지 않는다', async () => {
    expect(await resolveMentions('@.env.local @a/.env 봐줘', reader({ '.env.local': 'secret', 'a/.env': 'secret' }))).toEqual([]);
    expect(await resolveMentions('@config/app.json 봐줘', reader({ 'config/app.json': 'secret' }))).toEqual([]);
  });
  it('없는 파일은 뺀다', async () => {
    expect(await resolveMentions('@nope/x.ts', reader({}))).toEqual([]);
  });
  it('너무 커서 못 연 파일은 경로만 담는다', async () => {
    const [f] = await resolveMentions('@big/x.log', reader({ 'big/x.log': 'too-big' }));
    expect(f?.path).toBe('big/x.log');
    expect(f?.head).toBeNull();
  });
  it('작업 폴더 밖 경로 언급은 읽으려 하지도 않는다', async () => {
    let called = false;
    const spy: MentionReader = { read: async () => ((called = true), { ok: false, reason: 'x' }) };
    await resolveMentions('@../secret.ts @C:/x.ts', spy);
    expect(called).toBe(false);
  });
});
