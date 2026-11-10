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

/** git과 하위 명령 사이에 낀 전역 옵션(-C 폴더, -c 키=값, --옵션) */
const gitCommand = (names: string): RegExp => new RegExp(String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--?\S+))*\s+(?:${names})\b`);

function environmentOf(command: string): Environment | null {
  // prod_main, my-prod, PROD처럼 앞뒤가 알파벳이 아니면 운영으로 본다(밑줄·숫자로 이어진 이름도)
  if (/(^|[^a-z])prod(uction)?([^a-z]|$)|운영/i.test(command)) return 'prod';
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

  if (shell && gitCommand('push').test(command)) {
    const branch = protectedIn(command, protectedBranches);
    const force = /\s(--force|-f|--force-with-lease)\b/.test(command);
    const risks = [force ? 'A force push overwrites history on the remote' : 'Goes straight to the remote repository'];
    if (branch !== null) risks.push(`${branch} is a protected branch; it may trigger deploys or affect other people's work`);
    return { ...base, kind: 'code', headline: `${force ? 'Force push' : 'Push'} to ${branch ?? 'a branch'}`, protectedBranch: branch, forcePush: force, risks };
  }
  if (shell && gitCommand('merge|rebase').test(command)) {
    const branch = protectedIn(command, protectedBranches);
    return { ...base, kind: 'code', headline: branch !== null ? `Merge into ${branch}` : 'Merge a branch', protectedBranch: branch, risks: branch !== null ? [`Touches ${branch}`] : [] };
  }
  if (shell && /\b(terraform|aws|kubectl|helm|cdk|pulumi)\b/.test(command)) {
    const environment = environmentOf(command);
    const destroys = /\b(destroy|delete|terminate|rm|remove|drain)\b/.test(command);
    const risks = [destroys ? 'Can delete or detach resources' : 'Changes resources'];
    if (environment === 'prod') risks.push('This is the production (prod) environment');
    if (environment === null) risks.push('Cannot tell the environment from the command');
    return { ...base, kind: 'infra', headline: environment === 'prod' ? 'Production infrastructure change' : 'Infrastructure change', environment, profile: flag(command, 'profile'), region: flag(command, 'region'), risks };
  }
  if (shell && /\b(psql|mysql|prisma\s+migrate|knex\s+migrate|flyway|liquibase)\b|\b(drop|truncate)\s+table|\bdelete\s+from\b/i.test(command)) {
    return { ...base, kind: 'database', headline: 'DB write / migration', risks: ['Data changes. You need a backup to undo it'] };
  }
  if (!shell) return { ...base, kind: 'files', headline: 'Change to a file outside the work folder', risks: ['The file is outside the work folder'] };
  return { ...base, kind: 'other', headline: request.reason, risks: [] };
}
