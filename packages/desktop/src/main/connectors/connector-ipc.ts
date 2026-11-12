import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IpcMain } from 'electron';
import { ConnectorBookDto, type ConnectorBook } from '@rauha/core';
import { CONNECTOR_IPC, type ConnectorListView } from '../../shared/connector-api.js';
import { ConnectorService, type ConnectorStore } from './connector-service.js';
import { openSdkProbe } from './sdk-connector-probe.js';

/** connectors.json: 이름·주소·프리셋만. 토큰은 Claude Code 가 계정 설정 폴더에 둔다. */
export function fileConnectorStore(path: string): ConnectorStore {
  return {
    load: async () => {
      try {
        return ConnectorBookDto.from(JSON.parse(await readFile(path, 'utf8'))).toEntity();
      } catch {
        return ConnectorBookDto.from(null).toEntity();
      }
    },
    save: async (book: ConnectorBook) => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, `${JSON.stringify(ConnectorBookDto.fromEntity(book).toFile(), null, 2)}\n`, 'utf8');
      await rename(tmp, path);
    },
  };
}

export interface ConnectorIpcDeps {
  readonly file: string;
  /** 지금 계정의 환경(process.env + CLAUDE_CONFIG_DIR) */
  readonly env: () => Promise<Record<string, string>>;
  readonly executable: () => string | undefined;
  readonly openExternal: (url: string) => Promise<void>;
  readonly send: (channel: string, view: ConnectorListView) => void;
}

/** 설정 → 커넥터의 main 쪽: connectors:* 채널. 앱이 뜨면 한 번 상태를 읽어 둔다(모델 호출 없음). */
export function registerConnectorIpc(ipc: Pick<IpcMain, 'handle'>, deps: ConnectorIpcDeps): ConnectorService {
  const service = new ConnectorService({
    store: fileConnectorStore(deps.file),
    openProbe: async (servers) => openSdkProbe(servers, { env: await deps.env(), executable: deps.executable() }),
    openExternal: deps.openExternal,
    notify: (view) => deps.send(CONNECTOR_IPC.changed, view),
  });
  ipc.handle(CONNECTOR_IPC.list, () => service.list());
  ipc.handle(CONNECTOR_IPC.refresh, () => service.refresh());
  ipc.handle(CONNECTOR_IPC.addPreset, (_e, id: unknown) => service.addPreset(id));
  ipc.handle(CONNECTOR_IPC.addCustom, (_e, input: unknown) => service.addCustom(input));
  ipc.handle(CONNECTOR_IPC.connect, (_e, id: unknown) => service.connect(id));
  ipc.handle(CONNECTOR_IPC.cancel, (_e, id: unknown) => service.cancel(id));
  ipc.handle(CONNECTOR_IPC.remove, (_e, id: unknown) => service.remove(id));
  void service.refresh().catch(() => undefined);
  return service;
}
