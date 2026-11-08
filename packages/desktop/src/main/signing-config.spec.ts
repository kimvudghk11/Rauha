import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signedConfigText, signingEnabled, SIGNING_ENV } from '../../scripts/signing.mjs';

const ALL = Object.fromEntries(SIGNING_ENV.map((n) => [n, 'x']));
const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');

describe('맥 서명·공증 켜기', () => {
  it('다섯 환경 변수가 모두 있을 때만 켠다', () => {
    expect(signingEnabled(ALL)).toBe(true);
    for (const name of SIGNING_ENV) expect(signingEnabled({ ...ALL, [name]: '' })).toBe(false);
    expect(signingEnabled({ ...ALL, CSC_LINK: undefined })).toBe(false);
    expect(signingEnabled({ ...ALL, APPLE_ID: '  ' })).toBe(false);
    expect(signingEnabled({})).toBe(false);
  });

  it('값이 없으면 기존 설정은 ad-hoc 그대로다', () => {
    expect(yml).toContain('identity: "-"');
    expect(yml).toContain('notarize: false');
    expect(yml).toContain('hardenedRuntime: false');
  });

  it('켜면 ad-hoc 줄을 빼고 강화 런타임과 공증을 켠다', () => {
    const signed = signedConfigText(yml);
    expect(signed).not.toContain('identity: "-"');
    expect(signed).toContain('hardenedRuntime: true');
    expect(signed).toContain('notarize: true');
    expect(signed.split('\n').length).toBe(yml.split('\n').length - 1);
  });

  it('바꿀 줄이 없으면 조용히 넘어가지 않고 던진다', () => {
    expect(() => signedConfigText('mac:\n  target: dmg\n')).toThrow();
  });
});
