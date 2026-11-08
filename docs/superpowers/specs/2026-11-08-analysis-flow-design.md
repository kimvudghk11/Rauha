# 분석 흐름: 조사 → 방향 비교 → 설계 → 계획 → 승인하면 구현

2026-11-08 · 상태: 구현 중 · `2026-11-08-engine-speed-usage-design.md` 4.3절의 구체화

## 1. 왜

사용자는 보통 분석을 먼저 하고, 그 분석을 바탕으로 코드를 고친다. 지금 분석(`debug`·`risk`)은 팀원 호출 한 번에 자유 글 하나로 끝난다(`company-desk.ts`의 `analyze`). 그래서

- 고치기 직전에 필요한 "방향 여러 개 비교", "설계", "단계별 계획"이 없다.
- 사용자가 AI 추천이 아닌 다른 방향을 봤는지가 어디에도 남지 않는다. 기록 탭의 "방향 비교"(`shared/record-book.ts`의 `Direction`)는 `recordInputOf`가 늘 `null`을 넣어서 비어 있다(`team-work.ts`의 `quietUser`가 아무것도 묻지 않기 때문).
- 분석이 끝난 뒤 "고쳐줘"를 다시 말하면 접수부터 처음부터 다시 파악한다.

목표는 brainstorming(방향 비교·설계)과 writing-plans(단계별 계획) 수준의 결과물이 **마크다운 문서로 저장소에 남고**, 사용자가 방향을 직접 고르고, 승인하면 그 계획이 그대로 기존 BDD/TDD 작업 루프의 입력이 되는 것이다.

## 2. 조사 (읽은 것, 사실만)

| 사실 | 근거 |
|---|---|
| 라우터 mode `debug`/`risk`는 `CompanyDesk.analyze`로 가서 팀원 1회 호출, 결과는 `{answer, files}` 하나 | `chat-session.ts:233,237`, `company-desk.ts:62-70`, `schemas.ts` ANALYSIS_SCHEMA |
| 작업(`work`)은 `design` 인자(문자열 블록)를 받아 접수 팀장 입력에 `<design>`으로 싣는다 | `chat-session.ts:291`, `minimal-loop.service.ts:482` |
| 기능 요청의 설계 대화는 이미 질문·승인 포트(`discuss`, `approve`)를 가진다. 그러나 데스크톱은 둘 다 "그만두기"로 막아 둔다 | `design.service.ts`, `compose.ts:135` |
| 허락 카드는 `Approvals` 창구 → `ApprovalView` → `chat-view.ts`의 `approvalCard`로 간다. 작업을 멈추면 `closeJob`이 거절로 닫는다 | `approvals.ts`, `approval-view.ts`, `chat-view.ts:392` |
| 데스크톱의 `UserPort`는 `quietUser`(`interactive:false`) | `team-work.ts:28` |
| 기록의 `Direction{recommended, chosen, reason}`과 `divergedFromAi()`·기록 화면·마크다운 내보내기는 이미 있다. 채우는 쪽만 없다 | `record-book.ts:114,281`, `record-input.ts:26`, `records-view.ts:249` |
| 작업 루프는 작업 트리에 모르는 커밋 안 한 파일이 있으면 `DIRTY_WORKTREE`로 거절한다. 세션이 남긴 파일(`carried`)만 예외 | `workspace-state.ts` |
| 문서 팀원의 쓰기 범위는 `docs/**`, `CHANGELOG.md`, `README.md` | `write-policy.ts` writer |
| 데스크톱 작업은 같은 레포에 두 번째로 오면 worktree에서 일한다. 기억·지식은 원래 레포 키(`keyRoot`) | `main.ts`, `compose.ts` |
| 라우터는 haiku, 프롬프트는 `prompts/router.md` | `role-settings.dto.ts`, `schemas.ts` ROUTE_SCHEMA |

## 3. 방향 비교

| 안 | 내용 | 장점 | 단점·위험 | 되돌리기 |
|---|---|---|---|---|
| A. 한 번 호출 유지 + 스키마만 키우기 | 분석 호출 한 번이 조사·방향·설계·계획을 한꺼번에 낸다 | 호출 1번, 구현 작음 | 사용자가 중간에 방향을 고를 수 없다. 기록의 "방향 비교"를 채울 선택이 없다. 긴 출력 한 번이라 품질이 흐려진다 | 쉬움 |
| **B. 코어에 분석 컨텍스트를 두고 단계별로 호출, 방향·승인은 질문 카드로 (추천)** | 조사 1 → 방향 비교 1 → (사용자 고름) → 설계+계획 1 → (사용자 승인) → 작업 루프. 단계마다 문서에 이어 쓴다 | 사용자가 고른다. 선택이 기록된다. 단계마다 멈출 수 있어 한도를 아낀다. 카드는 기존 허락 창구를 재사용한다 | 코드가 가장 많다. 호출이 최대 3번(지금의 3배) | 중간 |
| C. 데스크톱이 단계마다 별도 작업(Job)으로 돌린다 | 조사 작업이 끝나면 "방향 비교" 작업을 새로 만든다 | 코어를 안 고친다 | 터미널·데스크톱이 달라진다. 단계 사이에 맥락을 문자열로 다시 실어야 한다. 작업이 여럿이라 팀 방이 어지럽다 | 쉬움 |

**AI 추천: B.** 사용자가 이미 4단계 흐름과 질문 카드를 요구했고(4.3절), A는 선택을 만들 수 없고 C는 맥락이 흩어진다.
사용자가 다른 방향을 고르거나 직접 쓸 수 있다. 이 문서 자체도 같은 방식으로 정했고, 이 절이 "다른 방향도 봤다"는 기록이다.

## 4. 설계 (B)

### 4.1 목표 / 비목표

목표
- 분석·조사·"어떻게 할지 비교" 요청만 새 흐름을 탄다.
- 각 단계 산출물을 `docs/analysis/YYYY-MM-DD-<주제>.md` 한 파일에 단계별 절로 이어 쓴다.
- 방향은 AI 추천을 표시하되 사용자가 다른 방향을 고르거나 직접 쓸 수 있다(질문 카드).
- 선택(AI 추천 vs 사용자 선택, 이유 한 줄)은 기록 탭 `Direction`으로 간다.
- "이대로 고치기"를 누르면 계획이 `work(..., design)` 블록으로 넘어간다.
- 설정에서 끌 수 있다(`analysisFlow`). 끄면 지금의 한 번 호출 분석 그대로.

비목표
- 가벼운 질문(light)과 작은 수정 요청(`work`)은 이 흐름을 타지 않는다.
- 단계 중간에서 앱을 껐다가 이어서 하기(문서는 남지만 자동 재개는 하지 않는다).
- 계획의 단계마다 작업 루프를 따로 돌리기(한 번에 넘긴다).
- 설계 팀원과 여러 번 대화하기(기능 요청의 기존 설계 대화는 그대로).

### 4.2 모양 (DDD)

새 컨텍스트 `packages/core/src/analysis/{domain,application,infrastructure}`.

- `domain/analysis-reach.ts` 값 객체. 어디까지 갈지(`investigate`·`compare`·`plan`). 요청이 분석 흐름 대상인지(`requested`), 한도가 빠듯하면 줄이는 규칙(`limitedBy`).
- `domain/investigation.ts` 값 객체. 확인한 사실(근거 파일 필수), 원인 후보(확신도), 모르는 것. `areas()`가 "짚은 영역 수"를 센다.
- `domain/direction.ts` 값 객체. `DirectionSet`은 방향 2~4개에 추천이 정확히 하나. `choose()`가 `DirectionChoice`(추천·선택·직접 쓴 것·이유, `divergedFromAi()`)를 만든다.
- `domain/blueprint.ts` 값 객체. 설계와 단계별 계획. 단계마다 "먼저 쓸 테스트"·"바꿀 파일"·"확인 명령"이 비면 거절한다.
- `domain/analysis-run.ts` 엔티티(애그리거트 루트). 단계 전이 규칙, `next()`가 다음에 할 일을 알려 준다. 설계 모델 등급(`designTier`)·큰 변경 판정도 여기.
- `domain/analysis-doc-path.ts` 값 객체. 폴더 고르기(`docs/analysis` 우선), 날짜-주제 이름, 이미 있으면 `-2`.
- `application/dto/*` 모델 출력 검증(`from`)과 문서 만들기(`toMarkdown`). 서비스는 불러오기→메서드→저장만.
- `application/analysis.service.ts` 얇은 조정자. 팀원 호출, 사용자 카드, 문서 저장을 차례로 부른다.
- `infrastructure/file-analysis-docs.ts` 파일 쓰기. 새 파일은 `wx`로만 만들고, 고쳐 쓰기는 내가 만든 표지(`<!-- rauha-analysis:<id> -->`)가 있는 파일만.

### 4.3 데이터 흐름

```
라우터 → mode debug/risk (+ reach)
  └ analysisFlow 켜짐 && AnalysisReach.requested(입력)  → AnalysisService.run
        1 조사        debugger|riskchecker  sonnet·medium   → 문서 §1 쓰기
        2 방향 비교   같은 팀원              sonnet          → 문서 §2 쓰기 → [카드: 방향 고르기]
        3 설계+계획   designer              sonnet·high (큰 변경만 opus) → 문서 §3·§4 → [카드: 이대로 고치기]
        5 승인        ChatSession.work(요청, design=계획 블록)
```

- 3과 4(설계, 계획)는 한 호출에서 나온다. 같은 입력을 두 번 읽는 비용을 아끼기 위해서다. 문서에는 절이 따로 있다. 대신 사용자 승인은 설계+계획을 함께 보고 한 번에 한다.
- 팀원 호출은 상태가 없어서(`TeamMemberPort.run`) "같은 프로세스에서 이어 가기"는 못 한다. 대신 1·2는 같은 앞부분 블록을 같은 순서로 보내 프롬프트 캐시가 맞게 한다.
- 호출 수: 조사에서 멈추면 1회(지금과 같다). 끝까지 가면 최대 3회 + 구현.
- 화면(`interactive` 카드 포트)이 없으면(`-p`, 터미널) 방향 비교까지만 하고 추천·대안과 문서 위치를 알린다. 사용자 선택 없이 설계로 가지 않는다(4.3절 "하지 않을 것").

### 4.4 약점 점검과 반영

| 약점 | 어떻게 막나 |
|---|---|
| 질문 무한 대기 | 카드마다 대기 한도(30분). 지나면 카드를 닫고 그 단계에서 멈춘다. 추천을 자동 채택하지 않는다(한도를 쓰지 않으려고). 문서는 거기까지 남는다 |
| 사용자가 답을 안 함 | 위와 같다. 작업 카드는 "내 선택 기다림" 상태로 보인다(`report.waiting`) |
| 중단(멈추기, 앱 종료) | 멈춤 신호가 팀원 호출을 끊고(`blocked: cancelled`), `closeJob`이 열린 카드를 닫는다. 거기까지의 문서는 남는다. 닫힌 카드는 기록에 선택으로 남기지 않는다 |
| 한도 소진 | 호출이 막히면(`blocked`) 그 단계에서 멈추고 풀리는 시각을 알린다. 시작할 때와 사용자를 기다린 뒤 다음 단계 전에 한도를 다시 본다: 90% 이상이면 조사까지만, 70% 이상이면 설계 모델을 opus로 올리지 않는다 |
| 문서 덮어쓰기 | 새 파일은 `wx`(있으면 실패)로만. 이름이 겹치면 `-2`, `-3`. 이어 쓰기는 내 표지가 있는 파일만, 없으면 거절. 쓸 수 있는 곳은 `docs/**/*.md`뿐(`WritePolicy` writer와 같은 범위) |
| 모델이 형식을 못 맞춤 | 검증 실패 이유를 달아 한 번만 다시 부르고, 그래도 안 되면 그 단계에서 멈춘다. 이미 쓴 문서는 남긴다 |
| 승인 뒤 작업이 `DIRTY_WORKTREE`로 거절 | 방금 쓴 분석 문서를 세션이 남긴 파일(`carried`)로 등록한다 |
| 비밀 | 프롬프트가 비밀 값을 문서에 넣지 말라고 한다. 문서에 찍기 전 DTO가 흔한 비밀 모양(키·토큰)을 `[값 가림]`으로 바꾼다 |
| 같은 카드에 두 번 답 | 창구는 처음 답만 받는다(이미 그렇다) |
| 새 흐름이 가벼운 질문을 삼킴 | 라우터 분류는 `debug`/`risk`만, 그 안에서도 분석 낱말이 있는 요청만(`AnalysisReach.requested`). 나머지는 지금 길 그대로. 아래 5.1에 spec으로 고정 |

### 4.5 모델·호출 비용

- 조사·방향 비교: debugger/riskchecker(sonnet·medium). 조사에서 멈추면 지금과 같은 1회.
- 설계+계획: designer. 기본 sonnet·high(`forAssignment`). 큰 변경이면 opus: 영역이 셋 이상이거나(`Investigation.areas()`) 여러 저장소이거나 라우터가 feature로 본 경우. 한도가 빠듯하면(`SessionBudget.saving`) 올리지 않는다. 이 사다리는 `RoleSettingsDto.forAssignment`를 그대로 쓴다.
- 환경 변수로 모델을 고정한 역할(`RAUHA_ROLE_*`)은 그대로 따른다.

### 4.6 기록 연결

카드의 답이 돌아오면 데스크톱이 `JobTrail.direction(jobId, …)`에 `{recommended, chosen, reason}`을 둔다. `recordInputOf`가 이를 `RecordInput.direction`에 넣는다. 그러면 기록 탭 "AI 추천과 다르게 골랐어요" 표시와 내보내기가 채워진다. 이유는 사용자가 적은 한 줄이고, 없고 추천대로 골랐으면 AI의 추천 이유를 쓴다. 작업이 끝난 뒤 자동으로 닫힌 카드(멈춤)는 선택으로 남기지 않는다.

### 4.7 테스트 전략

- 도메인: 엔티티·값 객체를 목 없이 직접 만들어 규칙 문장 이름으로 spec. (도달 범위, 방향 수·추천 하나, 계획 단계 필수 칸, 단계 전이, 문서 이름 겹침)
- 서비스: 가짜 팀(`FakeTeam`, 미리 정한 출력), 가짜 사용자 포트, 메모리 문서 저장소. 실제 Claude 호출 없음. (끝까지 가기, 조사에서 멈추기, 다른 방향 고르기, 직접 쓰기, 시간 초과, 막힘, 형식 실패 재시도)
- 세션: 가짜 `analyst`로 라우터 분류가 새 흐름을 타는 경우·안 타는 경우를 고정.
- 데스크톱: 창구(질문 카드 답·닫기), 기록 입력(선택 → `Direction`), 설정 파싱, 카드 화면 문자열. 화면은 `RAUHA_SMOKE_SHOT` 숨김 모드에서 `executeJavaScript`로 글자 확인.

## 5. 단계별 계획

각 단계는 작은 커밋이고, 끝날 때 `yarn typecheck`·`yarn test`.

| # | 일 | 먼저 쓸 spec | 확인 |
|---|---|---|---|
| 1 | 도메인: `AnalysisReach`, `Investigation`, `DirectionSet`/`DirectionChoice`, `Blueprint`, `AnalysisDocPath` | 각 `*.spec.ts` | 도메인 spec 통과 |
| 2 | 도메인: `AnalysisRun`(전이·다음 할 일·설계 등급) | `analysis-run.spec.ts` | 전이 spec 통과 |
| 3 | 응용: 스키마, DTO(`from`/`toMarkdown`), `AnalysisService`, 파일 저장소 | `analysis.service.spec.ts`, `file-analysis-docs.spec.ts` | 가짜 팀으로 단계·카드·시간 초과·막힘 spec |
| 4 | 세션: 라우터 `reach`, `ChatSession`이 분석 흐름 호출, 문서 `carried`, `TurnOutcome 'analysis'`, 프롬프트, CLI 출력 | `route.dto.spec`, `chat-session.spec` | 라우터 분류 고정 spec |
| 5 | 데스크톱 main: 질문 창구, `user.analysis`, 기록 연결, 설정, 가짜 팀 | `approvals.spec`, `record-input.spec`, `settings.spec`, `team-work.spec` | 기록 Direction이 채워짐 |
| 6 | 데스크톱 화면: 질문 카드, 설정 토글 | `ask-card.spec` | 숨김 모드 `executeJavaScript`로 글자 확인 |
| 7 | `docs/desktop-guide.md` | — | — |

## 6. 못 하는 것·위험

- 실제 Claude로 끝까지 돌려 보지 않는다(한도). 모델 출력의 품질과 프롬프트 효과는 이 문서 기준으로 확인되지 않았다.
- 분석 문서는 저장소 안의 새 파일이라 커밋하기 전까지 작업 트리를 더럽힌다. 같은 세션에서 바로 구현하면 `carried`로 풀리지만, 나중에 새 요청으로 고치면 먼저 커밋하라는 안내가 나올 수 있다(문서 팀원이 쓴 문서도 같다).
- 분석을 중간에 멈추면 자동 재개는 없다. 문서 경로를 말해 새로 시키면 된다.
