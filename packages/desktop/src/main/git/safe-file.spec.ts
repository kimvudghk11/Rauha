import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPlainFile } from './safe-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-safe-'));
  dirs.push(d);
  return d;
};

describe('assertPlainFile', () => {
  it('보통 파일과 아직 없는 파일은 통과한다', async () => {
    const d = temp();
    writeFileSync(join(d, 'a.txt'), 'x');
    await expect(assertPlainFile(join(d, 'a.txt'))).resolves.toBeUndefined();
    await expect(assertPlainFile(join(d, 'none.txt'))).resolves.toBeUndefined();
  });

  it('심볼릭 링크는 레포 밖을 가리킬 수 있어 거절한다', async () => {
    const d = temp();
    writeFileSync(join(d, 'target.txt'), 'x');
    try {
      symlinkSync(join(d, 'target.txt'), join(d, 'link.txt'), 'file');
    } catch {
      return; // 링크를 만들 권한이 없는 PC(Windows 일반 계정)
    }
    await expect(assertPlainFile(join(d, 'link.txt'))).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});
