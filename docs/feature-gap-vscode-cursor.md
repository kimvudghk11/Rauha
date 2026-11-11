# Rauha 기능 격차 조사: VS Code · Cursor 와 비교

2026-11-11 조사. 사용자 요청: "vscode나 cursor를 확인해서 내가 부족한 기능이 없는지 잘 확인해봐".
Rauha(`packages/desktop`)는 편집기가 아니라 팀장이 일을 팀원(Haiku·Sonnet·Opus)에게 나눠 맡기는 멀티에이전트 데스크톱 앱이다. 그래서 "VS Code 와 똑같이"가 아니라 **매일 코드 작업을 맡기고 확인하는 데 막히는 것**만 우선순위를 매겼다.

조사 방법과 한계
- VS Code·Cursor 쪽은 공식 문서를 WebFetch 로 읽은 내용만 적었다(출처는 5절). 문서에 안 나온 것은 "문서에서 확인 못 함"이라 적고 추측하지 않았다. Cursor 문서는 `docs.cursor.com` 이 `cursor.com/docs` 로 옮겨져 있다.
- Rauha 쪽은 소스(`packages/desktop/src`)와 `docs/desktop-guide.md`, `docs/design/ui-structure.md` 를 읽어 판정했다. 앱을 실제로 띄워 보지는 않았다(이 조사에서는 코드 근거만 썼다).
- 판정 표기: 있음 / 일부 / 없음.

## 1. 요약: 가장 아쉬운 10가지

1. **진짜 터미널(PTY) 없음** — 명령마다 새 셸이라 vim·ssh·대화형 CLI·`export` 유지가 안 된다. (VS Code 터미널 vs `main/terminal/terminal-host.ts`)
2. **채팅에서 코드 변경을 diff 로 보고 적용·거절하는 흐름이 약함** — Cursor 는 Apply/Accept/Reject 를 줄 단위로 한다. Rauha 는 worktree 브랜치(`rauha/job-…`)로 남기고 허락 카드의 "diff 보기"만 있다.
3. **체크포인트(작업 전 상태로 되돌리기) 없음** — Cursor 는 큰 변경 전 스냅샷을 만들어 복원한다. Rauha 는 브랜치로 대체되지만 "이 작업 전으로 되돌리기" 단추가 없다.
4. **채팅 @ 컨텍스트가 `@폴더` 하나뿐** — Cursor 는 @파일·@폴더·@터미널·@이전 채팅·@git diff·@브라우저. 특정 파일을 채팅에 붙이는 길이 없다(`chat-view.ts` 입력창 안내는 `@folder` 만).
5. **채팅 이미지 첨부 없음** — 스크린샷을 붙여 "이 화면 고쳐줘"가 안 된다.
6. **Problems 패널(진단)·자동완성·정의로 이동 없음** — 편집기는 CodeMirror 6 에 하이라이트·접기·찾기만 있고 언어 서버가 없다(`code-editor.ts`).
7. **편집기 보조: 분할 보기·자동 저장·미니맵·브레드크럼·파일 비교(diff 편집기)·Timeline 없음** — Ctrl+S 수동 저장만 있다.
8. **Git: 줄 단위 인라인 diff 없음** — stash·blame·커밋 그래프·3-way 충돌 구역 해결은 구현함(2026-11-11). 줄 선택 스테이지(`stageSelection`)와 충돌 텍스트 편집도 있다.
9. **최근 폴더(작업 폴더 목록)·멀티 루트 전환 없음** — 작업 폴더 하나만 기억한다(`shared/settings.ts` 의 `workFolder`). 회사 맥북·집 PC 에서 폴더를 자주 바꾸면 매번 대화상자를 연다.
10. **단축키 안내·앱 전체 탭 전환 단축키·명령 팔레트 없음** — 코드 탭 안의 Ctrl/Cmd+P·S·Shift+F·`만 있고, 앱 탭(Chat/Repo/Todo…)을 키로 옮길 수 없고 단축키 목록도 볼 곳이 없다.

## 2. 비교 표

사용자 가치: 매일(★★★) / 가끔(★★) / 드묾(★). 난이도: S(하루 안) / M(며칠) / L(1주 이상 또는 새 의존성·구조 변경). 우선순위: P0(바로) ~ P3(안 해도 됨).
VS Code/Cursor 칸은 5절 출처 번호. "-" 는 해당 제품이 그 항목을 문서에서 확인 못 한 것.

### 2-1. 편집기

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 파일 탭 | 탭·드래그 정렬 [V1] | VS Code 기반 | 일부: 탭·● 표시·닫기 있음, 드래그 정렬·분할 없음 (`code-view.ts` 탭 그리기) | ★★★ | M | P2 |
| 편집기 분할 | 있음 [V1] | 있음 | 없음 (`code-view.ts`에 분할 코드 없음) | ★★ | L | P3 |
| 찾기/바꾸기 | Ctrl+F, 바꾸기, 대소문자 유지 [V3] | 같음 | 있음: CodeMirror search (`code-editor.ts` `searchKeymap`) | ★★★ | - | 이미 있음 |
| 전체 검색 | Ctrl+Shift+F, include/exclude, 전체 바꾸기 [V3] | 있음 + 코드베이스 검색 [C5] | 일부: 전체 찾기·Aa·정규식 있음, 바꾸기·include/exclude 없음 (`main/code/code-search.ts`, `shared/text-search.ts`) | ★★★ | M | P2 |
| 다중 커서 | Alt+클릭, Ctrl+Alt+↑↓ [V3] | 같음 | 일부: Alt 드래그 사각 선택만 (`rectangularSelection`), 클릭 추가 없음 | ★ | S | P3 |
| 코드 접기 | 있음 [V3] | 같음 | 있음 (`foldGutter`, `foldKeymap`) | ★★ | - | 이미 있음 |
| 미니맵 | 있음 [V2] | 같음 | 없음 | ★ | M | P3 |
| 브레드크럼 | 있음 [V2] | 같음 | 없음 (상태줄 `.code-status`만) | ★ | S | P3 |
| 정의/참조 이동 | 있음(언어 서비스) [V4: 문서에서 확인 못 함] | 같음 | 없음 (언어 서버 없음) | ★★ | L | P3 |
| 자동완성 | IntelliSense [V4] | 같음 + Tab 완성 [C3] | 없음 (`autocompletion` 안 씀) | ★★ | L | P3 |
| 포맷터 | 확장 | 같음 | 없음. 들여쓰기는 `.editorconfig` 를 따름 (`shared/editor-config.ts`) | ★★ | M | P3 |
| 되돌리기 기록 Timeline | 파일별 Git·로컬 저장 이력 [V2][V5] | 같음 | 일부: 편집기 undo 와 git 탭 히스토리는 있고 파일별 이력 화면은 없음 | ★★ | M | P2 |
| 파일 비교 diff | 두 파일·저장본 비교 [V3] | 같음 | 일부: 편집기 왼쪽 바뀐 줄 표시(`shared/code-changes.ts`)와 git 탭 diff만, 임의 두 파일 비교 없음 | ★★ | M | P2 |
| 자동 저장 | `files.autoSave` [V3] | 같음 | **구현함(6절)** (Off 기본, `shared/auto-save.ts`) | ★★★ | S | **P1** |
| 파일 빠른 열기 Ctrl/Cmd+P | 있음 [V2] | 같음 | **있음**: `code-view.ts` `openQuick`, `shared/quick-open.ts` (코드 탭을 보고 있을 때만 동작) | ★★★ | - | 이미 있음 |
| md 미리보기 | 있음 | 같음 | 있음: 편집·나란히·미리보기 (`markdown-view.ts`, `code-preview.ts`) | ★★★ | - | 이미 있음 |
| 이미지 뷰어 | 있음 | 같음 | 있음 (`code-preview.ts`) | ★★ | - | 이미 있음 |

### 2-2. 탐색기

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 드래그로 이동 | 있음 | 같음 | 있음 (`code-tree-view.ts` `dragstart`, `code-file-ops.ts`) | ★★ | - | 이미 있음 |
| 새 파일·이름 바꾸기·복제·삭제(휴지통) | 있음 | 같음 | 있음 (`code-file-ops.ts`, F2/Delete/Ctrl+C·V) | ★★★ | - | 이미 있음 |
| 파일 아이콘 | 아이콘 테마 | 같음 | 있음: 직접 그린 아이콘 (`file-icons-art.ts`, `code-icons.ts`) | ★★ | - | 이미 있음 |
| 다중 선택 | 있음 | 같음 | 없음(코드에서 Shift/Ctrl 선택 처리 못 찾음, 한 줄씩 조작) | ★★ | M | P2 |
| 트리 검색 필터 | 있음 | 같음 | 일부: 전체 찾기(내용)·빠른 열기(이름)로 대체, 트리 안 필터 입력 없음 | ★ | S | P3 |
| 파일 감시 | 자동 반영 | 같음 | 일부: 창을 다시 눌렀을 때 디스크 변경 확인(`code-view.ts` `checkDisk`), 실시간 감시(watch)는 없음 | ★★ | M | P2 |
| 최근 파일·열어 둔 탭 복원 | 있음 | 같음 | 없음: 작업 폴더를 바꾸면 탭이 모두 닫힘 (`dropAll`) | ★★ | M | P2 |

### 2-3. 소스 제어 (git 탭)

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 변경 목록·스테이지·커밋 | 있음 [V5] | 같음 | 있음 (`git-changes-view.ts`, `shared/git-api.ts` `stage/commit`) | ★★★ | - | 이미 있음 |
| 줄 단위 스테이지 | 있음 [V5] | 같음 | 있음: `stageSelection`, hunk (`shared/git-diff.ts`) | ★★ | - | 이미 있음 |
| 인라인 diff(편집기 안) | 있음 | 같음 | 일부: 편집기 왼쪽 막대만, diff 는 git 탭에서 | ★★ | M | P2 |
| 브랜치 만들기·전환·삭제·머지 | 있음 | 같음 | 있음 (`createBranch/switchBranch/merge/deleteBranch`) | ★★★ | - | 이미 있음 |
| Fetch/Pull/Push | 있음 | 같음 | 있음, 보호 브랜치 확인 창 포함 | ★★★ | - | 이미 있음 |
| 히스토리·커밋 diff | Graph [V5] | 같음 | **구현함(2026-11-11)**: 목록+diff(`log`, `commitDiff`) + 브랜치 선·점 그래프(`shared/git-graph.ts`, 상한 500커밋, 병합 커밋 표시, All branches 토글). 맥 실기·1000개 넘는 이력 속도는 미확인 | ★★ | M | P2 |
| stash | 있음 [V5] | 같음 | **구현함(6절)** (git 탭 Stash 탭, `shared/git-stash.ts`) | ★★★ | S | **P1** |
| blame | 있음 [V5] | 같음 | **구현함(2026-11-11)**: Repo 편집기 Blame 토글(`shared/git-blame.ts`, `code:blame`, 5000줄 상한, 저장한 글 기준), 거터 클릭 시 Git History 의 그 커밋으로 이동. 맥 실기 미확인 | ★★ | M | P2 |
| 충돌 해결 | 인라인 + 3-way 편집기 [V5] | 같음 | **구현함(2026-11-11)**: Mine / Base / Theirs 나란히 + 구역별 Accept mine·theirs·both·base (`shared/conflict-text.ts`, `readConflict {base}` 는 `git merge-file --diff3` 로 임시 폴더에서 조상 재현). 파일 통째 내 것/상대 것·텍스트 직접 편집도 유지. 맥 실기 미확인 | ★★ | L | P2 |
| 커밋 취소 | 있음 | 같음 | 있음 (`undoCommit` soft reset) | ★★ | - | 이미 있음 |
| worktree | 있음 [V5] | 같음 | 있음: 팀 작업용 자동 worktree + 목록 (`worktrees`, `git-worktree-graph.ts`) | ★★ | - | 이미 있음 |
| PR 열기 | GitHub 확장 [V5] | 같음 | 일부: PR 만들기 페이지 열기(`openPr`)만 | ★★ | M | P3 |
| cherry-pick·rebase·태그 | 명령/확장 | 같음 | 없음 | ★ | M | P3 |

### 2-4. 터미널

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| PTY(대화형) | 있음 [V6] | 같음 | **없음**: 명령마다 새 셸, 네이티브 모듈 회피 (`main/terminal/terminal-host.ts`, `docs/desktop-guide.md` 7절) | ★★★ | L | P1(큰 항목, 문서만) |
| 여러 탭 | 있음 [V6] | 같음 | 있음 (`terminal-view.ts` `newTab`) | ★★ | - | 이미 있음 |
| 분할 | 있음 [V6] | 같음 | 없음 | ★ | M | P3 |
| 셸 선택(프로필) | 있음 [V6] | 같음 | 없음(OS 기본 셸 고정: mac `$SHELL`, Windows PowerShell) | ★★ | S | P2 |
| 링크 열기 | 있음 [V6] | 같음 | 없음 | ★★ | M | P2 |
| 터미널 찾기 | 있음 [V6] | 같음 | 없음 | ★ | S | P3 |
| 터미널 명령 제안(AI) | Copilot [V6] | 있음(문서에서 확인 못 함) | 일부: 채팅 `/` 명령 자동완성은 있으나 터미널 칸은 해당 없음 | ★ | M | P3 |

### 2-5. 명령 팔레트·단축키·설정·작업 공간

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 명령 팔레트(Ctrl+Shift+P) | 있음 [V2] | 같음 | 없음 | ★★★ | M | P2 |
| 앱 탭 전환 단축키 | Ctrl+Tab·Ctrl+번호 | 같음 | **없음 → 구현함(아래 4절)** (`shared/tab-shortcut.ts`, `renderer/app.ts`) | ★★★ | S | **P0** |
| 단축키 안내 | 키보드 단축키 보기 [V2] | 같음 | **없음 → 구현함(아래 4절)** (`shared/shortcut-sheet.ts`, `renderer/shortcut-view.ts`) | ★★ | S | **P1** |
| 사용자 지정 단축키 | 있음 [V2] | 같음 | 없음 | ★ | M | P3 |
| 설정 UI | 있음 | 있음 | 있음: Settings 탭 (`settings-view.ts`), 단 편집기 설정(글꼴 크기·줄바꿈 등)은 없음 | ★★ | S | P2 |
| 글꼴 크기·확대 | 있음 | 같음 | 일부: 메뉴 View 의 확대/축소만 (`main/platform/app-menu.ts`) | ★★ | S | P2 |
| 테마 | 색 테마 | 같음 | 일부: 어두운 테마 하나 + 캐릭터 테마(`characters.ts`). 밝은 테마 없음 | ★★ | M | P3 |
| 멀티 루트 작업 공간 | 있음 [V7] | 같음 | 일부: 작업 폴더 하나 아래 레포 여러 개를 최상위로 보임 (`docs/desktop-guide.md` 7절) | ★★★ | - | 이미 있음(형태 다름) |
| 최근 폴더 | File > Open Recent [V7] | 같음 | **구현함(6절)** (`shared/recent-folders.ts`, `renderer/recent-folders-view.ts`) | ★★ | S | **P1** |

### 2-6. 디버깅·테스트·확장

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 디버거(중단점) | 있음 [V8] | 같음 | 없음 | ★★ | L | P3 |
| 테스트 탐색기 | 있음 [V8] | 같음 | 없음. 팀이 테스트를 돌리고 결과는 기록 탭에 요약 | ★★ | L | P3 |
| Problems 패널 | 있음(문서에서 확인 못 함) [V8] | 같음 | 없음 | ★★ | L | P3 |
| 확장 | 마켓플레이스 | 같음 | 없음(의도적, 3절) | ★ | L | P3 |

### 2-7. Cursor 의 AI 기능

| 기능 | VS Code | Cursor | Rauha 현황 + 근거 | 가치 | 난이도 | 우선순위 |
|---|---|---|---|---|---|---|
| 채팅에서 변경 보기·Accept/Reject | Copilot | Agent 가 편집 적용, 체크포인트 [C2] (줄별 Accept/Reject 는 문서에서 확인 못 함) | 일부: 팀 상세 허락 카드 "diff 보기", 합치기는 허락 카드 (`ui-structure.md` 채팅 절) | ★★★ | M | **P0**(문서만) |
| 체크포인트 | - | 있음 [C2] | 일부: 작업별 worktree 브랜치. "이 작업 되돌리기" 단추 없음 | ★★★ | M | P1 |
| @ 컨텍스트 | - | 파일·폴더·터미널·이전 채팅·git diff·브라우저 [C4] (@web/@docs 는 문서에서 확인 못 함) | 일부: `@폴더` 맨 앞 지정만 (`chat-view.ts`, `desktop-guide.md` 4절) | ★★★ | M | P1 |
| 규칙 파일 | - | `.cursor/rules` `.mdc`, AGENTS.md, 사용자·팀 규칙 [C6] | 일부/다름: Rules 탭의 규칙(항상/묻지 않고/꼭 허락, 전체·폴더·레포 범위)은 앱 데이터에 저장. 레포의 `CLAUDE.md` 는 Claude Code 가 읽음. AGENTS.md 지원은 확인 못 함 | ★★★ | S | P2 |
| 에이전트/백그라운드·클라우드 에이전트 | - | 병렬, 클라우드 VM [C7] | **있음(로컬)**: 동시 3개(설정에서 1~6), worktree 분리, 큐 (`shared/settings.ts` `concurrency`). 클라우드 실행은 없음 | ★★★ | - | 이미 있음(로컬) |
| 작업 대기열 | - | 실행 중 Enter 로 대기 메시지, 순서 변경 [C2] | 일부: 일 카드 대기·`/queue`, 드래그 순서 변경 없음 | ★★ | M | P3 |
| 모델 선택 | - | 작업마다 선택 [C2] | **있음, 더 세분**: 팀원마다 모델 등급·노력 수준 (`team-settings-store.ts`, 설정 > Team) | ★★★ | - | 이미 있음 |
| Tab 자동완성 | - | 있음 [C3] | 없음 | ★★ | L | P3 |
| 인라인 편집 Cmd+K | - | 문서상 Agent 로 흡수, 선택 줄을 참조해 입력창 열기 [C8] | 없음: 편집기에서 선택 영역을 채팅으로 보내는 길이 없음 | ★★ | S | P2 |
| 코드베이스 인덱싱 | - | Instant Grep(로컬 인덱스). 임베딩은 저장 안 한다고 문서에 적힘 [C5] | 일부: 팀원 "저장소 파악" 역할이 있음. 별도 인덱스 없음 | ★★ | L | P3 |
| 대화 기록·검색 | - | 이전 채팅 @ 참조 [C4] | 일부: 레포별 대화 기억과 복원 (`main/data/chat-history-store.ts`, `main/team/repo-conversations.ts`), 대화 검색 입력 없음 | ★★ | M | P2 |
| 이미지 첨부 | - | 이미지 읽기 [C2] | 없음 | ★★ | M | P2 |
| 음성·클라우드 앱 등 신규 | - | 음성 채팅(2026-11-06), Agent SDK(2026-10-20) [C9] | 없음 | ★ | L | P3 |

## 3. 일부러 따라 하지 않을 것

| 항목 | 이유 |
|---|---|
| 확장 마켓플레이스·확장 API | Rauha 는 편집기가 아니다. 보안 면(비밀 파일 차단, 가림 규칙)을 앱이 통제하는 것이 강점인데 확장은 그 경계를 깬다. 비용도 크다. |
| 디버거(중단점·watch)·테스트 탐색기 | 팀원이 테스트를 돌리고 결과를 요약해 주는 것이 Rauha 방식이다. 사람이 줄 단위로 디버깅하는 일은 VS Code 를 따로 쓰는 편이 낫다(문서의 "VS Code를 열지 않고 보고 고치는 곳"은 가벼운 수정까지만). |
| 언어 서버 기반 자동완성·정의 이동·리팩터링·Problems | 언어마다 서버를 붙여야 해 설치 크기와 맥·Windows 호환 부담이 크다. 팀원이 코드를 쓰므로 사람 입력 보조의 가치가 낮다. |
| Tab 자동완성(Cursor 전용 모델) | 사람이 타자로 쓰는 일이 아니라 일을 맡기는 앱이다. 구독 한도를 아끼는 최상위 목표와도 충돌(호출이 늘어난다). |
| 클라우드 에이전트(원격 VM) | 로컬 폴더·개인 계정 구독 토큰을 옮기지 않는다는 원칙(`CLAUDE.md`)과 충돌한다. 회사 코드를 밖으로 보내는 일도 피해야 한다. |
| 코드베이스 임베딩 인덱스 | Cursor 도 문서상 임베딩을 저장하지 않는 쪽이다 [C5]. Rauha 는 필요할 때 "저장소 파악" 팀원이 읽는 방식이 한도를 덜 쓴다. |
| 사용자 지정 단축키 편집기·밝은/어두운 색 테마 마켓 | 매일 쓰는 가치에 비해 화면·저장 구조가 크다. 필요하면 나중에 밝은 테마 하나만. |
| 편집기 분할·미니맵·다중 커서 고급 기능 | 편집이 본업이 아니다. 비용 대비 효과가 작다. |

## 4. 추천 로드맵 (다음 3개 버전)

### 다음 버전 (v0.1.14): 바로 쓰는 작은 것
- **앱 탭 전환 단축키 Ctrl/Cmd+1~9,0 [구현함]**: 왼쪽 막대의 위쪽부터 순서대로 열 개(Chat, Repo, Todo, API, Docker, DB, Records, Git, Slash, Rules). Settings 는 열한째라 Ctrl/Cmd+, (VS Code 관례). 창이 낮으면 위쪽 탭만 스크롤(스크롤바 없음·그라데이션 표시), Settings·Report 는 아래 고정. 영향 파일: `shared/tab-shortcut.ts`(+spec), `renderer/app.ts`.
- **단축키 안내창 Ctrl/Cmd+Shift+/ [구현함]**: 앱 전체·Repo·채팅 단축키를 한 장으로. 영향 파일: `shared/shortcut-sheet.ts`(+spec), `renderer/shortcut-view.ts`, `renderer/app.ts`, `renderer/ui.css`(또는 `code.css`).
- **자동 저장(P1) [구현함]**: 설정 > Editor 의 "Auto save" 를 Off(기본) / After delay (1s) / On focus change 에서 고른다. 영향: `shared/auto-save.ts`(+spec), `shared/settings.ts`, `renderer/code-view.ts`, `renderer/settings-view.ts`.
- **최근 폴더(P1) [구현함]**: `Settings.recentFolders`(최대 5, 겹침 없음)를 설정 화면의 작업 폴더 칸과 첫 실행 마법사에 목록으로 보인다. 영향: `shared/settings.ts`, `shared/recent-folders.ts`(+spec), `renderer/recent-folders-view.ts`, `renderer/settings-view.ts`, `renderer/first-run.ts`.

### 그다음 (v0.1.15): 맡긴 일을 확인하는 흐름
- **git stash(P1) [구현함]**: `GIT_FUNCTIONS` 에 `stashList/stash/stashApply/stashPop/stashDrop` 추가, git 탭에 "Stash" 탭(메시지·새 파일 포함·목록·Apply/Pop/Drop). 영향: `shared/git-api.ts`, `shared/git-guard.ts`(StashRef·StashMessage), `shared/git-stash.ts`(+spec), `main/git/git-dispatch.ts`, `main/git/git-repo.ts`, `renderer/git-stash-view.ts`, `renderer/git-view.ts`.
- **작업 변경 보기·되돌리기(체크포인트)(P1) [구현함]**: 코드를 고치는 작업이 시작될 때 HEAD와 시작 시점 미커밋 상태(git 트리 해시)를 앱 데이터 `checkpoints.json`에 남기고, 끝난 일 카드/팀 상세에 Changes 칸(바뀐 파일·+/-줄·읽기 전용 diff·비밀 파일 숨김), 파일별 Revert file·Undo all changes(확인창, 작업 뒤 직접 고친 파일은 충돌로 건너뜀), 되돌리기 전 백업 patch(최근 20개)와 Undo the undo, worktree 브랜치는 Discard branch. 영향: `shared/checkpoint*.ts`, `main/git/checkpoint-git.ts`, `main/team/checkpoint-keeper.ts`, `renderer/changes-view.ts`. 가짜 팀 시험: RAUHA_FAKE_EDIT=1 + 요청에 [edit].
- **hunk 단위 되돌리기(Revert hunk) [구현함]**: 변경 칸에서 파일 diff 를 펼치면 고쳐진 글 파일의 hunk 머리줄마다 Revert hunk(이미 되돌렸으면 Reverted, 그 자리가 작업 뒤 바뀌었으면 Conflict). hunk 는 번호가 아니라 내용 해시로 가리키고 화면과 실제가 어긋나면 거절, 되돌리기 전 `git apply -R --check`·백업 patch(Undo the undo 가능)·확인창. 새 파일·지운 파일·바이너리·UTF-8 아닌 글·작업 중 커밋이 있던 작업은 파일 단위만. 영향: `shared/checkpoint-hunk.ts`, `shared/git-diff.ts`(hunkPatch), `main/git/checkpoint-git.ts`, `main/team/checkpoint-keeper.ts`·`checkpoint-dispatch.ts`, `renderer/changes-view.ts`. 아직 없음: 줄 단위 거절, hunk 'Accept'.
- **채팅 @파일(P1)**: `@` 입력 시 파일·폴더 자동완성(코드 탭 `fileCache` 재사용), 고른 파일 경로를 요청 앞에 붙인다. 영향: `renderer/command-suggest.ts`(또는 새 `mention-suggest.ts`), `renderer/chat-view.ts`.

### 그다음 (v0.1.16): 편집·터미널 체감
- **선택 영역을 채팅으로 보내기(Cmd+K 대응)(P2)**: 편집기에서 선택 후 Ctrl/Cmd+L 로 `@파일:줄` 형태로 입력창에 채움. 영향: `renderer/code-view.ts`, `chat.fill`.
- **채팅 이미지 붙여넣기(P2)**: 붙여넣은 PNG 를 임시 파일로 저장해 요청에 경로로 첨부. 영향: `renderer/chat-view.ts`, `main/main.ts`.
- **터미널 셸 선택·링크 열기(P2)**: 영향: `main/terminal/shell-command.ts`, `renderer/terminal-view.ts`.
- **PTY 터미널(큰 항목)**: 네이티브 모듈이 맥·Windows 설치 파일을 깨뜨릴 위험 때문에 보류. 사전 검증(prebuilt 확인, GitHub Actions 로 맥 빌드) 후 결정.

## 5. Rauha 만의 강점 (비교를 공정하게)

VS Code 와 Cursor 가 가진 편집기 기능은 Rauha 에 없는 것이 많지만, 반대로 두 제품에 없는 것을 Rauha 는 이미 갖고 있다. **팀 분업**(접수·설계·테스트·구현·리뷰를 Haiku·Sonnet·Opus 22명이 나눠 맡고, 팀원마다 모델·노력·도구를 설정), **레포별 대화 기억**(레포마다 이어 일하고 초기화도 레포 단위), **가림 규칙과 허락 카드**(비밀 파일·`git push` 차단, 위험 작업은 영향 표와 함께 허락 카드, 규칙 탭 3칸), **기록 → 블로그**(끝난 일을 요약 기록으로 쌓고 공개용으로 가린 트러블슈팅 글 초안까지), **리포트 → 내 개인 AWS**(회사 계정 오업로드를 막는 계정 번호 확인과 함께 S3 로), **세션 한도 관리**(구독 한도를 %로만 보여 주고 90%에서 멈춤)이다. 목표가 "더 좋은 편집기"가 아니라 "한도를 아끼며 일을 맡기는 앱"이므로, 위 격차 중 **일을 맡기고 결과를 확인하는 쪽(P0·P1)** 을 먼저 메우고 편집기 본업 기능은 의도적으로 뒤로 둔다.

## 6. 구현 현황 (이 문서와 함께 한 것)

| 항목 | 상태 |
|---|---|
| 편집기 자동 저장 | 구현함 (Off 기본 / After delay (1s) / On focus change). 읽기 전용·디스크에서 바뀐 파일·같은 글로 한 번 실패한 파일은 저장하지 않고, 충돌 질문 창을 띄우지 않으며, 질문 창이 떠 있을 때도 저장하지 않는다. 비밀 파일은 main 이 쓰기를 거절한다. 성공은 상태줄 "Auto-saved", 실패는 편집기 위 안내. 테스트 `shared/auto-save.spec.ts`, 숨김 창 확인 |
| 최근 작업 폴더 | 구현함 (최대 5개, 설정 Work folder 와 첫 실행 마법사). 고르면 설정은 "Allow work in this folder?" 확인 창, 마법사는 2/3 허락 단계를 그대로 거친다. 사라진 폴더는 흐리게 "Not found" + Remove. 테스트 `shared/settings.spec.ts`, `shared/recent-folders.spec.ts` |
| git stash | 구현함 (git 탭의 Stash 탭: 메시지 + "Include new files", 목록, Apply(남김) / Pop(지움) / Drop(확인 창). 번호와 stash 커밋 해시를 함께 보내 목록이 바뀐 사이 엉뚱한 stash 를 건드리지 않고, 덮어써질 변경이면 막고, 충돌이면 Conflicts 탭으로 보내며 stash 는 남긴다. 첫 커밋 없음·충돌 중·치울 변경 없음도 막는다. 옵션처럼 읽히는 번호·해시·메시지는 `StashRef`/`StashMessage` 가 거절). 테스트 `shared/git-guard.spec.ts`, `shared/git-stash.spec.ts`, `main/git/git-dispatch.spec.ts` |
| 앱 탭 전환 Ctrl/Cmd+1~8 | 구현함 (왼쪽 막대 순서, 탭 단추 툴팁에 키 표시, 창이 떠 있으면 무시). 테스트 `shared/tab-shortcut.spec.ts` |
| 단축키 안내창 Ctrl/Cmd+Shift+/ | 구현함 (Shift 없는 Ctrl+/ 는 편집기 주석 전환이라 쓰지 않음). 테스트 `shared/shortcut-sheet.spec.ts` |

## 7. 출처

VS Code (https://code.visualstudio.com/docs)
- [V1] 사용자 인터페이스: https://code.visualstudio.com/docs/getstarted/userinterface (탭, 편집기 분할)
- [V2] 같은 문서: Command Palette, Quick Open, Breadcrumbs, Minimap, Timeline, 단축키
- [V3] 편집 기본: https://code.visualstudio.com/docs/editing/codebasics (다중 커서, 찾기/바꾸기, 전체 검색, 접기, 자동 저장, diff)
- [V4] IntelliSense: https://code.visualstudio.com/docs/editing/intellisense (자동완성, 매개변수 정보. 정의 이동·이름 바꾸기는 이 페이지에서 확인 못 함)
- [V5] 소스 제어: https://code.visualstudio.com/docs/sourcecontrol/overview (스테이지, 줄 스테이지, Graph, Timeline, 충돌 3-way, stash, worktree, blame)
- [V6] 터미널: https://code.visualstudio.com/docs/terminal/basics (여러 탭, 분할, 셸 프로필, 링크, 찾기, 셸 통합)
- [V7] 멀티 루트 작업 공간: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces (Open Recent 포함)
- [V8] 테스트: https://code.visualstudio.com/docs/debugtest/testing (Test Explorer, 디버깅. Problems 패널은 이 페이지에서 확인 못 함)

Cursor (https://cursor.com/docs, 예전 docs.cursor.com 에서 이전됨)
- [C1] 문서 첫 화면: https://cursor.com/docs (Agent, Rules, 계획·리뷰, 연동)
- [C2] Agent 개요: https://cursor.com/docs/agent/overview (파일 편집, 체크포인트, 터미널 명령, 메시지 대기열, 모델 선택, 이미지 읽기)
- [C3] Tab: https://cursor.com/docs/tab/overview
- [C4] @ 멘션: https://cursor.com/docs/context/mentions (파일·폴더·터미널·채팅·git diff·브라우저)
- [C5] 코드베이스 인덱싱: https://cursor.com/docs/context/codebase-indexing (Instant Grep, 임베딩 미저장)
- [C6] 규칙: https://cursor.com/docs/context/rules (`.cursor/rules/*.mdc`, AGENTS.md, User·Team Rules)
- [C7] 클라우드 에이전트: https://cursor.com/docs/cloud-agent
- [C8] 인라인 편집: https://cursor.com/docs/inline-edit/overview (Cmd+K 는 Agent 흐름으로 대체됐다고 적혀 있음)
- [C9] 변경 기록: https://cursor.com/changelog (2026-11-06 음성 채팅, 2026-11-05 Live Apps, 2026-10-20 Agent SDK, 2026-10-16 Cloud Agent Canvases, 2026-10-13 Origin 마켓플레이스)

Rauha 쪽 근거: `docs/desktop-guide.md`, `docs/design/ui-structure.md`, `packages/desktop/src/**` (본문에 파일 경로 표기).
