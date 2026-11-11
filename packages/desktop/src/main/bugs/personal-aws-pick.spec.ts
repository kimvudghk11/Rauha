import { describe, expect, it } from 'vitest';
import type { AwsTarget } from '../../shared/bug-sync.js';
import { BugSyncError } from '../../shared/bug-sync.js';
import { PERSONAL_AWS } from '../../shared/personal-aws.js';
import { personalAwsPicker, personalAwsPort } from './personal-aws-pick.js';
import type { S3Port } from './s3-port.js';

/** 프로필 이름 → 그 프로필의 실제 계정(없으면 로그인 실패) */
function fakeConnect(accounts: Record<string, string | null>, tried: string[] = []) {
  return (target: AwsTarget): S3Port => ({
    callerAccount: async () => {
      tried.push(target.profile);
      const a = accounts[target.profile];
      if (a === undefined || a === null) throw new Error('no credentials');
      return a;
    },
    put: async () => undefined,
    list: async () => [target.profile],
    get: async () => target.profile,
  });
}

const COMPANY = '111122223333';

describe('개인 AWS 프로필 고르기 — 계정은 고정, 프로필은 찾아 쓴다', () => {
  it('회사 노트북처럼 default 가 회사 계정이면 개인 계정인 personal 프로필을 쓴다', async () => {
    const port = await personalAwsPicker(fakeConnect({ default: COMPANY, personal: PERSONAL_AWS.account }))();
    expect(await port.list('x')).toEqual(['personal']);
  });

  it('이 PC 처럼 default 가 개인 계정이면 default 를 쓴다', async () => {
    const port = await personalAwsPicker(fakeConnect({ default: PERSONAL_AWS.account }))();
    expect(await port.get('k')).toBe('default');
  });

  it('회사 계정 프로필밖에 없으면 아무 데도 보내지 않고 개인 프로필을 추가하라고 알린다', async () => {
    const pick = personalAwsPicker(fakeConnect({ default: COMPANY }));
    await expect(pick()).rejects.toThrow(BugSyncError);
    await expect(pick()).rejects.toThrow(/aws configure --profile personal/);
  });

  it('로그인되는 프로필이 하나도 없으면 그렇게 알린다', async () => {
    await expect(personalAwsPicker(fakeConnect({}))()).rejects.toThrow(/can sign in/);
  });

  it('한 번 찾은 프로필은 다음에 먼저 써 본다', async () => {
    const tried: string[] = [];
    const pick = personalAwsPicker(fakeConnect({ default: PERSONAL_AWS.account }, tried));
    await pick();
    tried.length = 0;
    await pick();
    expect(tried).toEqual(['default']);
  });

  it('연결은 처음 쓸 때 한 번만 찾고, 실패하면 다음에 다시 찾는다', async () => {
    let calls = 0;
    let ok = false;
    const port = personalAwsPort(async () => {
      calls += 1;
      if (!ok) throw new BugSyncError('no');
      return fakeConnect({ personal: PERSONAL_AWS.account })({ profile: 'personal' } as AwsTarget);
    });
    await expect(port.callerAccount()).rejects.toThrow('no');
    ok = true;
    expect(await port.callerAccount()).toBe(PERSONAL_AWS.account);
    await port.list('p');
    expect(calls).toBe(2);
  });
});
