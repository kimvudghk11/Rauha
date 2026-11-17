import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mergeClaudeMd, mergeLanguageSetting, StyleGraph, StyleSignal, type StyleNode, type StylePreference } from '@rauha/core';

export interface StyleStoreDeps {
  /** 사용자 말 한 줄 → 오래 갈 취향(모델 한 번). 실패하면 빈 목록 */
  readonly extract: (said: string) => Promise<readonly StylePreference[]>;
  /** 지금 계정의 Claude 설정 폴더(CLAUDE_CONFIG_DIR). 이 폴더의 CLAUDE.md·settings.json 에 반영한다. 없으면 반영하지 않는다 */
  readonly configDir: () => string | null | Promise<string | null>;
  readonly now: () => string;
}

/**
 * 사용자 취향 그래프를 앱 데이터 폴더에 두고(style-graph.json), 바뀔 때마다 계정 설정에 반영한다:
 * - CLAUDE.md: rauha 구역만 넣거나 바꾼다(구역 밖 사용자 글은 그대로)
 * - settings.json: language 하나만, 사용자가 직접 정한 다른 값은 덮지 않는다
 * 로그인 토큰 파일은 읽지도 옮기지도 않는다.
 */
export class StyleStore {
  private graph = StyleGraph.empty();
  private languageOwned = false;
  private queue: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly file: string,
    private readonly deps: StyleStoreDeps,
  ) {
    this.ready = readFile(file, 'utf8')
      .then((t) => {
        const raw: unknown = JSON.parse(t);
        const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        this.graph = StyleGraph.from(o['graph']);
        this.languageOwned = o['languageOwned'] === true;
      })
      .catch(() => undefined);
  }

  /** 팀원 시스템 프롬프트에 붙일 취향 목록(없으면 빈 글) */
  promptBlock(): string {
    return this.graph.promptBlock();
  }

  list(): StyleNode[] {
    return this.graph.active();
  }

  /** 사용자 말에 취향 신호가 있으면 모델로 뽑아 배운다. 배운 것이 있으면 true. 일을 막지 않게 뒤에서 부른다 */
  learnFrom(said: string): Promise<boolean> {
    if (!StyleSignal.likely(said)) return Promise.resolve(false);
    return this.serial(async () => {
      await this.ready;
      const prefs = await this.deps.extract(said);
      if (prefs.length === 0) return false;
      const next = this.graph.learn(prefs, this.deps.now());
      if (JSON.stringify(next.toJSON()) === JSON.stringify(this.graph.toJSON())) return false;
      this.graph = next;
      await this.persist();
      return true;
    });
  }

  forget(id: string): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      this.graph = this.graph.forget(id);
      await this.persist();
    });
  }

  /** 계정 폴더가 바뀌었을 때(계정 전환) 지금 취향을 다시 반영한다 */
  sync(): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      await this.syncFiles();
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    await this.syncFiles();
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ graph: this.graph.toJSON(), languageOwned: this.languageOwned }, null, 2), 'utf8');
  }

  private async syncFiles(): Promise<void> {
    const dir = await Promise.resolve(this.deps.configDir()).catch(() => null);
    if (dir === null) return;
    await mkdir(dir, { recursive: true });
    const mdPath = join(dir, 'CLAUDE.md');
    const md = await readFile(mdPath, 'utf8').catch(() => '');
    const nextMd = mergeClaudeMd(md, this.graph.claudeMdBlock());
    if (nextMd !== md) await writeFile(mdPath, nextMd, 'utf8');
    const language = this.graph.language();
    if (language === null) return;
    const settingsPath = join(dir, 'settings.json');
    const text = await readFile(settingsPath, 'utf8').catch(() => null);
    let parsed: unknown = null;
    if (text !== null && text.trim() !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // 사용자가 손으로 고치다 깨진 설정은 건드리지 않는다
      }
    }
    const merged = mergeLanguageSetting(parsed, language, this.languageOwned);
    if (merged === null) return;
    this.languageOwned = merged.owned;
    await writeFile(settingsPath, `${JSON.stringify(merged.settings, null, 2)}\n`, 'utf8');
  }
}
