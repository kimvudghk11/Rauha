import { describe, expect, it } from 'vitest';
import { ToolKits } from './tool-kit.js';

const wants = (role: Parameters<typeof ToolKits.for>[0], request: string, kit: 'browser' | 'aws') => ToolKits.for(role, request).includes(kit);

describe('ToolKits 브라우저', () => {
  it('요청에 주소가 있으면 답변 팀원에게 브라우저를 붙인다', () => {
    expect(wants('answerer', 'https://example.com 이 페이지 내용 요약해줘', 'browser')).toBe(true);
    expect(wants('answerer', 'localhost:5173 지금 어떻게 보여?', 'browser')).toBe(true);
    expect(wants('answerer', '127.0.0.1:8080/admin 에 뭐 떠?', 'browser')).toBe(true);
  });

  it('주소 없이 띄워 둔 웹페이지·브라우저를 가리켜도 붙인다', () => {
    expect(wants('answerer', '지금 띄운 웹페이지 읽어줘', 'browser')).toBe(true);
    expect(wants('answerer', '브라우저에서 로그인 화면 확인해줘', 'browser')).toBe(true);
    expect(wants('debugger', '열어 둔 페이지에서 버튼이 왜 안 눌려?', 'browser')).toBe(true);
    expect(wants('answerer', 'dev 서버 화면 봐줘', 'browser')).toBe(true);
  });

  it('웹페이지와 상관없는 요청에는 붙이지 않는다 (도구 설명만으로 입력이 크게 늘어서)', () => {
    expect(wants('answerer', 'Money.add는 왜 이렇게 짰어?', 'browser')).toBe(false);
    expect(wants('answerer', '테스트 돌려봐', 'browser')).toBe(false);
    expect(wants('answerer', 'README 3페이지쯤 내용 뭐야', 'browser')).toBe(false);
  });

  it('브라우저를 쓰지 않는 역할에는 주소가 있어도 붙이지 않는다', () => {
    expect(wants('router', 'https://example.com 읽어줘', 'browser')).toBe(false);
    expect(wants('marketer', 'https://example.com 경쟁사 랜딩 보고 문구 써줘', 'browser')).toBe(false);
  });

  it('화면을 다루는 디자인 팀원은 주소가 있으면 붙인다', () => {
    expect(wants('uxdesigner', 'http://localhost:3000 화면 흐름 검토해줘', 'browser')).toBe(true);
  });
});

describe('ToolKits AWS', () => {
  it('AWS 서비스나 인프라를 말하면 AWS 공식 지식(문서·리전·스킬)을 붙인다', () => {
    expect(wants('answerer', 'ECS on EC2랑 Fargate 차이 알려줘', 'aws')).toBe(true);
    expect(wants('operator', '내 S3 버킷 목록 보여줘', 'aws')).toBe(true);
    expect(wants('designer', '주문 이벤트를 SQS로 받아서 람다로 처리하는 구조 만들어줘', 'aws')).toBe(true);
    expect(wants('implementer', 'CDK로 VPC 스택 추가해줘', 'aws')).toBe(true);
    expect(wants('implementer', '테라폼으로 RDS 모듈 만들어줘', 'aws')).toBe(true);
    expect(wants('riskchecker', '이 IAM 정책 바꾸면 어디가 깨져?', 'aws')).toBe(true);
    expect(wants('answerer', '서버리스로 가면 비용이 어때?', 'aws')).toBe(true);
  });

  it('영어 낱말 안에 든 약어(ecs, iam)는 AWS로 보지 않는다', () => {
    expect(wants('answerer', 'specs 폴더 정리해줘', 'aws')).toBe(false);
    expect(wants('answerer', 'diam 변수 이름 바꿔줘', 'aws')).toBe(false);
  });

  it('AWS와 상관없는 요청이나 AWS를 다루지 않는 역할에는 붙이지 않는다', () => {
    expect(wants('answerer', 'Money.add는 왜 이렇게 짰어?', 'aws')).toBe(false);
    expect(wants('marketer', 'AWS 스타트업 행사 홍보 문구 써줘', 'aws')).toBe(false);
    expect(wants('tester', 'S3 업로드 테스트 추가해줘', 'aws')).toBe(false);
  });

  it('두 가지가 다 필요하면 둘 다 붙인다', () => {
    expect(ToolKits.for('answerer', 'localhost:3000에서 S3 업로드가 왜 실패해?')).toEqual(['browser', 'aws']);
  });
});

describe('ToolKits 커넥터', () => {
  it('노션·컨플루언스·지라·구글 문서를 가리키는 요청이면 답변 팀원에게 커넥터를 붙인다', () => {
    expect(ToolKits.for('answerer', '이 내용 노션에 정리해줘')).toContain('connectors');
    expect(ToolKits.for('answerer', '컨플루언스 온보딩 페이지 읽어줘')).toContain('connectors');
    expect(ToolKits.for('answerer', 'JIRA 이슈 PROJ-12 요약해줘')).toContain('connectors');
    expect(ToolKits.for('answerer', '구글 시트에 적어줘')).toContain('connectors');
    expect(ToolKits.for('answerer', 'Notion page 찾아줘')).toContain('connectors');
  });

  it('상관없는 요청과 다른 역할에는 붙이지 않는다', () => {
    expect(ToolKits.for('answerer', '이 함수 뭐 해?')).not.toContain('connectors');
    expect(ToolKits.for('implementer', '노션에 정리해줘')).not.toContain('connectors');
  });
});
