/** 허락 요청이 무엇에 닿는지. 정리 화면이 종류별(코드·인프라)로 다른 칸을 보여 주는 데 쓴다. */
export type ApprovalKind = 'code' | 'infra' | 'database' | 'files' | 'other';

export type Environment = 'prod' | 'qa' | 'dev';

export interface ApprovalSummary {
  readonly kind: ApprovalKind;
  /** 한 줄 요약 */
  readonly headline: string;
  /** 보호 브랜치에 닿으면 그 이름(main·qa·release …) */
  readonly protectedBranch: string | null;
  readonly forcePush: boolean;
  /** 인프라 명령이 겨냥하는 환경. 알 수 없으면 null */
  readonly environment: Environment | null;
  /** 인프라 명령의 --profile · --region 값(없으면 null) */
  readonly profile: string | null;
  readonly region: string | null;
  /** 정리 화면에 보일 위험 문장들 */
  readonly risks: readonly string[];
}

export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ['main', 'qa', 'release'];

const words = (command: string): string[] => command.split(/\s+/).filter((w) => w !== '');

function protectedIn(command: string, protectedBranches: readonly string[]): string | null {
  for (const raw of words(command)) {
    // origin/main, HEAD:main, +main 같은 모양도 본다
    const name = raw.replace(/^\+/, '').split(/[:/]/).pop() ?? '';
    if (protectedBranches.includes(name)) return name;
  }
  return null;
}

/** `--profile prod` 또는 `--profile=prod` 모양에서 값을 읽는다 */
function flag(command: string, name: string): string | null {
  const m = new RegExp(`--${name}[= ](\\S+)`).exec(command);
  return m?.[1] ?? null;
}

function environmentOf(command: string): Environment | null {
  if (/\b(prod|production)\b|운영/i.test(command)) return 'prod';
  if (/\b(qa|stg|staging)\b/i.test(command)) return 'qa';
  if (/\b(dev|develop|development)\b/i.test(command)) return 'dev';
  return null;
}

/**
 * 허락 요청 하나를 사람이 읽을 요약으로 바꾼다. 규칙 문장만 다루고 명령을 실행하지 않는다.
 * 영향의 정확한 숫자(충돌·뒤처진 커밋)는 git으로 따로 계산한다.
 */
export function summarizeRequest(request: { readonly tool: string; readonly detail: string; readonly reason: string }, protectedBranches: readonly string[] = DEFAULT_PROTECTED_BRANCHES): ApprovalSummary {
  const command = request.detail;
  const shell = request.tool === 'Bash' || request.tool === 'PowerShell';
  const base = { protectedBranch: null, forcePush: false, environment: null, profile: null, region: null, risks: [] as string[] };

  if (shell && /\bgit\s+push\b/.test(command)) {
    const branch = protectedIn(command, protectedBranches);
    const force = /\s(--force|-f|--force-with-lease)\b/.test(command);
    const risks = [force ? '강제 push는 원격의 기록을 덮어써요' : '원격 저장소에 바로 올라가요'];
    if (branch !== null) risks.push(`${branch} 브랜치는 보호 대상이라 자동 배포나 다른 사람의 작업에 영향이 있을 수 있어요`);
    return { ...base, kind: 'code', headline: `${branch ?? '브랜치'}${branch !== null ? ' 브랜치' : ''}${force ? '에 강제 push' : '에 push'}`, protectedBranch: branch, forcePush: force, risks };
  }
  if (shell && /\bgit\s+(merge|rebase)\b/.test(command)) {
    const branch = protectedIn(command, protectedBranches);
    return { ...base, kind: 'code', headline: branch !== null ? `${branch} 브랜치 합치기` : '브랜치 합치기', protectedBranch: branch, risks: branch !== null ? [`${branch} 브랜치에 닿아요`] : [] };
  }
  if (shell && /\b(terraform|aws|kubectl|helm|cdk|pulumi)\b/.test(command)) {
    const environment = environmentOf(command);
    const destroys = /\b(destroy|delete|terminate|rm|remove|drain)\b/.test(command);
    const risks = [destroys ? '리소스를 지우거나 끊을 수 있어요' : '리소스를 바꿔요'];
    if (environment === 'prod') risks.push('운영(prod) 환경이에요');
    if (environment === null) risks.push('어느 환경인지 명령에서 알 수 없어요');
    return { ...base, kind: 'infra', headline: environment === 'prod' ? '운영 인프라 변경' : '인프라 변경', environment, profile: flag(command, 'profile'), region: flag(command, 'region'), risks };
  }
  if (shell && /\b(psql|mysql|prisma\s+migrate|knex\s+migrate|flyway|liquibase)\b|\b(drop|truncate)\s+table|\bdelete\s+from\b/i.test(command)) {
    return { ...base, kind: 'database', headline: 'DB 쓰기·마이그레이션', risks: ['데이터가 바뀌어요. 되돌리려면 백업이 필요해요'] };
  }
  if (!shell) return { ...base, kind: 'files', headline: '작업 폴더 밖 파일 변경', risks: ['작업 폴더 밖의 파일이에요'] };
  return { ...base, kind: 'other', headline: request.reason, risks: [] };
}
