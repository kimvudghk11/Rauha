# 화면 구조도 (지금 있는 그대로)

2026-11-08 조사. 시안이 아니라 `packages/desktop/src/renderer`의 소스(index.html, *.css, *-view.ts)와 숨김 창 측정으로 확인한 사실이다.
어긋난 곳을 고치면 이 문서의 "어긋난 곳" 표를 같이 고치고, 고친 뒤 구조는 `ui-components.md`가 기준이다.

## 조사 방법

- 측정기: `packages/desktop/scripts/measure-ui.cjs`. 창을 화면에 띄우지 않고(`show` 무효화), 임시 데이터 폴더와 가짜 팀(`RAUHA_FAKE_TEAM=1`)으로 돌려 실제 Claude를 부르지 않는다. 시험용 레포 둘(변경·앞섬·브랜치가 있는 것, 머지 충돌 중인 것)을 만들어 작업 폴더로 쓴다.
- 장면 17개(채팅 2, 코드 4, 할 일 2, 기록 2, git 4, 명령어, 규칙, 설정. 레포 탭은 코드 탭에 합쳐졌고, 그 뒤 코드 탭 탐색기 장면 9개가 늘었다: 레포 노드 줄·메뉴·이름 바꾸기 입력·삭제 확인)를 폭 1700·1100·720·600에서 `getBoundingClientRect`·`getComputedStyle`로 쟀다. 보이는 `button·select·input·textarea·.chip` 전부를 표로 모았다.
- 아래 수치는 모두 이 측정값이다. 폭 4단계는 `layout.ts`의 `TIER_MIN`(xl 1700 · m 1100 · s 720 · xs 그 아래)이다.
- 폭 4단계 전부에서 가로 넘침(`scrollWidth > innerWidth`)과 잘림(`overflow` 숨김인데 내용이 더 큼)은 0건이었다.
- 못 한 것: 맥 실기(신호등·제목줄 겹침은 코드와 `title-bar.spec.ts`로만 확인), 첫 실행 마법사 3단계(측정기에서 예전 rauha 지우기 대화상자까지만 잡힘. 같은 `.dialog` 부품이라 같은 수치가 적용된다).

## 1. 전체 틀

```
body > .app  (grid: 52px 탭 막대 | 본문;  s·xs에서는 44px)
 ├─ header.titlebar        맥에서만 보임. 높이 --titlebar-h(35). 끌기 영역. 신호등은 OS가 위에 그림
 ├─ div.update             새 버전 배너(제목줄 아래, 전체 폭). hidden이면 없음
 ├─ nav.act#tabs           왼쪽 탭 막대: 9개 버튼(아이콘 + 9.5px 글자). s·xs에서는 글자 0px(아이콘만)
 ├─ main.main#screen       탭 하나가 들어감
 └─ footer.status          24px. 왼쪽 일 수 · 가운데 한도 막대(.status-usage) · 오른쪽 한도 문구(.status-right)
오버레이: .veil > .dialog (첫 실행·확인), .toasts > .toast (허락 알림), .qo-veil > .qo (코드 빠른 열기)
```

## 2. 화면 → 영역 → 부품

표기: `부품(클래스)`. [!]는 아래 "어긋난 곳" 번호.

### 채팅 (`chat-view.ts`, `chat.css`, `styles.css`)

```
section.chat  (grid: data-mode = xl 2열 방 · side 나란히 · rows 위아래 · xs 메인만+띠)
 ├─ .strip              (xs만) .stripchip 버튼들 [!]칩 모양 버튼이 따로 있음
 ├─ .pane.mainp         메인(팀장과 대화)
 │    ├─ .ph            머리: b 제목 · .hint · .ltoggle(배치 토글 버튼 2개) · button.btn.sm.reset-conv「대화 초기화」(askDialog 확인 후 앞 대화·이어 일할 파일만 비우고 flash로 안내) [!]
 │    ├─ .msgs          .m(.av + .tx(.who)) · .m.me · .empty · .hand(일 카드: .dot .state .handline .go .stop .keep) [!]
 │    └─ .composer      textarea(채움, 9/10 여백) · .hint(.kbd)  · .cmd-suggest(/명령 자동완성)
 ├─ .rooms              팀 방 카드 목록
 │    └─ .pane.room     .ph(.dot b .chip .time) · .stage(canvas.sp, .bub) · .steps · .stepl · .log
 └─ .detail             팀 상세(방을 누르면)
      ├─ .pane          .ph(← 메인 .btn.sec · 제목 · .right[.btn.danger 멈추기]) · .dtabs(버튼 탭: 정리 / 원본 로그 …) · .dbody
      │                 .dbody 안: .approval(허락 카드) / .review(.impact 표 · ul.files · pre.diff .dl) / .result / .term 모양 로그
      └─ .dside         .tl(타임라인: .s .k)
허락 카드  .approval: .ah · .facts(.chip) · details · input.note · .btns[.btn.primary 한 번만 / .btn.sec 이번 작업 동안 / .btn.sec 다르게 / .btn.danger 거절]
알림 토스트 .toasts > .toast: b · 문구 · .btn.primary 「정리 보기」
```

### 코드 (`code-view.ts`, `code-tree-view.ts`, `code-file-ops.ts`, `code-menu.ts`, `code-dialog.ts`, `code-editor.ts`, `terminal-view.ts`, `code.css`)

```
section.code  (flex, 테두리 1px, 둥근 6px)
 ├─ aside.code-explorer (260/300px, s·xs는 ☰로 겹쳐 열기)
 │    ├─ .code-ehead    35px: .code-mode(탐색기/검색, 밑줄 탭) · b.code-folder · .code-ibtn ↻
 │    ├─ .code-tools    아이콘 단추 6개(.btn.ghost.icon.sm: 새 파일·새 폴더·이름 바꾸기·복제·옮기기·휴지통)
 │    ├─ .tree          button.tree-row 22px (.tree-chev .tree-name .tree-sync(브랜치·↑↓) .tree-tag .tree-badge) · 레포 노드 아래 .repo-line(.chip 브랜치·.sbadge ↑↓·변경 수·작업 중·.link git 탭에서 보기·.btn.icon ↻) · .tree-edit(input.sm + .err) · 오른쪽 클릭 .menu.ctx
 │    └─ .code-search   .cs-row(input.cs-input · .cs-opt Aa .*) · .cs-summary · .cs-results(.cs-path .cs-hit)
 └─ section.code-main
      ├─ .code-bar      35px: .code-ibtn ☰ · .code-tabs(.code-tab + .code-x) · .code-ibtn >_
      ├─ .code-notice   .note(.warn) + .btn
      ├─ .code-host(CodeMirror) 또는 .code-empty
      ├─ .term          터미널 칸: .term-grip · .term-bar(30px: .term-tabs .term-stop .code-ibtn + ×) · .term-note · pre.term-out · .term-row(.term-prompt input.term-input)
      └─ .code-status   22px
 오버레이 .qo-veil > .qo(input.qo-input · .qo-row)
```

### 할 일 (`todo-view.ts`, `todo-board.ts`, `todo-detail.ts`, `todo.css`)

```
section.todo
 ├─ .rhead   b 제목 · .hint · .seg 보드/목록 · .btn.primary 「＋ 새 카드」
 ├─ .ttools  input 검색 · select 3개 · label.tg
 ├─ .notice (경고 줄)
 ├─ .tbody > .tmain > .tboard > .tcolumns (가로 스크롤, 칸 폭 272px 고정)
 │    ├─ .tcol[data-col] × 보이는 칸
 │    │    ├─ .tch   .chip.tname(색 칩=칸 이름) · .tcount · .grow · .btn.icon.sm.ghost 「+」 「⋯」
 │    │    ├─ .tcards  .tadding(input, 입력 중일 때) · .item.tcard[data-id](.tt 제목 · .tchips 값 있는 속성 칩만)
 │    │    └─ .btn.ghost.sm.tadd 「+ 새로 만들기」
 │    └─ .ttail  「+ 칸 추가」(누르면 input) · .thidden(.lbl 숨긴 칸 N · .thid.row-item × N: 점 · 이름 · 수 · .btn.sm 「보이기」)
 └─ .veil.tveil > .tmodal  (카드 창: 화면 가운데 모달, 폭 720px·최대 높이 85vh. 사이드 패널이 아니다)
      ├─ .btn.icon.ghost.dclose 「×」
      ├─ .dbody  input.dtitle(큰 제목) · .dprops(.dprop × 6 = span.dpk 「이름 :」 + 값) · .dsection 설명(textarea.dnote, 자동 높이) · .dsection 체크리스트(.dcheck: .dcrow × N · input.dcnew) · .btns 맡기기/진행 보기/복제/지우기
      └─ .dfoot  저장 상태 · 날짜 · 오류
```

카드 창 키보드: Esc·바깥 누르기·×로 닫고 닫기 직전에 안 보낸 고침을 바로 저장한다. Tab은 창 안에서만 돌고, 한글 입력기 조합 중 Enter는 `dom.ts`의 `isEnterKey`로 무시한다. 메뉴·확인 창이 위에 떠 있을 때 Esc는 그 창만 닫는다(`stopPropagation`).

### 기록 (`records-view.ts`, `blog-view.ts`, `record-parts.ts`, `data-tabs.css`, `blog.css`)

```
section.records
 ├─ .rhead · .rtools(.rsearch[input + × 검색어 지우기] · select 3 · label.tg · .btn 보이는 기록 복사[.end]) · .rtags.bar(칩 + .btn.ghost.sm 필터 지우기[.end, 조건이 있을 때만])
 └─ .rec (2열; s·xs는 목록/상세 전환)
      ├─ .rclist.pane  .ph · .rpick(.bar[3개 선택 · 전체 선택 · 선택 해제] .bar[블로그 글 · 복사 · 삭제[.end]]) · .ritems > .rpickrow[data-id](input[checkbox] · button.ri(.rt · .tchips[끝남/멈춤 · 태그 ≤2 · +N] · .rm 시각·걸린 시간·레포))
      └─ .rcdet.pane   .rdbar(sticky: ← 목록 · 블로그 글[.end] · 복사[primary] · 지우기[danger]) · .rtitle · .tchips · .rsec(태그: button.chip.purple + ▾ → .menu) …
 블로그 패널 .bg   .rdbar(← 기록으로 · 정리 노트 복사[.end] · .md로 저장 · 초안 쓰기[primary]) · .bg-head · .bar 길이·어투(.seg) · 가릴 이름 · 코드 조각 · 정리 노트 · 바뀐 목록(되돌리기) · 초안 카드
 지우기 확인은 앱 공통 확인 창(git-common askDialog: .veil > .dialog, 취소 / 지우기 .btn.danger)
```

#### 기록 탭 점검 (2026-11-08, 고치기 전 → 고친 뒤)

측정기(`measure-ui.cjs`)의 기록 장면 11개(목록·상세·체크·체크+상세·지우기 확인·체크 지우기 확인·범위 선택·태그 메뉴·검색 결과·검색 없음·블로그 패널·초안 확인)를 폭 4단계에서 쟀다. 위 항목은 고치기 전, 끝에 "→"가 있는 것은 고친 방법이다.

1. 상세의 복사·블로그 글·지우기가 **맨 아래** 있어 메모까지 내려가야 보인다 → 위쪽에 고정된 한 줄(`.rdbar`, sticky).
2. 같은 화면에 강조(파랑) 버튼이 둘(목록의 「블로그 글」 + 상세의 「마크다운으로 복사」) → `primaryRecordAction()`이 하나만 정함(상세가 열려 있으면 복사, 블로그 패널이면 초안 쓰기, 아무것도 안 열렸고 체크가 있으면 블로그 글). 측정기가 강조 버튼 2개 이상을 위반으로 센다.
3. 도구줄: select 3개와 체크칸·복사 버튼이 줄바꿈될 때 정렬이 어긋남(체크 글이 select 밑으로 떨어짐), 검색칸에 지우기(×) 없음 → `.tselects`를 `display: contents`로 풀어 한 줄 흐름, 검색칸에 × 추가, 복사 버튼은 오른쪽 끝(`.end`).
4. 필터 칩 줄에 지금 조건이 걸렸는지·한 번에 지우는 법이 없음 → 조건이 있으면 「필터 지우기」(`activeFilterKeys`), 빈 결과 화면에도 같은 버튼.
5. 선택 작업줄이 "체크한 기록으로 블로그 글을 만들 수 있어요" 한 문장 + 단추 3개가 한 줄에 눌려 있고 선택 수가 없음 → "3개 선택"을 앞에, 전체 선택·선택 해제, 둘째 줄에 블로그 글·복사·삭제(위험, 오른쪽 끝). 필터에 가려진 선택은 "3개 선택 (2개는 지금 안 보여요)". Shift+클릭 범위 선택(`rangeBetween`).
6. 지우기 확인이 단추 자리에서 글자만 바뀜("정말 지울까요?"/"아니요")이라 무엇을 몇 개 지우는지 모름 → 앱 공통 확인 창: "기록 N개를 지울까요?", 제목들(앞 3개 + 외 N개), "이 컴퓨터에서 지워져요. 되돌릴 수 없어요.", 취소(먼저 선택) / 지우기 danger.
7. 목록 행에 상태 칩 없음(멈춤만), 걸린 시간 없음, 태그가 많으면 줄이 길어짐 → 끝남/멈춤 칩이 늘 첫 칸, 태그는 2개 + "+N", 둘째 줄에 `시각 · 걸린 시간 · 레포`(숫자 같은 폭).
8. 키보드: 위아래 이동·Enter·Esc 없음, 행이 전부 Tab 정지점 → 한 줄만 Tab 정지점(roving), ↑↓·Home·End로 초점 이동, Enter(버튼 기본 동작)로 열기, x로 체크, Esc로 되돌아가기(검색칸에서는 검색어 지우기).
9. 태그 칩이 눌러서 바꿀 수 있다는 힌트가 없음 → 칩에 작은 ▾, 누르면 체크가 있는 메뉴(`.menu`).
10. 복사·저장 결과가 위쪽 경고 줄에 뜸(복사 성공도 경고색) → 성공은 잠깐 뜨는 알림("복사했어요", `.toast.flash`), 실패·오류만 경고 줄. 빈 상태·로딩(스피너)·검색 없음 문구 정리.
11. 상세 제목이 길면 길게 늘어남 → 3줄까지 말줄임(전체는 툴팁). 위쪽 단추 줄은 제목과 따로라 밀리지 않음.
12. 블로그 패널: 복사·저장·초안 쓰기가 긴 글 맨 아래 → 같은 고정 줄(`.rdbar`)로 올림. 초안 확인 카드가 뜨면 위쪽 「초안 쓰기」는 보조로 물러남(강조 하나). 「되돌리기」에 아이콘, 코드 조각 「지우기」는 위험 색.
13. (측정기 자체) 숨긴 창에서 `requestAnimationFrame`이 멈춰 폭 720 장면이 폭 1100 배치로 재졌다 → `setBackgroundThrottling(false)`. 앞 장면의 확인 창·메뉴가 다음 장면에 남던 것도 장면 사이에 치움. 측정기가 기록·할 일 파일을 내 실제 `~/.rauha/desktop`이 아니라 임시 폴더에 둠(이전에는 시험 기록이 실제 기록에 쌓였다).

결과: 폭 1700·1100·720·600 모두 규칙 위반 0건(버튼 높이 28/24, 위쪽 단추 줄 줄바꿈 0, 선택 작업줄 줄바꿈 0, 강조 버튼 1개 이하, 아이콘만 있는 버튼의 툴팁·접근성 이름 있음, 글자 잘린 버튼 0, 가로 넘침 0).

### git (`git-view.ts`, `git-changes-view.ts`, `git-lists-view.ts`, `git-common.ts`, `git.css`)

```
section.git
 ├─ .ghead   select.gselect · button.gbranch · .chip(앞섬/뒤처짐/보호/머지 중) · .gfill · [.btn.sec fetch · .btn.sec pull · .btn.primary push · .btn.sec PR 열기]
 ├─ .gbar    button.gtab(변경/브랜치/히스토리/충돌) · .btn.sec.gfillbtn 다시 읽기
 ├─ .gmsg    결과 한 줄
 └─ .gbody
      ├─ 변경    .gsplit: .gside(.gall .gfiles > .gf(.gb .gname .gx) · .gcommit(input.ginput · textarea.ginput · .btn.primary 커밋)) | .gmain(.gmh · .gdiff(.gdbar .gh .gl))
      ├─ 브랜치  .gtools(input.ginput + .btn.primary 새로 만들기) · .glist > .gf(… .btn.sec 전환/머지 · .btn.danger 삭제)
      ├─ 히스토리 .gsplit: 커밋 목록 | diff
      └─ 충돌    .gsplit: 파일 목록 | .gmain(.gmh[.btn.sec 내 것 · 상대 것 · 저장, .btn.primary 해결됨] · textarea.gconf)
확인 대화상자(git-common.askDialog)  .veil > .dialog(b · p.gpre · input.ginput · .btns[.btn.sec 취소 · .btn.primary/.danger 확인])
```

### 명령어 (`commands-view.ts`, `commands.css`)

```
section.commands > .rhead · form.cmdform.pane(.fields input×2 · textarea · .row[.btn.primary 더하기 · .btn.sec 취소]) · .cmdlist > .pane.cgroup > .cmd(.top(b.mono .ds .tg .btn.sec 자세히/고치기/지우기) · .body(.args pre.tpl)) · .cmdfoot .btn.sec 기본 명령 되돌리기
```

### 규칙 (`rules-view.ts`, `chat.css`, `commands.css`)

```
section.rules > .rhead · .ruletalk.pane(textarea · .btn.sec 정리하기) · form.ruleform.pane(.row input·select … · .btn.primary 규칙 더하기) · .rcols(3열; s·xs 1열) > .pane.rcol > .rule(.meta .chip · .btn.sec 지우기) / .rule.default(.dtop label.tg · textarea · .rfoot[.btn.primary 저장 · .btn.sec 취소/기본값으로])
```

### 설정 (`settings-view.ts`, `team-view.ts`, `login-view.ts`, `chat.css`, `commands.css`)

```
section.settings
 ├─ .pane.sec 「계정」    .login(.acct(.acct-title .acct-detail) · .login-row[.btn.primary Claude 로그인 · .btn.sec 다시 확인/취소]) · .srow(select)
 ├─ .pane.sec 「한도」    .limits > .limit(.lbl .bar > i · .pct · .dim)
 ├─ .pane.sec 일반         .srow(label + select/input) × 여러 줄 · .hint
 ├─ .pane.sec 「업데이트」 .btn.sec 업데이트 확인 · .btn.primary 지금 업데이트
 ├─ .pane.sec 「캐릭터 테마」 .cset-list > button.item.cset(.on)(.cset-faces canvas.sp × 5 · b 이름 · .hint 한 줄 소개). 누르면 22역할 그림이 한 번에 바뀐다(우선순위: 팀 설정에서 따로 고른 캐릭터 > 테마 > 기본 바다 친구들)
 └─ .pane 「팀 설정」(team-view)  .team > .tlist > .tm(.tmtop(canvas.sp b .ds select .tg .btn.sec 자세히) · .tmbody(.tf .tools textarea)) · .tfoot .btn.sec 팀 전체 기본값으로
```

### 답답한 점 적기 (`bug-view.ts`, `data-tabs.css` 끝, 설정의 「내 AWS」)

새 탭이 아니라 어느 탭에서나 열리는 창이다. 여는 곳: 단축키 Ctrl/Cmd+Shift+B(`shared/bug-shortcut.ts`, 물리 키 B), 탭 막대 맨 끝의 `button.bug-open`(탭이 아니라서 `#tabs button` 순서의 끝에 둔다).

```
.veil.bugs-veil > .dialog.bugs(폭 min(640, 100vw-32), 안에서 세로 스크롤)
 ├─ .bar            b 제목 · .hint 단축키 · .btn.icon.sm.ghost 닫기
 ├─ .bug-form       input.bug-title(80자) · textarea.bug-memo-input(2000자)
 ├─ .bar            .hint 자동 첨부 안내 · .btn.primary 적어 두기   ← 이 화면의 강조는 이것 하나
 ├─ .tabs           .tab 미해결 n · .tab 해결 n
 ├─ .bug-list       .item.bug-item × n (.bar[b.bug-name · .chip 올림/안 올림] · .bug-memo · .hint.bug-meta · .btns[.btn.sm × 3 · .btn.icon.sm.danger])
 └─ .bar.bug-sync   .btn.sm 내 AWS로 올리기 · .btn.sm 받아오기 · (막혔으면 .hint 이유) · .hint/.err 상태 한 줄
미리보기 단계: 같은 창 안에서 목록 대신 .bug-list(가린 글) + .btns.end[.btn 돌아가기 · .btn.primary 확인하고 올리기]
```

- 지우기는 공통 확인 창(`askDialog`, `.dialog` 위에 한 겹 더). Esc는 미리보기에서 목록으로, 목록에서 창 닫기. Enter는 `isEnterKey`(한글 조합 중 무시), 메모 칸은 Ctrl/Cmd+Enter.
- 올리기·받기 단추는 설정의 프로필 이름 등 네 칸이 올바를 때만 켜진다. 막혔으면 단추 툴팁과 아래 한 줄이 이유를 말한다.
- 설정 탭의 「내 AWS (답답한 점 올리기)」 `.pane.sec`: `.srow` input × 4(프로필 이름·버킷·리전·개인 계정 번호) + 상태 한 줄(`.hint.pad`/`.err.pad`) + 키를 적지 않는다는 안내.
- 측정 장면: `bug-dialog`, `bug-saved`, `bug-preview`, `bug-delete-ask`, `bug-done`(폭 1700·1100·720·600 모두 규칙 위반 0건).

### 제목줄·배너·상태 줄·탭 막대

```
header.titlebar    맥만. 35px, 가운데 글자 12px muted, 좌우 여백 84px(신호등 자리), 전체가 끌기 영역
div.update         .update-bar(min-height 28, .msg + .btn 1/9 여백 11.5px) · .update-note(맥만)
footer.status      24px, 글자 11.5px. .status-usage > .limit(.lbl .bar 56px .pct)
nav.act            button 52×52 (s·xs 44×42): svg 22 + span 9.5px, .on = 왼쪽 2px 막대
```

### 첫 실행·확인 대화상자 (`first-run.ts`, `command-runner.ts`, `git-common.ts`)

```
.veil(fixed, 검정 투명) > .dialog(카드, max 480; .wizard 520) : b 제목 · p · ul · .btns[.btn.primary / .btn.sec]
```

## 3. 측정한 부품 치수 (폭 1100, 글자 가운데 맞춤 기준)

### 버튼 (`button.btn` 계열)

| 쓰는 곳 | 클래스 | 높이 | 안쪽 여백 위/오/아래/왼 | 글자 |
|---|---|---|---|---|
| 허락 카드 「거절」「한 번만 허락」 | `.btn.danger` / `.btn.primary` | 25.4 · 30.4 | 3/10/3/10 | 12 |
| git 머리 fetch · pull · PR 열기 | `.btn.sec` | **30.4** | 3/10/**8**/10 | 12 |
| git 머리 push (같은 줄) | `.btn.primary` | **25.4** | 3/10/3/10 | 12 |
| git 「다시 읽기」 | `.btn.sec.gfillbtn` | 30.4 | 3/10/**8**/10 | 12 |
| 할 일 「＋ 새 할 일」 | `.btn.primary` | 25.4 | 3/10/3/10 | 12 |
| 할 일 폼 「취소」 | `.btn.sec` | 30.4 | 3/10/**8**/10 | 12 |
| 규칙 「규칙 더하기」 | `.btn.primary` | 29 | 3/10/3/10 | 12 |
| 기록 「보이는 기록 복사」 | `.btn.sec` | 30.4 | 3/10/**8**/10 | 12 |
| 기록 상세 「마크다운으로 복사」「기록 지우기」 | `.btn.primary` / `.btn.sec.danger` | 20.7 | 1/8/1/8 | 11.5 |
| git 브랜치 행 「전환」「삭제」 | `.btn.sec` / `.btn.danger` | 19.9 | 1/8/1/8 | 11 |
| 명령어·설정 카드 「자세히」 | `.btn.sec` | 20.7 | 1/8/1/8 | 11.5 |
| git 커밋 | `.btn.primary` | 25.4 | 3/10/3/10 | 12 |
| git 「현재 브랜치에서 새로 만들기」 | `.btn.primary` | 28.8 | 3/10/3/10 | 12 |

같은 `.btn.sec`가 높이 **19.9 / 20.7 / 30.4** 세 가지다. 같은 줄 안에서도 `.btn.sec` 30.4와 `.btn.primary` 25.4가 섞인다(git 머리).

### 입력칸

| 쓰는 곳 | 높이 | 여백 | 글자 |
|---|---|---|---|
| 채팅 입력 textarea | 40 | 9/10 | 13 |
| 할 일·기록 검색 input, 규칙 input | 28.8 · 29 | 4/8 | 13 |
| git 커밋 제목 `.ginput` | 28.8 | 4/8 | 13 |
| 명령어 폼 input | 30.8 | 5/8 | 13 |
| 설정 숫자 input / select | 26.8 / 27 | 3/8 | 13 |
| 설정 팀 설정 select | 24.8~25 | 2/6 | 13 |
| 코드 검색 `.cs-input` | 26.1 | 3/7 | 12.5 |
| select (할 일·git) | 29 | 4/8 | 13 |

### 탭·칩·아이콘

| 부품 | 높이 | 비고 |
|---|---|---|
| 왼쪽 탭 버튼 | 42 (s·xs) / 52 | 글자 9.5px, 선택은 왼쪽 막대 |
| `.gtab` (git) | 30.8 | 13px, 5/12 여백, 밑줄 `--accent` |
| `.dtabs button` (팀 상세) | 30.8 | 13px, 5/10 여백, 밑줄 `--accentfg` |
| `.code-mode` | 25.9 | 11px, 밑줄 `--accent` |
| `.code-tab` / `.term-tab` | 35 / 30 | 13px / 12px |
| `.ltoggle button` | 1/9 여백 | 11px |
| `.chip` | 17.9 | 11px, 둥근 10 |
| `.rtag` (기록 필터, 버튼) | 20.7 | 11.5px, 둥근 10 |
| `.stripchip` (버튼) | 21.9 | 11px, 둥근 12 |
| `.code-ibtn` | 26×26 | 14px 글자 |
| `.code-x` | 18×18 | 14px |
| `.gx` | 17.6×20.3 | 14px |
| `.hand .go` `.keep` `.stop` (일 카드) | 16.7 · 16.7 · 19.9 | 링크형 / 테두리형 섞임 |

## 4. 어긋난 곳 목록

### A. 버튼 크기·글자 세로 위치

1. **`.sec` 이름 충돌이 글자를 위로 밀어 올린다.** `chat.css`의 `.sec { padding-bottom: 8px }`(설정 카드용)가 보조 버튼 `.btn.sec`에도 적용돼 안쪽 여백이 3/10/**8**/10이 된다. 높이 30.4에 글자가 가운데가 아니라 위쪽(위 3, 아래 8)에 붙는다. git 머리 `fetch·pull·PR 열기`, `다시 읽기`, 기록 `보이는 기록 복사`, 할 일 `취소`, 허락 카드 보조 버튼, 팀 상세 `← 메인`이 모두 해당. 사용자가 말한 "버튼 안 글자 위치가 안 맞는다"의 직접 원인이다.
2. 같은 줄에서 높이가 다르다: git 머리는 `.btn.sec` 30.4, `.btn.primary` 25.4. 허락 카드 줄은 `.btns`가 늘려 `.btn.primary`도 30.4로 커진다(글자는 위에 붙음).
3. 버튼 크기 단계가 사실상 6가지: 19.9 · 20.7 · 25.4 · 28.8 · 29 · 30.4. 글자는 11 · 11.5 · 12 세 가지. 이유는 탭마다 `padding: 1px 8px; font-size: 11.5px`(할 일 `.tbtns .btn`, 팀 설정 `.tmtop .btn`, 명령어 `.cmd .top .btn`, 규칙 `.rule .btn`, 코드 `.code-notice .btn`, 로그인 `.login-row .btn.sec`, 업데이트 `.update-bar .btn`, git `.gh .btn` 11px, `.gpanel .gf .btn` 11px)을 따로 덮어쓰기 때문이다.
4. `.btn`에 `line-height`가 없다. 줄 높이가 글자 크기 × 1.45(본문 상속)라 11→15.95, 11.5→16.675, 12→17.4로 제각각이고, 세로 가운데는 `padding` 대칭에만 기대고 있다.
5. `.btn.sec`에는 스타일이 없고(hover만) 기본 `.btn`과 같다. 즉 "기본/보조"가 구분되지 않는다. `.btn.danger`도 hover일 때만 빨갛다.
6. 버튼 글자색이 `color: inherit`라 `.ph`(muted)나 `.hand` 안에서는 연한 회색(157)이 된다(팀 상세 `← 메인`·`멈추기` 글자 157, 다른 곳 204).

### B. 색 체계

7. **git 머리: push만 파랑, fetch·pull·PR 열기는 회색**(`act(..., primary)`가 push에만 `true`). 변경 탭의 `커밋`도 파랑이라, 변경 탭에서는 push와 커밋 두 개가 동시에 파랗다. 어느 쪽이 지금 해야 할 일인지 구분이 없다.
8. 파란 강조 버튼이 한 화면에 여럿: 할 일 폼(`더하기`)+`＋ 새 할 일`, 규칙 여러 개의 `저장`, 허락 카드 `한 번만 허락`+토스트 `정리 보기`.
9. 칩 색: `.chip.green/.red/.blue/.purple`은 글자색만 바뀌고 배경은 그대로 회색(`git.css`), `.chip.yellow`만 배경·테두리까지 바뀐다(`chat.css`). 같은 `.chip.yellow`가 두 파일에 따로 있다.
10. 토큰 밖 색이 CSS에 직접 박혀 있다: `#1b1b1b`(diff·보드 열·일 카드·명령 서식), `#2f2a1e #5b4d2e #231f16`(경고), `#17283a #0c2a44 #0e4f7f #1c2a38`(채팅/hunk), `#12261a #17301c #3a1d1d #2a1717`(diff), `#2a2d2e #222`(hover 두 가지), `#3fb27f #d9a441`(계정 줄), 코드 탭 git 표시 `#73c991 #c74e39 #e2c08d`가 `--green #89d185 / --red #f48771 / --yellow #e2c08d`와 다르다.
11. hover 색이 제각각: `.btn.sec:hover` 파랑 테두리, `.btn.danger:hover` 빨강 테두리, `.tree-row:hover #2a2d2e`, `.ri:hover #222`, `.code-ibtn:hover #ffffff14`, `.gf:hover var(--card)`.

### C. 탭·칩·아이콘 버튼 모양

12. "탭" 모양이 7가지: 왼쪽 막대, `.gtab`(5/12, 13px, `--accent` 밑줄), `.dtabs`(5/10, `--accentfg` 밑줄), `.code-mode`(4/6, 11px), `.code-tab`(높이 35, 위 `--accent` 선), `.term-tab`(30, 밑줄), `.ltoggle`(채움 `--sel`).
13. 칩 모양: `.chip`(17.9, 11px), `.rtag`(20.7, 11.5px), `.stripchip`(21.9, 11px, 둥근 12), `.tree-tag`, `.cs-count`, `.cs-opt`가 서로 다른 높이·글자·반지름.
14. 아이콘 버튼 크기: `.code-ibtn` 26×26, `.code-x` 18×18, `.gx` 17.6×20.3, `.cs-opt` 26×26.1. 링크형 텍스트 버튼(`.hand .go`, `.hand .keep`, `.code-link`)도 각자 정의.
15. 입력칸 높이 24.8~40까지 8종(위 표). 같은 줄에 버튼과 나란히 놓일 때 높이가 안 맞는다(git `다시 읽기` 30.4 옆 input 28.8, 명령어 폼 30.8).

### D. 같은 이름 CSS 충돌

16. `.sec`: 설정 카드(`padding-bottom:8px`) ↔ 보조 버튼 `.btn.sec` (위 1번).
17. `.term`: 코드 탭 터미널 칸(`flex:none; max-height:60%; border-top; position:relative`) ↔ 팀 상세 `.dbody.term`(로그 글꼴). 후자도 전자의 규칙을 같이 받는다.
18. `.dim`: `git.css`(muted) · `data-tabs.css`(dim #6e7681) · `.cmd-help .dim` · `.code-empty .dim` · `.cs-path .dim` · `.qo-row .dim`. 로드 순서상 `data-tabs.css`가 이겨 전역 `.dim`은 더 어두운 색이다.
19. `.pad`: `git.css`(14px) ↔ `chat.css`의 `.hint.pad, .dim.pad`(4px 10px).
20. `.tg`(토글 라벨) 정의가 `commands.css`·`data-tabs.css`에 각각, `.row`는 `.ruleform .row`·`.cmdform .row`·`.rule .row`에 각각, `.err`는 전역 + `.ruleform .err` + `.cmdform .err` + `.rule .err`, `.hint`는 `.ph .hint`·`.composer .hint`·`.rfoot .hint`·`.todo .rhead .hint`로 흩어져 있다.
21. `.sp`: 픽셀 캔버스(`canvas.sp`) ↔ `.code-status .sp`(상태줄 칸) ↔ `.tmtop .sp`(팀원 그림).
22. `.note`: 허락 카드의 입력칸(`.approval .note`) ↔ 코드 알림 줄(`.code-notice .note`).
23. `.btns`: 대화상자(오른쪽 정렬) ↔ 허락 카드(왼쪽, 줄바꿈)는 같은 이름에 다른 정렬.

### E. 간격·글자 크기

24. 간격이 4·5·6·7·8·9·10·11·12·14·16 등 11가지로 섞여 있다(예: 카드 패딩 7/9, 9/11, 6/9, 5/9, 8/10, 12). 단계가 없다.
25. 글자 크기: 9.5 · 10 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 · 13.5 · 14 · 15 · 16 (12가지).
26. 카드/목록 행: `.pane` 카드(둥근 6, 테두리), `.rule/.cmd/.tm/.repo/.tcard`는 안쪽 카드(둥근 6, `--card`), `.rrow`(둥근 4), `.ri`(둥근 0, 밑줄) 등 모양이 다 다르다.

### F. 맥 제목줄

27. 제목줄(35px)은 `grid-row: 1`이고 본문은 3행이라 겹치지 않는다. 토스트는 `bottom:34px`(상태 줄 위) 고정이고, 폭 720 이하에서는 `top: calc(var(--titlebar-h) + 44px)`로 제목줄을 피한다. 코드 탭 탐색기 겹침판(`position:absolute; top:0`)은 `.code` 안이라 제목줄과 무관하다. 맥 실기 확인은 못 했다.

## 5. 고친 뒤 (같은 날 재측정)

측정기를 폭 4단계 전부(1700·1100·720·600)와 18개 장면에서 다시 돌렸다. 창 크기와 화면의 폭 단계(`data-tier`)가 둘 다 바뀐 것을 확인한 뒤 쟀다(처음 조사의 일부 장면은 창 크기가 덜 바뀐 채 재졌을 수 있어, 위 2~4절의 폭별 "넘침 0건"은 이 5절 결과로 대체한다).

- 규칙 위반 0건: 모든 `.btn`이 높이 28(`sm` 24, `lg` 32)이고 위아래 여백 0, 글자는 flex 가운데. 탭 32/28, 칩 20, 입력칸·select 28/24. 가로 스크롤·창 밖 넘침 0건(가로로 밀어 보는 방 목록·파일 탭 줄은 제외).
- 측정기 `scripts/measure-ui.cjs`는 이 규칙을 `check()`로 검사하고 화면 콘솔 오류(CSP 포함)도 모은다.
- 어긋난 곳 처리: A1~A6 버튼(`.sec` 충돌, 6가지 높이, line-height) 해결 · B7 git 강조는 `primaryGitAction()`으로 하나만 · B9~B10 칩 색·토큰 밖 색은 토큰/허용 목록 · C12~C14 탭·칩·아이콘 버튼은 `tab`·`chip`·`btn icon` · D16~D23 이름 충돌은 공통 이름을 ui.css 한 곳에서만 정의하도록 spec 검사 · E24~E25 간격·글자는 단계 토큰.
- 남은 것: 코드 탭 전용 밀집 부품(`tree-row` 22, `code-tab` 35, `term-tab` 30, `.ri` 기록 행)은 VS Code 규격이라 따로 둠. 글자 크기 10·10.5·12.5 일부가 코드 탭·캐릭터 말풍선에 남음. 첫 실행 마법사는 가짜 팀 실행에서 건너뛰어 측정하지 못함(같은 `.dialog`+`.btns` 부품). 맥 실기 확인 못 함.

## 6-1. API 탭 (2026-11-11, `api-view.ts`, `api-editor.ts`, `api-response-view.ts`, `api-tree.ts`, `api-parts.ts`, `api-env-dialog.ts`, `api.css`)

왼쪽 목록(Requests: 컬렉션·기록, Import) | 가운데 이름 줄(Save)·주소 줄(메서드·주소·Send↔Cancel)·편집기(Params·Headers·Auth·Body) | 응답 칸(상태 칩·시간·크기·Body/Headers·복사). 환경 선택 옆 Manage 가 환경 창을 연다. Send 단추는 누른 뒤 같은 자리에서 Cancel 이 되므로 `data-repeat-ok` 로 연타 막기에서 뺀다(그렇지 않으면 450ms 안의 Cancel 이 삼켜진다). 폭 440~1700 에서 측정 장면 5개(api·api-failed·api-list·api-env·api-import) 위반 0건.

## 6-2. DB 탭 (2026-11-11, `db-view.ts`, `db-table.ts`, `db.css`)

머리줄(이름 · Read-only/Write mode 칩 · 열린 파일 경로 · Write mode 체크) → 한계 안내 한 줄 → 경고 줄(Write mode 일 때) → 몸: 왼쪽 `.pane`(Files: 경로 입력·Add·Browse…, 파일 목록 / Tables 목록) | 가운데 `.pane`(`.tabs` Schema·Rows·SQL → 칸). Rows 는 도구줄(Prev·Next·쪽 표시·Export CSV·Refresh) + 표(`.tbl`, 300행씩 그리고 Show more), SQL 은 CodeMirror 편집기 + 도구줄(Run 만 강조 · Cancel · 시간 제한 · Ctrl+Enter) + 결과 줄 + 표. 좁은 폭(xs)에서는 몸이 세로로 쌓이고, 표는 칸 안에서만 가로로 밀린다. 부품은 모두 ui.css 것이고 db.css 는 배치만 정한다.

## 6. Docker 탭 (2026-11-11)

머리줄(이름 · Connected/Not running 칩 · 엔진·CLI 버전 · Refresh) → 한계 안내 한 줄 → 엔진 문제 카드(꺼짐·CLI 없음일 때만, 이유·해결·설치 링크) → `.tabs`(Containers·Images·Volumes·Networks·Compose) → 도구줄(컨테이너만: 검색·상태 칩) → 목록 `.pane`(표 `.tbl`, 좁으면 Image·Ports·Created 열을 접는다) → 로그 `.pane`(최근 N줄·Refresh·Copy·한 줄 명령). 부품은 모두 ui.css 것이고 docker.css 는 배치만 정한다. 폭 440·600·720·1100·1700 에서 가짜 docker(목록·꺼짐·삭제 확인 창 장면) 측정 위반 0건. 왼쪽 막대에서 'Docker' 6자는 잘리지 않는다. 실제 Docker 엔진으로는 확인하지 못했다.
