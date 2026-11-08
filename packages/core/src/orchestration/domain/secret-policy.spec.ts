import { describe, expect, it } from 'vitest';
import { SecretPolicy } from './secret-policy.js';

describe('SecretPolicy', () => {
  const p = SecretPolicy.defaults();

  it('기본 비밀 파일은 어느 폴더에 있어도 막는다', () => {
    for (const path of ['.env', 'apps/api/.env.production', 'certs/server.pem', 'keys/id_rsa', '.npmrc']) expect(p.isSecret(path)).toBe(true);
  });

  it('예시 파일은 비밀이 아니다', () => {
    for (const path of ['.env.example', 'config/.env.sample', '.env.template']) expect(p.isSecret(path)).toBe(false);
  });

  it('Windows 구분자와 대문자도 같은 파일로 본다', () => {
    expect(p.isSecret('config\\Prod.KEY')).toBe(true);
    expect(p.isSecret('.ENV')).toBe(true);
  });

  it('보통 소스 파일은 막지 않는다', () => {
    for (const path of ['src/env.ts', 'src/keyboard.ts', 'README.md']) expect(p.isSecret(path)).toBe(false);
  });

  it('추가 패턴은 경로째로도 맞춘다', () => {
    expect(SecretPolicy.of(['secrets/**']).isSecret('secrets/db/password.txt')).toBe(true);
  });

  const here = { root: 'E:/work/app', secretFiles: ['.env', 'secrets/db.txt'] };

  it('셸 명령에 비밀 파일이 나오면 그 이름을 돌려준다', () => {
    expect(p.secretIn('cat .env | head', here)).toBe('.env');
    expect(p.secretIn('type "config\\.env.local"', here)).toBe('config\\.env.local');
    expect(p.secretIn('yarn test', here)).toBeNull();
  });

  it('와일드카드, 절대 경로, git show, 옵션 값으로 가리켜도 잡는다', () => {
    expect(p.secretIn('cat .env*', here)).toBe('.env*');
    expect(SecretPolicy.of(['secrets/**']).secretIn('cat E:\\work\\app\\secrets\\db.txt', here)).toBe('E:\\work\\app\\secrets\\db.txt');
    expect(p.secretIn('git show HEAD:.env', here)).toBe('HEAD:.env');
    expect(p.secretIn('node --env-file=.env server.js', here)).toBe('.env');
  });

  it('비밀 파일이 있는 저장소에서는 셸로 내용을 통째로 뒤지는 검색을 막는다', () => {
    expect(p.secretIn('grep -rn API_KEY .', here)).toBe('grep -rn');
    expect(p.secretIn('rg password', here)).toBe('rg');
    expect(p.secretIn('git grep token', here)).toBe('git grep');
    expect(p.secretIn('grep -rn API_KEY .', { ...here, secretFiles: [] })).toBeNull();
    expect(p.secretIn('grep -n foo src/a.ts', here)).toBeNull();
  });
});

describe('SecretPolicy 우회 시도', () => {
  const p = SecretPolicy.defaults();
  const here = { root: 'E:/work/app', secretFiles: ['.env', 'credentials.json'] };
  const blocked = (command: string) => expect(p.secretIn(command, here), command).not.toBeNull();

  it('따옴표나 역슬래시로 이름을 쪼개도 같은 파일로 본다', () => {
    blocked('cat .e""nv');
    blocked("cat .en''v");
    blocked('cat .e\\nv');
    blocked('cat ".e"nv');
  });

  it('?와 [글자]와 {a,b} 와일드카드로 가리켜도 잡는다', () => {
    blocked('cat .?nv');
    blocked('cat .[e]nv');
    blocked('cat .en{v,}');
    blocked('cat .{env,x}');
  });

  it('16진·8진 표기($\'\\x2e\')로 쓴 이름도 잡는다', () => {
    blocked("cat $'\\x2eenv'");
    blocked("cat $'\\056env'");
  });

  it('Windows 대체 데이터 스트림(::$DATA)과 짧은 8.3 이름으로 가리켜도 잡는다', () => {
    blocked('type .env::$DATA');
    blocked('type ENV~1');
    blocked('type CREDEN~1.JSO');
  });

  it('비밀 파일이 있으면 풀어서 실행하는 명령(base64 -d, eval, xxd -r, printf \\x)은 거절한다', () => {
    blocked('echo LmVudg== | base64 -d | xargs cat');
    blocked('eval "$(echo Y2F0IC5lbnY= | base64 --decode)"');
    blocked('cat $(printf "\\x2eenv")');
    blocked('xxd -r -p <<< 2e656e76');
  });

  it('비밀 파일이 없으면 같은 명령도 막지 않고, HEAD~1 같은 보통 명령은 막지 않는다', () => {
    expect(p.secretIn('echo aGk= | base64 -d', { root: 'E:/work/app', secretFiles: [] })).toBeNull();
    expect(p.secretIn('git diff HEAD~1', here)).toBeNull();
    expect(p.secretIn('git log -n 3 --oneline', here)).toBeNull();
  });
});
