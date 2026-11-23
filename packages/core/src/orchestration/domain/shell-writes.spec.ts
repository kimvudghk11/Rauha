import { describe, expect, it } from 'vitest';
import { shellWriteTargets } from './shell-writes.js';

describe('셸 명령이 쓰는 파일', () => {
  it.each([
    ['echo hi > src/a.ts', ['src/a.ts']],
    ['echo hi >> src/a.ts', ['src/a.ts']],
    ["cat >> src/cart.js <<'EOF'\nexport const x = 1;\nEOF", ['src/cart.js']],
    ['cat > test/a.test.js << EOF\nconst f = (a) => a > 1;\nEOF', ['test/a.test.js']],
    ['printf "x" | tee src/a.ts', ['src/a.ts']],
    ['printf "x" | tee -a src/a.ts other.txt', ['src/a.ts', 'other.txt']],
    ["sed -i 's/a/b/' src/a.ts", ['src/a.ts']],
    ["sed -i.bak -e 's/a/b/' src/a.ts src/b.ts", ['src/a.ts', 'src/b.ts']],
    ['Set-Content -Path src/a.ts -Value x', ['src/a.ts']],
    ['"x" | Out-File src/a.ts', ['src/a.ts']],
    ['echo "a" 1> "src/my file.ts"', ['src/my file.ts']],
  ] as const)('%s', (cmd, want) => {
    expect(shellWriteTargets(cmd)).toEqual(want);
  });

  it.each([
    'npm test 2>&1 | tail -15',
    'npm test > /dev/null 2>&1',
    'node -e "const f = (a) => a > 1"',
    'grep -n "=>" src/a.ts',
    "echo 'a > b'",
    'ls -la',
    'cat src/a.ts',
    'git diff > NUL',
    'cmd 2>/dev/null',
  ])('쓰지 않는다: %s', (cmd) => {
    expect(shellWriteTargets(cmd)).toEqual([]);
  });

  it('heredoc 본문 안의 > 는 무시한다', () => {
    expect(shellWriteTargets("cat > t.js <<'EOF'\nif (a > b) x >> y;\necho 1 > src/evil.ts\nEOF")).toEqual(['t.js']);
  });
});
