import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import type { ServerTarget } from '../../shared/db-server.js';

declare const __RDS_CA_BUNDLE__: string | undefined;

/**
 * Amazon RDS 루트 CA 묶음(certs/aws-rds-global-bundle.pem).
 * 출처: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem (AWS 가 클라이언트에 넣어 쓰라고 공개한 공개 인증서, 약 170KB).
 * RDS·Aurora 의 서버 인증서는 Node 기본 CA 목록에 없는 Amazon RDS 루트가 서명해서, 이것 없이 "SSL + 인증서 확인"을 고르면 접속이 실패한다.
 * 빌드(scripts/build.mjs)가 파일 내용을 __RDS_CA_BUNDLE__ 로 main 번들에 넣는다(asar 안에서도 된다). 시험·소스 실행에서는 파일을 읽는다.
 * 묶음을 새로 받으려면 같은 주소에서 내려받아 파일을 바꾸고 server-tls.spec.ts 를 돌린다.
 */
export const RDS_CA_MIN_CERTS = 100;

let cached: string | null = null;
export function rdsCaBundle(): string {
  if (typeof __RDS_CA_BUNDLE__ === 'string') return __RDS_CA_BUNDLE__;
  cached ??= readFileSync(new URL('./certs/aws-rds-global-bundle.pem', import.meta.url), 'utf8');
  return cached;
}

/** 드라이버(mysql2 · pg)에 넘길 SSL 설정. off 면 null */
export function sslOptionsFor(target: ServerTarget): { readonly rejectUnauthorized: boolean; readonly ca?: readonly string[] } | null {
  if (target.ssl === 'off') return null;
  if (target.ssl === 'require') return { rejectUnauthorized: false };
  // ca 를 주면 Node 기본 목록을 대신하므로, 기본 목록에 RDS 묶음을 더해 넘긴다
  return target.extraCa() === 'aws-rds' ? { rejectUnauthorized: true, ca: [...rootCertificates, rdsCaBundle()] } : { rejectUnauthorized: true };
}
