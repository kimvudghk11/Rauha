import { describe, expect, it } from 'vitest';
import { RepoDigest, type DigestRepo } from './repo-digest.js';

const repo = (name: string, extra: Partial<DigestRepo> = {}): DigestRepo => ({
  name,
  root: `E:/work/${name}`,
  branch: 'main',
  tags: [],
  commits: [{ hash: 'abc1234', at: '2026-11-17', author: '김', subject: `${name} 고침` }],
  changelog: null,
  ...extra,
});

describe('RepoDigest', () => {
  it('체인지로그·커밋·변경 내역을 묻는 말이면 rauha 가 먼저 모은다', () => {
    expect(RepoDigest.asks('모든 레포 체인지로그랑 커밋 다 봐줘')).toBe(true);
    expect(RepoDigest.asks('최근 변경 내역 정리해줘')).toBe(true);
    expect(RepoDigest.asks('CHANGELOG 기준으로 뭐가 바뀌었어?')).toBe(true);
    expect(RepoDigest.asks('릴리스 노트 뽑아줘')).toBe(true);
  });

  it('커밋·변경 이야기가 없는 질문이면 모으지 않는다', () => {
    expect(RepoDigest.asks('이 함수 왜 null 을 돌려줘?')).toBe(false);
  });

  it('묶음에는 모든 저장소가 빠짐없이 들어가고 저장소마다 한 항목으로 답하라고 적는다', () => {
    const block = RepoDigest.block([repo('a'), repo('b'), repo('c')]);
    expect(block).toContain('저장소 3개');
    for (const name of ['a', 'b', 'c']) expect(block).toContain(`■ ${name}`);
    expect(block).toContain('저장소마다 한 항목');
  });

  it('CHANGELOG 앞부분과 태그를 그대로 싣는다', () => {
    const block = RepoDigest.block([repo('a', { tags: ['v1.2.0'], changelog: { path: 'CHANGELOG.md', head: '## 1.2.0\n- 결제 취소 추가' } })]);
    expect(block).toContain('v1.2.0');
    expect(block).toContain('- 결제 취소 추가');
    expect(block).toContain('CHANGELOG.md');
  });

  it('CHANGELOG 가 없는 저장소는 없다고 적는다(지어내지 않게)', () => {
    expect(RepoDigest.block([repo('a')])).toContain('CHANGELOG 없음');
  });

  it('저장소가 많으면 저장소마다 실을 글 길이를 줄여 전체가 넘치지 않는다', () => {
    const long = { path: 'CHANGELOG.md', head: 'x'.repeat(10_000) };
    const many = Array.from({ length: 30 }, (_, i) => repo(`r${i}`, { changelog: long }));
    const block = RepoDigest.block(many);
    expect(block.length).toBeLessThan(100_000);
    for (let i = 0; i < 30; i += 1) expect(block).toContain(`■ r${i} `);
  });

  it('rauha 가 이미 본 곳(저장소 루트와 CHANGELOG 경로)을 돌려준다', () => {
    const seen = RepoDigest.seen([repo('a', { changelog: { path: 'CHANGELOG.md', head: '' } }), repo('b')]);
    expect(seen).toEqual(['E:/work/a', 'E:/work/a/CHANGELOG.md', 'E:/work/b']);
  });

  it('모은 저장소가 없으면 빈 글', () => {
    expect(RepoDigest.block([])).toBe('');
  });
});
