# rauha 데스크톱 덩어리 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 터미널 대신 Electron 프로그램에서 메인(Delfi)에 일을 내리면, 메인은 막히지 않고 맡긴 일이 각자 동시에 돈다.

**Architecture:** 새 워크스페이스 `packages/desktop`(Electron main·preload·renderer)이 `@rauha/core`를 main 프로세스에서 돌린다. 화면은 preload가 연 좁은 IPC로만 main과 이야기한다. 동시 실행 규칙(작업 상태, 상한 3)은 core의 도메인 엔티티 `Job`·`JobBoard`에, 불러오기→메서드→알리기는 application 서비스 `JobRunner`에 둔다.

**Tech Stack:** Electron, esbuild(main·preload·renderer 번들), TypeScript, 바닐라 DOM(마일스톤 1). Yarn 4 workspaces(`nodeLinker: node-modules`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-rauha-desktop-design.md`

## Global Constraints

- yarn만 쓴다. npm·pnpm 명령 금지.
- core는 DDD: `domain / application / infrastructure`. domain은 Node API·SDK·파일을 import하지 않는다. 생성자 `private` + 정적 팩토리, setter 금지, 서비스에 도메인 `if` 금지.
- 규칙은 실패하는 `*.spec.ts`부터. 테스트 이름은 한국어 규칙 문장.
- 화면 어디에도 돈(달러)을 보이지 않는다. 한도는 %로만.
- 구독 토큰을 읽거나 옮기지 않는다. 계정은 `CLAUDE_CONFIG_DIR`로만.
- 색: VS Code Dark Modern 토큰(`--bg #1f1f1f`, `--side #181818`, `--card #252526`, `--border #2b2b2b`, `--border2 #3c3c3c`, `--text #cccccc`, `--bright #e7e7e7`, `--muted #9d9d9d`, `--dim #6e7681`, `--input #313131`, `--accent #0078d4`, `--accentfg #4daafc`, `--sel #04395e`, `--green #89d185`, `--yellow #e2c08d`, `--red #f48771`, `--delfi #6FBDEB`). 하늘색은 Delfi 몸에만.
- 동시 실행 상한 기본 3. 넘치면 대기.
- renderer는 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `packages/cli`는 마일스톤 6까지 지우지 않는다.

## Review Focus

1. 작업이 실패(예외)해도 다음 대기 작업이 시작된다 — 실패한 작업은 `stopped`, 자리가 빈다. (Task 2 테스트)
2. 작업을 멈추면(stop) 그 작업의 AbortSignal이 꺼지고 자리가 빈다. 이미 끝난 작업을 멈춰도 아무 일 없다. (Task 2 테스트)
3. 빈 입력·공백만 있는 입력은 작업이 되지 않는다. (Task 1 테스트)
4. 같은 id로 두 번 넣으면 거절한다(화면이 두 번 눌러도 작업이 둘이 되지 않음). (Task 1 테스트)
5. 창이 좁아져도(모니터 반쪽, 약 700px) 입력창과 상태 줄이 가려지지 않는다. (Task 4 확인 단계 — 마일스톤 5에서 4단계 배치로 완성)

---

## 마일스톤 개요

| M | 내용 | 끝났을 때 |
|---|---|---|
| **1** | Electron 틀, Dark Modern, 왼쪽 탭, 채팅 탭 메인 칸, 상태 줄 · core `Job`/`JobBoard`/`JobRunner` | 앱이 뜨고, 일을 여러 개 연달아 보내도 메인이 안 막히며 3개까지만 동시에 돈다(연습용 작업) |
| 2 | 실제 팀 연결: `ChatSession`을 메인 대화와 작업으로 나누기, 쓰는 작업은 레포별 git worktree, 팀 방(캐릭터·단계·로그) | 진짜 rauha 일을 동시에 맡기고 팀 방에서 본다 |
| 3 | 팀 상세(정리/원본 로그), 허락·알림: `tool-guard` 규칙 판정, 정리 카드, diff, 브랜치 영향(main·qa), 인프라 위험도 | 위험한 일만 알림이 오고, 정리를 보고 허락한다 |
| 4 | 규칙 탭(3칸, 범위, 말로 적기) · 작업 폴더 전체 읽기와 분류 · 레포 탭 | 내 규칙대로 묻고/안 묻고, 폴더 안 레포·문서가 목록에 뜬다 |
| 5 | 설정(계정·한도·알림·권한), 첫 실행, 창 크기 4단계 배치, 캐릭터 22개와 움직임, 아이콘 | 시안의 덩어리 1 화면이 모두 동작 |
| 6 | Windows 설치 파일, 설치 때 터미널 rauha 실행 파일 지우기, `packages/cli` 제거와 기능 이전 | 설치형 프로그램 하나만 남는다 |

마일스톤 2~6은 앞 마일스톤을 사용자에게 보여 준 뒤 이 문서에 태스크를 이어 쓴다.

---

## 마일스톤 1

### File Structure

- `packages/core/src/orchestration/domain/job.ts` — 작업 하나의 상태와 바꾸는 메서드
- `packages/core/src/orchestration/domain/job-board.ts` — 작업 모음, 상한, 다음에 시작할 작업
- `packages/core/src/orchestration/application/job-runner.ts` — 넣기·시작·끝·멈춤을 돌리고 바뀔 때 알린다
- `packages/core/src/jobs.ts` — 데스크톱이 SDK·sqlite 없이 가져갈 수 있는 좁은 입구(`@rauha/core/jobs`)
- `packages/desktop/` — Electron 앱
  - `src/main/main.ts` 창 띄우기, IPC 연결 · `src/main/demo-work.ts` 연습용 작업
  - `src/preload/preload.ts` `window.rauha` API
  - `src/shared/ipc.ts` IPC 채널 이름과 주고받는 모양
  - `src/renderer/index.html`, `styles.css`, `app.ts`, `tabs.ts`, `characters.ts`, `status-line.ts`
  - `scripts/build.mjs` esbuild 번들

### Task 1: `Job`과 `JobBoard` 도메인

**Files:**
- Create: `packages/core/src/orchestration/domain/job.ts`, `job-board.ts`
- Test: `packages/core/src/orchestration/domain/job.spec.ts`, `job-board.spec.ts`

**Interfaces:**
- Produces:
  - `type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'stopped'`
  - `class Job { readonly id: string; readonly request: string; readonly status: JobStatus; readonly queuedAt: string; readonly endedAt: string | null; readonly stopReason: string | null; static queue(p: { id: string; request: string; at: string }): Job | null; start(): Job; wait(): Job; resume(): Job; finish(at: string): Job; stop(reason: string, at: string): Job; get holdsSlot(): boolean; get isOver(): boolean }`
  - `class JobBoard { static empty(limit?: number): JobBoard; readonly limit: number; readonly jobs: readonly Job[]; add(job: Job): JobBoard; replace(job: Job): JobBoard; find(id: string): Job | null; startable(): readonly Job[]; counts(): { running: number; waiting: number; queued: number } }`
  - `DEFAULT_JOB_LIMIT = 3`

- [ ] **Step 1: 실패하는 테스트**
  - `Job.queue`: `'빈 요청이나 공백만 있는 요청은 작업이 되지 않는다'` → `Job.queue({ id: 'a', request: '  ', at })` 는 `null`. `'요청 앞뒤 공백은 지우고 대기로 시작한다'` → status `'queued'`, request trimmed.
  - 상태 바꾸기: `'대기 → 진행 → 끝'`(finish는 endedAt 기록), `'진행 중 기다림으로 갔다가 다시 진행한다'`, `'끝났거나 멈춘 작업은 다시 바뀌지 않는다'`(`stop` on done → 그대로 같은 값), `'대기가 아닌 작업은 시작할 수 없다'`(start on running throws).
  - `holdsSlot`: running·waiting은 true, queued·done·stopped는 false.
  - `JobBoard`: `'기본 상한은 3이다'`, `'진행 중이 상한보다 적으면 먼저 들어온 대기 작업부터 시작할 수 있다'`(대기 5개 → startable 3개, id 순서 a,b,c), `'기다리는 작업도 자리를 차지한다'`(running 2 + waiting 1 → startable 0), `'같은 id를 두 번 넣으면 거절한다'`(throws), `counts`.
- [ ] **Step 2:** `yarn test packages/core/src/orchestration/domain/job` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현. 값은 불변: 메서드마다 새 `Job`/`JobBoard`를 돌려준다(`LearningBook` 방식). 끝난 작업에 `stop`/`finish`는 자기 자신을 그대로 돌려준다. `start`/`wait`/`resume`의 잘못된 전환은 `Error`.
- [ ] **Step 4:** 같은 명령 → PASS
- [ ] **Step 5:** 커밋 `feat(core): 작업(Job)과 작업판 — 상한 3, 기다리는 작업도 자리를 차지한다`

### Task 2: `JobRunner` 서비스와 `@rauha/core/jobs` 입구

**Files:**
- Create: `packages/core/src/orchestration/application/job-runner.ts`, `packages/core/src/jobs.ts`
- Modify: `packages/core/package.json`(exports에 `"./jobs"` — `rauha-source: ./src/jobs.ts`, `types: ./dist/jobs.d.ts`, `import: ./dist/jobs.js`), `vitest.config.ts`(alias `@rauha/core/jobs` → `packages/core/src/jobs.ts`, `@rauha/core` 앞에)
- Test: `packages/core/src/orchestration/application/job-runner.spec.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `type JobWork = (job: Job, signal: AbortSignal) => Promise<void>`
  - `class JobRunner { static start(p: { work: JobWork; newId: () => string; now: () => string; limit?: number; onChange?: (board: JobBoard) => void }): JobRunner; submit(request: string): Job | null; stop(id: string): void; get board(): JobBoard; idle(): Promise<void> }`
  - `jobs.ts`는 `Job`, `JobBoard`, `JobRunner`, `DEFAULT_JOB_LIMIT`, 타입들만 다시 내보낸다.

- [ ] **Step 1: 실패하는 테스트** (작업은 테스트가 쥔 Promise로 끝을 조절한다)
  - `'일을 넣으면 끝나기를 기다리지 않고 바로 돌아온다'` — work가 안 끝나도 `submit`이 Job을 즉시 돌려주고 그 상태는 `running`.
  - `'네 번째 일은 앞의 일이 끝날 때까지 대기한다'` → 4개 넣으면 counts `{ running: 3, queued: 1 }`, 첫 work resolve 후 `idle()` 아닌 microtask flush 뒤 running 3·done 1.
  - `'일이 실패해도 멈춤으로 표시하고 다음 대기 일을 시작한다'` → reject(new Error('boom')) → status `stopped`, stopReason `'boom'`, 대기였던 일 running.
  - `'멈추면 그 일의 신호가 꺼지고 자리가 빈다'` → `stop(id)` 후 받은 signal.aborted true, status stopped, stopReason `'사용자가 멈춤'`.
  - `'끝난 일을 멈춰도 아무 일 없다'`.
  - `'빈 요청은 넣지 않는다'` → `submit('  ')` null, onChange 안 불림.
  - `'판이 바뀔 때마다 알린다'` → onChange 호출 수 ≥ 1, 마지막 인자 board.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 서비스는 판을 들고 `board.add` → `board.startable()` → 각각 `start`·`replace`·work 호출 → 끝나면 `finish`/`stop`·`replace` → 다시 pump. 상태 판단은 엔티티 메서드만 쓴다.
- [ ] **Step 4:** PASS, `yarn typecheck`
- [ ] **Step 5:** 커밋 `feat(core): 작업 돌리기 — 메인은 안 막히고 상한까지만 함께 돈다`

### Task 3: `packages/desktop` 틀 (Electron이 뜬다)

**Files:**
- Create: `packages/desktop/package.json`, `tsconfig.json`, `scripts/build.mjs`, `src/main/main.ts`, `src/main/demo-work.ts`, `src/preload/preload.ts`, `src/shared/ipc.ts`, `src/renderer/index.html`
- Modify: root `package.json` scripts에 `"desktop": "yarn workspace @rauha/desktop start"`

**Interfaces:**
- Consumes: `@rauha/core/jobs`의 `JobRunner`
- Produces (`src/shared/ipc.ts`):
  - 채널: `IPC.submit = 'job:submit'`, `IPC.stop = 'job:stop'`, `IPC.board = 'job:board'`(main→renderer push)
  - `interface JobView { id: string; request: string; status: JobStatus; stopReason: string | null }` · `interface BoardView { jobs: JobView[]; running: number; waiting: number; queued: number; limit: number }` · `function boardView(board: JobBoard): BoardView`
  - preload의 `window.rauha = { submit(text): Promise<JobView | null>; stop(id): void; onBoard(cb: (b: BoardView) => void): void }`

- [ ] **Step 1: 실패하는 테스트** `src/shared/ipc.spec.ts`: `'작업판을 화면용 모양으로 바꾼다 — 상태 수와 상한을 담는다'`.
- [ ] **Step 2–4:** 구현·PASS. `package.json`: name `@rauha/desktop`, `private`, `type: module`, `main: dist/main.cjs`, scripts `build: node scripts/build.mjs`, `start: node scripts/build.mjs && electron .`, `typecheck: tsc -p tsconfig.json --noEmit`; deps `@rauha/core: workspace:^`; devDeps `electron`, `esbuild`, `typescript`, `@types/node`. `build.mjs`: main·preload는 `platform: node`, `format: cjs`, `external: ['electron']`, 조건 `rauha-source`; renderer는 `platform: browser`, `format: iife`; html·css 복사. tsconfig: base 확장, `lib: [ES2023, DOM]`, `customConditions: ['rauha-source']`.
  - 연습용 작업(`demo-work.ts`): 3~6초 기다렸다 끝난다. signal이 꺼지면 바로 멈춘다. 화면에 "연습용 작업"이라고 표시한다(마일스톤 2에서 진짜 팀으로 바꾼다).
- [ ] **Step 5:** `yarn install` 후 `yarn desktop` — 창이 뜬다. Yarn 4에서 electron postinstall(바이너리 내려받기)이 막히면 원인·해결을 커밋 메시지와 보고에 남긴다.
- [ ] **Step 6:** 커밋 `feat(desktop): Electron 틀 — core 작업판을 main에서 돌리고 IPC로 화면에 보낸다`

### Task 4: 화면 — 왼쪽 탭, 채팅 메인 칸, 상태 줄

**Files:**
- Create: `src/renderer/styles.css`, `app.ts`, `tabs.ts`, `characters.ts`, `status-line.ts`
- Test: `src/renderer/tabs.spec.ts`, `src/renderer/status-line.spec.ts`, `src/renderer/characters.spec.ts`

**Interfaces:**
- Produces:
  - `tabs.ts`: `TABS: readonly { id: TabId; label: string; ready: boolean }[]` — 순서 채팅·코드·할 일·기록·레포·명령어·규칙, 설정은 맨 아래(`bottom: true`). 덩어리 1의 M1에서 `ready`는 채팅만 true, 나머지는 "곧".
  - `status-line.ts`: `statusText(b: BoardView): string` — 예 `'진행 2 · 기다림 1 · 대기 0'`.
  - `characters.ts`: `type Sprite = { palette: Record<string, string>; frames: string[][] }`, `spriteFor(role: CharacterRole): Sprite`, `CharacterRole = 'delfi' | ...` — 지금은 시안 v3의 Delfi(깜빡임 프레임 포함)·거북·게·문어·복어 격자를 옮겨 둔다. 그림을 고르는 곳은 이 함수 하나뿐이다.

- [ ] **Step 1: 실패하는 테스트**
  - tabs: `'탭 순서는 채팅·코드·할 일·기록·레포·명령어·규칙이고 설정은 맨 아래다'`, `'지금은 채팅 탭만 열리고 나머지는 곧'`.
  - status: `'진행·기다림·대기 수를 한 줄로 쓴다'`, `'돈은 보이지 않는다'`(결과에 `$` 없음).
  - characters: `'모든 프레임의 줄 길이가 같다'`, `'팔레트에 없는 글자를 쓰지 않는다'`, `'Delfi는 깜빡임 프레임이 있다'`.
- [ ] **Step 2–4:** 구현·PASS. 화면은 시안 `screens-v3.html`의 채팅 탭 왼쪽 칸을 따른다: 왼쪽 활동 막대(52px, 아이콘+글자), 메인 칸 머리(Delfi 2배 + "메인"), 메시지 목록, 입력창(Enter로 보내기, 보낸 뒤에도 바로 다음 입력 가능), 넘긴 일마다 카드(요청 · 상태 점 · "연습용 작업"), 아래 상태 줄(`statusText`). 진행 중 카드에는 멈추기 버튼. 팀 방 칸은 M2.
- [ ] **Step 5: 확인** `yarn desktop`에서 5개 연달아 보내기 → 3개 진행·2개 대기, 끝날 때마다 다음이 진행. 창을 약 700px로 줄여도 입력창·상태 줄이 보인다.
- [ ] **Step 6:** `yarn typecheck` · `yarn test` 통과 → 커밋 `feat(desktop): 왼쪽 탭·메인 칸·상태 줄 — 일을 연달아 보내도 입력이 막히지 않는다`
