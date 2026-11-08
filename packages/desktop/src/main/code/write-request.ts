import type { WriteRequest } from '../../shared/code-api.js';
import { MAX_OPEN_BYTES } from '../../shared/code-text.js';

/** 저장 요청 DTO. 화면에서 온 값은 믿지 않고 모양과 크기를 검사해서 만든다. */
export class WriteRequestDto {
  private constructor(readonly request: WriteRequest) {}

  /** 모양이 틀리거나 글이 상한(1MB)을 넘으면 null */
  static from(input: unknown): WriteRequestDto | null {
    if (typeof input !== 'object' || input === null) return null;
    const o = input as Record<string, unknown>;
    if (typeof o['path'] !== 'string' || typeof o['text'] !== 'string' || typeof o['baseVersion'] !== 'string') return null;
    if (o['eol'] !== 'lf' && o['eol'] !== 'crlf') return null;
    if (typeof o['bom'] !== 'boolean' || typeof o['overwrite'] !== 'boolean') return null;
    // 글자 수 상한으로 먼저 거른다(바이트는 쓰기 직전에 다시 잰다)
    if (o['text'].length > MAX_OPEN_BYTES) return null;
    return new WriteRequestDto({ path: o['path'], text: o['text'], baseVersion: o['baseVersion'], eol: o['eol'], bom: o['bom'], overwrite: o['overwrite'] });
  }
}
