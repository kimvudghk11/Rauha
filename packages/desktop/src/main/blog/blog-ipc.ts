import { homedir, userInfo } from 'node:os';
import { writeFile } from 'node:fs/promises';
import type { IpcMain } from 'electron';
import { BLOG_IPC, type BlogToneId } from '../../shared/blog-dto.js';
import { usableRepoNames, type RedactContext } from '../../shared/blog-redact.js';
import { BlogService } from './blog-service.js';

export interface BlogIpcDeps {
  /** 작업 폴더 안의 레포·폴더 이름들 */
  readonly folderNames: () => readonly string[];
  /** 설정에 적은 가릴 회사·서비스 이름 */
  readonly companyNames: () => readonly string[];
  /** 모델을 한 번 불러 초안을 받는다(실제 호출은 main이 넘긴다) */
  readonly draft: (note: string, tone: BlogToneId) => Promise<string>;
  /** 저장 대화상자. 취소하면 null */
  readonly pickPath: (fileName: string) => Promise<string | null>;
}

/** 블로그 글 IPC. 가림에 쓸 이름은 main이 모아 주고, 저장 경로는 사용자가 대화상자에서 고른 것만 쓴다. */
export function registerBlogIpc(ipc: Pick<IpcMain, 'handle'>, deps: BlogIpcDeps): BlogService {
  const service = new BlogService({
    context: (): RedactContext => {
      let userName = '';
      try {
        userName = userInfo().username;
      } catch {
        userName = '';
      }
      return { repoNames: usableRepoNames(deps.folderNames()), companyNames: deps.companyNames(), userName, homePath: homedir() };
    },
    draft: deps.draft,
    pickPath: deps.pickPath,
    write: (path, text) => writeFile(path, text, 'utf8'),
  });
  ipc.handle(BLOG_IPC.context, () => service.context());
  ipc.handle(BLOG_IPC.draft, (_e, request: unknown) => service.draft(request));
  ipc.handle(BLOG_IPC.save, (_e, request: unknown) => service.save(request));
  return service;
}
