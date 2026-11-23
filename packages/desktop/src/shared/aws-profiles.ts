export interface AwsProfileView {
  readonly name: string;
  readonly region: string | null;
  /** SSO(IAM Identity Center) 로그인을 쓰는지 */
  readonly sso: boolean;
  /** credentials 파일에 키가 있는지(값은 읽지 않는다) */
  readonly keys: boolean;
}

const SAFE_NAME = /^[\w.@+-]{1,64}$/;

/** "[이름]" 칸들. 값은 이름=값 줄만 모은다 */
function sections(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head !== null) {
      cur = new Map();
      out.set(head[1]!.trim(), cur);
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (kv !== null && cur !== null) cur.set(kv[1]!.toLowerCase(), kv[2]!.trim());
  }
  return out;
}

/**
 * ~/.aws/config 와 ~/.aws/credentials 에서 프로필 이름·리전·SSO 여부만 읽는다.
 * credentials 는 어느 칸이 있는지만 보고 키 값은 담지 않는다.
 */
export class AwsProfiles {
  private constructor(private readonly items: readonly AwsProfileView[]) {}

  static read(configText: string, credentialsText: string): AwsProfiles {
    const items: AwsProfileView[] = [];
    const byName = new Map<string, number>();
    for (const [head, kv] of sections(configText)) {
      const name = head === 'default' ? 'default' : head.startsWith('profile ') ? head.slice('profile '.length).trim() : null;
      if (name === null || !SAFE_NAME.test(name) || byName.has(name)) continue;
      byName.set(name, items.length);
      items.push({ name, region: kv.get('region') ?? null, sso: kv.has('sso_session') || kv.has('sso_start_url'), keys: false });
    }
    for (const [head] of sections(credentialsText)) {
      const name = head.trim();
      if (!SAFE_NAME.test(name)) continue;
      const at = byName.get(name);
      if (at !== undefined) items[at] = { ...items[at]!, keys: true };
      else {
        byName.set(name, items.length);
        items.push({ name, region: null, sso: false, keys: true });
      }
    }
    return new AwsProfiles(items);
  }

  list(): readonly AwsProfileView[] {
    return this.items;
  }

  /** 목록에 있는 이름만 명령 인자로 넘긴다 */
  has(name: unknown): name is string {
    return typeof name === 'string' && this.items.some((p) => p.name === name);
  }
}

/** `aws sts get-caller-identity --output json` → 계정 번호와 누구인지(역할/사용자 이름) */
export function callerOf(json: string): { readonly account: string; readonly who: string } | null {
  try {
    const v = JSON.parse(json) as { Account?: unknown; Arn?: unknown };
    if (typeof v.Account !== 'string' || typeof v.Arn !== 'string') return null;
    const res = v.Arn.split(':').slice(5).join(':');
    const who = res.replace(/^(assumed-role|user|role)\//, '');
    return { account: v.Account, who };
  } catch {
    return null;
  }
}
