# rauha

> *rauha* — 핀란드어로 "평화, 고요함". [ˈrɑu̯hɑ] 라우하

터미널에서 `rauha`를 치면 팀장과 대화가 시작되고, 팀장은 업무를 작게 쪼개 BDD/TDD 순서로 팀원에게 나눠 준다. 쉬운 일은 Haiku, 테스트가 실패할 때만 Sonnet·Opus로 올린다.

```
나 ↔ 팀장 (Sonnet) ↔ 기획 · 설계 · 테스트 · 구현 · 리뷰 · 문서 · 디버깅 · 인프라
```

- 설계서: [docs/design/claude-team-design.md](docs/design/claude-team-design.md)
- 개발 규칙: [docs/conventions/ddd-entity-dto.md](docs/conventions/ddd-entity-dto.md)
- 데스크톱 앱 사용 안내(한 장): [docs/desktop-guide.md](docs/desktop-guide.md)
- 새 버전 알림: 앱이 GitHub 릴리스를 보고 새 버전이 있으면 위쪽에 알려 주고 내 컴퓨터용 설치 파일을 바로 내려받게 한다(자동 설치는 없음) — [안내](docs/desktop-guide.md)
- **바로 내려받기(로그인 필요 없음)**: [Windows](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-Setup-0.1.1-x64.exe) · [Mac Apple 칩](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-0.1.1-mac-arm64.dmg) · [Mac 인텔](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-0.1.1-mac-x64.dmg) — 설치 방법은 아래 "데스크톱 앱 설치"

## 데스크톱 앱 설치 (맥북 · Windows)

터미널 대신 창에서 쓰는 데스크톱 앱이다. 메인 칸에서 일을 맡기면 팀이 각자 팀 방에서 동시에 일하고, 위험한 일만 정리된 화면을 보고 허락한다. macOS(Apple 칩·인텔)와 Windows에서 돈다. 설치 파일에는 서명이 없어서 처음 열 때 한 번 허용해 줘야 한다.

### 1. 설치 파일 받기 (로그인 필요 없음)

| 내 컴퓨터 | 내려받기 | 크기 |
| --- | --- | --- |
| Windows | [rauha-Setup-0.1.1-x64.exe](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-Setup-0.1.1-x64.exe) | 210MB |
| Mac (Apple 칩, M1 이상) | [rauha-0.1.1-mac-arm64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-0.1.1-mac-arm64.dmg) | 228MB |
| Mac (인텔) | [rauha-0.1.1-mac-x64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.1.1/rauha-0.1.1-mac-x64.dmg) | 239MB |

내 맥이 어떤 칩인지는 Apple 메뉴 → 이 Mac에 관하여에서 볼 수 있다. 다른 버전은 [Releases 페이지](https://github.com/kimvudghk11/rauha/releases)에 있다. 가장 최신 개발 빌드는 Actions → desktop 실행의 Artifacts에도 올라온다(14일 보관, GitHub 로그인 필요).

### 2. 설치

- **macOS**: `.dmg`를 열고 rauha를 Applications로 끌어다 놓는다. 서명이 없는 앱이라 처음 열면 "Apple은 rauha에 … 악성 코드가 없음을 확인할 수 없습니다"라는 경고가 뜬다(고장이 아니다). 둘 중 하나로 열면 된다.
  1. **터미널 한 줄(가장 빠름)**: 터미널에서 `xattr -dr com.apple.quarantine /Applications/rauha.app`을 실행하고 앱을 다시 연다.
  2. **시스템 설정**: 앱을 한 번 열어 경고에서 **완료**를 누른다. 그다음 시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 "rauha가 차단되었습니다" 옆의 **그래도 열기** → 암호나 Touch ID → **열기**. (macOS 15 Sequoia부터는 예전의 "우클릭 → 열기"가 통하지 않는다.)
- **Windows**: `rauha-Setup-…-x64.exe`를 실행한다. "알 수 없는 게시자" 경고가 뜨면 **추가 정보 → 실행**.

### 3. 처음 열면

작업 폴더(레포와 문서 폴더가 들어 있는 상위 폴더)를 고르고, 그 폴더에서 일해도 되는지 허락하고, Claude 계정을 고른다. Claude 로그인이 안 돼 있으면 먼저 터미널에서 `claude`로 로그인한다. 예전 터미널 `rauha`가 설치돼 있으면 찾아서 보여 주고, 확인하면 지운다(기억·대화 기록 같은 데이터는 그대로 둔다).

### 설치 파일이 안 열리면: 소스로 실행

Node.js 22 이상, git, yarn(corepack)이 필요하다.

```bash
git clone https://github.com/kimvudghk11/rauha.git
cd rauha
corepack enable
yarn install
yarn build
yarn desktop
```

더 자세한 안내는 [docs/desktop-guide.md](docs/desktop-guide.md), 되는 것과 아직 안 되는 것은 [docs/release-checklist.md](docs/release-checklist.md), 설치 파일을 만드는 방법은 [packages/desktop/PACKAGING.md](packages/desktop/PACKAGING.md)에 있다. 맥 설치본은 서버(GitHub Actions)에서 만들어 앱이 뜨는 것까지만 확인했고, 실제 맥북에서의 실행은 아직 확인하지 못했다.

## 지금 상태

| 패키지 | 내용 | 상태 |
| --- | --- | --- |
| `@rauha/core` | 파이프라인 상태 머신(`WorkOrder`), 승격 사다리, 역할별 쓰기 권한, 보고서 DTO, 회사/개인 프로필 판정, 작업(Job) 동시 실행 | 동작 + 테스트 |
| `@rauha/desktop` | Electron 데스크톱 앱: 채팅·팀 방·허락 카드·규칙·레포·설정·git 탭 | 동작 + 테스트(맥 실행은 확인 못 함) |
| `@rauha/cli` | 터미널 대화 모드(`rauha`) | 동작. 데스크톱으로 옮겨 가는 중이라 아래 설치는 예전 방식 |

## 터미널 버전 설치 (예전 방식, 새 PC에서 한 번)

데스크톱 앱을 쓰면 이 단계는 필요 없다. Git, Node.js 24 LTS, Yarn(corepack), Claude Code, rauha를 차례로 설치하고 `rauha` 명령을 만든다. 이미 있는 것은 건너뛰므로 여러 번 실행해도 된다.

macOS (터미널):

```bash
curl -fsSL https://raw.githubusercontent.com/kimvudghk11/rauha/main/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/kimvudghk11/rauha/main/scripts/install.ps1 | iex
```

| 단계 | macOS | Windows | 이미 있으면 |
| --- | --- | --- | --- |
| 패키지 관리자 | Homebrew | winget(Windows 기본) | 건너뜀 |
| Git | `brew install git` | `winget install -e --id Git.Git` | `git`이 있으면 건너뜀 |
| Node.js | `brew install node@24` | `winget install -e --id OpenJS.NodeJS.LTS` (nvm이 있으면 `nvm install 24.22.1`) | Node 22 이상이면 건너뜀 |
| Yarn | `corepack enable` | `corepack enable` | `yarn`이 돌면 건너뜀 |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` | `claude`가 있으면 건너뜀 |
| rauha | `~/rauha`에 clone → `yarn install` → `yarn build` → `rauha setup` | `~\rauha`에 같은 순서 | 있으면 `git pull --ff-only` |

설치 폴더는 `RAUHA_DIR` 환경 변수로 바꿀 수 있다. 설치가 끝나면 새 터미널에서 `rauha login`을 한 번 하고, 프로젝트 폴더에서 `rauha`를 입력한다.

### 회사 계정 따로 쓰기

`~/.rauha/config.toml`에 프로필과 폴더 규칙을 적으면, 폴더(또는 git 원격 주소)에 따라 계정이 갈린다. 회사 맥북처럼 회사 계정만 쓰면 `default_profile = "work"`만 적어도 된다.

```toml
default_profile = "work"

[profiles.work]
claude_config_dir = "~/.rauha/profiles/work/claude"
sync = "none"

[profiles.personal]
claude_config_dir = "~/.rauha/profiles/personal/claude"

[[match]]
git_remote = "github.com/my-company/*"
profile = "work"
```

프로필마다 한 번씩 로그인한다: `rauha login --profile work`.

## 개발

Node.js 22 이상과 Corepack이 필요하다.

```bash
corepack enable          # yarn 4 를 package.json 의 packageManager 버전으로 사용
yarn install
yarn test                # 테스트
yarn typecheck           # 타입 검사
yarn build               # dist 빌드
yarn rauha whoami        # CLI 실행
yarn rauha setup         # 처음 한 번: 어느 폴더에서든 rauha로 부를 수 있게 한다
```

`rauha setup`은 PATH에 있는 폴더(Windows는 `%APPDATA%\npm`, macOS·Linux는 `~/.local/bin`)에 이 저장소의 빌드 결과를 부르는 실행 파일을 둔다. 그 뒤로는 작업할 프로젝트 폴더에서 `rauha`만 입력하면 된다. `rauha update`로 갱신하면 같은 실행 파일이 새 버전을 부른다.

대화 중 `/review`는 커밋하지 않은 내 변경(또는 `/review <브랜치>`로 그 브랜치와 갈라진 뒤의 변경)을 리뷰어가 검토한다. 파일은 고치지 않고 근거가 확인된 지적만 보여 준다. `rauha --continue`(`-c`)는 지난 대화를 이어서 연다(`/update` 뒤에는 자동).

팀원과 rauha는 비밀 파일을 읽지도 쓰지도 않는다. 기본 목록(`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*` 등, `.env.example` 같은 예시 파일은 제외)에 더해, 저장소 루트의 `.rauhaignore`에 한 줄에 하나씩 `.gitignore`처럼 적으면 함께 막는다(`secrets/`는 그 폴더 전체, `/config/prod.json`은 루트 기준, `/`가 없으면 어느 폴더에서든). 비밀 파일이 있는 저장소에서는 내용을 폴더째 뒤지는 검색(`grep -r`, `rg`, `git grep`, 폴더 대상 Grep 내용 검색)도 막는다. 파일 이름만 찾는 검색은 된다.

저장소 여러 개를 담은 폴더(예: `~/work`)에서 `rauha`를 띄우면 그 아래 저장소(두 단계까지)를 모두 작업 공간에 넣는다. 메시지에 저장소 이름이 나오면 그 저장소에서, 없으면 마지막으로 다룬 저장소에서 일하고, 그래도 모르면 묻는다. 두 저장소를 함께 말하면 한 답으로 비교해 준다(여러 저장소를 한 번에 고치는 일은 아직 하지 않는다). `/repo`로 목록, `/repo <이름>`으로 바꾸기, `/repo add <경로>`로 더하기. 저장소마다 그 폴더 규칙의 계정으로 일한다.

"모든 프로젝트", "모든 레포", "상위 폴더"처럼 전체를 말하면 작업 공간의 모든 저장소를 함께 읽는다. 읽기만 하는 요청("스캔해줘", "훑어봐")은 코드 작업이 아니라 질문이다. 이력서·포트폴리오·보고서처럼 코드가 아닌 결과물은 문서 팀원이 git 기록과 파일을 읽고 `.md`만 써서 만든다(저장소가 4개를 넘으면 저장소마다 나눠 읽고 모아 쓴다). 작업 공간 폴더에도 문서를 쓸 수 있다.

기능 요청("쿠폰 기능 만들어줘")은 먼저 설계 팀원과 이야기한다. 한 번에 질문 하나(추천 답과 함께), "알아서 해"라고 하면 추천값으로 정하고 "rauha가 정함"으로 표시한다. 설계안은 `~/.rauha/profiles/<프로필>/designs/`에 Markdown으로 남고(직접 고쳐도 된다), 승인하면 작업을 나눠 순서대로 진행한다. 이때 접수는 설계가 답한 것을 다시 묻지 않는다. `/design <요청>`은 설계부터 시작하고, 작고 분명한 수정은 지금처럼 바로 진행한다.

대화 화면은 터미널처럼 움직인다: `/clear`와 Ctrl+L은 화면을 지우고, 입력창에 글이 있으면 Ctrl+C는 글만 지우며, 빈 입력창에서 Ctrl+C·Ctrl+D를 두 번 누르면 끝난다. 시작할 때 Claude 로그인이 풀려 있으면 알려 준다.

답과 결과 안내서에는 어느 브랜치·커밋을 보고 판단했는지(`읽은 기준: main (a1b2c3d)`)가 붙는다. rauha는 저장소마다 구조와 짧은 메모를 `~/.rauha/profiles/<프로필>/knowledge/`에 남겨 두고, 다음에는 git diff로 바뀐 부분만 고친다.

같은 폴더에서는 작업이 한 번에 하나만 돈다(다른 rauha가 작업 중이면 시작하지 않고 알린다). 같은 프로젝트에서 작업 두 개를 동시에 돌리려면 `git worktree add ../<이름> -b <브랜치>`로 폴더를 하나 더 만들어 거기서 띄운다.

## 구조

```
rauha/
├── packages/
│   ├── core/   # 도메인: orchestration, profile (DDD)
│   └── cli/    # rauha 명령어
└── docs/
    ├── design/       # 팀 구성 설계서
    └── conventions/  # 개발 규칙
```
