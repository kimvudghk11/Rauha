# 패키징 메모

이 파일은 패키징 담당(빌드 설정·CI)과 소스 담당이 함께 쓴다. 아래 "앱이 기대하는 설치본 배치"는 소스 담당 절이다.

## 앱이 기대하는 설치본 배치 (소스 담당)

경로를 찾는 규칙은 `src/main/platform/resources.ts`(spec 있음)에 있다. 설치본에서 다음 파일이 있어야 한다.

| 무엇 | 설치본 위치(`process.resourcesPath` = `Contents/Resources` 또는 `resources`) | 이유 |
|---|---|---|
| 프롬프트 폴더 | `resources/prompts/` (저장소의 `prompts/` 전체, `extraResources`) | 팀원 시스템 프롬프트. 없으면 팀이 못 일한다. `RAUHA_PROMPTS_DIR`이 있으면 그것이 먼저다. |
| Claude Code 실행 파일 | `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`(Windows는 `claude.exe`) (`asarUnpack`) | Agent SDK는 플랫폼별 **네이티브 실행 파일**을 띄운다. asar 안에서는 실행할 수 없다. 이 실행 파일은 `node`가 필요 없다. |
| Agent SDK 본체 | `app.asar.unpacked` 또는 asar 안 `node_modules/@anthropic-ai/claude-agent-sdk` | main 번들(esbuild)에서 `external`로 둔 패키지다. 번들에 들어가지 않으니 설치본의 `node_modules`에 있어야 한다. |
| `@playwright/mcp` | 같은 이유로 `node_modules`에 있어야 한다(브라우저 연동 때만 쓴다) | `external` |
| 그림·화면 파일 | `dist/renderer/**`(html·css·js·`assets/`) | 렌더러가 상대 주소로 읽는다. |
| 앱 아이콘 | `build/icon.png`(창), 맥 Dock은 `.icns` | `BrowserWindow.icon`은 `app.getAppPath()/build/icon.png`를 읽는다. 설치본에서도 `build/`가 앱 폴더 안에 있어야 한다. |

- 이 SDK 실행 파일은 optionalDependency(`@anthropic-ai/claude-agent-sdk-darwin-arm64` 등)로 받는다. **빌드하는 기계의 플랫폼 것만 설치된다.** mac arm64와 x64를 둘 다 만들려면 CI가 각 아키텍처에서 `yarn install`을 하거나 두 패키지를 모두 받아야 한다.
- 앱은 SDK에 `pathToClaudeCodeExecutable`로 위 경로를 넘긴다. 못 찾으면 SDK 기본 방식으로 찾는다.
- 맥은 GUI 앱이 셸의 PATH를 못 받으므로 시작할 때 로그인 셸(`$SHELL -ilc`)에서 PATH를 읽어 합친다(`src/main/platform/shell-path.ts`). 설치본에 별도 설정은 필요 없다.
- 기억 저장소는 `node:sqlite`(Electron 내장 Node)라서 네이티브 모듈 재빌드가 없다.

---

## 패키징 담당: electron-builder 설정과 CI

설정은 `electron-builder.yml`, 스크립트는 `scripts/dist.mjs`(build 후 electron-builder), `scripts/smoke-dist.mjs`(설치본 확인).

- `yarn dist` 지금 OS용 / `yarn dist:mac` / `yarn dist:win` (루트에서도 같은 이름). 결과는 `packages/desktop/release/`(git 제외).
- mac: dmg + zip, arm64 + x64, ad-hoc 서명(`identity: "-"`), hardenedRuntime 끔. win: NSIS(사용자 단위 설치 가능, 설치 위치 고르기 가능), x64, 서명 없음.
- 아이콘: `build/icon.png`(1024)에서 `yarn workspace @rauha/desktop icons`로 `build/icon.icns`를 만든다. `build/icon.ico`는 이미 있다.
- `.yarnrc.yml`의 `supportedArchitectures`로 Agent SDK의 플랫폼별 실행 파일을 mac arm64·x64, win 모두 받는다(한 러너에서 두 칩을 만들기 위함).

## 설치본에서 파일이 있는 곳 (소스 쪽이 읽을 때 기준)

`resources`는 Windows `<설치폴더>/resources`, mac `rauha.app/Contents/Resources`. 코드에서는 `process.resourcesPath`.

| 무엇 | 설치본 위치 |
| --- | --- |
| main/preload/화면 번들 | `resources/app.asar` 안 `dist/main.cjs`, `dist/preload.cjs`, `dist/renderer/**` (소스·spec·`.map` 없음) |
| 팀원 프롬프트 `*.md` | `resources/prompts/` (`main.ts`의 `promptsDir()`가 이미 이 경로를 읽는다) |
| Agent SDK (JS) | `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/` (asar 밖) |
| Agent SDK 실행 파일 | `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<win32\|darwin>-<x64\|arm64>/` (`claude.exe` / `claude`). SDK 패키지의 optionalDependency라 electron-builder가 자동으로 안 담아서 `extraResources`로 SDK 옆에 둔다. 설치본엔 그 칩 것 하나만 들어간다 |
| 브라우저 MCP | `resources/app.asar.unpacked/node_modules/@playwright/mcp`, `playwright`, `playwright-core` (asar 밖) |

주의할 점(소스 쪽):

- `@rauha/core`는 esbuild가 번들에 합치므로 `devDependencies`다. 런타임에 읽는 SDK·`@playwright/mcp`만 `dependencies`다. 런타임에 새 외부 패키지를 `external`로 추가하면 `dependencies`에도 넣어야 설치본에 들어간다.
- `browser-mcp.ts`는 `node: process.execPath`로 `@playwright/mcp/cli.js`를 띄운다. 설치본에서 `process.execPath`는 Electron 실행 파일이므로 이 자식 프로세스에는 `ELECTRON_RUN_AS_NODE=1`이 필요하다. 아직 확인하지 않았다(스모크는 가짜 팀이라 이 경로를 타지 않는다).
- SDK의 `node` 실행도 같은 문제가 있을 수 있다(5.12의 2번).

## CI

`.github/workflows/desktop.yml` — main push와 수동 실행(`workflow_dispatch`), matrix `macos-latest`·`windows-latest`. install(--immutable) → typecheck → test → build → `yarn dist` → `smoke:dist`(파일 배치 확인 + `RAUHA_FAKE_TEAM=1`, `RAUHA_SMOKE_SHOT`로 Electron을 띄워 스크린샷 생성 확인) → artifact 업로드(14일).

artifact 이름: `rauha-desktop-macOS`(dmg 2개 + zip 2개), `rauha-desktop-Windows`(`rauha-Setup-<버전>-x64.exe`), `smoke-shot-<OS>`(스모크 스크린샷). 실행 목록: https://github.com/kimvudghk11/rauha/actions/workflows/desktop.yml

## 확인 못 한 것

CI 기준(실행 42417327547, macos-latest·windows-latest 둘 다 초록, 2026-11-08): 위 artifact 4개가 올라갔고 설치본 파일 배치 확인과 가짜 팀 Electron 스모크(스크린샷 생성)가 두 OS 모두 통과했다. 실행 주소: https://github.com/kimvudghk11/rauha/actions/runs/42417327547

- 실제 맥북에서 dmg를 열어 설치하고 첫 실행하는 것. Gatekeeper가 ad-hoc 서명 앱을 어떻게 막는지, 회사 보안 소프트웨어(MDM)가 막는지.
- Apple Silicon 러너에서 만든 x64 dmg·zip은 실행해 보지 못했다(CI는 arm64 러너에서 arm64 앱만 띄운다).
- 맥 설치본에서 진짜 팀(Claude 로그인 후 일 시키기)과 브라우저 MCP가 도는지. 스모크는 가짜 팀이라 이 경로를 타지 않는다.
- ad-hoc 서명이 실제로 붙었는지는 CI 로그의 `codesign -dv` 줄로만 볼 수 있다(로그인 없이는 읽지 못해 확인하지 않았다).
- 알림 권한, 문서·데스크톱 폴더 접근 권한, 첫 실행 때 터미널 rauha 지우기 대화상자 동작.
- Windows 설치본의 exe 아이콘: `signAndEditExecutable: false`라 exe 파일 자체에는 아이콘이 입혀지지 않는다(창 아이콘은 `build/icon.png`).
- artifact 용량: macOS 약 960MB(dmg·zip 각 2개), Windows 약 220MB.
