// 실제 모델로 요청마다 세션을 몇 % 쓰는지 잰다(앱과 같은 composeSession, Electron 없이).
// 쓰는 법: node packages/desktop/scripts/session-bench.mjs <레포 폴더> [차례 id …]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, '..', 'dist', 'session-bench.cjs');
await build({
  entryPoints: [join(here, 'session-bench-entry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  conditions: ['rauha-source'],
  external: ['electron', '@anthropic-ai/claude-agent-sdk', '@playwright/mcp', '@lydell/node-pty'],
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
  logLevel: 'warning',
});
const env = { ...process.env };
for (const k of Object.keys(env)) if (k === 'ELECTRON_RUN_AS_NODE' || k.startsWith('CLAUDECODE')) delete env[k];
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
