# 엔진 속도·한도 빠른 개선 계획

**Spec:** `docs/superpowers/specs/2026-11-08-engine-speed-usage-design.md` (4.1 Q1~Q4, 4.2 W1~W2). 월요일(2026-11-09) 전 필수.

**목표:** "1+1은 얼마야?" 같은 사소한 질문이 저장소 훑기 없이 haiku 한 번 + 라우터 한 번으로 끝난다. 버려지는 호출이 0이다.

**규칙:** 실패하는 `*.spec.ts` 먼저. 규칙은 도메인(`Route`/`RouteDto`, `RoleSettingsDto`)에, `ChatSession`은 부르고 잇기만 한다. 데스크톱·CI 파일은 건드리지 않는다. 시그니처 변경은 기본값으로 호환한다.

## 단계

1. **light/deep 판정 (RouteDto)** — 스키마에 `depth: 'light' | 'deep'` 추가(기본 deep이라 필드 없는 옛 출력은 지금처럼). 인사·맞장구(`isSmallTalk`)는 라우터가 뭐라 하든 light. `prompts/router.md`에 판정 기준 한 줄.
   - spec: 라우터 출력에 depth가 없으면 deep / light면 light / 인사는 항상 light.
2. **light 답변 등급 (RoleSettingsDto)** — `lightAnswerer()`: haiku·low·6턴·읽기 도구(Read/Grep/Glob)만·웹·Bash 없음. 환경 변수로 answerer 모델을 고정했으면 그 모델을 따른다.
   - spec: light는 haiku 등급, 턴 6.
3. **저장소 지식은 저장돼 있는 것만 (KnowledgePort.stored)** — 선택 메서드 `stored()`: 저장소를 훑거나 조사 팀원을 부르지 않고 저장된 것만 읽는다. light 질문은 `stored()`만 쓰고(없으면 지식 없이 답), deep 질문도 `stored()`가 있으면 그것을 쓴다(없으면 기존 `current()`로, 옛 구현 호환).
   - spec: light 질문은 `current()`를 부르지 않는다 / 조사 팀원(surveyor)을 부르지 않는다.
4. **미리 시작 없애기** — `ChatSession.start`의 `team.prepare` 호출, 라우터와 동시에 답변을 시작하는 코드, 중단 신호(`early`)·`STOPPED`를 지운다. `looksLikeQuestion`도 쓸 곳이 없어 지운다. 답변 팀원은 라우터 판정이 끝난 뒤에만 부른다.
   - spec: `prepare` 호출 0 / 라우터가 끝나기 전에는 답변 팀원 호출이 없다.
5. **"더 깊게" 값 (`canGoDeeper`)** — light 답은 `answer` 결과에 `canGoDeeper: true`. `handle(input, also, 'deep')`는 라우터 없이 deep 질문 경로로 바로 가고 같은 질문 캐시를 건너뛴다. 데스크톱 버튼은 따로 붙인다.
   - spec: light 답은 canGoDeeper true, deep 답은 false, `force 'deep'`은 라우터를 안 부르고 sonnet이 답한다.
6. **조사는 답한 뒤 배경에서** — deep 답을 돌려준 뒤 세션당 한 번 `knowledge.current()`를 기다리지 않고 돌린다(실패는 삼킨다). light 답은 한도를 아끼려고 배경 조사도 부르지 않는다. 작업(코드 수정)은 지금처럼 하되 이 배경 조사는 한 번뿐이라 변경 파일마다 다시 돌지 않는다.
   - spec: 답을 먼저 돌려주고 그 뒤에 조사가 돈다 / 두 번째 deep 답에서는 다시 안 돈다.
7. **측정** — 고친 뒤 실제 호출 최대 4번("1+1은 얼마야?", "이 저장소 README가 뭐야?")으로 호출 수·모델·시간·세션 %를 엔진 설계 문서 "고친 뒤 측정"에 적는다. 세션 90% 넘으면 멈춘다. 달러 금지.

## 뒤로 미룸

- **검사 개선(W1·W2: 바뀐 곳만·셋 동시·전체는 리뷰 직전 한 번)**: `minimal-loop.service.ts`·`node-checks.ts`·`ChecksPort`를 건드리는 큰 변경이라 1~6 뒤로 미룬다. 시간이 남으면 `runSuite`의 세 검사를 동시에 돌리는 것부터.
- **분석 4단계(조사→방향 비교→설계→계획)**: 이번엔 구현하지 않는다. 설계는 스펙 4.3에 있다. 단계: ① 결과 schema 4종 ② 방향 고르기 사용자 입력 ③ 설계 팀원 연결(sonnet·high, 큰 변경만 Opus) ④ 계획이 `work(..., design)` 입력이 되게 잇기.
