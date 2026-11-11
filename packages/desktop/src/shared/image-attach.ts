/** 채팅에 붙일 수 있는 이미지 장수·크기 상한 */
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
const EXT: Readonly<Record<ImageMime, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LABEL_MAX = 24;

/**
 * 첫 바이트(매직 넘버)로 형식을 알아본다. 이름·확장자·보낸 쪽이 말한 형식은 믿지 않는다. png·jpg·webp 만 받는다.
 * 머리 글자만 붙인 글 파일을 거르려고 머리 다음 구조도 본다: PNG 는 첫 조각이 IHDR, JPEG 은 표지 바이트(0xC0~0xFE), WebP 는 VP8/VP8L/VP8X 조각.
 */
export function sniffImageMime(b: Uint8Array): ImageMime | null {
  const at = (i: number): number => b[i] ?? -1;
  const word = (i: number, w: string): boolean => [...w].every((c, k) => at(i + k) === c.charCodeAt(0));
  if (b.length >= 16 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a && word(12, 'IHDR')) return 'image/png';
  if (b.length >= 4 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff && at(3) >= 0xc0 && at(3) <= 0xfe) return 'image/jpeg';
  if (b.length >= 16 && word(0, 'RIFF') && word(8, 'WEBP') && (word(12, 'VP8 ') || word(12, 'VP8L') || word(12, 'VP8X'))) return 'image/webp';
  return null;
}

export type ImageFail = 'empty' | 'too-big' | 'not-image';
export type ImageResult = { readonly ok: true; readonly image: ImageAttachment } | { readonly ok: false; readonly reason: ImageFail };

const labelOf = (name: string): string => {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).trim();
  if (base === '') return 'image';
  if (base.length <= LABEL_MAX) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 5 ? base.slice(dot) : '';
  return `${base.slice(0, LABEL_MAX - ext.length - 1)}…${ext}`;
};

/** 붙인 이미지 한 장. 내용이 png·jpg·webp 이고 5MB 이하일 때만 만들어진다. */
export class ImageAttachment {
  private constructor(
    readonly mime: ImageMime,
    readonly bytes: Uint8Array,
    readonly label: string,
  ) {}

  static fromBytes(name: string, bytes: Uint8Array): ImageResult {
    if (bytes.length === 0) return { ok: false, reason: 'empty' };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-big' };
    const mime = sniffImageMime(bytes);
    if (mime === null) return { ok: false, reason: 'not-image' };
    return { ok: true, image: new ImageAttachment(mime, bytes, labelOf(name)) };
  }

  get ext(): string {
    return EXT[this.mime];
  }
}

export interface DraftImage {
  readonly id: string;
  readonly image: ImageAttachment;
  readonly label: string;
  readonly mime: ImageMime;
}

/** 입력칸에 붙어 있는 이미지들(최대 3장). 바꾸면 새 값이 나온다. */
export class ImageDraft {
  private constructor(
    private readonly items: readonly DraftImage[],
    private readonly next: number,
  ) {}

  static empty(): ImageDraft {
    return new ImageDraft([], 1);
  }

  add(image: ImageAttachment): { readonly ok: true; readonly draft: ImageDraft } | { readonly ok: false; readonly reason: 'too-many' } {
    if (this.items.length >= MAX_IMAGES) return { ok: false, reason: 'too-many' };
    const item: DraftImage = { id: `img${this.next}`, image, label: image.label, mime: image.mime };
    return { ok: true, draft: new ImageDraft([...this.items, item], this.next + 1) };
  }

  remove(id: string): ImageDraft {
    return new ImageDraft(this.items.filter((i) => i.id !== id), this.next);
  }

  cleared(): ImageDraft {
    return new ImageDraft([], this.next);
  }

  list(): readonly DraftImage[] {
    return this.items;
  }

  /** 팀에 보낼 바이트들 */
  toUploads(): Uint8Array[] {
    return this.items.map((i) => i.image.bytes);
  }
}

export interface ImageUpload {
  readonly ext: string;
  readonly bytes: Uint8Array;
}

/**
 * main 이 화면에서 받은 이미지 목록을 검증하는 DTO. 화면이 이미 검사했어도 다시 본다.
 * 하나라도 이상하면(배열 아님·4장 이상·이미지 아님·5MB 초과) 통째로 받지 않는다(null). 없으면 빈 목록.
 */
export class ImageUploadDto {
  static from(raw: unknown): ImageUpload[] | null {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return null;
    const out: ImageUpload[] = [];
    for (const item of raw) {
      if (!ArrayBuffer.isView(item)) return null;
      const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
      const r = ImageAttachment.fromBytes('', bytes);
      if (!r.ok) return null;
      out.push({ ext: r.image.ext, bytes });
    }
    return out;
  }
}
