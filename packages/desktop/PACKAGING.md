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
