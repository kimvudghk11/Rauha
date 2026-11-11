import { randomUUID } from 'node:crypto';
import type { IpcMain } from 'electron';
import { DOCKER_IPC, type DockerLogEvent } from '../../shared/docker-api.js';
import { findComposeFiles, resolveComposeFile } from './compose-find.js';
import { runDocker, streamDocker } from './docker-run.js';
import { DockerService } from './docker-service.js';

export interface DockerIpcDeps {
  /** 지금 작업 폴더. 없으면 null */
  readonly workDir: () => string | null;
  readonly send: (channel: string, event: DockerLogEvent) => void;
  readonly onQuit: (cleanup: () => void) => void;
}

/** Docker 탭의 main 쪽: docker:* 채널. docker CLI 는 이 프로세스가 고정 인자로만 부른다. */
export function registerDockerIpc(ipc: Pick<IpcMain, 'handle'>, deps: DockerIpcDeps): DockerService {
  const service = new DockerService({
    run: runDocker,
    stream: streamDocker,
    workDir: deps.workDir,
    findCompose: findComposeFiles,
    resolveCompose: resolveComposeFile,
    newId: () => randomUUID(),
    emit: (event) => deps.send(DOCKER_IPC.logEvent, event),
  });
  deps.onQuit(() => service.stopAll());
  ipc.handle(DOCKER_IPC.status, () => service.status());
  ipc.handle(DOCKER_IPC.containers, () => service.containers());
  ipc.handle(DOCKER_IPC.images, () => service.images());
  ipc.handle(DOCKER_IPC.volumes, () => service.volumes());
  ipc.handle(DOCKER_IPC.networks, () => service.networks());
  ipc.handle(DOCKER_IPC.start, (_e, id: unknown) => service.start(id));
  ipc.handle(DOCKER_IPC.stop, (_e, id: unknown) => service.stop(id));
  ipc.handle(DOCKER_IPC.restart, (_e, id: unknown) => service.restart(id));
  ipc.handle(DOCKER_IPC.remove, (_e, req: unknown) => service.remove(req));
  ipc.handle(DOCKER_IPC.inspect, (_e, id: unknown) => service.inspect(id));
  ipc.handle(DOCKER_IPC.logs, (_e, req: unknown) => service.logs(req));
  ipc.handle(DOCKER_IPC.logsStop, (_e, streamId: unknown) => service.logsStop(streamId));
  ipc.handle(DOCKER_IPC.composeFind, () => service.composeFind());
  ipc.handle(DOCKER_IPC.composeList, () => service.composeList());
  ipc.handle(DOCKER_IPC.compose, (_e, req: unknown) => service.compose(req));
  ipc.handle(DOCKER_IPC.exec, (_e, req: unknown) => service.exec(req));
  ipc.handle(DOCKER_IPC.imageRemove, (_e, req: unknown) => service.imageRemove(req));
  ipc.handle(DOCKER_IPC.imagePull, (_e, req: unknown) => service.imagePull(req));
  ipc.handle(DOCKER_IPC.volumeRemove, (_e, req: unknown) => service.volumeRemove(req));
  ipc.handle(DOCKER_IPC.networkRemove, (_e, req: unknown) => service.networkRemove(req));
  return service;
}
