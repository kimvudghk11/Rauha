// main·preload·화면을 esbuild로 묶어 dist/에 둔다. core는 소스(rauha-source)를 바로 묶는다.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// 전체 찾기 worker 코드(정규식이 멈추면 main 이 worker 째 끊는다): 같은 방식으로 문자열로 넣는다.
const searchWorker = await build({ entryPoints: [join(src, 'main', 'code', 'search-worker.ts')], bundle: true, platform: 'node', format: 'cjs', minify: true, write: false, conditions: ['rauha-source'], logLevel: 'warning' });
const searchWorkerSource = searchWorker.outputFiles[0].text;

const common = { bundle: true, sourcemap: true, conditions: ['rauha-source'], logLevel: 'warning' };

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'main', 'main.ts')], outfile: join(dist, 'main.cjs'), platform: 'node', format: 'cjs', external: runtimeExternal, ...metaUrl, define: { ...metaUrl.define, __DB_CHILD_SOURCE__: JSON.stringify(dbChildSource), __SEARCH_WORKER_SOURCE__: JSON.stringify(searchWorkerSource) } }),
  // 코드 탭의 정의로 이동·참조·진단: typescript 를 묶은 worker 파일(3.6MB, 처음 쓸 때만 읽는다). asar 밖(app.asar.unpacked)에 풀어 둔다.
  build({ bundle: true, minify: true, conditions: ['rauha-source'], logLevel: 'warning', entryPoints: [join(src, 'main', 'code', 'ts', 'ts-worker.ts')], outfile: join(dist, 'ts-worker.cjs'), platform: 'node', format: 'cjs' }),
  build({ ...common, entryPoints: [join(src, 'preload', 'preload.ts')], outfile: join(dist, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(src, 'renderer', 'app.ts')], outfile: join(dist, 'renderer', 'app.js'), platform: 'browser', format: 'iife' }),
]);
for (const file of ['index.html', 'styles.css', 'ui.css', 'chat.css', 'git.css', 'commands.css', 'data-tabs.css', 'todo.css', 'blog.css', 'code.css', 'api.css', 'docker.css', 'db.css', 'changes.css']) cpSync(join(src, 'renderer', file), join(dist, 'renderer', file));
// 타입 검사에 쓰는 typescript 의 lib.*.d.ts (dist/ts-lib/)
const tsLib = join(dirname(createRequire(import.meta.url).resolve('typescript')));
mkdirSync(join(dist, 'ts-lib'), { recursive: true });
for (const file of readdirSync(tsLib)) if (/^lib\.([\w.-]+\.)?d\.ts$/.test(file)) cpSync(join(tsLib, file), join(dist, 'ts-lib', file));
