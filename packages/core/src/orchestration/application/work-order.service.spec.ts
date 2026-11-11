import { describe, expect, it } from 'vitest';
import { InMemoryWorkOrderRepository } from '../infrastructure/in-memory-work-order.repository.js';
import { OpenWorkOrderDto } from './dto/open-work-order.dto.js';
import { WorkReportDto } from './dto/work-report.dto.js';
import { WorkOrderService } from './work-order.service.js';

describe('WorkOrderService', () => {
  it('요청을 열고 상태 줄을 돌려준다', async () => {
    const service = new WorkOrderService(new InMemoryWorkOrderRepository(), () => 'wo-1');
    const status = await service.open(
      OpenWorkOrderDto.from({ title: '로그인 실패 제한', fileCount: 3, scope: ['src/auth/**'] }),
    );
    expect(status.toStatusLine()).toBe('[M] 로그인 실패 제한 · scenario · 다음: planner(haiku)');
    expect(status.next?.model).toBe('claude-haiku-5-5');
  });

  it('잠긴 테스트를 바꾼 구현 보고는 거부한다', async () => {
    const repo = new InMemoryWorkOrderRepository();
    const service = new WorkOrderService(repo, () => 'wo-1');
    await service.open(OpenWorkOrderDto.from({ title: 't', fileCount: 1, scope: ['src/auth/**'] }));
    const order = await repo.findById('wo-1');
    order!.approveScenario({ happyPaths: 1, errorPaths: 1 });
    order!.recordRed(WorkReportDto.from({ result: 'done', did: ['red'], passed: 0, failed: 1 }).toTestRun());

    const report = WorkReportDto.from({
      result: 'done',
      did: ['구현'],
      changedFiles: ['src/auth/login.spec.ts'],
      passed: 1,
      failed: 0,
    });
    await expect(service.submitImplementation('wo-1', report)).rejects.toThrow(/login.spec/);
  });
});
