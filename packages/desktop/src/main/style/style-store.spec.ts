import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StylePreference } from '@rauha/core';
import { StyleStore } from './style-store.js';

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-style-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const korean: StylePreference = { key: 'language', topic: 'language', text: '답은 한국어로', quote: '한국어로', value: 'korean' };
const noGuess: StylePreference = { key: 'no-guessing', topic: 'accuracy', text: '추측 말고 확인한 것만', quote: '추측 말고', value: null };

function store(config: string | null, prefs: readonly StylePreference[] = [korean, noGuess], file = join(temp(), 'style-graph.json')) {
  let calls = 0;
  const s = new StyleStore(file, {
    extract: async () => {
      calls += 1;
      return prefs;
    },
    configDir: () => config,
    now: () => '2026-11-17T10:00:00Z',
  });
  return { s, file, calls: () => calls };
}

describe('StyleStore', () => {
  it('취향 신호가 없는 일 요청은 모델을 부르지 않는다', async () => {
    const { s, calls } = store(temp());
    expect(await s.learnFrom('Money.add 고쳐줘')).toBe(false);
    expect(calls()).toBe(0);
  });

  it('배운 취향을 저장하고 팀원 프롬프트 글과 계정 CLAUDE.md 구역·settings.json language 에 반영한다', async () => {
    const config = temp();
    writeFileSync(join(config, 'CLAUDE.md'), '# 내 규칙\n- 커밋은 한국어\n');
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ model: 'claude-opus-5-5' }));
    const { s, file } = store(config);
    expect(await s.learnFrom('앞으로 추측 말고 한국어로 답해줘')).toBe(true);
    expect(s.promptBlock()).toContain('- 추측 말고 확인한 것만');
    const md = readFileSync(join(config, 'CLAUDE.md'), 'utf8');
    expect(md.startsWith('# 내 규칙\n- 커밋은 한국어\n')).toBe(true);
    expect(md).toContain('<!-- rauha:style:begin -->');
    expect(JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8'))).toEqual({ model: 'claude-opus-5-5', language: 'korean' });
    // 다시 열어도 그대로
    const again = new StyleStore(file, { extract: async () => [], configDir: () => config, now: () => 'x' });
    await again.ready;
    expect(again.list().map((n) => n.key).sort()).toEqual(['language', 'no-guessing']);
  });

  it('사용자가 직접 정한 다른 language 는 덮지 않고, 깨진 settings.json 도 건드리지 않는다', async () => {
    const a = temp();
    writeFileSync(join(a, 'settings.json'), JSON.stringify({ language: 'japanese' }));
    await store(a).s.learnFrom('항상 한국어로 답해줘');
    expect(JSON.parse(readFileSync(join(a, 'settings.json'), 'utf8')).language).toBe('japanese');
    const b = temp();
    writeFileSync(join(b, 'settings.json'), '{ broken');
    await store(b).s.learnFrom('항상 한국어로 답해줘');
    expect(readFileSync(join(b, 'settings.json'), 'utf8')).toBe('{ broken');
  });

  it('지우면 CLAUDE.md 의 rauha 구역도 빠진다(사용자 글은 남는다)', async () => {
    const config = temp();
    writeFileSync(join(config, 'CLAUDE.md'), '내 글\n');
    const { s } = store(config, [noGuess]);
    await s.learnFrom('앞으로 추측 말고 답해');
    await s.forget(s.list()[0]!.id);
    expect(readFileSync(join(config, 'CLAUDE.md'), 'utf8')).toBe('내 글\n');
    expect(s.promptBlock()).toBe('');
  });

  it('계정 폴더를 모르면 파일에는 반영하지 않고 기억만 한다', async () => {
    const { s } = store(null);
    expect(await s.learnFrom('앞으로 추측 말고 답해')).toBe(true);
    expect(s.list()).toHaveLength(2);
  });

  it('계정 폴더가 아직 없으면 만들어서 CLAUDE.md 를 쓴다', async () => {
    const config = join(temp(), 'nested', 'claude');
    await store(config, [noGuess]).s.learnFrom('앞으로 추측 말고 답해');
    expect(existsSync(join(config, 'CLAUDE.md'))).toBe(true);
    mkdirSync(config, { recursive: true });
  });
});
