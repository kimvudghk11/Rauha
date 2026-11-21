# Rauha

> *rauha* — 핀란드어로 "평화, 고요함". [ˈrɑu̯hɑ] 라우하

**AI에게 일을 시키는 게 아니라, 팀을 꾸려서 일을 맡기는 데스크톱 앱.**

터미널 창 하나에서 AI와 한 줄씩 주고받던 시대는 끝났다. Rauha는 **14개 부서·49명의 회사**다. 일을 던지면 도트 캐릭터(돌고래 Delfi와 친구들)가 기획(BM·PM·상품기획 MD)·개발(프론트·백엔드·iOS·안드로이드)·디자인(UX·브랜드·상품·그래픽)·마케팅(광고·PR)·콘텐츠(SNS·카피·영상)·영업·커머스(스마트스토어·쿠팡 입점·물류)·고객 성공·데이터·법무·품질·운영·재무(회계·클라우드 비용)·인사로 나눠 각자 팀 방에서 동시에 일한다. 모두 자기 분야 10년차 이상의 지식으로, 추측하지 않고 확인한 것만 말한다. 나는 그동안 메인 칸에서 다음 일을 던진다. 정말 위험한 일만 정리된 화면을 보고 허락한다. 내 Claude 구독 그대로, macOS와 Windows에서.

| 흔한 AI 하네스 | Rauha |
| --- | --- |
| 한 번에 한 일, 끝날 때까지 대기 | **동시에 여러 일** — 같은 레포도 git worktree로 안 부딪히게 |
| 터미널 로그를 읽어야 진행을 안다 | **팀 방** — 누가 어느 단계에서 뭘 하는지 캐릭터와 단계 막대로 한눈에 |
| 허락 창은 명령어 한 줄 | **허락 카드** — 코드는 diff와 main/qa 영향(앞섬·뒤처짐·충돌·자동 배포), 인프라는 위험도 표 |
| 모든 질문에 같은 모델 | **일마다 알맞은 크기** — 인사는 모델 없이, 간단한 질문은 Sonnet, 리뷰·설계·디버깅·보안·아키텍처 조언만 Opus, 구현은 실패하면 Opus·Fable로 승격 |
| 단계마다 처음부터 다시 읽는다 | **한 번 읽은 건 기억** — 같은 팀원의 다음 차례는 앞 세션을 이어 새 말만 보내고, 작업 공간 저장소 지도는 모델 없이 만들어 둔다. 결과 카드에 그 일이 쓴 세션 % |
| 한 레포만 본다 | **폴더 하나만 고르면** 그 아래 레포와 문서를 알아서 훑고 요청에 맞는 곳에서 일한다 |
| 코드만 만든다 | 사업 하나를 굴릴 만큼: PRD·가격·광고·약관·채용·AWS 비용·회계까지 **부서별 팀원**이 맡는다 |
| 모델이 레포를 하나씩 뒤지다 빠뜨린다 | **rauha 도구 14개**(mcp__rauha__*): 모든 레포 변경·코드 검색·CI·의존성·표 읽기를 rauha가 직접 읽어 준다 |
| 모르는 것도 아는 척 | 모르는 칸은 지어내지 않고 **"모름"** 이라고 쓴다. 화면에 금액도 없다 |

- **바로 내려받기(로그인 필요 없음)**: [Windows](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-Setup-0.3.1-x64.exe) · [Mac Apple 칩](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-0.3.1-mac-arm64.dmg) · [Mac 인텔](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-0.3.1-mac-x64.dmg) — 설치 방법은 아래 "설치"
- 사용 안내(한 장): [docs/desktop-guide.md](docs/desktop-guide.md) · 되는 것과 아직 안 되는 것: [docs/release-checklist.md](docs/release-checklist.md)

## 무엇을 하나

회사에서 프로젝트 폴더 하나에 레포 여러 개와 문서 폴더를 같이 두고, 개발·문서·인프라 일을 동시에 하는 사람을 위해 만들었다. 작업 폴더를 하나 고르면 그 아래 레포와 문서를 알아서 훑고, 요청에 맞는 곳에서 일한다. 코드 일은 테스트부터 쓰는 BDD/TDD 순서로 팀원에게 나눠 주고, 테스트가 실패하면 더 큰 모델로 올려서 푼다.

- **동시에 여러 일**: 일을 맡기면 바로 다음 일을 보낼 수 있다. 동시에 3개까지(설정에서 1~6) 돌고 넘치면 대기한다. 같은 레포에서 둘 이상 돌면 두 번째부터는 git worktree에서 일하고, 끝나면 `rauha/job-…` 브랜치로 남긴다.
- **팀 방**: 일마다 방이 생겨 캐릭터, 진행 단계 막대, 마지막 한 줄, 걸린 시간이 보인다. 방을 누르면 정리된 내용과 원본 로그를 볼 수 있다.
- **허락 카드**: 위험한 일만 묻는다. 코드는 바뀐 파일·diff와 main/qa 같은 보호 브랜치에 주는 영향(앞섬·뒤처짐·충돌·자동 배포 여부)을, 인프라는 환경·영향 범위·중단 여부·되돌리는 시간 같은 위험도 표를 보여 준다. 모르는 칸은 지어내지 않고 "모름"이다. 비밀 파일 읽기·쓰기는 허락과 상관없이 막혀 있다. commit·push·PR은 요청에서 시켰을 때만 묻지 않고 하고, 시키지 않았거나 강제 push면 허락 카드로 묻는다.
- **세션을 아끼면서 똑똑하게**: "ㅎㅇ"·"고마워"는 모델 없이 바로 답하고, 이 저장소를 몰라도 되는 질문은 Sonnet이 짧게 답한다("더 깊게"를 누르면 Opus). 이 저장소를 읽어야 하는 질문은 깊게, 구성·설계·합치기·전환 같은 아키텍처 질문은 내 작업 공간을 읽고 처음부터 Opus가 답한다. 설계 대화·빠진 항목 마저 하기·구현 재시도·이어지는 질문은 같은 팀원의 앞 세션을 이어서 이미 읽은 파일을 다시 읽지 않는다. 문서만 고치는 요청은 코드 작업(테스트 먼저)이 아니라 문서 경로로 간다.
- **검증은 꼼꼼하게**: 테스트 팀원이 단위·통합·E2E·TDD·BDD·커버리지·뮤테이션·속성 기반·회귀·계약·성능·보안 12가지 중 바뀐 내용에 맞는 것을 빠짐없이 쓰고, 건너뛴 것은 이유를 남긴다. 리뷰어가 빠진 검증을 근거와 함께 짚는다.
- **규칙 탭**: "항상 지킬 것 / 묻지 않고 할 것 / 꼭 허락받을 것"을 범위와 함께 적는다. 말로 적으면 정리해 준다.
- **코드 탭(레포 목록·파일 조작 포함) · git 탭**: 코드 탭 탐색기에서 레포별 브랜치·원격과의 차이·바뀐 파일을 보고 파일을 만들고 이름 바꾸고 옮기고 휴지통으로 보내며,  git 탭에서는 GitHub Desktop처럼 변경 보기, hunk·줄 단위 스테이지, 커밋, 브랜치, fetch/pull/push, 히스토리, 충돌 풀기, PR 열기를 한다.
- **설정**: Claude 계정 바꾸기(Claude Code 설정 폴더 하나 = 계정 하나), 세션·주간 사용 한도 %, 알림, 창 배치(너비 4단계 반응형), 보호 브랜치, 동시 실행 수. 화면에 금액은 나오지 않는다.
- **새 버전 알림**: 새 버전이 나오면 위쪽에 알려 주고 내 컴퓨터용 설치 파일을 내려받게 한다(자동 설치는 없다).
- **만드는 중**: 코드·할 일·기록·명령어 탭, 팀원별 설정, 정보 저장(내 AWS)은 순서대로 열고 있다(되는 것은 [점검표](docs/release-checklist.md)).

### 아직 부족한 점

솔직하게, 지금은 **Claude 모델만** 쓴다(Sonnet·Opus·Fable을 역할과 난이도에 맞춰 나눠 쓰고, Haiku는 쓰지 않는다). 다른 회사의 AI 모델을 팀원에 섞어 쓰는 것은 아직 못 한다. 그리고 맥 실기에서의 전체 흐름은 사용하면서 계속 확인하는 중이다.

## 설치

### 1. 설치 파일 받기

| 내 컴퓨터 | 내려받기 | 크기 |
| --- | --- | --- |
| Windows | [rauha-Setup-0.3.1-x64.exe](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-Setup-0.3.1-x64.exe) | 218MB |
| Mac (Apple 칩, M1 이상) | [rauha-0.3.1-mac-arm64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-0.3.1-mac-arm64.dmg) | 237MB |
| Mac (인텔) | [rauha-0.3.1-mac-x64.dmg](https://github.com/kimvudghk11/rauha/releases/download/v0.3.1/rauha-0.3.1-mac-x64.dmg) | 248MB |

내 맥의 칩은 Apple 메뉴 → 이 Mac에 관하여에서 볼 수 있다. 다른 버전은 [Releases 페이지](https://github.com/kimvudghk11/rauha/releases)에 있다.

### 2. 설치

설치 파일에 서명이 없어서 처음 열 때 한 번 허용해 줘야 한다.

- **macOS, 경고 없이 설치(가장 쉬움)**: 터미널에 아래 한 줄을 붙여 넣는다. 터미널로 받은 파일에는 "인터넷에서 받음" 표시가 붙지 않아서 아래 경고가 뜨지 않는다. 내 맥 칩에 맞는 최신 버전을 받아 `/Applications`에 넣고 연다. 새 버전이 나와서 다시 설치할 때도 같다.

  ```bash
  curl -fsSL https://raw.githubusercontent.com/kimvudghk11/rauha/main/scripts/install-mac.sh | bash
  ```

- **macOS, dmg로 직접**: `.dmg`를 열고 rauha를 Applications로 끌어다 놓는다. 처음 열면 "Apple은 rauha에 … 악성 코드가 없음을 확인할 수 없습니다"라는 경고가 뜬다(고장이 아니다). 둘 중 하나로 열면 된다.
  1. **터미널 한 줄(가장 빠름)**: `xattr -dr com.apple.quarantine /Applications/Rauha.app`을 실행하고 앱을 다시 연다.
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

- 설계: [팀 구성](docs/design/claude-team-design.md) · [화면 구조](docs/design/ui-structure.md)
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
