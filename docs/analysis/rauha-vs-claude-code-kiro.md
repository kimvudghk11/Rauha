# rauha가 Claude Code·Kiro보다 부족한 점 분석

- 작성일: 2026-10-25
- 대상: 저장소 현재 상태(`packages/`, `prompts/`, `docs/design/claude-team-design.md`)와 설계 의도
- 목적: 지난 세션의 "부족한 점" 요약을 항목별로 풀어 쓴다. 각 항목은 비교 대상, 근거, 영향, 개선 방향을 적는다.

## 읽는 법

- **근거 표기**: `경로:행`은 저장소 파일에서 직접 열어 확인한 내용이다. "설계서"는 `docs/design/claude-team-design.md`의 해당 문단이다.
- **외부 기능 표기**: Claude Code 기능은 2026-10-25에 `code.claude.com/docs/en/sub-agents`, `code.claude.com/docs/en/hooks`를 WebFetch로 열어 확인한 것만 사실로 쓴다. Kiro 기능은 `kiro.dev/docs/specs/` 한 페이지만 확인했다.
- **확인하지 못한 추정**: 위 페이지에서 확인하지 못한 외부 기능 설명은 본문에 "확인하지 못한 추정"이라고 명시한다. 사실처럼 쓰지 않는다.
- **영향도·난이도**: 상·중·하 세 단계다. 영향도는 "이 부족함 때문에 일이 실패하거나 사람이 손으로 메우는 양", 난이도는 "rauha 구조를 얼마나 바꿔야 하는가"로 본다.

## 디자인 축

설계 문서와 코드 구조에서 나온 부족한 점이다.

### D1. 팀원 정의가 rauha 저장소 안에 고정되어 프로젝트별로 바꿀 수 없다

- **비교 대상**: Claude Code 서브에이전트. 프로젝트 전용 정의는 `.claude/agents/`, 사용자 전용은 `~/.claude/agents/`의 Markdown 파일이며 `model`, `tools` 필드로 팀원마다 모델과 도구를 정한다.
- **근거**: `packages/core/src/orchestration/infrastructure/prompt-library.ts:8`의 `const ROLES: readonly MemberRole[] = ['intake', 'tester', 'implementer', 'reviewer', 'router', 'answerer'];`와 `:20`의 "저장소의 기본 프롬프트 폴더". 프로젝트에서 읽는 것은 `packages/core/src/orchestration/infrastructure/agent-sdk-team-member.ts:62`의 `settingSources: ['project']`뿐이라 CLAUDE.md만 읽힌다. 모델 매핑은 `packages/core/src/index.ts:5`가 내보내는 `MODEL_ID` 상수에 있다.
- **영향**: 특정 프로젝트에만 필요한 팀원(예: 인프라 전용 검사, 언어별 관례 검사)을 추가하거나 기존 팀원의 프롬프트를 덮어쓰려면 rauha 소스를 고쳐야 한다. 다른 프로젝트에서 rauha를 쓸 때 설계서의 "프로젝트 CLAUDE.md를 따른다" 원칙이 CLAUDE.md 수준에서만 지켜진다(설계서 "개발 규칙" 문단).
- **개선 방향**: 프로젝트 루트의 `.rauha/roles/*.md`를 기본 프롬프트 위에 덮어쓰는 방식을 검토한다. 이름이 겹치면 프로젝트 파일이 우선한다. 모델 등급도 같은 파일의 머리말에 적게 하면 Claude Code의 `model` 필드와 같은 자리에 온다. 구현은 이 분석 밖의 별도 작업이다.

### D2. 설계서는 9개 팀을 말하지만 코드에는 6개 역할만 있다

- **비교 대상**: Kiro 스펙 워크플로. 스펙 하나가 요구사항(requirements), 설계(design), 작업(tasks) 세 단계로 나뉜다(`kiro.dev/docs/specs/` 확인).
- **근거**: 설계서 개요 문단은 "팀장 1명과 팀원 9개 팀"을 말한다. 설계서 "구현 순서" 문단의 체크박스 `- [ ] 각 팀원의 시스템 프롬프트 초안 작성`은 미완료다. 코드의 역할 목록은 `prompt-library.ts:8`의 6개뿐이고, 설계·문서·디버깅·인프라 역할은 없다.
- **영향**: 설계 팀(Opus)이 빠져 L급 작업이 설계 없이 구현으로 넘어간다. 문서 팀이 없어 변경 기록은 사람이 직접 써야 한다. 설계서의 승격 경로(시니어 → 디버깅 → 설계 자문)도 현재 코드에서는 완성되지 않았다.
- **개선 방향**: 설계서 순서대로 한 팀씩 붙인다. 가장 가까운 기존 역할은 `intake`(기획)이므로 먼저 `intake`의 출력을 설계서 기획 문단의 형식에 맞추고, 그다음 설계 팀을 추가한다. 역할 추가 순서는 설계서 "구현 순서" 1–5단계를 따른다.

### D3. 터미널 CLI만 있고 IDE 통합이 없다 (설계상 결정)

- **비교 대상**: Kiro. Kiro는 IDE 형태로 쓰는 것으로 알려져 있다.
- **근거**: 설계서 CLI 문단은 "이 툴은 터미널 CLI 하나로 만들고, VS Code 확장은 만들지 않는다"라고 적었다. 같은 문단은 `/open`과 터미널 하이퍼링크로 파일 위치를 연다고 한다.
- **영향**: 에디터 안에서 파일과 줄을 고르거나 팀원 변경분을 diff로 검토하는 흐름이 없다. 설계서도 "지금 보고 있는 코드" 파악을 `@` 지정과 git 신호에 기대고 있어, 에디터에서 보던 커서 위치는 전달되지 않는다.
- **확인하지 못한 추정**: Kiro가 IDE 형태라는 설명은 이번 분석에서 확인하지 않았다. 확인하지 못한 추정이다.
- **개선 방향**: 설계서가 이미 정한 대로 커서 위치가 필요해지는 시점에 VS Code 보조 확장을 추가 단계로 검토한다. 당장은 `/open`과 `파일:줄` 하이퍼링크를 쓰면 대부분 메워진다.

## 기능 축

실행 방식, 도구, 산출물에서 나온 부족한 점이다.

### F1. 독립된 작업을 병렬로 실행하지 않는다

- **비교 대상**: Claude Code 서브에이전트 병렬 실행. 공식 문서는 "For independent investigations, spawn multiple subagents to work simultaneously."라고 적는다(`code.claude.com/docs/en/sub-agents`, 2026-10-25 WebFetch 확인). 기본 동시 실행 한도는 20개로 요약되었다.
- **근거**: 설계서 개요 표의 주 파이프라인 행은 "정해진 순서대로 자동 진행"이다. 실제 흐름은 `packages/core/src/orchestration/application/minimal-loop.service.ts`에서 순차로 진행되며, `Promise.all`은 `:205`의 `const [baselineResults, intake] = await Promise.all([checks.runSuite(), this.intake(request, tally, context)]);` 한 곳뿐이다.
- **영향**: 여러 파일을 읽는 조사 작업을 작게 나눠도 시간이 직렬로 늘어난다. 설계서의 "작게 쪼갠다" 원칙이 토큰 절감에는 맞지만 시간 절감에는 이어지지 않는다.
- **개선 방향**: 읽기 전용 팀원(기획·조사)끼리는 병렬로 돌리고, 쓰기 범위가 겹치지 않는 구현 팀원만 병렬로 허용한다. 쓰기 범위는 work order의 `범위` 항목으로 확인한다.

### F2. 훅 이벤트를 두 개만 쓴다

- **비교 대상**: Claude Code 훅. 이벤트는 세션 시작·종료(`SessionStart`, `SessionEnd`), 턴(`UserPromptSubmit`, `Stop`), 도구(`PreToolUse`, `PermissionRequest`, `PostToolUse`), 서브에이전트(`SubagentStart`, `SubagentStop`), 압축(`PreCompact`) 등으로 나뉜다(`code.claude.com/docs/en/hooks`, 2026-10-25 WebFetch 확인). 공식 문서는 PreToolUse에 대해 "Before a tool call executes. Can block it"이라고 적는다.
- **근거**: `packages/core/src/orchestration/infrastructure/agent-sdk-team-member.ts:67-69`에 `PreToolUse: [{ hooks: [createToolGuard(`와 `PostToolUse: [{ hooks: [fetchLog.hook] }]`만 있다.
- **영향**: 팀원 종료 시점에 사용량이나 보고서를 기록하는 일은 `run()` 안에 묶여 있다. 세션 시작·종료에 맞춘 정리 작업(예: 프로필 상태 저장, 진행 중인 팀원 정리)을 훅으로 분리할 수 없어 코드를 직접 고쳐야 한다.
- **개선 방향**: `SubagentStop`과 `Stop`에 기록 작업을 옮기고, 훅 목록을 설정 파일에서 고를 수 있게 한다. 기존 `createToolGuard`는 그대로 둔다.

### F3. MCP 연동이 없다

- **비교 대상**: Claude Code와 Kiro의 MCP 지원. 이번 분석에서 두 제품의 MCP 문서는 열지 않았으므로 **확인하지 못한 추정**이다.
- **근거**: `packages/core/src`와 `packages/cli/src`의 `.ts` 파일에서 `mcp` 문자열을 검색했고 결과는 0건이었다(2026-10-25 실행). 도구 위험도 분류는 `packages/core/src/orchestration/domain/tool-risk.ts`에 있으며 MCP 도구 이름을 다루지 않는다.
- **영향**: 이슈 트래커, DB, 사내 문서 사이트를 팀원이 직접 읽거나 쓸 수 없다. 외부 정보가 필요하면 사람이 복사해서 넘겨야 한다.
- **개선 방향**: 팀원별 `tools` 목록에 MCP 도구 이름을 받을 수 있게 하고, `tool-risk.ts`의 분류에 MCP 도구를 추가한다. 쓰기 성격의 MCP 도구는 기본 `ask`로 둔다.

### F4. 잘못 고친 작업을 되돌리는 기능이 없다

- **비교 대상**: Claude Code의 되돌리기(체크포인트) 기능. 이번 분석에서 공식 문서로 확인하지 않았으므로 **확인하지 못한 추정**이다.
- **근거**: `packages/cli/src`와 `packages/core/src`의 `.ts` 파일에서 `rewind`, `checkpoint`, `undo`를 검색했고 결과는 0건이었다(2026-10-25 실행). 작업 시작 전 깨끗한 작업 트리를 요구하는 규칙은 `docs/superpowers/plans/2026-10-25-step1-minimal-loop.md`의 `DIRTY_WORKTREE` 항목(200행 근처)에 있다.
- **영향**: 구현 팀원이 엉뚱한 파일을 고친 뒤에는 사람이 `git`으로 직접 되돌려야 한다. 재시도 전 상태를 rauha가 보장하지 못해, 실패가 쌓이면 원인 파악이 어려워진다.
- **개선 방향**: 팀원 실행 전 상태를 `git stash` 또는 임시 브랜치로 기록하고, 실패 시 그 지점으로 되돌리는 명령을 추가한다. 기록은 기존 `requireClean` 검사와 같은 자리에 둔다.

### F5. 기획·설계 산출물이 사용자가 고칠 수 있는 파일로 남지 않는다

- **비교 대상**: Kiro 스펙. 스펙 하나가 `requirements.md`(또는 `bugfix.md`), `design.md`, `tasks.md` 세 파일을 만든다고 적는다(`kiro.dev/docs/specs/`, 2026-10-25 WebFetch 확인: "Every spec generates three key files that form the foundation of your specification:").
- **근거**: 설계서 "기획 (BDD)" 표의 출력 행은 "`.feature` 파일(Gherkin)"이다. 그러나 저장소 루트에 `features/`와 `docs/adr/` 디렉터리가 없다(2026-10-25 확인). 설계 팀도 코드에 없어(D2) 설계 노트가 만들어지지 않는다.
- **영향**: 나중에 "이 기능이 왜 이렇게 생겼는지"를 시나리오 파일로 추적할 수 없다. 사용자가 시나리오를 고치고 다시 실행하는 흐름도 없어, 요구사항 변경이 대화 기록에만 남는다.
- **개선 방향**: 기획 팀의 출력을 `features/*.feature`로 쓰고, 상태 머신이 그 파일을 확인받은 뒤에만 테스트 단계로 넘어가게 한다. 설계 노트는 L급에서만 `docs/adr/`에 쓴다.

### F6. 테스트 판정이 Vitest에 묶여 있다

- **비교 대상**: Claude Code는 셸 명령을 실행해 어떤 테스트 러너든 쓸 수 있다고 알려져 있다. 이 비교 대상 설명은 **확인하지 못한 추정**이다. Kiro의 테스트 처리도 확인하지 않았다.
- **근거**: `packages/core/src/orchestration/infrastructure/node-checks.ts:59`의 `return 'vitest' in deps || /\bvitest\b/.test(this.pkg.scripts?.['test'] ?? '');`와 `:68`의 "전체 테스트를 JSON reporter로 돌리는 명령(vitest일 때만)". 결과 해석은 `packages/core/src/orchestration/application/dto/vitest-report.dto.ts`가 맡는다.
- **영향**: Jest, pytest, 그 밖의 러너를 쓰는 프로젝트에서는 테스트 통과 여부를 코드가 판정하지 못한다. 설계서 원칙 3번 "판정은 코드가 한다"가 Vitest 프로젝트에서만 성립한다.
- **개선 방향**: 판정 결과를 `pass/fail/이름`의 공통 형식으로 바꾸고, 러너별 파서(DTO)를 프로젝트 설정으로 고르게 한다. 지금 Vitest 파서는 그대로 두고 하나 더 붙이는 것부터 시작한다.

## 우선순위 요약

| 항목 | 영향도 | 난이도 |
| --- | --- | --- |
| F1 독립 작업 병렬 실행 없음 | 상 | 상 |
| D2 설계서 9개 팀 중 6개 역할만 구현 | 상 | 상 |
| F4 되돌리기(체크포인트) 없음 | 상 | 중 |
| F5 기획·설계 산출물이 파일로 남지 않음 | 상 | 하 |
| D1 팀원 정의가 프로젝트별로 바뀌지 않음 | 상 | 중 |
| F2 훅 이벤트 두 개만 사용 | 중 | 중 |
| F3 MCP 연동 없음 | 중 | 상 |
| F6 테스트 판정이 Vitest에 묶여 있음 | 중 | 중 |
| D3 IDE 통합 없음 (설계상 결정) | 하 | 상 |
