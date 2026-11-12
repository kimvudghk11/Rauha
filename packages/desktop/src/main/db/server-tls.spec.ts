import { X509Certificate } from 'node:crypto';
import { rootCertificates as tlsRoots } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { ServerTarget } from '../../shared/db-server.js';
import { RDS_CA_MIN_CERTS, rdsCaBundle, sslOptionsFor } from './server-tls.js';

const t = (o: Record<string, unknown>) => ServerTarget.parse({ kind: 'postgres', host: 'db.example.com', user: 'app', database: 'shop', ...o });
const RDS = 'mydb.abc123.ap-northeast-2.rds.amazonaws.com';

describe('서버 접속 SSL 설정', () => {
  it('SSL off 면 암호화하지 않는다', () => {
    expect(sslOptionsFor(t({ ssl: 'off' }))).toBeNull();
  });
  it('require 는 암호화만 하고 인증서는 보지 않는다', () => {
    expect(sslOptionsFor(t({ ssl: 'require' }))).toEqual({ rejectUnauthorized: false });
    expect(sslOptionsFor(t({ host: RDS, ssl: 'require' }))).toEqual({ rejectUnauthorized: false });
  });
  it('verify 는 Node 기본 CA 로 인증서를 확인한다(RDS 가 아니면 CA 를 바꾸지 않는다)', () => {
    expect(sslOptionsFor(t({ ssl: 'verify' }))).toEqual({ rejectUnauthorized: true });
  });
  it('RDS 호스트 + verify 면 Node 기본 CA 에 Amazon RDS CA 묶음을 더해 믿는다', () => {
    const o = sslOptionsFor(t({ host: RDS, ssl: 'verify' }));
    expect(o?.rejectUnauthorized).toBe(true);
    const ca = o?.ca ?? [];
    expect(ca).toContain(rdsCaBundle());
    for (const root of tlsRoots.slice(0, 3)) expect(ca).toContain(root);
    expect(ca.length).toBe(tlsRoots.length + 1);
  });
});

describe('앱에 넣은 Amazon RDS CA 묶음', () => {
  it(`공식 global-bundle.pem 이 들어 있고 ${RDS_CA_MIN_CERTS}개 이상의 Amazon RDS 루트 인증서다`, () => {
    const pem = rdsCaBundle();
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(RDS_CA_MIN_CERTS);
    for (const b of blocks) {
      const cert = new X509Certificate(b);
      expect(cert.subject).toMatch(/O=Amazon Web Services\\?, Inc\./);
      expect(cert.subject).toMatch(/OU=Amazon RDS/);
      expect(cert.ca).toBe(true);
    }
  });
});
