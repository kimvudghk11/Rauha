/**
 * 확인용 실행(RAUHA_FAKE_TEAM)에서 모델 대신 돌려주는 AI 시험 출력. 화면 측정·연습용이라 코드를 읽지 않고 고정된 케이스를 낸다.
 */
export const FAKE_TEST_MODEL = {
  plan: async (_prompt: string): Promise<unknown> => ({
    cases: [
      { category: 'happy', title: '필수 값만 넣으면 만들어진다', expect_note: '201 Created', body: '{"email":"user@example.com","name":"kim"}', auth: 'default', expect_status: [200, 201], evidence: 'src/users/users.controller.ts:12', mutates: true },
      { category: 'validation', title: '이메일 형식이 틀리면 400', expect_note: '@IsEmail 이 막는다', body: '{"email":"not-an-email","name":"kim"}', auth: 'default', expect_status: [400], evidence: 'src/users/dto/create-user.dto.ts:5', mutates: false },
      { category: 'validation', title: '이름이 비면 400', expect_note: '@IsNotEmpty', body: '{"email":"user@example.com","name":""}', auth: 'default', expect_status: [400], evidence: 'src/users/dto/create-user.dto.ts:8', mutates: false },
      { category: 'auth', title: '토큰 없이 부르면 401', expect_note: 'AuthGuard', body: '{"email":"user@example.com","name":"kim"}', auth: 'none', expect_status: [401], evidence: 'src/users/users.controller.ts:9', mutates: false },
      { category: 'data', title: '같은 이메일로 두 번 만들면 409', expect_note: '중복 검사', body: '{"email":"dup@example.com","name":"kim"}', auth: 'default', repeat: 2, expect_status: [409], evidence: 'src/users/users.service.ts:21', mutates: true },
      { category: 'security', title: 'role 필드를 끼워 넣어도 admin 이 되지 않는다', expect_note: 'whitelist 로 버린다', body: '{"email":"a@example.com","name":"kim","role":"admin"}', auth: 'default', expect_status: [201, 400], body_excludes: ['"role":"admin"'], evidence: 'src/main.ts:6', mutates: true },
    ],
    notes: '삭제된 사용자 케이스는 데이터를 미리 만들어야 해서 넣지 않았어요.',
  }),
  fixes: async (prompt: string): Promise<unknown> => ({
    summary: '중복 검사와 입력 검증 일부가 빠져 있어요.',
    fixes: [...prompt.matchAll(/<case id="([^"]+)">/g)].map((m) => ({ case_id: m[1], cause: '서비스에서 같은 이메일을 확인하지 않고 바로 저장해요.', fix: '저장 전에 이메일로 찾아 있으면 ConflictException 을 던지세요.', file: 'src/users/users.service.ts', line: 21 })),
  }),
};
