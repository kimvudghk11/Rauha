import { runEngine, type EngineRequest } from './sqlite-engine.js';

/**
 * 자식 프로세스의 진입점: 표준 입력으로 요청 JSON 한 개를 받아 엔진을 돌리고, 표준 출력으로 응답 JSON 한 개를 쓴 뒤 끝난다.
 * (Electron 실행 파일을 ELECTRON_RUN_AS_NODE=1 로 `-e` 코드로 띄운다. 파일을 따로 싣지 않으니 asar 안에서도 된다.)
 */
const chunks: Buffer[] = [];
process.stdin.on('data', (c: Buffer) => chunks.push(c));
process.stdin.on('end', () => {
  let out: string;
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString('utf8')) as EngineRequest;
    out = JSON.stringify(runEngine(req));
  } catch (error) {
    out = JSON.stringify({ ok: false, code: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  process.stdout.write(out, () => process.exit(0));
});
