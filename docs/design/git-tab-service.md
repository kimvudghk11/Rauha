# Git 탭 서비스 설계 — 단추 하나씩, 순서대로

Figma: https://www.figma.com/design/vxcQsjWkEJTDiSY6Wuz7SX (F1~F3 장면, rauha 색 변수 `rauha/Dark`)
F4~F6 은 Figma 무료(Starter) MCP 호출 한도에 걸려 이 문서로만 정리했다. 장면 구성은 F1~F3 과 같은 틀(위 저장소 막대 · 화면 탭 · 내용)이다.

## 공통 원칙

1. **파란 단추는 늘 하나** — 지금 해야 할 일. 뒤처졌으면 Pull, 앞섰으면 Push, 새 브랜치면 Publish branch, 아무것도 없으면 Fetch.
2. **누른 단추만 돈다** — 누른 순간 그 단추에 돌아가는 표시와 "…ing" 글. 같은 종류의 다른 단추는 잠깐 꺼진다(두 번 눌림·동시 실행 금지).
3. **실패는 그 자리 배너** — 쉬운 말 한 줄 + 바로 고치는 단추(Pull and push again, Sign in, Set name and email, Try again). 모르는 오류는 첫 줄 + [Copy details].
4. **못 누르는 단추는 이유를 바로 아래에** — 툴팁에 숨기지 않는다.
5. **끝나면 알림 + 다음 할 일** — 오른쪽 아래 알림(5초)에 [Undo]/[View], 위 막대의 파란 단추가 다음 할 일로 바뀐다.
6. **위험한 일은 확인 창** — Discard, 브랜치 삭제, Drop stash, 보호 브랜치 push/merge, Re-run(Actions 시간 사용). 창에 무엇을 잃는지 숫자로.

## 화면 틀

- **저장소 막대**: 저장소 이름 · ⎇ 브랜치 알약(누르면 찾기 메뉴) · 상태 문장("1 ahead · 3 behind origin/main") · 마지막 확인 시각 · Fetch · Pull ↓n · Push ↑n · Open PR
- **화면 탭**: Changes(n) · Branches · History · Stash(n) · Actions(NEW) · Conflicts(n, 머지 중에만 빨갛게)

## F1 변경 보기 → 스테이지 → 커밋 → 되돌리기 (Figma)

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F1-1 | 왼쪽 막대 Git (Ctrl+8) | `overview()` | 불러오는 중 skeleton, 저장소 아님 → [Initialize] [Open another folder] |
| F1-2 | 파일 이름 | `diff({path, side})`, hunk 마다 [Stage hunk] | 바이너리 크기 비교, 5,000줄 넘으면 앞 500줄 + [Show all] |
| F1-3 | 체크칸 / Space / [Stage file] | `stage({paths})` → Staged 로 이동, 요약 갱신 | 파일 잠김 → 그 줄 아래 빨간 한 줄 |
| F1-4 | 제목 입력, ✨ Draft with teammate(NEW) | 스테이지한 diff 로 Haiku 가 초안(규칙 `conventions()` 반영) | 72자 초과 노랑, 버튼 글 "Commit 1 file to main" |
| F1-5 | Commit (Ctrl+Enter) | `commit({subject, body})`, 입력 잠금 | 이름·이메일 없음 → 배너 [Set name and email] 그 자리 입력, 훅 3초↑ → 훅 출력 마지막 줄 |
| F1-6 | — | 알림 ✓ Committed + [Undo] [View], Push ↑1 파랑 | Undo = `undoCommit()`(soft), push 뒤에는 Revert… |

## F2 동기화: Push 거절 → 한 번에 Pull 하고 다시 Push (Figma)

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F2-1 | Push ↑1 (Ctrl+Shift+P) | `push({})`, 보호 브랜치면 먼저 확인 창 | 문장 "Pushing 1 commit…" |
| F2-2 | — | 거절을 알아보면 자동 `fetch()` → ↓3 | 빨간 배너 + [Pull and push again] [Pull only] |
| F2-3 | Pull and push again | ff 안 되면 Merge(추천)/Rebase 고르기, [Always do this] 저장소마다 기억 | 충돌 → F4 |
| F2-4 | — | 파란 배너에 단계(✓ Pulled · ✓ Merged · ◌ Pushing) | Cancel 은 push 전까지만, 20초↑ "Still working…" |
| F2-5 | — | 알림 "✓ Pulled 3 · Pushed 2" + [View on GitHub], 파랑은 Fetch | 자동 fetch 5분(설정에서 끄기) |

## F3 브랜치: 찾기 → 만들기 → 바꾸기 (Figma)

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F3-1 | ⎇ 알약 (Ctrl+Shift+B) | `branches()`, 최근순 + 원격만 있는 것 흐리게 | 타자로 거르기, ↑↓ Enter, Esc |
| F3-2 | 없는 이름 입력 → Enter | `createBranch({name, base, checkout: true})` | 띄어쓰기 → `-` 미리보기, 금지 글자 빨간 줄, feat/ fix/ 후보 |
| F3-3 | (고친 파일 있을 때) | Bring my changes(추천) / Leave them on main(stash) / Cancel | 가져갈 수 없으면 첫 선택지 꺼짐 + 이유 |
| F3-4 | — | 알약 갱신, "Not on GitHub yet", 파랑 = [Publish branch] | 알림 [Switch back] |

## F4 머지 → 충돌 풀기 → 끝내기

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F4-1 | Branches 탭 행의 [Merge into main] | 행: 이름 · 마지막 커밋 · ↑↓ · [Switch] [Merge into main] [⋯(Rename, Delete…)] | 현재 브랜치 행에는 Merge 없음 |
| F4-2 | — | main 이 보호 브랜치면 확인 창: "main is protected. Merge feat/actions (4 commits) into it?" [Merge anyway] | `merge({name, confirmed: true})` |
| F4-3 | — | 충돌이면 탭 Conflicts(2) 가 빨갛게 생기고 그리로 이동. 노란 배너 "Merge stopped: 2 files conflict" + [Abort merge] | `mergeState()` |
| F4-4 | 충돌 파일 행: [Use mine] [Use theirs] [Edit] | `resolveSide({path, side})` 또는 Edit → 덩어리마다 위(mine)/아래(theirs) 나란히 + [Accept mine/theirs/both], 직접 고치기 | `readConflict` / `writeConflict` / `markResolved` |
| F4-5 | 모두 풀리면 [Finish merge] (파랑) | 초록 배너 "All conflicts resolved", 커밋 제목 미리 채움 "Merge feat/actions into main" → `finishMerge()` | Abort merge 는 확인 창(되돌림 범위 숫자로) → `abortMerge()` |
| F4-6 | — | 알림 "✓ Merged feat/actions into main" + [Delete feat/actions]. 파랑 = Push ↑5 | 삭제는 `deleteBranch` 확인 창 |

## F5 Actions (NEW) — GitHub 워크플로 보기

조회는 GitHub API 라 비용·Actions 시간이 들지 않는다. Re-run 만 시간을 쓴다.

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F5-1 | Actions 탭 | 실행 목록: 상태 아이콘 · 워크플로 이름 · 트리거(push main / tag v0.2.4) · 커밋 제목 · 걸린 시간 · 언제. 위에 Workflow ▾ Branch ▾ Status ▾ 거르기 | 진행 중은 30초마다 새로, 아니면 탭 열 때만 |
| F5-2 | 실행 행 | 왼쪽 job 목록(windows · mac-arm64 · mac-x64 · smoke) + 걸린 시간, 오른쪽 선택한 job 의 단계 ✓/✗ | 태그 실행이면 위에 만든 설치 파일과 크기 |
| F5-3 | 실패한 단계 | 펼쳐서 로그 마지막 80줄, 오류 줄 빨갛게. [Copy log] [Open on GitHub] [Ask teammate why](NEW: 로그를 채팅으로 보냄) | 로그가 지워졌으면(90일) "Logs expired" |
| F5-4 | [Re-run failed jobs] | 확인 창: "This uses GitHub Actions minutes (free for public repos)." | 권한 없음 → "You can view but not re-run here." |
| F5-5 | — | 끝나면 OS 알림 "desktop · v0.2.4 succeeded in 18m" + [Open release] | 창이 뒤에 있어도 알림 |
| 로그인 | 비공개 저장소이고 로그인 정보가 없을 때 | 빈 화면 "Sign in to GitHub to see Actions for this private repo" [Sign in with GitHub] → 기기 로그인 코드 창(코드 복사 + github.com/login/device 열기) | `gh` 가 있으면 그 로그인을 그대로. 공개 저장소는 로그인 없이(시간당 60번 → 새로고침 간격 늘림). 토큰은 OS 보안 저장소, 보기 권한만 |

## F6 히스토리 · 스태시

| 단계 | 누르는 것 | 일어나는 일 | 상태·실패 |
|---|---|---|---|
| F6-1 | History 탭 | 그래프(가지 선) · 제목 · 작성자 · 언제 · 짧은 해시, 위에 찾기칸(제목·해시·작성자) + [All branches] 토글 | `log({ref, all})`, 200개씩 더 불러오기 |
| F6-2 | 커밋 행 | 오른쪽에 바뀐 파일과 diff. [Copy hash] [Create branch here] [Revert…] | `commitDiff({hash})` |
| F6-3 | Stash 탭 · [Stash changes] | 메시지 칸 + [Include untracked] → `stash()` | 고친 파일 없으면 단추 꺼짐 + 이유 |
| F6-4 | 스태시 행: [Apply] [Pop] [Drop…] | `stashApply` / `stashPop` / `stashDrop`(확인 창: 파일 n개를 잃음) | 적용 중 충돌 → F4 와 같은 충돌 화면 |

## 만드는 순서(작은 것부터, 각 단계 spec 먼저)

1. **저장소 막대 + 파란 단추 규칙** — `primaryAction(overview)` 값 객체(shared), 상태 문장. 기존 `git-toolbar.ts` 옆.
2. **Push 거절 → Pull and push again** — 하나의 이어진 작업(단계 배너), 갈라짐 선택 창과 저장소별 기억.
3. **브랜치 찾기 메뉴** — 찾기·만들기 한 칸, 이름 검사 값 객체, 고친 파일 3선택 창.
4. **못 누르는 이유 · 실패 배너의 고치는 단추** — `knownGitError` 에 "고치는 단추" 정보 추가.
5. **Actions 탭** — 읽기 전용 GitHub API, 로그인(gh → 공개 무로그인 → 기기 로그인), 진행 중 새로고침·끝 알림.
6. **✨ Draft with teammate** — 스테이지한 diff 만 Haiku 에 보내 제목·본문 초안.
7. 충돌 화면 나란히 보기, 히스토리 찾기·Create branch here, 스태시 메시지.
