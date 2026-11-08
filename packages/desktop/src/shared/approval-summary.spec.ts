import { describe, expect, it } from 'vitest';
import { summarizeRequest } from './approval-summary.js';

const bash = (detail: string) => ({ tool: 'Bash', detail, reason: '위험 동작' });

describe('summarizeRequest', () => {
  it('main으로 push하면 코드 종류이고 보호 브랜치를 알린다', () => {
    const s = summarizeRequest(bash('git push origin main'));
    expect(s.kind).toBe('code');
    expect(s.protectedBranch).toBe('main');
    expect(s.forcePush).toBe(false);
    expect(s.headline).toBe('main 브랜치에 push');
  });

  it('강제 push는 따로 표시하고 위험을 더 쓴다', () => {
    const s = summarizeRequest(bash('git push --force origin qa'));
    expect(s.forcePush).toBe(true);
    expect(s.protectedBranch).toBe('qa');
    expect(s.risks.join(' ')).toContain('덮어써요');
  });

  it('보호 브랜치가 아니면 보호 브랜치 표시가 없다', () => {
    expect(summarizeRequest(bash('git push origin feature/pay')).protectedBranch).toBeNull();
  });

  it('보호 브랜치 목록은 설정으로 바꿀 수 있다', () => {
    expect(summarizeRequest(bash('git push origin develop'), ['develop']).protectedBranch).toBe('develop');
  });

  it('terraform apply를 운영 환경에 하면 인프라 종류이고 운영이라고 알린다', () => {
    const s = summarizeRequest(bash('terraform apply -var env=prod'));
    expect(s.kind).toBe('infra');
    expect(s.environment).toBe('prod');
    expect(s.risks.join(' ')).toContain('운영');
  });

  it('환경을 알 수 없는 인프라 명령은 모른다고 쓴다', () => {
    const s = summarizeRequest(bash('kubectl delete pod web-1'));
    expect(s.environment).toBeNull();
    expect(s.risks.join(' ')).toContain('어느 환경');
  });

  it('인프라 명령의 프로필과 리전을 읽는다', () => {
    const s = summarizeRequest(bash('aws ecs update-service --profile company-prod --region ap-northeast-2 --cluster x'));
    expect(s.profile).toBe('company-prod');
    expect(s.region).toBe('ap-northeast-2');
    expect(summarizeRequest(bash('terraform apply')).profile).toBeNull();
  });

  it('DB 마이그레이션은 데이터베이스 종류다', () => {
    expect(summarizeRequest(bash('npx prisma migrate deploy')).kind).toBe('database');
  });

  it('작업 폴더 밖 파일을 고치려는 도구 호출은 파일 종류다', () => {
    expect(summarizeRequest({ tool: 'Write', detail: 'C:/Users/me/.ssh/config', reason: '폴더 밖' }).kind).toBe('files');
  });
});

describe('summarizeRequest 가리기 시도', () => {
  it('prod_main처럼 밑줄로 이어진 운영 프로필도 운영으로 알린다(경로에 dev가 있어도)', () => {
    const s = summarizeRequest(bash('aws s3 rm s3://dev-data/old --recursive --profile prod_main --region ap-northeast-2'));
    expect(s.environment).toBe('prod');
    expect(s.profile).toBe('prod_main');
  });

  it('git -C 폴더 merge main처럼 옵션이 끼어 있어도 보호 브랜치 합치기로 알린다', () => {
    const s = summarizeRequest(bash('git -C ../app merge main'));
    expect(s.protectedBranch).toBe('main');
    expect(s.headline).toBe('main 브랜치 합치기');
  });

  it('git -c 옵션이 끼어 있어도 push는 push로 알린다', () => {
    const s = summarizeRequest(bash('git -c http.extraHeader=x push --force origin main'));
    expect(s.forcePush).toBe(true);
    expect(s.protectedBranch).toBe('main');
  });
});
