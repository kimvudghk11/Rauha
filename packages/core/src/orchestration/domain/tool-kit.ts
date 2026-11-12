import type { MemberRole } from './member-role.js';

/**
 * 요청에 따라 팀원에게 더 붙이는 도구 묶음(MCP 서버).
 * browser: 웹페이지를 열어 읽는 브라우저. aws: AWS 공식 문서·리전별 제공 여부·AWS 스킬(계정 없이 쓰는 공개 서버).
 */
export type ToolKit = 'browser' | 'aws' | 'connectors';

/** 사용자가 설정에서 연결한 업무 도구(노션·컨플루언스·지라 …)를 읽고 쓰는 역할. 지금은 답변 팀원만. */
const CONNECTOR_ROLES: ReadonlySet<MemberRole> = new Set(['answerer']);
const CONNECTOR_WORDS = /노션|notion|컨플루언스|confluence|컨플|위키|wiki|지라|jira|아틀라시안|atlassian|구글\s?(독스|문서|시트|드라이브)|google\s?(docs?|sheets?|drive)|스프레드\s?시트|spreadsheet|시트에|커넥터|connector/i;

/** 브라우저로 페이지를 열어 볼 수 있는 역할. 답을 찾거나(답변·디버깅) 화면을 다루는(UX) 팀원만. */
const BROWSER_ROLES: ReadonlySet<MemberRole> = new Set(['answerer', 'debugger', 'uxdesigner']);
/** AWS 지식을 쓰는 역할. 설계·구현·운영과 그 판단을 돕는 팀원. 테스트 팀원은 이미 정한 동작만 검증하므로 뺀다. */
const AWS_ROLES: ReadonlySet<MemberRole> = new Set(['answerer', 'operator', 'designer', 'intake', 'implementer', 'debugger', 'riskchecker', 'securitychecker', 'planner', 'splitter']);

const ADDRESS = /https?:\/\/\S+|\b(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i;
const WEB_WORDS = /웹\s?페이지|웹\s?사이트|브라우저|browser|web\s?page|(dev|개발)\s?서버/i;
/** "띄운 웹페이지", "열어 둔 로그인 페이지"처럼 지금 떠 있는 페이지를 가리키는 말 */
const OPENED_PAGE = /(띄운|띄워\s?(둔|놓은)|열어\s?(둔|놓은)|열린|켜\s?(둔|놓은))\s*(\S+\s+){0,2}\S*(페이지|화면|사이트)/;

/** 짧은 약어는 영어 낱말 안에서 걸리지 않게 앞뒤가 영문·숫자가 아닐 때만 본다("specs"의 ecs, "diam"의 iam). */
const AWS_SHORT = /(?<![A-Za-z0-9])(aws|s3|ec2|ecs|eks|ecr|rds|iam|vpc|sqs|sns|ses|kms|cdk|cfn|sam|alb|elb|nlb|efs|ebs|waf|acm|ssm|sts)(?![A-Za-z0-9])/i;
const AWS_WORDS =
  /amazon|lambda|람다|fargate|aurora|dynamo|cloudformation|클라우드포메이션|terraform|테라폼|cloudfront|route\s?53|eventbridge|step\s?functions|api\s?gateway|cognito|bedrock|sagemaker|elasticache|kinesis|cloudwatch|athena|glue|opensearch|beanstalk|lightsail|amplify|app\s?runner|secrets\s?manager|parameter\s?store|클라우드|인프라|서버리스|serverless/i;

/**
 * 이 요청에 어떤 도구 묶음을 붙일지. 도구 설명이 브라우저 2만 자, AWS 8천 자쯤이라 모든 호출에 붙이면 한도를 크게 쓴다.
 * 그래서 요청이 그쪽을 가리킬 때만 붙인다. 놓치면 팀원은 WebFetch·WebSearch로 대신한다.
 */
export class ToolKits {
  private constructor() {}

  static for(role: MemberRole, request: string): ToolKit[] {
    const kits: ToolKit[] = [];
    if (BROWSER_ROLES.has(role) && (ADDRESS.test(request) || WEB_WORDS.test(request) || OPENED_PAGE.test(request))) kits.push('browser');
    if (AWS_ROLES.has(role) && (AWS_SHORT.test(request) || AWS_WORDS.test(request))) kits.push('aws');
    if (CONNECTOR_ROLES.has(role) && CONNECTOR_WORDS.test(request)) kits.push('connectors');
    return kits;
  }
}
