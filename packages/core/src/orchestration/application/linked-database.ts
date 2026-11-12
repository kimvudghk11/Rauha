import type { DbDialect, DbTableName } from '../domain/db-tools.js';

/** DB 도구 한 번의 결과 글. ok 가 false 면 팀원에게 오류로 보인다. */
export interface DbToolReply {
  readonly ok: boolean;
  readonly text: string;
}

/**
 * 작업 레포에 연결된 DB(사용자가 DB 탭에 저장한 연결 중 하나). 읽기 전용으로만 연다.
 * 접속 정보(호스트·사용자·비밀번호·접속 문자열)는 이 모양 밖으로 나오지 않는다: 팀원에게는 name 과 결과 글만 간다.
 */
export interface LinkedDatabase {
  readonly dialect: DbDialect;
  /** 팀원에게 보일 이름: DB 이름(또는 SQLite 파일 이름)만 */
  readonly name: string;
  /** 운영 DB 로 보이는지(연결 이름·호스트에 prod). 도구 설명에 "가벼운 쿼리만"을 붙인다. */
  readonly production: boolean;
  tables(): Promise<DbToolReply>;
  describe(table: DbTableName): Promise<DbToolReply>;
  indexes(table: DbTableName): Promise<DbToolReply>;
  sample(table: DbTableName, rows: number): Promise<DbToolReply>;
  /** 읽기 전용 문장 하나(DbProbeSql.select 를 지난 것) */
  select(sql: string): Promise<DbToolReply>;
  /** DbProbeSql.explain 이 만든 EXPLAIN 문장 */
  explain(statement: string): Promise<DbToolReply>;
}
