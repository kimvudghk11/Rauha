// main·preload·화면을 esbuild로 묶어 dist/에 둔다. core는 소스(rauha-source)를 바로 묶는다.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
mkdirSync(join(dist, 'renderer'), { recursive: true });

const common = { bundle: true, sourcemap: true, conditions: ['rauha-source'], logLevel: 'warning' };

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'main', 'main.ts')], outfile: join(dist, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(src, 'preload', 'preload.ts')], outfile: join(dist, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(src, 'renderer', 'app.ts')], outfile: join(dist, 'renderer', 'app.js'), platform: 'browser', format: 'iife' }),
]);
for (const file of ['index.html', 'styles.css']) cpSync(join(src, 'renderer', file), join(dist, 'renderer', file));
