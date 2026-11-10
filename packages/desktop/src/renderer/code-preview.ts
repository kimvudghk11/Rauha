import type { CodeApi, CodeFail, ImageResult } from '../shared/code-api.js';
import { parseMarkdown } from '../shared/markdown.js';
import { el } from './dom.js';
import { renderMarkdown } from './markdown-view.js';

/** 마크다운 미리보기에 그릴 글자 수 상한(넘는 부분은 잘라 알린다) */
const MAX_PREVIEW_CHARS = 300_000;
const PREF_KEY = 'rauha.code.mdmode';
const RENDER_DELAY_MS = 180;

export type MdMode = 'edit' | 'split' | 'preview';

export interface ImageInfo {
  readonly path: string;
  readonly mime: string;
  readonly bytes: number;
  /** 그림이 다 읽힌 뒤에 알게 되는 크기 */
  width: number | null;
  height: number | null;
}

export interface PreviewDeps {
  readonly api: Pick<CodeApi, 'readImage'>;
  /** 열린 글 파일의 지금 내용(저장 전 수정 포함) */
  readonly textOf: (path: string) => string | null;
  /** 좁은 창이면 나란히 보기를 못 쓴다 */
  readonly narrow: () => boolean;
  /** 보이는 것이 바뀌어 탭·상태 줄을 다시 그려야 한다 */
  readonly changed: () => void;
}

const MODE_LABEL: Readonly<Record<MdMode, string>> = { edit: 'Edit', split: 'Split', preview: 'Preview' };

function savedMode(): MdMode | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'edit' || v === 'split' || v === 'preview' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 코드 탭의 미리보기: .md 파일의 렌더 미리보기(편집/나란히/미리보기)와 그림 파일 뷰어.
 * 편집기(host) 옆에 같은 칸을 나눠 쓰고, 어떤 모습으로 보일지는 body의 data-view가 정한다(CSS).
 */
export class CodePreview {
  /** 편집기·미리보기·그림 뷰어를 담는 칸 */
  readonly body = el('div', 'code-body');
  /** 마크다운일 때만 보이는 전환 단추(탭 줄에 단다) */
  readonly modeBar = el('div', 'seg md code-mode');
  private readonly pane = el('div', 'code-preview');
  private readonly stage = el('div', 'code-imgview');
  private readonly modeButtons = new Map<MdMode, HTMLButtonElement>();
  private pref: MdMode | null = savedMode();
  private md: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cache = new Map<string, Promise<ImageResult>>();
  private readonly shown = new Map<string, ImageInfo>();
  private active: string | null = null;
  private seq = 0;

  constructor(
    host: HTMLElement,
    private readonly deps: PreviewDeps,
  ) {
    this.pane.setAttribute('aria-label', 'Markdown preview');
    this.body.append(host, this.pane, this.stage);
    for (const m of ['edit', 'split', 'preview'] as const) {
      const b = el('button', undefined, MODE_LABEL[m]);
      b.type = 'button';
      b.dataset['m'] = m;
      b.addEventListener('click', () => this.setMode(m));
      this.modeButtons.set(m, b);
      this.modeBar.append(b);
    }
    this.modeBar.hidden = true;
    this.stage.hidden = false;
    this.apply();
  }

  // ── 마크다운 ──

  /** 지금 보는 글 파일이 바뀌었다(null이면 글 파일이 없다). 그림 뷰어는 닫는다. */
  showText(path: string | null): void {
    const next = path !== null && /\.(md|markdown|mdx)$/i.test(path) ? path : null;
    if (next === this.md && this.active === null) return;
    this.active = null;
    this.stage.replaceChildren();
    if (next !== this.md) this.cache = new Map();
    this.md = next;
    this.apply();
  }

  /** 그림 뷰어를 비운다(그림 탭은 그대로 둔다) */
  leaveImage(): void {
    if (this.active === null) return;
    this.active = null;
    this.stage.replaceChildren();
    this.md = null;
    this.apply();
  }

  /** 편집기 글이 바뀌었다 */
  textChanged(): void {
    if (this.md === null || this.mode() === 'edit') return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.render(), RENDER_DELAY_MS);
  }

  /** 지금 마크다운 파일을 보고 있다 */
  isMarkdown(): boolean {
    return this.md !== null && this.active === null;
  }

  mode(): MdMode {
    const m = this.pref ?? 'split';
    return m === 'split' && this.deps.narrow() ? 'preview' : m;
  }

  private setMode(m: MdMode): void {
    this.pref = m;
    try {
      localStorage.setItem(PREF_KEY, m);
    } catch {
      /* 저장 못 해도 이번 화면에서는 바뀐다 */
    }
    this.apply();
  }

  private apply(): void {
    const image = this.active !== null;
    const md = this.md !== null && !image;
    const mode = this.mode();
    this.body.dataset['view'] = image ? 'image' : md ? mode : 'edit';
    this.modeBar.hidden = !md;
    for (const [m, b] of this.modeButtons) {
      b.classList.toggle('on', m === mode);
      b.hidden = m === 'split' && this.deps.narrow();
    }
    if (md && mode !== 'edit') this.render();
    this.stage.hidden = !image;
  }

  /** 창 크기 단계가 바뀌었을 수 있다 */
  relayout(): void {
    this.apply();
  }

  private render(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const path = this.md;
    if (path === null) return;
    const text = this.deps.textOf(path);
    if (text === null) return;
    const cut = text.length > MAX_PREVIEW_CHARS;
    const root = renderMarkdown(parseMarkdown(cut ? text.slice(0, MAX_PREVIEW_CHARS) : text), {
      path,
      loadImage: (p) => {
        let hit = this.cache.get(p);
        if (hit === undefined) {
          hit = this.deps.api.readImage(p);
          this.cache.set(p, hit);
        }
        return hit;
      },
    });
    if (cut) root.append(el('p', 'md-empty', 'The text is long, so only the start is shown.'));
    const top = this.pane.scrollTop;
    this.pane.replaceChildren(root);
    this.pane.scrollTop = top;
  }

  // ── 그림 뷰어 ──

  /** 그림 파일을 읽어 뷰어에 연다. 못 열면 까닭을 돌려준다. */
  async openImage(path: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: CodeFail }> {
    const seq = ++this.seq;
    const r = await this.deps.api.readImage(path);
    if (seq !== this.seq) return { ok: true };
    if (!r.ok) return r;
    const info: ImageInfo = { path: r.path, mime: r.mime, bytes: r.bytes, width: null, height: null };
    this.shown.set(r.path, info);
    this.active = r.path;
    this.md = null;
    const img = el('img', 'imgv');
    img.alt = r.path;
    img.addEventListener('load', () => {
      info.width = img.naturalWidth;
      info.height = img.naturalHeight;
      img.classList.toggle('crisp', Math.max(img.naturalWidth, img.naturalHeight) <= 128);
      this.deps.changed();
    });
    img.addEventListener('click', () => img.classList.toggle('actual'));
    img.title = 'Click to toggle actual size / fit';
    img.src = r.dataUrl;
    this.stage.replaceChildren(img);
    this.apply();
    this.deps.changed();
    return { ok: true };
  }

  /** 열려 있는 그림 탭들(연 순서) */
  images(): readonly ImageInfo[] {
    return [...this.shown.values()];
  }

  activeImage(): ImageInfo | null {
    return this.active === null ? null : (this.shown.get(this.active) ?? null);
  }

  /** 이미 열린 그림 탭을 다시 보인다(디스크에서 바뀌었을 수 있으니 새로 읽는다) */
  showImage(path: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: CodeFail }> {
    return this.openImage(path);
  }

  /** 그림 탭 하나를 닫는다. 보고 있던 것이면 뷰어를 비우고 true */
  closeImage(path: string): boolean {
    this.shown.delete(path);
    if (this.active !== path) return false;
    this.active = null;
    this.stage.replaceChildren();
    this.apply();
    return true;
  }

  /** 이 경로(또는 그 아래)의 그림 탭을 닫는다(이름이 바뀌었거나 지워졌을 때) */
  closeImagesUnder(path: string): void {
    for (const p of [...this.shown.keys()]) if (p === path || p.startsWith(`${path}/`)) this.closeImage(p);
  }

  closeAllImages(): void {
    this.shown.clear();
    this.active = null;
    this.stage.replaceChildren();
    this.apply();
  }
}
