import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Investigation } from './investigation.js';

const base = {
  symptom: '결제가 두 번 깎인다',
  facts: [{ text: '재시도 때 같은 결제 번호로 승인을 다시 부른다', evidence: 'packages/api/src/pay/retry.ts:42' }],
  causes: [{ text: '재시도에 멱등 키가 없다', confidence: 'high' as const, check: '재시도 직전 승인 로그를 본다' }],
  unknowns: ['PG사가 중복 승인을 막는지'],
};

describe('Investigation', () => {
  it('확인한 사실마다 근거(파일)가 있어야 한다', () => {
    expect(() => Investigation.of({ ...base, facts: [{ text: '아마 그럴 것이다', evidence: '' }] })).toThrow(DomainError);
  });

  it('원인 후보의 확신도는 높음·중간·낮음 중 하나다', () => {
    expect(() => Investigation.of({ ...base, causes: [{ text: 'x', confidence: 'sure' as never, check: 'y' }] })).toThrow(DomainError);
  });

  it('증상이 비어 있으면 만들 수 없다', () => {
    expect(() => Investigation.of({ ...base, symptom: '  ' })).toThrow(DomainError);
  });

  it('사실을 못 찾았으면 모르는 것을 적어야 한다', () => {
    expect(() => Investigation.of({ ...base, facts: [], unknowns: [] })).toThrow(DomainError);
    expect(Investigation.of({ ...base, facts: [], unknowns: ['재현이 안 된다'] }).facts).toHaveLength(0);
  });

  it('근거 파일의 줄 번호를 떼고 영역을 센다: 모노레포는 앞 두 칸, 그 밖에는 첫 칸', () => {
    const inv = Investigation.of({
      ...base,
      facts: [
        { text: 'a', evidence: 'packages/api/src/a.ts:1' },
        { text: 'b', evidence: 'packages/api/src/b.ts' },
        { text: 'c', evidence: 'packages/web/src/c.ts:9' },
        { text: 'd', evidence: 'docs/x.md' },
        { text: 'e', evidence: 'README.md' },
      ],
    });
    expect(inv.areas()).toEqual(['packages/api', 'packages/web', 'docs', '(루트)']);
  });

  it('윈도우 경로 구분자도 같은 영역으로 센다', () => {
    const inv = Investigation.of({ ...base, facts: [{ text: 'a', evidence: String.raw`packages\api\src\a.ts:3` }, { text: 'b', evidence: 'packages/api/x.ts' }] });
    expect(inv.areas()).toEqual(['packages/api']);
  });

  it('근거 파일 목록은 줄 번호 없이 한 번씩만 돌려준다', () => {
    const inv = Investigation.of({ ...base, facts: [{ text: 'a', evidence: 'a.ts:1' }, { text: 'b', evidence: 'a.ts:2' }] });
    expect(inv.evidencePaths()).toEqual(['a.ts']);
  });
});
