/** 가져오기 글이 어떤 형식인지 알아본다(Import 창의 "Auto") */
export type ImportFormat = 'curl' | 'http' | 'openapi' | 'postman';

export function detectImportFormat(text: string): ImportFormat {
  const t = text.replace(/^﻿/, '').trimStart();
  if (/^curl(\s|$)/i.test(t)) return 'curl';
  if (t.startsWith('{')) {
    try {
      const doc: unknown = JSON.parse(t);
      if (typeof doc === 'object' && doc !== null) {
        const o = doc as Record<string, unknown>;
        if (typeof o['openapi'] === 'string' || typeof o['swagger'] === 'string') return 'openapi';
        if (typeof o['info'] === 'object' && Array.isArray(o['item'])) return 'postman';
      }
    } catch {
      /* JSON 이 아니면 아래에서 */
    }
  }
  // YAML OpenAPI·Swagger: 주석 줄 뒤 맨 위 키
  for (const line of t.split(/\r?\n/)) {
    const l = line.trim();
    if (l === '' || l.startsWith('#') || l === '---') continue;
    if (/^(openapi|swagger)\s*:/.test(l)) return 'openapi';
    break;
  }
  return 'http';
}
