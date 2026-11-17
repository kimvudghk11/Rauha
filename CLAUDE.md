# rauha

Claude Agent SDK 위에서 팀장(오케스트레이터)이 BDD/TDD 업무를 Sonnet·Opus·Fable 팀원에게 나눠 주는 멀티에이전트 하네스. 전체 설계는 `docs/design/claude-team-design.md`.

## 명령어

- 패키지 관리는 **yarn**만 쓴다(Yarn 4, workspaces). npm / pnpm 명령을 쓰지 않는다.
- `yarn install` · `yarn typecheck` · `yarn test` · `yarn build`
- 작업을 끝내기 전에 `yarn typecheck`와 `yarn test`가 통과해야 한다.

## 이 저장소의 개발 방식

`docs/conventions/ddd-entity-dto.md`를 따른다. 핵심만:

- DDD: 컨텍스트마다 `domain / application / infrastructure`. domain은 바깥(Node API, SDK, 파일)을 import하지 않는다.
- 규칙은 **엔티티·값 객체 메서드**에, 바깥 입력 검증·변환은 **DTO 메서드**(`from`, `toEntity`, `fromEntity`, `toMarkdown` …)에 둔다.
- 서비스는 불러오기 → 메서드 호출 → 저장만 한다. 서비스에 도메인 `if`를 쓰지 않는다.
- 생성자는 `private`, 정적 팩토리로만 만든다. 상태는 의도가 드러나는 메서드로만 바꾼다(setter 금지).
- 규칙을 바꿀 때는 실패하는 `*.spec.ts`부터 쓴다. 테스트 이름은 한국어 규칙 문장.

## 주의

- 이 규칙은 rauha 자체 개발용이다. rauha 팀원 프롬프트에 이 스타일을 넣지 않는다. rauha가 다른 프로젝트에서 일할 때는 그 프로젝트의 `CLAUDE.md`와 기존 코드 방식을 따른다.
- Claude 구독 토큰을 읽거나 옮기는 코드를 쓰지 않는다. 계정 구분은 `CLAUDE_CONFIG_DIR`로만 한다.
