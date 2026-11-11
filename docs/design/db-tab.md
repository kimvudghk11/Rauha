# DB 탭 설계 메모 (2026-11-11)

## 지금 구현한 것: SQLite 파일

- 엔진은 Electron 45 에 든 Node 24 의 `node:sqlite`(SQLite 3.53)다. 네이티브 모듈도 WASM 번들도 따로 싣지 않으므로 맥·윈도우 패키징(asar)에 영향이 없고 새 라이선스도 없다(Node MIT, SQLite 퍼블릭 도메인).
- 고르지 않은 것과 이유:
  - `sql.js`(WASM, MIT): 파일 전체를 메모리로 읽고 쓰기는 통째 다시 써야 해서 큰 파일과 쓰기에 불리하고, 동기 WASM 이라 시간 제한도 똑같이 프로세스를 죽여야 한다.
  - 시스템 `sqlite3` CLI: 윈도우에는 기본으로 없고 맥 버전도 제각각이라 "없으면 설치하세요"가 된다.
  - `better-sqlite3` 같은 네이티브 모듈: 맥(arm64/x64)·윈도우 둘 다 prebuilt/리빌드가 필요해 패키징이 깨지기 쉽다(금지).
- 쿼리는 요청마다 `process.execPath` 를 `ELECTRON_RUN_AS_NODE=1 -e <코드>` 로 띄운 자식 프로세스에서 돈다. 끝나지 않는 쿼리(재귀 CTE)는 SQLite 안에서 끊을 수단이 없어 프로세스째 죽인다. 코드는 빌드가 문자열로 main 번들에 넣어 asar 안에서도 된다.
- 방어 층(바깥부터): ① 렌더러 → main 요청 검사(`DbRequest`, 경로·id·정렬 값 객체) ② 문장 검사 `SqlStatement`(한 문장, 읽기/쓰기/스키마, 막는 문장·함수) ③ 쓰기 문장은 Write mode + confirm ④ 자식 안에서 문장 검사 한 번 더 ⑤ 읽기 전용 열기(`readOnly`) ⑥ SQLite 인가 함수(Node 24.10+ 에만 있다. CI 의 Node 22 에는 없어 있을 때만 추가로 건다) ⑦ `trusted_schema=OFF`, defensive, 길이 한계, `hard_heap_limit`, 확장 로드 끔.
- 알려진 한계: 파일을 확인하고 여는 사이의 아주 짧은 틈(TOCTOU), 쓰기 모드 문장은 되돌릴 수 없음(자동 백업 없음), WAL 모드 파일을 읽기 전용으로 열려면 같은 폴더에 쓰기 권한이 필요할 수 있다.

## 나중에: PostgreSQL / MySQL (이번엔 하지 않음)

접속 정보와 네트워크 쿼리가 있어 SQLite 와 위험이 다르다. 할 때 지킬 것:

1. **접속 정보 저장**: 비밀번호는 `safeStorage`(OS 키체인)에만 두고 JSON 에는 호스트·포트·DB·사용자·SSL 모드만 둔다. 연결 문자열 전체를 화면·기록·진단에 내지 않는다(`maskConnectionSecrets` 를 모든 오류 글에 이미 거친다). 환경 변수 `${...}` 참조를 지원해 레포에 비밀이 들어가지 않게 한다.
2. **실행 위치**: SQLite 와 같은 자식 프로세스 방식(요청마다 또는 연결별 상주)으로 두고 시간 제한 = 프로세스 종료 + 서버 쪽 `statement_timeout`/`MAX_EXECUTION_TIME` 을 같이 건다. 드라이버(`pg`, `mysql2`)는 순수 JS 라 네이티브 문제는 없지만 번들 크기·라이선스(MIT)를 확인한다.
3. **읽기 전용**: PostgreSQL 은 `SET default_transaction_read_only = on` + 읽기 전용 트랜잭션, MySQL 은 `START TRANSACTION READ ONLY`. 문장 검사는 방언별 토크나이저가 필요하다(`COPY ... PROGRAM`, `pg_read_file`, `LOAD DATA`, `INTO OUTFILE` 차단).
4. **네트워크 안전**: API 탭의 주소 검사(링크 로컬·메타데이터 주소 차단, DNS 해석 후 확인)를 재사용하고, TLS 기본 켬. 터널(SSH)은 별도 항목.
5. **결과 상한**은 같은 5000행/5MB 를 쓰고 서버 커서로 가져와 상한에서 멈춘다.
6. **화면**: 연결 목록이 "파일"에서 "연결"로 바뀌고 종류 칩(SQLite/PostgreSQL/MySQL)과 "연결 테스트" 버튼이 는다. 스키마 트리(스키마 → 테이블 → 열)가 필요하다.
- 계산해서 만드는 거대한 값(`zeroblob(a*b)`)은 SQLite 길이 한계(Node 24+ 의 `limits` 옵션)가 있는 환경에서만 막힌다. 숫자로 적은 크기는 모든 Node 에서 문장 검사가 막는다. 어느 쪽이든 시간 제한이 프로세스를 죽이는 마지막 방어선이다.
