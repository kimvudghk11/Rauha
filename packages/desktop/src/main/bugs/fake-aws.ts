import type { S3Port } from './s3-port.js';

/** 확인용 실행(RAUHA_FAKE_TEAM)에서 진짜 AWS 대신 쓰는 메모리 저장소. 계정은 000000000000이다. */
export function fakeAws(): S3Port {
  const files = new Map<string, string>();
  return {
    callerAccount: async () => '000000000000',
    put: async (key, body) => void files.set(key, body),
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)),
    get: async (key) => files.get(key) ?? '',
  };
}
