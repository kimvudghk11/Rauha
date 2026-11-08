# 공통 UI 부품과 규칙

`packages/desktop/src/renderer/ui.css` 한 파일이 토큰과 부품을 정한다. 탭 CSS는 **배치**(어디에 놓을지: grid·flex·간격·너비)만 정하고, 버튼·입력칸·탭·칩·카드의 **겉모양**(높이·안쪽 여백·글자 크기·색)은 여기 것만 쓴다.
문제 목록과 측정값은 `ui-structure.md`. 규칙은 `ui-components.spec.ts`가 글자로 확인하고, 실제 숫자는 `packages/desktop/scripts/measure-ui.cjs`로 잰다.

## 토큰

색 기본값은 `styles.css :root`(VS Code Dark Modern)에 있다.

| 용도 | 토큰 | 값 |
|---|---|---|
| 배경 / 옆 막대 / 카드 / 입력칸 | `--bg --side --card --input` | #1f1f1f #181818 #252526 #313131 |
| 테두리 | `--border` `--border2` | #2b2b2b #3c3c3c |
| 글자 | `--text` `--bright` `--muted` `--dim` | #ccc #e7e7e7 #9d9d9d #6e7681 |
| 강조(파랑) | `--accent` `--accent-hover` `--accentfg` `--sel` | #0078d4 #026ec1 #4daafc #04395e |
| 상태 | `--green --yellow --red --purple` | #89d185 #e2c08d #f48771 #c586c0 |
| 경고 줄 | `--warn-bg` `--warn-border` | #2f2a1e #5b4d2e |
| 위험 | `--danger-bg` `--danger-border` | #3a1d1d #5a2d2d |
| 눌렀을 때 | `--btn-bg-hover` `--row-hover` `--ghost-hover` | #3a3a3a #2a2d2e #ffffff14 |

하늘색 `--delfi`는 Delfi 캐릭터 몸에만 쓴다(UI 강조색이 아니다).

| 단계 | 토큰 |
|---|---|
| 간격 4 · 8 · 12 · 16 · 24 | `--s1 … --s5` |
| 글자 11 · 12 · 13 · 15 (제목 16은 `.rhead b`만) | `--fs-xs --fs-sm --fs-md --fs-lg` |
| 조작 부품 높이 24 · 28 · 32 | `--h-sm --h-md --h-lg` |
| 모서리 4 · 6 · 8 · 알약 | `--r-sm --r-md --r-lg --r-pill` |

## 부품

### 버튼 `.btn`

높이는 고정, 안쪽은 `inline-flex`로 가운데 맞춤, `line-height: 1`, 위아래 여백 0. 그래서 글자가 위나 아래로 쏠리지 않고 같은 줄의 입력칸·탭과 높이가 같다.

| 종류 | 클래스 | 언제 |
|---|---|---|
| 보조(기본) | `btn` | 대부분의 버튼. 회색 |
| 강조 | `btn primary` | **한 화면(한 영역)에서 가장 중요한 한 동작만.** 파랑 |
| 위험 | `btn danger` | 지우기·거절·중단. 빨간 글자와 테두리 |
| 테두리 없음 | `btn ghost` | 머리줄의 부가 동작(멈추기 같은) |
| 크기 | `sm`(24) · 기본(28) · `lg`(32, 대화상자·한 칸 가득) | 카드·목록 행 안은 `sm`, 도구줄·폼은 기본 |
| 아이콘 | `btn icon`(정사각 28) · `btn icon sm`(24) | `+ × ↻ ☰ >_` |
| 글자만 | `link` | "git에서 보기", "진행 보기 →" |

`btn sec`는 쓰지 않는다(보조가 기본이다). 위치용 이름(`gfillbtn` 같은)은 붙여도 되지만 크기·색은 정하지 못한다.
disabled는 모두 같은 `opacity .45`.

### 입력칸

`input`(체크박스 제외)·`select`·`textarea`는 클래스 없이 같은 모양이다(높이 28, 좌우 여백 8, 글자 13, 포커스 시 파란 테두리). 카드 안 한 줄은 `class="sm"`(24, 글자 12). 터미널 입력과 빠른 열기 입력(`.term-input`, `.qo-input`)만 자기 칸에 박혀 있어 테두리를 그리지 않는다.

### 탭

`.tabs`(줄) 안에 `.tab`(`on`으로 선택, 밑줄 `--accent`). 높이 32, `tab sm`은 28. git 탭 줄, 팀 상세, 코드 탐색기 머리가 같은 부품이다. 배치 토글은 `.seg`.
왼쪽 탭 막대(`nav.act`)는 아이콘 막대라 따로 둔다(52×52, 좁으면 44×42).

### 칩

`.chip`(높이 20, 11px, 알약). 색은 의미를 따른다: `green`(좋음·앞섬) `yellow`(주의·뒤처짐) `red`(위험·보호) `blue`(정보) `purple`(분류). 모두 글자색과 옅은 배경·테두리가 같이 바뀐다. 누르는 칩은 `button.chip`(선택은 `on`).

### 카드와 목록

- 카드 `.pane`: 큰 영역 틀(`--bg`, 테두리, 모서리 6).
- 항목 `.item`: 카드 안 항목(`--card`, 안쪽 8/12, 모서리 6). `off`는 흐리게.
- 목록 행 `.row-item`: 높이 최소 28, hover `--row-hover`, 선택 `--sel`.

### 색 점·진행 막대·팝업 메뉴·표

- 색 점 `.dot`(+`blue green yellow red purple`, 기본 회색): 칸·라벨 색. 라벨은 `.chip`의 같은 색 이름을 쓴다.
- 진행 막대 `.meter > i`(너비는 `element.style.width`로만).
- 팝업 메뉴 `.menu > button`(+`.sep`, `.lbl`): `position: fixed`로 기준 요소 아래에 띄운다. 위험 항목은 `danger`.
- 표 `.tbl`: 머리 고정, 줄 hover `--row-hover`.

### 줄과 묶음

- 도구줄 `.bar`: 버튼·입력칸·칩이 가운데 정렬로 한 줄(간격 8). `.grow`, `.end`로 늘리기·오른쪽 끝.
- 버튼 묶음 `.btns`(오른쪽 정렬은 `.btns.end`).
- 경고 줄 `.notice`.

### 글자

`.dim`(`--muted`) · `.faint`(`--dim`) · `.hint`(12px muted) · `.err`(빨강) · `.lbl`(라벨) · `.mono`. 이 이름은 ui.css에서만 정의한다.

### 대화상자·알림·허락 카드

`.veil > .dialog`, `.toast`, `.approval`은 위 토큰만 쓴다(간격 8·12, 모서리 8, 버튼은 `lg`/기본). 대화상자 아래 버튼 묶음은 `.btns.end`.

## git 탭의 색 규칙

한 번에 강조되는 동작은 하나다. `shared/git-primary.ts`의 `primaryGitAction()`이 상태에서 정한다.

| 상태 | 강조(파랑) |
|---|---|
| 충돌이 있다 | 없음 (충돌 탭의 `해결됨`만 파랑) |
| 스테이지한 변경이 있다(머지 마무리 포함) | `커밋` |
| 커밋할 게 없고 머지 중이 아니고 원격보다 뒤처졌다 | `pull` |
| 커밋할 게 없고 머지 중이 아니고 원격보다 앞섰다 | `push` |
| 그 외 | 없음 |

fetch · PR 열기 · 다시 읽기 · 브랜치 이름 버튼은 항상 보조(회색).

## 새 화면을 만들 때

1. 버튼은 `btn`(+`primary`/`danger`/`sm`)만. 탭 CSS에 `.xxx .btn { padding … }`를 쓰지 않는다.
2. 간격은 `var(--s*)`, 글자는 `var(--fs-*)`를 쓴다.
3. 새 색이 필요하면 토큰을 ui.css·styles.css에 먼저 더한다.
4. `ui-components.spec.ts`가 통과해야 한다.
