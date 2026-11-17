import { RequestCoverage, type Ask } from '../../domain/request-coverage.js';

const STATUS = new Set<Ask['status']>(['done', 'partial', 'not_done']);

/**
 * 팀원 보고의 asks·scope → 요청 항목 표. 없거나 깨진 항목은 버린다(옛 보고·가짜 팀원도 그대로 읽힌다).
 * 상태를 알 수 없는 항목은 끝나지 않은 것으로 본다(끝났다고 부풀리지 않는다).
 */
export class CoverageDto {
  private constructor() {}

  static read(output: unknown, opened: readonly string[] | undefined): RequestCoverage {
    const o = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    const asks: Ask[] = (Array.isArray(o['asks']) ? o['asks'] : []).flatMap((item): Ask[] => {
      if (typeof item !== 'object' || item === null) return [];
      const a = item as Record<string, unknown>;
      const status = STATUS.has(a['status'] as Ask['status']) ? (a['status'] as Ask['status']) : 'partial';
      return [{ ask: text(a['ask']), status, note: text(a['note']), needs: text(a['needs']) }];
    });
    const scope = (Array.isArray(o['scope']) ? o['scope'] : []).filter((s): s is string => typeof s === 'string');
    return RequestCoverage.of(asks, opened ?? [], scope);
  }
}
