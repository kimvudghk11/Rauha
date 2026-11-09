import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemberRole } from '../application/dto/role-settings.dto.js';
import type { MemberCall, MemberResult, RunLogPort } from '../application/ports.js';
import { ToolTally } from '../domain/tool-tally.js';
import type { CheckResult } from '../domain/verification.js';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 실행 기록을 `<runsDir>/<yyyyMMdd-HHmmss>-<id8>/`에 남긴다. 프롬프트 비교와 사용량 확인용. */
export class FileRunLog implements RunLogPort {
  private readonly dir: string;
  private sequence = 0;

  constructor(
    runsDir: string,
    runId: string,
    startedAt: Date,
    private readonly promptHash: string,
  ) {
    this.dir = join(runsDir, `${stamp(startedAt)}-${runId.slice(0, 8)}`);
  }

  async recordCall(role: MemberRole, attempt: number, call: MemberCall, result: MemberResult): Promise<void> {
    this.sequence += 1;
    await this.write(join('calls', `${pad(this.sequence)}-${role}-${attempt}.json`), {
      role,
      attempt,
      setting: call.setting,
      userMessage: call.userMessage,
      output: result.output,
      error: result.error,
      /** 찾아본 것(도구 이름과 횟수만). 팀원이 폴더를 실제로 훑었는지 한눈에 본다. */
      toolsLine: ToolTally.line(result.usage.tools ?? []),
      usage: result.usage,
    });
  }

  async recordChecks(label: string, results: readonly CheckResult[]): Promise<void> {
    await this.write(`checks-${label}.json`, results);
  }

  async finish(summary: Record<string, unknown>, guideMarkdown: string): Promise<string> {
    await this.write('summary.json', { ...summary, promptHash: this.promptHash });
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, 'guide.md'), guideMarkdown, 'utf8');
    return this.dir;
  }

  private async write(name: string, data: unknown): Promise<void> {
    const path = join(this.dir, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}
