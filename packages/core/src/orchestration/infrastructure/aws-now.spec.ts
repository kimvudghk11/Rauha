import { describe, expect, it } from 'vitest';
import { withAwsNow } from './agent-sdk-team-member.js';

describe('AWS 작업 팀원에게 지금 AWS 상태 붙이기', () => {
  it('AWS 도구 묶음을 붙인 호출에만 붙인다', () => {
    const line = 'profile=default · region=ap-northeast-2 · VPN: 꺼짐';
    expect(withAwsNow('SYS', ['aws'], line)).toContain('<aws_now>');
    expect(withAwsNow('SYS', ['aws'], line)).toContain(line);
    expect(withAwsNow('SYS', ['browser'], line)).toBe('SYS');
    expect(withAwsNow('SYS', [], line)).toBe('SYS');
  });

  it('상태가 비어 있으면 붙이지 않는다', () => {
    expect(withAwsNow('SYS', ['aws'], '  ')).toBe('SYS');
  });

  it('계정 사실은 여전히 CLI 로 확인하라고 적는다', () => {
    expect(withAwsNow('SYS', ['aws'], 'x')).toMatch(/aws CLI 로 확인/);
  });
});
