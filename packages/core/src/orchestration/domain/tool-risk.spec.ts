import { describe, expect, it } from 'vitest';
import { ToolRisk } from './tool-risk.js';

const ROOT = 'E:/work/app';
const bash = (command: string) => ToolRisk.assess('Bash', { command }, ROOT).decision;
const write = (file_path: string) => ToolRisk.assess('Write', { file_path, content: 'x' }, ROOT).decision;

describe('ToolRisk', () => {
  it('git commit과 git push는 언제나 거절한다', () => {
    expect(bash('git commit -m "x"')).toBe('deny');
    expect(bash('npm test && git commit -am x')).toBe('deny');
    expect(bash('git push origin main')).toBe('deny');
    expect(bash('GIT_AUTHOR_NAME=a git commit -m x')).toBe('deny');
  });

  it('git 쓰기 명령은 묻는다', () => {
    for (const cmd of [
      'git reset --hard',
      'git checkout -- src/a.ts',
      'git restore .',
      'git clean -fd',
      'git stash',
      'git rebase main',
      'git branch -D old',
      'git rm src/a.ts',
    ]) {
      expect(bash(cmd), cmd).toBe('ask');
    }
  });

  it('git 읽기 명령은 허용한다', () => {
    for (const cmd of ['git status', 'git diff --stat', 'git log -3', 'git show HEAD', 'git branch']) {
      expect(bash(cmd), cmd).toBe('allow');
    }
  });

  it('파일 지우기는 묻는다', () => {
    for (const cmd of [
      'rm -rf dist',
      'cd src; rm a.ts',
      'rmdir old',
      'del /q a.txt',
      'Remove-Item -Recurse build',
      'find . -name "*.tmp" -delete',
      'ls | xargs rm',
    ]) {
      expect(bash(cmd), cmd).toBe('ask');
    }
  });

  it('전역 설치·배포·sudo는 묻는다', () => {
    for (const cmd of ['npm i -g typescript', 'npm install --global x', 'yarn global add x', 'pnpm add -g x', 'npm publish', 'yarn npm publish', 'sudo apt install x']) {
      expect(bash(cmd), cmd).toBe('ask');
    }
  });

  it('테스트·빌드·설치 명령은 허용한다', () => {
    for (const cmd of ['yarn test', 'npx vitest run src/a.spec.ts', 'npm install', 'yarn add -D vitest', 'tsc --noEmit', 'cat package.json | head -5']) {
      expect(bash(cmd), cmd).toBe('allow');
    }
  });

  it('폴더 밖 경로에 쓰는 Edit/Write는 묻는다', () => {
    expect(write('E:\\other\\a.ts')).toBe('ask');
    expect(write('../x.ts')).toBe('ask');
    expect(write('E:/work/app-other/a.ts')).toBe('ask');
    expect(write('E:\\work\\app\\src\\a.ts')).toBe('allow');
    expect(write('e:/work/app/src/a.ts')).toBe('allow');
    expect(write('src/a.ts')).toBe('allow');
    expect(ToolRisk.assess('Edit', { file_path: 'C:/x.ts' }, ROOT).decision).toBe('ask');
  });

  it('옵션·경로·하위 셸로 감싼 git commit도 거절한다', () => {
    for (const cmd of [
      'git -C . commit -m x',
      'git -C .. commit -am wip',
      'git -c user.name=a commit -m x',
      'git --git-dir=.git --work-tree=. commit -m x',
      'echo hi & git commit -m x',
      'bash -c "git commit -m x"',
      "sh -c 'git push'",
      '(git commit -m x)',
      'git.exe commit -m x',
      '/usr/bin/git commit -m x',
      'echo $(git commit -m x)',
      'cmd /c git commit -m x',
    ]) {
      expect(bash(cmd), cmd).toBe('deny');
    }
  });

  it('경로·하위 셸·find -exec로 감싼 지우기도 묻는다', () => {
    for (const cmd of ['/usr/bin/rm -rf x', 'find . -name a -exec rm {} ;', 'cmd /c rd /s /q build', 'powershell -Command "Remove-Item x"', 'rm.exe x']) {
      expect(bash(cmd), cmd).toBe('ask');
    }
  });

  it('읽기 도구와 웹 도구는 허용한다', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']) {
      expect(ToolRisk.assess(tool, {}, ROOT).decision, tool).toBe('allow');
    }
  });

  it('묻거나 거절할 때는 이유를 붙인다', () => {
    expect(ToolRisk.assess('Bash', { command: 'rm -rf x' }, ROOT).reason).toMatch(/지우기/);
    expect(ToolRisk.assess('Bash', { command: 'yarn test' }, ROOT).reason).toBeNull();
  });
});

describe('ToolRisk — 클라우드 명령', () => {
  const bash = (command: string) => ToolRisk.assess('Bash', { command }, ROOT).decision;

  it('AWS 조회 명령(describe·list·get·ls)은 묻지 않는다', () => {
    for (const command of ['aws sts get-caller-identity', 'aws ec2 describe-instances --region ap-northeast-2', 'aws s3 ls', 'aws --profile dev s3api list-buckets', 'aws iam list-users --output json', 'aws dynamodb scan --table-name t']) {
      expect(bash(command), command).toBe('allow');
    }
  });

  it('AWS 변경 명령(create·delete·put·run·terminate·s3 cp/rm/rb …)은 묻는다', () => {
    for (const command of ['aws ec2 run-instances --image-id x', 'aws ec2 terminate-instances --instance-ids i-1', 'aws s3 rb s3://b --force', 'aws s3 rm s3://b/k', 'aws s3 cp a s3://b/a', 'aws --profile prod --region ap-northeast-2 iam create-user --user-name x', 'aws lambda delete-function --function-name f']) {
      expect(bash(command), command).toBe('ask');
    }
    expect(ToolRisk.assess('Bash', { command: 'aws s3 rb s3://b' }, ROOT).reason).toMatch(/AWS 변경/);
  });

  it('aws configure로 설정된 프로필·리전은 묻지 않고 읽는다 (어느 계정으로 일할지 알아야 해서)', () => {
    expect(bash('aws configure list')).toBe('allow');
    expect(bash('aws configure list-profiles')).toBe('allow');
    expect(bash('aws configure get region --profile dev')).toBe('allow');
    expect(bash('aws configure get profile.prod.sso_account_id')).toBe('allow');
  });

  it('aws configure의 비밀 값은 읽지도 쓰지도 않는다', () => {
    expect(bash('aws configure get aws_secret_access_key')).toBe('deny');
    expect(bash('aws configure get profile.dev.aws_access_key_id')).toBe('deny');
    expect(bash('aws configure set aws_secret_access_key x')).toBe('deny');
    expect(bash('aws configure set aws_session_token x --profile dev')).toBe('deny');
    expect(bash('aws configure export-credentials --profile dev')).toBe('deny');
  });

  it('입력을 기다리는 aws configure(키 입력, sso 설정)는 rauha에서 끝나지 않으므로 사용자에게 맡긴다', () => {
    expect(bash('aws configure')).toBe('deny');
    expect(bash('aws configure --profile dev')).toBe('deny');
    expect(bash('aws configure sso')).toBe('deny');
    expect(ToolRisk.assess('Bash', { command: 'aws configure' }, ROOT).reason).toMatch(/직접/);
  });

  it('비밀이 아닌 설정 바꾸기와 SSO 로그인은 묻고 한다', () => {
    expect(bash('aws configure set region ap-northeast-2 --profile dev')).toBe('ask');
    expect(bash('aws sso login --profile dev')).toBe('ask');
    expect(bash('aws sso list-accounts')).toBe('allow');
  });

  it('다른 명령 안에 숨겨도 같은 규칙으로 본다', () => {
    expect(bash('bash -c "aws s3 rb s3://b"')).toBe('ask');
    expect(bash('echo hi && aws ec2 describe-vpcs | head')).toBe('allow');
  });

  it('terraform·kubectl·cdk는 인프라를 바꾸는 하위 명령만 묻는다', () => {
    for (const command of ['terraform apply', 'terraform destroy -auto-approve', 'kubectl delete pod x', 'kubectl apply -f a.yaml', 'cdk deploy', 'cdk destroy']) {
      expect(bash(command), command).toBe('ask');
    }
    for (const command of ['terraform plan', 'terraform validate', 'kubectl get pods', 'kubectl logs x', 'cdk synth', 'cdk diff']) {
      expect(bash(command), command).toBe('allow');
    }
  });
});

describe('ToolRisk 우회 시도', () => {
  const denied = (command: string) => expect(bash(command), command).toBe('deny');

  it('감싸는 프로그램(timeout, command, nice …)과 별칭(-c alias.)으로도 git push를 막는다', () => {
    denied('timeout 30 git push origin main');
    denied('command git push');
    denied('nice -n 5 git push');
    denied('git -c alias.p=push p');
    denied('git -c alias.ship=push ship origin main');
    denied('git submodule foreach "git push"');
    denied('git rebase -x "git push" main');
  });

  it('공백이 든 따옴표 경로의 git.exe, PowerShell 호출 형태로도 git push를 막는다', () => {
    denied('& "C:\\Program Files\\Git\\cmd\\git.exe" push');
    denied('iex "git push"');
    denied('Invoke-Expression "git commit -m x"');
    denied('Start-Process git -ArgumentList "push"');
  });

  it('git push와 같은 일을 하는 저수준 명령(send-pack, http-push)도 막는다', () => {
    denied('git send-pack origin main');
    denied('git http-push origin main');
  });

  it('git 별칭을 만드는 설정은 묻는다', () => {
    expect(bash('git config alias.p push')).toBe('ask');
    expect(bash('git config --global alias.p "!git push"')).toBe('ask');
    expect(bash('git config user.name x')).toBe('allow');
  });
});

describe('ToolRisk .git 안쪽', () => {
  it('팀원이 .git/hooks나 .git/config를 쓰는 것은 거절하고, 셸로 건드리면 묻는다', () => {
    expect(write('E:/work/app/.git/hooks/pre-push')).toBe('deny');
    expect(write('E:/work/app/.GIT/config')).toBe('deny');
    expect(write('E:/work/app/.github/workflows/ci.yml')).toBe('allow');
    expect(bash('echo x > .git/hooks/pre-commit')).toBe('ask');
    expect(bash('git status')).toBe('allow');
  });

  it('sudo git push도 묻지 않고 거절한다', () => {
    expect(bash('sudo git push')).toBe('deny');
    expect(bash('sudo ls')).toBe('ask');
  });
});
