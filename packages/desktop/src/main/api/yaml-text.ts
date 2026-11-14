import { parse } from 'yaml';
import { ApiError } from '../../shared/api-request.js';

/**
 * YAML(OpenAPI·Swagger 문서)을 JSON 글로. 별칭(&·*)은 100번까지만 펼쳐 "billion laughs" 같은 부풀리기를 막고,
 * 사용자 정의 태그는 읽지 않는다(core 스키마).
 */
export function yamlToJson(text: string): string {
  let doc: unknown;
  try {
    doc = parse(text, { maxAliasCount: 100, schema: 'core', uniqueKeys: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : '';
    throw new ApiError(`That is neither JSON nor valid YAML${msg ? ` (${msg})` : ''}.`);
  }
  const json = JSON.stringify(doc);
  if (json === undefined || json.length > 20_000_000) throw new ApiError('That YAML document is too large.');
  return json;
}
