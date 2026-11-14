# DBeaver 참고 자료 (rauha DB 탭용)

조사일 2026-11-14. 공식 문서에서 확인한 것은 "확인", 문서에 없어 기억에 의존한 것은 "미확인"으로 표시했다.
코드는 바꾸지 않았다.

## 1. SQL 에디터와 스크립트

출처: https://dbeaver.com/docs/dbeaver/SQL-Editor/ , https://dbeaver.com/docs/dbeaver/Script-Management/ , https://dbeaver.com/docs/dbeaver/Shortcuts/

- 스크립트는 파일이다 (확인). Ctrl+S 로 프로젝트의 `Scripts` 폴더에 저장한다. Project Explorer 의 Scripts 에서 목록을 본다.
  - 파일 이름 `Script.sql`, `Script-1.sql` 식 번호 매김, 연결별 하위 폴더 (미확인, 기본값으로 알려져 있음).
  - 제안: rauha 는 연결마다 스크립트 여러 개를 localStorage 에 `{id, name, sql}[]` 로 둔다. 이름은 `Script`, `Script-1` 규칙.
- 새 스크립트: Ctrl+] (확인). 파일 없는 콘솔: Ctrl+Alt+Enter (확인). 콘솔은 닫으면 내용이 사라지고, 저장하면 스크립트로 바뀐다 (확인).
  - 제안: 에디터 위에 탭 줄 + `+` 버튼, Ctrl+] 로 새 탭.
- 연결 목록에서 Ctrl+Enter = 그 연결의 가장 최근 스크립트 열기 (확인). 에디터 안에서 Ctrl+Enter 는 문장 실행이다.
  - 제안: 사이드바에서 연결을 더블클릭하면 마지막 스크립트 탭을 연다.
- F3 = 스크립트 고르기 창 (확인, 문서 본문은 F3/F4 혼용). 연결 우클릭 → Open SQL script.
- 에디터의 연결 바꾸기: Ctrl+9 또는 툴바 Active datasource 상자 (확인). "None" 을 고르면 연결을 떼고 SQL 은 남는다 (확인). 스키마는 Ctrl+0.
  - 제안: 탭마다 연결 드롭다운. 바꿔도 SQL 은 유지.
- 이름 바꾸기: Ctrl+F2 또는 우클릭 → File → Rename SQL Script (확인).
- 저장 안 된 변경: 탭 이름에 `*`, 에디터 왼쪽에 색 막대 (확인). Revert 로 디스크 내용으로 되돌림.
- 탭 제목: 기본으로 `<연결 이름> Script-1` 형태, 환경설정의 Script Title Pattern 으로 바꿈 (검색 결과로 확인, 상세 변수는 미확인).
- 탭 색: 연결 유형(Dev/Test/Prod) 색이 에디터와 탭 배경에 입혀짐 (연결 유형 문서로 확인, 아래 4절).
  - 제안: 탭 아래 2px 선을 환경색으로. 이미 있는 환경 줄무늬 재사용.
- 자동 저장: DBeaver 는 닫을 때 저장하고, 빈 스크립트는 지우는 옵션이 있음 (미확인).
  - 제안: rauha 는 입력 후 500ms 디바운스로 항상 저장, 빈 탭은 닫을 때 삭제.
- 쿼리 이동: Alt+Down / Alt+Up 이 다음/이전 쿼리로 커서 이동 (확인).

## 2. 자동 완성 (SQL assist)

출처: https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/

- 수동 호출: Ctrl+Space (확인). 마지막으로 친 식별자로 확정: Ctrl+Shift+Space (확인).
- `SELECT * FROM t` 에서 `*` 뒤 Ctrl+Space 를 누르면 전체 컬럼으로 펼침 (확인).
  - 제안: `*` 펼치기는 인기 기능이라 S 크기로 추가 가능.
- 엔진 3종 (확인): Semantic(권장, 쿼리 구조와 범위를 분석), Legacy(커서 위치만 봄, 서브쿼리에서 틀림), Combined.
  - 설정 위치 Window > Preferences > Editor > SQL Editor > Code Completion.
- Semantic 이 하는 일: FROM/JOIN 뒤에는 테이블, `별칭.` 뒤에는 그 테이블 컬럼, SELECT/WHERE 에는 FROM 에 있는 테이블들의 컬럼 (문서 요지, 세부는 미확인).
  - 제안: 커서가 있는 문장만 간단히 파싱해 `FROM x a JOIN y b` 의 별칭 지도를 만들고, `a.` 뒤엔 x 컬럼, WHERE/SELECT 에선 FROM·JOIN 테이블 컬럼만 보여 준다. 지금의 "마지막 연 테이블" 방식을 대체. (M)
- Hippie(전역) 제안 (확인): 현재 스크립트의 단어 중 비슷한 것을 제안. 설정으로 켜고 끔.
  - 제안: 낮은 우선순위로 스크립트 속 식별자 포함. (S)
- 자동 활성화(`.` 입력, 글자 입력, 지연 ms), 별칭 자동 삽입, 키워드 대소문자: 문서에서 확인 못함 (미확인). 알려진 동작은 `.` 와 글자 입력 시 짧은 지연 뒤 팝업, 테이블 선택 시 별칭 옵션 삽입, 키워드는 기본 대문자.
  - 제안: 테이블 선택 시 `users u` 처럼 별칭 삽입은 옵션으로 두고 기본 끔.
- 템플릿(`sf` → `SELECT * FROM`): 별도 SQL Templates 페이지가 있으나 이번에 못 읽음.
  - 제안: 작은 스니펫 몇 개(`sf`, `sc`=SELECT COUNT(*), `ij`=INNER JOIN)를 제안 목록에 섞는다. (S)
- 정렬(랭킹): 문서에 설명 없음. 문맥에 맞는 종류(테이블/컬럼)가 위, 키워드가 아래라고 알려져 있음 (미확인).

## 3. 결과 보기

출처: https://dbeaver.com/docs/dbeaver/Data-Editor/ , https://dbeaver.com/docs/dbeaver/SQL-Execution/

- 보기 모드 3종 (확인): Grid, Text(고정폭 텍스트), Record(행/열을 뒤집어 한 행을 세로로, Tab 키와 같음).
  - 제안: 그리드 위에 Grid/Record 토글, 행이 1개일 때 자동 Record. (M)
- 필터 상자: 그리드 위 입력칸에 WHERE 조건을 직접 씀 (확인). 열 머리 화살표 메뉴와 셀 우클릭에도 Filter/Order 하위 메뉴가 있음. 기본은 서버 쪽 정렬·필터이고 옵션으로 클라이언트 쪽.
  - 제안: 그리드 위 `WHERE ...` 입력칸과 `ORDER BY ...` 칸. 쿼리를 서브쿼리로 감싸 실행. 열 머리 클릭 = 정렬 토글. (M)
- 값 패널: 오른쪽 사이드 Value 버튼, 셀 우클릭 → Toggle result panel (확인). 긴 텍스트/JSON 을 보기 좋게 보여 줌.
  - 제안: 셀 선택 시 오른쪽에 값 패널(JSON 이면 들여쓰기). (M)
- 실행 구분 (확인): Ctrl+Enter = 커서 문장 또는 선택 영역, Alt+X = 스크립트 전체 순차 실행, Ctrl+\ = 새 결과 탭에서 문장 실행, Ctrl+Alt+Shift+X = 스크립트의 쿼리마다 결과 탭.
  - 탭 이름은 주 테이블 이름, 조인이면 `(+)` (확인). 탭 고정(pin) 가능.
  - 제안: Alt+X 와 결과 탭 여러 개. 탭 이름은 주 테이블. (M)
- 통계 탭: Show statistics 옵션(결과 없을 때만/여러 쿼리/항상) (확인). 별도 실행 로그 창은 없음.
  - 제안: 결과 아래에 한 줄 "N행 · 0.12초" 항상 표시. (S)
- 가져오기 크기: 아래 툴바의 Result-set fetch size, "Fetch all data" 버튼 (확인). 기본 200 은 문서에서 확인 못함(알려진 값). 스크롤을 끝까지 내리면 다음 페이지를 자동으로 가져옴 (미확인).
  - 제안: 기본 200행, 끝까지 스크롤하면 다음 200행, "전체 가져오기" 버튼.
- 스크립트 오류 처리 (확인): 첫 오류에서 Stop+rollback / Stop+commit / Ignore. 구분자 기본 `;`, 빈 줄을 구분자로 쓰는 옵션. 위험한 DROP 은 확인 창.
  - 제안: 스크립트 실행 시 오류에서 멈춤이 기본. DROP/TRUNCATE/WHERE 없는 DELETE 는 확인 창.

## 4. 내비게이터 상세

출처: https://dbeaver.com/docs/dbeaver/Database-Navigator/ , https://dbeaver.com/docs/dbeaver/Connection-Types/

- 필터 (확인): 트리 위 필터 바에 입력하면 일치 항목 강조, 펼쳐진 노드에만 적용. 우클릭 Filter 메뉴에 Hide / Show only / Configure filter / Toggle / Clear. 툴바 버튼으로 연결/스키마/객체 수준을 순환.
  - 제안: 이미 검색이 있으니 불일치 항목은 강조 대신 숨김 유지. 우클릭 "이 스키마 숨기기" 정도만. (S)
- Generate SQL (확인): 객체 우클릭 → Generate SQL → SELECT / INSERT / UPDATE / DELETE / MERGE / DDL.
  - 제안: 테이블 우클릭 메뉴에 SELECT, INSERT, UPDATE, DELETE, DDL 을 만들어 에디터 새 탭에 넣기. DDL 은 컬럼·PK 정보로 조립. (M)
- Read data in SQL console (확인): 우클릭 → 그 테이블의 SELECT 를 콘솔에서 바로 실행.
  - 제안: 테이블 더블클릭 = `SELECT * FROM t LIMIT 200` 을 새 탭(저장 안 되는 콘솔)에서 실행. (S)
- 연결 유형 기본값 (확인):

| | Development | Test | Production |
|---|---|---|---|
| 배경색 | 흰색 | 올리브 녹색 | 벽돌 빨강 |
| 자동 커밋 | 켬 | 켬 | 끔 |
| SQL 실행 확인 | 끔 | 끔 | 켬 |
| 데이터 변경 확인 | 끔 | 켬 | 켬 |
| 유휴 트랜잭션 제한 | 30분 | 15분 | 10분 |

  - 새 연결은 Development. "모든 요소에 연결 색 적용" 설정이 꺼져 있으면 연결 노드만 색칠 (확인).
  - 제안: rauha 환경(local/dev/staging/prod) 중 prod 는 쓰기 모드를 켜도 실행 전 확인 창, 변경 쿼리는 `UPDATE 3행 영향` 식 확인. (M)
- 자동 커밋/수동 커밋 표시: 툴바에 Auto/Manual 토글, 수동일 때 Commit/Rollback 버튼과 대기 문장 수 표시 (미확인, 이 페이지 읽기 실패).
  - 제안: 쓰기 모드 뱃지 옆에 "자동 커밋 / 수동(대기 N)" 표시는 L 이라 후순위.

## 5. 단축키 (SQL 에디터)

출처: https://dbeaver.com/docs/dbeaver/Shortcuts/ (모두 확인)

| 동작 | Windows | macOS |
|---|---|---|
| 문장 실행 | Ctrl+Enter | Cmd+Enter |
| 스크립트 실행 | Alt+X | Opt+X |
| 새 탭에서 실행 | Ctrl+\ | Ctrl+\ |
| 쿼리마다 결과 탭 | Ctrl+Alt+Shift+X | Ctrl+Opt+Shift+X |
| 실행 계획 | Ctrl+Shift+E | Ctrl+Shift+E |
| 포맷 | Ctrl+Shift+F | Ctrl+Shift+F |
| 한 줄 주석 | Ctrl+/ | Ctrl+/ |
| 여러 줄 주석 | Ctrl+Shift+/ | Ctrl+Shift+/ |
| 새 스크립트 | Ctrl+] | Ctrl+] |
| 새 콘솔 | Ctrl+Alt+Enter | Ctrl+Opt+Enter |
| 스크립트 이름 바꾸기 | Ctrl+F2 | Ctrl+F2 |
| 연결 선택 | Ctrl+9 | Ctrl+9 |
| 스키마 선택 | Ctrl+0 | Ctrl+0 |
| 결과 패널 보이기/숨기기 | Ctrl+T | Ctrl+T |
| 결과 패널 최대화 | Ctrl+Shift+T | Ctrl+Shift+T |
| 결과 탭 닫기 | Ctrl+Shift+\ | Ctrl+Shift+\ |
| 다음/이전 쿼리 | Alt+Down / Alt+Up | Opt+Down / Opt+Up |

- 제안: 먼저 Ctrl+Shift+F(sql-formatter 라이브러리), Ctrl+/, Ctrl+], Ctrl+T, Alt+X 를 넣는다. 맥에서는 Mac 키로 매핑.
- 제안: Ctrl+Shift+E 는 `EXPLAIN` 을 앞에 붙여 실행하는 것으로 시작 (S).

## 6. TablePlus / DataGrip 이 낫다고 알려진 점 (조사 시간 부족, 기억 기반, 미확인)

- TablePlus: 탭이 브라우저처럼 가볍고 Cmd+T 로 새 쿼리, 결과 셀을 바로 고치고 Cmd+S 로 변경을 한꺼번에 커밋하는 "대기 변경" 모델. 연결 색 라벨. rauha 쓰기 모드에 "변경 모아서 적용" 이 잘 맞음.
- DataGrip: 자동 완성이 가장 정교(별칭·조인 조건 제안, 컬럼 타입 표시), 쿼리 실행 전에 미해결 이름에 밑줄. rauha 는 별칭 인식과 없는 테이블 경고만 따라가면 충분.

## rauha 에 넣을 순서(추천)

1. 에디터 탭 여러 개 + 연결별 스크립트 목록, `Script-N` 이름, Ctrl+] (자동 저장, 닫을 때 빈 탭 삭제) — M
2. 별칭 인식 자동 완성: FROM/JOIN 파싱, `a.` 뒤 컬럼, WHERE/SELECT 에서 FROM 테이블 컬럼, `*` 펼치기 — M
3. 테이블 더블클릭 = 새 탭에서 `SELECT * ... LIMIT 200` 실행, 우클릭 Generate SQL (SELECT/INSERT/UPDATE/DELETE/DDL) — M
4. 결과 그리드 위 WHERE/ORDER BY 입력칸, 열 머리 클릭 정렬, 아래 "N행 · 시간" 한 줄 — M
5. 단축키 묶음: Ctrl+Shift+F 포맷, Ctrl+/ 주석, Ctrl+T 결과 접기, Alt+X 스크립트 실행 — S
6. prod 환경 보호: 변경 쿼리/쓰기 모드 실행 전 확인 창, 위험 쿼리(DROP, WHERE 없는 DELETE/UPDATE) 확인 — M
7. 값 패널(오른쪽, JSON 보기)과 Grid/Record 토글 — M
8. 스크립트 결과 탭 여러 개(쿼리마다), 탭 이름은 주 테이블 — L

참고 출처 목록: https://dbeaver.com/docs/dbeaver/SQL-Editor/ · https://dbeaver.com/docs/dbeaver/Script-Management/ · https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/ · https://dbeaver.com/docs/dbeaver/Data-Editor/ · https://dbeaver.com/docs/dbeaver/SQL-Execution/ · https://dbeaver.com/docs/dbeaver/Database-Navigator/ · https://dbeaver.com/docs/dbeaver/Connection-Types/ · https://dbeaver.com/docs/dbeaver/Shortcuts/
