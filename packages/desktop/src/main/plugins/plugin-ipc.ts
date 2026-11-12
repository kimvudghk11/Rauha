import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { PLUGIN_IPC, skillDescription, type SkillView } from '../../shared/plugin-api.js';
import { PluginService, type PluginCli, type SkillFolder } from './plugin-service.js';

/** 마켓플레이스 받기(git clone)·설치가 오래 걸릴 수 있다 */
const COMMAND_TIMEOUT_MS = 180_000;

export interface PluginIpcDeps {
  /** 지금 계정의 환경(process.env + CLAUDE_CONFIG_DIR) */
  readonly env: () => Promise<Record<string, string>>;
  /** 앱에 든 Claude Code 실행 파일. 없으면 플러그인 화면이 이유를 보여 준다. */
  readonly executable: () => string | undefined;
  /** 휴지통으로 보낸다(스킬 지우기) */
  readonly trash: (path: string) => Promise<void>;
}

/** 지금 계정의 설정 폴더(CLAUDE_CONFIG_DIR, 없으면 ~/.claude) */
const configDir = (env: Record<string, string>): string => env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');

/** `claude plugin …` 를 셸 없이 인자 배열로 돌린다(인자는 도메인이 검사한 id·출처뿐이다). */
export function processPluginCli(deps: Pick<PluginIpcDeps, 'env' | 'executable'>): PluginCli {
  return {
    run: async (args) => {
      const exe = deps.executable();
      if (exe === undefined) throw new Error('Claude Code was not found in this app, so plugins cannot be managed here.');
      const env = await deps.env();
      return new Promise((resolve) => {
        execFile(exe, [...args], { env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (_error, stdout, stderr) => resolve({ stdout: String(stdout), stderr: String(stderr) }));
      });
    },
  };
}

/** <설정 폴더>/skills/<이름>/SKILL.md 가 있는 폴더가 사용자 스킬이다 */
export function configSkillFolder(deps: Pick<PluginIpcDeps, 'env' | 'trash'>): SkillFolder {
  return {
    root: async () => configDir(await deps.env()),
    list: async () => {
      const dir = join(configDir(await deps.env()), 'skills');
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const skills: SkillView[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const text = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf8').catch(() => null);
        if (text !== null) skills.push({ name: entry.name, description: skillDescription(text) });
      }
      return skills;
    },
    remove: async (name) => deps.trash(join(configDir(await deps.env()), 'skills', name.value)),
  };
}

/** 설정 → 플러그인·스킬의 main 쪽: plugins:* 채널. 앱이 뜨면 한 번 목록을 읽어 둔다(팀원 실행에 붙이려고). */
export function registerPluginIpc(ipc: Pick<IpcMain, 'handle'>, deps: PluginIpcDeps): PluginService {
  const service = new PluginService({ cli: processPluginCli(deps), skills: configSkillFolder(deps) });
  ipc.handle(PLUGIN_IPC.list, () => service.list());
  ipc.handle(PLUGIN_IPC.refresh, () => service.refresh());
  ipc.handle(PLUGIN_IPC.install, (_e, input: unknown) => service.install(input));
  ipc.handle(PLUGIN_IPC.uninstall, (_e, id: unknown) => service.uninstall(id));
  ipc.handle(PLUGIN_IPC.enable, (_e, id: unknown) => service.enable(id));
  ipc.handle(PLUGIN_IPC.disable, (_e, id: unknown) => service.disable(id));
  ipc.handle(PLUGIN_IPC.addMarketplace, (_e, source: unknown) => service.addMarketplace(source));
  ipc.handle(PLUGIN_IPC.removeMarketplace, (_e, name: unknown) => service.removeMarketplace(name));
  ipc.handle(PLUGIN_IPC.removeSkill, (_e, name: unknown) => service.removeSkill(name));
  void service.refresh().catch(() => undefined);
  return service;
}
