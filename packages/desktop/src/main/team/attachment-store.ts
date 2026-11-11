import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { ImageUpload } from '../../shared/image-attach.js';

export interface StagedImages {
  /** 이 일의 이미지 폴더(앱 데이터 폴더 아래). 일이 끝나면 통째로 지운다. */
  readonly dir: string;
  readonly paths: readonly string[];
}

/**
 * 채팅에 붙인 이미지를 앱 데이터 폴더의 임시 위치(`<기본>/<무작위 이름>/<번호>.<확장자>`)에만 둔다.
 * 작업 폴더·저장소에는 쓰지 않는다. 파일 이름은 우리가 정하고(사용자 이름을 쓰지 않는다), 이 사용자만 읽게 만든다(0600/0700).
 * 지울 때는 기본 폴더 바로 아래 폴더만 지운다.
 */
export class AttachmentStore {
  constructor(
    private readonly base: string,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** 이미지가 없으면 null */
  async stage(images: readonly ImageUpload[]): Promise<StagedImages | null> {
    if (images.length === 0) return null;
    const dir = join(this.base, this.newId());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const paths: string[] = [];
    try {
      for (const [i, image] of images.entries()) {
        const path = join(dir, `${i + 1}.${image.ext}`);
        await writeFile(path, image.bytes, { flag: 'wx', mode: 0o600 });
        paths.push(path);
      }
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return { dir, paths };
  }

  /** 일이 끝났거나 못 받았을 때 그 일의 이미지를 지운다. 기본 폴더 바로 아래가 아닌 경로는 건드리지 않는다. */
  async cleanup(dir: string): Promise<void> {
    if (resolve(dirname(resolve(dir))) !== resolve(this.base)) return;
    await rm(dir, { recursive: true, force: true });
  }

  /** 앱이 켜질 때: 꺼지다 남은 이미지 폴더를 모두 지운다. */
  async sweep(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.base);
    } catch {
      return;
    }
    await Promise.all(names.map((n) => rm(join(this.base, n), { recursive: true, force: true }).catch(() => undefined)));
  }
}
