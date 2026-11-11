// main·preload·화면을 esbuild로 묶어 dist/에 둔다. core는 소스(rauha-source)를 바로 묶는다.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
mkdirSync(join(dist, 'renderer'), { recursive: true });

// core가 쓰는 import.meta.url(프롬프트 폴더 찾기 등)은 번들(cjs)에서 이 값으로 바꾼다.
const metaUrl = { banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" }, define: { 'import.meta.url': '__importMetaUrl' } };
// Agent SDK는 자기 폴더의 실행 파일을 찾아 쓰므로 묶지 않고 node_modules에서 읽는다.
const runtimeExternal = ['electron', '@anthropic-ai/claude-agent-sdk', '@playwright/mcp'];

// DB 탭의 SQLite 자식 프로세스 코드: 한 줄짜리 CJS 로 묶어 main 번들에 문자열로 넣는다(파일을 따로 싣지 않으니 asar 안에서도 된다).
const dbChild = await build({ entryPoints: [join(src, 'main', 'db', 'sqlite-child.ts')], bundle: true, platform: 'node', format: 'cjs', minify: true, write: false, conditions: ['rauha-source'], logLevel: 'warning' });
const dbChildSource = dbChild.outputFiles[0].text;

const common = { bundle: true, sourcemap: true, conditions: ['rauha-source'], logLevel: 'warning' };

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'main', 'main.ts')], outfile: join(dist, 'main.cjs'), platform: 'node', format: 'cjs', external: runtimeExternal, ...metaUrl, define: { ...metaUrl.define, __DB_CHILD_SOURCE__: JSON.stringify(dbChildSource) } }),
  build({ ...common, entryPoints: [join(src, 'preload', 'preload.ts')], outfile: join(dist, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(src, 'renderer', 'app.ts')], outfile: join(dist, 'renderer', 'app.js'), platform: 'browser', format: 'iife' }),
]);
for (const file of ['index.html', 'styles.css', 'ui.css', 'chat.css', 'git.css', 'commands.css', 'data-tabs.css', 'todo.css', 'blog.css', 'code.css', 'api.css', 'docker.css', 'db.css', 'changes.css']) cpSync(join(src, 'renderer', file), join(dist, 'renderer', file));
