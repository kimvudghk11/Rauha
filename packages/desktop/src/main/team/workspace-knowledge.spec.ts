import { describe, expect, it } from 'vitest';
import { workspaceKnowledge, WORKSPACE_REPO_CHARS } from './workspace-knowledge.js';

const knowledge = (text: string) => ({ toBlock: (name: string, max: number) => `<repo_knowledge repo="${name}" max="${max}">${text}</repo_knowledge>` });

describe('workspaceKnowledge', () => {
  it('작업 공간의 다른 저장소마다 저장해 둔 지식을 짧게 읽고, 지금 저장소는 뺀다(이미 따로 붙는다)', async () => {
    const loads: string[] = [];
    const items = await workspaceKnowledge(
      [{ name: 'shop', root: 'E:/w/shop' }, { name: 'api', root: 'E:/w/api' }, { name: 'admin', root: 'E:/w/admin' }],
      'E:/w/shop',
      async (root) => (loads.push(root), root === 'E:/w/api' ? knowledge('Nest') : null),
    );
    expect(loads).toEqual(['E:/w/api', 'E:/w/admin']);
    expect(items).toEqual([
      { name: 'api', block: `<repo_knowledge repo="api" max="${WORKSPACE_REPO_CHARS}">Nest</repo_knowledge>` },
      { name: 'admin', block: null },
    ]);
  });

  it('지식 파일이 깨졌거나 읽다 실패하면 그 저장소만 모름(null)으로 둔다', async () => {
    const items = await workspaceKnowledge([{ name: 'a', root: 'E:/w/a' }, { name: 'b', root: 'E:/w/b' }], 'E:/w/x', async (root) => {
      if (root === 'E:/w/a') throw new Error('깨짐');
      return knowledge('ok');
    });
    expect(items.map((i) => [i.name, i.block === null])).toEqual([['a', true], ['b', false]]);
  });

  it('경로 구분자·대소문자가 달라도 지금 저장소를 알아본다(Windows)', async () => {
    const items = await workspaceKnowledge([{ name: 'shop', root: 'E:\\w\\Shop' }, { name: 'api', root: 'E:/w/api' }], 'e:/w/shop', async () => null);
    expect(items.map((i) => i.name)).toEqual(['api']);
  });
});
