// 묶은 뒤 Electron을 띄운다. VS Code·Claude Code 안의 터미널은 ELECTRON_RUN_AS_NODE=1을 물려줘서,
// 그대로 띄우면 Electron이 창 없이 Node로 돌아 ipcMain이 없다는 오류가 난다. 그 값만 빼고 띄운다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('./build.mjs');
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
