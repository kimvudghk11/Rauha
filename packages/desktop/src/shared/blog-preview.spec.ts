import { describe, expect, it } from 'vitest';
import { blogPreview, type BlogPreviewState } from './blog-preview.js';
import type { RedactContext } from './blog-redact.js';
import { RecordEntry } from './record-book.js';

const ctx: RedactContext = { repoNames: ['payments-core'], companyNames: ['Acme Corp'], userName: 'kimbo', homePath: '/Users/kimbo' };
const state: BlogPreviewState = { length: 'detailed', titleIndex: 0, keep: [], snippets: [] };

const entry = RecordEntry.capture({
  id: 'r1',
  request: 'Acme Corp 결제 서버(secret-ledger) 타임아웃 원인 찾아줘',
  result: '원인은 10.20.30.40 의 DB 풀이 작아서였어요. ap-northeast-2 에서 arn:aws:iam::123456789012:role/pay 로 확인했어요. 키 AKIAIOSFODNN7EXAMPLE 는 폐기. 월 $300.',
  status: 'done',
  stopReason: null,
  roles: [],
  stages: ['원인 찾기'],
  queuedAt: '2026-11-01T10:00:00Z',
  endedAt: '2026-11-01T10:30:00Z',
  repo: 'secret-ledger',
  files: ['secret-ledger/src/a.ts', '.env'],
  approvals: [],
  direction: null,
}).withMemo('admin@acme.com 에게 alert, /Users/kimbo/work 에서');

describe('블로그 미리 보기', () => {
  it('회사·레포·IP·키·계정·리전·이메일·경로·금액이 어느 칸에도 남지 않는다', () => {
    const p = blogPreview([entry], ctx, state);
    const all = [p.markdown, ...p.titles, ...p.tags].join('\n');
    for (const leak of ['Acme', 'secret-ledger', 'payments-core', '10.20.30.40', 'AKIAIOSFODNN7EXAMPLE', '123456789012', 'ap-northeast-2', 'admin@', 'acme.com', '/Users/kimbo', 'kimbo', '$300', '.env']) {
      expect(all, leak).not.toContain(leak);
    }
  });

  it('작업 폴더에 없는 기록의 레포 이름도 자동으로 가린다', () => {
    const p = blogPreview([entry], { ...ctx, repoNames: [] }, state);
    expect(p.markdown).not.toContain('secret-ledger');
    expect(p.changes.some((c) => c.kind === 'repo' && c.original === 'secret-ledger')).toBe(true);
  });

  it('바뀐 목록을 되돌리면 그 이름만 글에 나타난다', () => {
    const p = blogPreview([entry], ctx, { ...state, keep: ['Acme Corp'] });
    expect(p.markdown).toContain('Acme Corp');
    expect(p.markdown).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(p.changes.find((c) => c.original === 'Acme Corp')?.kept).toBe(true);
  });

  it('기록이 없으면 글감이 없고 글도 비어 있다', () => {
    const p = blogPreview([], ctx, state);
    expect(p.hasMaterial).toBe(false);
    expect(p.markdown).toBe('');
  });

  it('고른 제목 번호가 범위를 넘어도 안전하다', () => {
    expect(blogPreview([entry], ctx, { ...state, titleIndex: 99 }).title).toBe(blogPreview([entry], ctx, { ...state, titleIndex: 2 }).title);
  });

  it('체크한 코드 조각만 들어가고 키가 든 조각도 가려진다', () => {
    const p = blogPreview([entry], ctx, { ...state, snippets: ['curl -H "x: sk-abcdefghijklmnopqrstuvwxyz" https://api.acme-corp.com'] });
    expect(p.markdown).toContain('curl');
    expect(p.markdown).not.toMatch(/sk-abcdef|acme-corp\.com/);
  });
});
