import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceFileReader } from './workspace-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('할 일 근거 파일 읽기', () => {
  it('작업 공간 안의 파일은 절대·상대 경로로 읽고, 밖·비밀·큰 파일은 null', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rauha-ws-'));
    dirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'todo.md'), '- [ ] 결제 리팩터링');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(root, 'big.md'), 'x'.repeat(600 * 1024));
    const read = workspaceFileReader([root]);
    expect(await read(join(root, 'docs', 'todo.md'))).toBe('- [ ] 결제 리팩터링');
    expect(await read('docs/todo.md')).toBe('- [ ] 결제 리팩터링');
    expect(await read(join(root, '.env'))).toBeNull();
    expect(await read(join(root, 'big.md'))).toBeNull();
    expect(await read(join(root, '..', 'elsewhere.md'))).toBeNull();
    expect(await read(join(root, 'docs', 'none.md'))).toBeNull();
  });
});
