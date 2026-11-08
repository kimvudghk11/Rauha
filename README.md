# rauha

> *rauha* — 핀란드어로 "평화, 고요함". [ˈrɑu̯hɑ] 라우하

**일을 맡기면 팀이 알아서 하고, 나는 그동안 다른 일을 하는 데스크톱 앱.** 메인 채팅 칸에 일을 적으면 돌고래 Delfi와 친구들(도트 캐릭터 22종)이 역할을 나눠 각자 팀 방에서 일한다. 일이 도는 동안에도 메인에서 다음 일을 바로 맡길 수 있고, 위험한 일만 정리된 화면을 보고 허락한다. [Claude Agent SDK](https://docs.claude.com) 위에서 내 Claude 구독으로 돈다. macOS(Apple 칩·인텔)와 Windows에서 쓴다.

- **바로 내려받기(로그인 필요 없음)**: [Windows](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-Setup-0.1.2-x64.exe) · [Mac Apple 칩](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-0.1.2-mac-arm64.dmg) · [Mac 인텔](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-0.1.2-mac-x64.dmg) — 설치 방법은 아래 "설치"
- 사용 안내(한 장): [docs/desktop-guide.md](docs/desktop-guide.md) · 되는 것과 아직 안 되는 것: [docs/release-checklist.md](docs/release-checklist.md)

## 무엇을 하나

회사에서 프로젝트 폴더 하나에 레포 여러 개와 문서 폴더를 같이 두고 일하는 사람을 위해 만들었다. 작업 폴더를 하나 고르면 그 아래 레포와 문서를 알아서 훑고, 요청에 맞는 곳에서 일한다.

- **동시에 여러 일**: 일을 맡기면 바로 다음 일을 보낼 수 있다. 동시에 3개까지(설정에서 1~6) 돌고 넘치면 대기한다. 같은 레포에서 둘 이상 돌면 두 번째부터는 git worktree에서 일하고, 끝나면 `rauha/job-…` 브랜치로 남긴다.
- **팀 방**: 일마다 방이 생겨 캐릭터, 진행 단계 막대, 마지막 한 줄, 걸린 시간이 보인다. 방을 누르면 정리된 내용과 원본 로그를 볼 수 있다.
- **허락 카드**: 위험한 일만 묻는다. 코드는 바뀐 파일·diff와 main/qa 같은 보호 브랜치에 주는 영향(앞섬·뒤처짐·충돌·자동 배포 여부)을, 인프라는 환경·영향 범위·중단 여부·되돌리는 시간 같은 위험도 표를 보여 준다. 모르는 칸은 지어내지 않고 "모름"이다. 비밀 파일 읽기·쓰기와 `git push`는 허락과 상관없이 막혀 있다.
- **가볍게 물으면 빠르게**: 질문에는 가벼운 모델로 빨리 답하고, 필요하면 "더 깊게"로 깊게 다시 답한다. 문서만 고치는 요청은 코드 작업(테스트 먼저)이 아니라 문서 경로로 간다.
- **규칙 탭**: "항상 지킬 것 / 묻지 않고 할 것 / 꼭 허락받을 것"을 범위와 함께 적는다. 말로 적으면 정리해 준다.
- **레포 탭 · git 탭**: 레포별 브랜치·원격과의 차이·바뀐 파일을 보고, git 탭에서는 GitHub Desktop처럼 변경 보기, hunk·줄 단위 스테이지, 커밋, 브랜치, fetch/pull/push, 히스토리, 충돌 풀기, PR 열기를 한다.
- **설정**: Claude 계정 바꾸기(Claude Code 설정 폴더 하나 = 계정 하나), 세션·주간 사용 한도 %, 알림, 창 배치(너비 4단계 반응형), 보호 브랜치, 동시 실행 수. 화면에 금액은 나오지 않는다.
- **새 버전 알림**: 새 버전이 나오면 위쪽에 알려 주고 내 컴퓨터용 설치 파일을 내려받게 한다(자동 설치는 없다).
- **아직 안 열린 탭**: 코드, 할 일, 기록, 명령어 탭과 정보 저장(내 AWS)은 "곧 열려요"다.

## 설치

### 1. 설치 파일 받기

| 내 컴퓨터 | 내려받기 | 크기 |
| --- | --- | --- |
| Windows | [rauha-Setup-0.1.2-x64.exe](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-Setup-0.1.2-x64.exe) | 221MB |
| Mac (Apple 칩, M1 이상) | [rauha-0.1.2-mac-arm64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-0.1.2-mac-arm64.dmg) | 239MB |
| Mac (인텔) | [rauha-0.1.2-mac-x64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-0.1.2-mac-x64.dmg) | 251MB |

내 맥의 칩은 Apple 메뉴 → 이 Mac에 관하여에서 볼 수 있다. 다른 버전은 [Releases 페이지](https://github.com/kimvudghk11/rauha/releases)에 있다.

### 2. 설치

설치 파일에 서명이 없어서 처음 열 때 한 번 허용해 줘야 한다.

- **macOS**: `.dmg`를 열고 rauha를 Applications로 끌어다 놓는다. 처음 열면 "Apple은 rauha에 … 악성 코드가 없음을 확인할 수 없습니다"라는 경고가 뜬다(고장이 아니다). 둘 중 하나로 열면 된다.
  1. **터미널 한 줄(가장 빠름)**: `xattr -dr com.apple.quarantine /Applications/rauha.app`을 실행하고 앱을 다시 연다.
  2. **시스템 설정**: 앱을 한 번 열어 경고에서 **완료**를 누른다. 시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 "rauha가 차단되었습니다" 옆 **그래도 열기** → 암호나 Touch ID → **열기**. (macOS 15 Sequoia부터는 "우클릭 → 열기"가 통하지 않는다.)
- **Windows**: `rauha-Setup-…-x64.exe`를 실행한다. "알 수 없는 게시자" 경고가 뜨면 **추가 정보 → 실행**.

### 3. 처음 열면

작업 폴더(레포와 문서 폴더가 들어 있는 상위 폴더)를 고르고, 그 폴더에서 일해도 되는지 허락하고, 쓸 Claude 계정을 고른다. Claude 로그인이 안 돼 있으면 먼저 터미널에서 `claude auth login`으로 로그인한다. 예전 터미널판 `rauha`가 PC에 있으면 찾아서 보여 주고, 확인하면 지운다(기억·대화 기록은 그대로 둔다).

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

설치 파일을 만드는 방법은 [packages/desktop/PACKAGING.md](packages/desktop/PACKAGING.md)에 있다.

## 확인하지 못한 것

맥 설치본은 서버(GitHub Actions)에서 만들어 앱이 뜨는 것까지만 확인했고, 실제 맥북에서의 전체 흐름(신호등 버튼 배치, 셸 PATH 읽기, 실제 일 맡기기)은 아직 확인하지 못했다. 자세한 목록은 [release-checklist](docs/release-checklist.md)에 있다.

## 개발

Node.js 22 이상과 Corepack이 필요하다. 패키지 관리는 yarn(4, workspaces)만 쓴다.

```bash
corepack enable
yarn install
yarn typecheck           # 타입 검사
yarn test                # 테스트
yarn build               # 빌드
yarn desktop             # 데스크톱 앱 실행
```

`main`에 push하면 GitHub Actions가 macOS·Windows에서 타입 검사·테스트·빌드·설치 파일 생성·실행 스모크를 돌리고, `v*` 태그를 올리면 설치 파일을 Releases에 올린다.

- 설계: [데스크톱 앱](docs/superpowers/specs/2026-11-08-rauha-desktop-design.md) · [엔진 속도·사용량](docs/superpowers/specs/2026-11-08-engine-speed-usage-design.md) · [팀 구성](docs/design/claude-team-design.md)
- 개발 규칙(DDD, 엔티티·DTO): [docs/conventions/ddd-entity-dto.md](docs/conventions/ddd-entity-dto.md)

```
rauha/
├── packages/
│   ├── core/      # 도메인: 팀 오케스트레이션, 작업(Job), 프로필 (DDD)
│   ├── desktop/   # Electron 앱 (main · preload · renderer)
│   └── cli/       # 예전 터미널판. 맥 확인 뒤 정리 예정
├── prompts/       # 팀원 프롬프트
└── docs/          # 설계·규칙·사용 안내
```
