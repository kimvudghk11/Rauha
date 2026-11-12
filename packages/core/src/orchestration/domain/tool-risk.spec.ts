import { describe, expect, it } from 'vitest';
import { GitPublishIntent } from './git-publish-intent.js';
import { ToolRisk } from './tool-risk.js';

const ROOT = 'E:/work/app';
const bash = (command: string) => ToolRisk.assess('Bash', { command }, ROOT).decision;
const write = (file_path: string) => ToolRisk.assess('Write', { file_path, content: 'x' }, ROOT).decision;

describe('ToolRisk', () => {
  it('시키지 않은 git commit과 git push는 허락 카드로 묻는다', () => {
    expect(bash('git commit -m "x"')).toBe('ask');
    expect(bash('npm test && git commit -am x')).toBe('ask');
    expect(bash('git push origin main')).toBe('ask');
    expect(bash('GIT_AUTHOR_NAME=a git commit -m x')).toBe('ask');
    expect(ToolRisk.assess('Bash', { command: 'git push' }, ROOT).reason).toMatch(/시키지 않은 push/);
  });

  it('push를 시켰어도 bash -c·sudo 로 감싼 강제 push는 묻고 규칙으로 풀 수 없다', () => {
    const intent = GitPublishIntent.from('푸시해줘');
    for (const command of ['bash -c "git push -f origin x"', 'sudo git push -f origin x', 'timeout 30 git push --force']) {
      const verdict = ToolRisk.assess('Bash', { command }, ROOT, intent);
      expect(verdict.decision, command).toBe('ask');
      expect(verdict.firm, command).toBe(true);
    }
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

  it('파일 이름을 바꾸는 git mv는 그냥 mv처럼 묻지 않는다(되돌릴 수 있는 이름 바꾸기)', () => {
    expect(bash('git mv src/cart.ts src/cart/total.ts')).toBe('allow');
    expect(bash('mv src/cart.ts src/cart/total.ts')).toBe('allow');
  });

  it('git mv 뒤에 위험한 명령을 이으면 그 명령대로 판정한다', () => {
    expect(bash('git mv a b && git push origin main')).toBe('ask');
    expect(bash('git mv a b && git reset --hard')).toBe('ask');
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

  it('옵션·경로·하위 셸로 감싼 시키지 않은 git commit도 묻는다', () => {
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
      expect(bash(cmd), cmd).toBe('ask');
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
  const denied = (command: string) => expect(bash(command), command).toBe('ask');

  it('감싸는 프로그램(timeout, command, nice …)과 별칭(-c alias.)으로 감싼 git push도 묻는다', () => {
    denied('timeout 30 git push origin main');
    denied('command git push');
    denied('nice -n 5 git push');
    denied('git -c alias.p=push p');
    denied('git -c alias.ship=push ship origin main');
    denied('git submodule foreach "git push"');
    denied('git rebase -x "git push" main');
  });

  it('공백이 든 따옴표 경로의 git.exe, PowerShell 호출 형태의 git push도 묻는다', () => {
    denied('& "C:\\Program Files\\Git\\cmd\\git.exe" push');
    denied('iex "git push"');
    denied('Invoke-Expression "git commit -m x"');
    denied('Start-Process git -ArgumentList "push"');
  });

  it('git push와 같은 일을 하는 저수준 명령(send-pack, http-push)도 묻는다', () => {
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

  it('sudo git push는 시켰어도 묻는다', () => {
    expect(bash('sudo git push')).toBe('ask');
    expect(ToolRisk.assess('Bash', { command: 'sudo git push' }, ROOT, GitPublishIntent.from('push 해줘')).decision).toBe('ask');
    expect(bash('sudo ls')).toBe('ask');
  });
});

describe('ToolRisk 사용자가 시킨 커밋·push·PR', () => {
  const asked = (request: string) => (command: string) => ToolRisk.assess('Bash', { command }, ROOT, GitPublishIntent.from(request)).decision;

  it('커밋을 시켰으면 커밋은 묻지 않고, push·PR은 여전히 묻는다', () => {
    const run = asked('고치고 커밋해줘');
    expect(run('git commit -m "fix: login"')).toBe('allow');
    expect(run('git add src/a.ts && git commit -m x')).toBe('allow');
    expect(run('git push origin fix')).toBe('ask');
    expect(run('gh pr create --fill')).toBe('ask');
  });

  it('push를 시켰으면 커밋과 push는 묻지 않는다', () => {
    const run = asked('커밋하고 푸시까지 해줘');
    expect(run('git commit -m x && git push -u origin fix/login')).toBe('allow');
    expect(run('gh pr create --fill')).toBe('ask');
  });

  it('PR을 시켰으면 커밋·push·gh pr create를 묻지 않는다', () => {
    const run = asked('커밋하고 PR까지 해줘');
    expect(run('git commit -m x')).toBe('allow');
    expect(run('git push -u origin fix/login')).toBe('allow');
    expect(run('gh pr create --title x --body y')).toBe('allow');
    expect(run('gh -R me/app pr create --fill')).toBe('allow');
    expect(run('gh pr merge 12 --squash')).toBe('ask');
  });

  it('PR 머지까지 시켰을 때만 gh pr merge를 묻지 않는다', () => {
    expect(asked('PR 만들고 머지까지 해줘')('gh pr merge 12 --squash')).toBe('allow');
    expect(ToolRisk.assess('Bash', { command: 'gh pr merge 12' }, ROOT).decision).toBe('ask');
  });

  it('gh의 다른 명령(조회 등)은 그대로 허용한다', () => {
    for (const command of ['gh pr list', 'gh pr view 3', 'gh pr checks', 'gh run list', 'gh issue list']) {
      expect(ToolRisk.assess('Bash', { command }, ROOT).decision, command).toBe('allow');
    }
  });

  it('강제 push와 원격 브랜치 지우기는 시켰어도 언제나 묻는다', () => {
    const run = asked('PR까지 올려줘');
    for (const command of ['git push --force', 'git push -f origin fix', 'git push -uf origin fix', 'git push --force-with-lease', 'git push --force-with-lease=fix:abc origin fix', 'git push origin +fix', 'git push origin +HEAD:fix', 'git push origin --delete fix', 'git push origin :fix', 'git push --mirror']) {
      expect(run(command), command).toBe('ask');
    }
    expect(ToolRisk.assess('Bash', { command: 'git push -f' }, ROOT, GitPublishIntent.from('push 해')).reason).toMatch(/강제 push/);
  });

  it('시킨 push도 감싸기·별칭으로 숨긴 강제 push는 묻는다', () => {
    const run = asked('push 해줘');
    expect(run('bash -c "git push --force"')).toBe('ask');
    expect(run('git -c alias.p=push p -f')).toBe('ask');
    expect(run('timeout 30 git push origin fix')).toBe('allow');
  });

  it('하지 말라고 한 요청이면 시키지 않은 것과 같다', () => {
    expect(asked('커밋은 내가 할게')('git commit -m x')).toBe('ask');
    expect(asked("fix it but don't push")('git push')).toBe('ask');
  });

  it('시켰어도 .git 안쪽을 건드리는 명령은 묻는다', () => {
    expect(asked('커밋해줘')('git commit -m x && echo x > .git/hooks/pre-commit')).toBe('ask');
  });
});
