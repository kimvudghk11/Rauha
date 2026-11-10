import { describe, expect, it } from 'vitest';
import { DiagnosticReport, LogRing, LOG_RING_MAX, LOG_TAIL, Redactor, logLinesOf, maskEmail, type DiagnosticSnapshot } from './diagnostics.js';

const MAC_HOME = '/Users/kimpyeonghwa';
const WIN_HOME = 'C:\\Users\\kimpyeonghwa';
const FAKE_KEY = ['sk', 'ant', 'api03', 'abcdefghijklmnop1234567890'].join('-');

function snapshot(patch: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot {
  return {
    collectedAt: '2026-11-09T01:02:03.000Z',
    app: { version: '0.1.4', packaged: true },
    os: { platform: 'darwin', version: '15.1', arch: 'arm64', chip: 'Apple M1' },
    runtime: { electron: '45.2.3', node: '24.1.0', chrome: '140.0.0.0' },
    workFolder: { path: `${MAC_HOME}/work`, exists: true },
    repoCount: 4,
    claude: { path: '/Applications/Rauha.app/Contents/Resources/claude', exists: true, executable: true },
    auth: { state: { kind: 'signed-in', who: 'kimpyeonghwa@example.com', detail: 'ACME Corp · max' }, configDir: '~/.claude' },
    tools: [
      { name: 'git', path: `${MAC_HOME}/homebrew/bin/git` },
      { name: 'aws', path: null },
    ],
    usage: { lastReadAt: '2026-11-09T01:00:00.000Z', failure: null },
    update: { checkedAt: '2026-11-09T00:59:00.000Z', latest: '0.1.5', newer: true, failed: false },
    logs: [],
    window: { width: 1280, height: 820, displays: 2 },
    mac: { titleBarStyle: 'hiddenInset', trafficLight: { x: 14, y: 12 }, fullScreen: false },
    ...patch,
  };
}

describe('경로 가리기', () => {
  it('홈 폴더는 ~로 줄이고 사용자 이름은 남기지 않는다(맥)', () => {
    const r = Redactor.of(MAC_HOME, 'kimpyeonghwa');
    expect(r.path(`${MAC_HOME}/work/rauha`)).toBe('~/work/rauha');
    expect(r.path(MAC_HOME)).toBe('~');
  });

  it('윈도 경로도 역슬래시를 슬래시로 보이고 ~로 줄인다', () => {
    const r = Redactor.of(WIN_HOME, 'kimpyeonghwa');
    expect(r.path(`${WIN_HOME}\\work\\rauha`)).toBe('~/work/rauha');
  });

  it('홈 밖 경로에 사용자 이름이 들어 있어도 지운다', () => {
    const r = Redactor.of(MAC_HOME, 'kimpyeonghwa');
    expect(r.path('/Users/other/dev')).toBe('~/dev');
    expect(r.path('/tmp/kimpyeonghwa-cache')).not.toContain('kimpyeonghwa');
  });

  it('경로를 모르면 "없음"이라고 쓴다', () => {
    expect(Redactor.of(MAC_HOME, 'kimpyeonghwa').path(null)).toBe('없음');
  });
});

describe('이메일 가리기', () => {
  it('앞 2글자만 남기고 나머지는 ***로 바꾼다', () => {
    expect(maskEmail('kimpyeonghwa@example.com')).toBe('ki***');
    expect(maskEmail('a@example.com')).toBe('a***');
  });
});

describe('글 한 줄 가리기', () => {
  const r = Redactor.of(MAC_HOME, 'kimpyeonghwa');

  it('홈 경로와 사용자 이름과 이메일이 새지 않는다', () => {
    const out = r.text(`ENOENT ${MAC_HOME}/work/a.ts by kimpyeonghwa <kimpyeonghwa@example.com>`);
    expect(out).not.toContain('kimpyeonghwa');
    expect(out).not.toContain('example.com');
    expect(out).toContain('~/work/a.ts');
  });

  it('윈도 홈 경로가 역슬래시 그대로 찍혀도 새지 않는다', () => {
    const w = Redactor.of(WIN_HOME, 'kimpyeonghwa');
    expect(w.text(`at ${WIN_HOME}\\AppData\\x.js:1`)).not.toContain('kimpyeonghwa');
  });

  it('토큰·키·달러 금액을 가린다', () => {
    const out = r.text(`key ${FAKE_KEY} Bearer abcdefghijklmnop1234 cost $12.50 password=hunter22`);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain('abcdefghijklmnop1234');
    expect(out).not.toContain('12.50');
    expect(out).not.toContain('hunter22');
  });

  it('여러 번 가려도 결과가 같다', () => {
    const once = r.text(`${MAC_HOME}/x kimpyeonghwa@example.com ${FAKE_KEY}`);
    expect(r.text(once)).toBe(once);
  });
});

describe('로그 줄 만들기', () => {
  it('여러 줄 오류는 줄마다 나누고 첫 줄에만 시각과 출처를 붙인다', () => {
    const lines = logLinesOf('2026-11-09T01:00:00.000Z', 'main', 'Error: boom\n    at a (x.js:1)\n    at b (y.js:2)');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('2026-11-09T01:00:00.000Z [main] Error: boom');
    expect(lines[1]).toBe('    at a (x.js:1)');
  });

  it('너무 긴 줄은 자르고 빈 줄은 버린다', () => {
    const lines = logLinesOf('t', 'main', `${'x'.repeat(2000)}\n\n`);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(400);
  });
});

describe('최근 로그 링 버퍼', () => {
  it('200줄까지만 들고 있고 오래된 줄부터 버린다', () => {
    const ring = new LogRing();
    for (let i = 0; i < LOG_RING_MAX + 25; i++) ring.push(`line ${i}`);
    expect(ring.all()).toHaveLength(LOG_RING_MAX);
    expect(ring.all()[0]).toBe('line 25');
  });

  it('끝에서 n줄을 돌려준다', () => {
    const ring = new LogRing();
    for (let i = 0; i < 100; i++) ring.push(`line ${i}`);
    expect(ring.tail(LOG_TAIL)).toHaveLength(LOG_TAIL);
    expect(ring.tail(2)).toEqual(['line 98', 'line 99']);
  });
});

describe('진단 정보 마크다운', () => {
  const r = Redactor.of(MAC_HOME, 'kimpyeonghwa');

  it('앱·컴퓨터·실행 환경 정보가 들어간다', () => {
    const md = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(md).toContain('0.1.4');
    expect(md).toContain('설치본');
    expect(md).toContain('macOS 15.1');
    expect(md).toContain('Apple M1');
    expect(md).toContain('arm64');
    expect(md).toContain('Electron 45.2.3');
    expect(md).toContain('Node 24.1.0');
  });

  it('작업 폴더는 ~로 줄이고 있는지와 레포 수를 보인다', () => {
    const md = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(md).toContain('~/work');
    expect(md).toContain('레포 4개');
  });

  it('Claude 실행 파일의 존재·실행 가능 여부를 보인다', () => {
    const ok = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(ok).toContain('실행 가능');
    const bad = DiagnosticReport.of(snapshot({ claude: { path: '/x/claude', exists: true, executable: false } }), r).toMarkdown();
    expect(bad).toContain('실행 권한 없음');
    const none = DiagnosticReport.of(snapshot({ claude: { path: null, exists: false, executable: false } }), r).toMarkdown();
    expect(none).toContain('찾지 못함');
  });

  it('로그인 상태 세 가지를 이유 한 줄만으로 보이고 이메일은 앞 2글자만 남긴다', () => {
    const signedIn = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(signedIn).toContain('로그인됨 (ki***)');
    expect(signedIn).not.toContain('example.com');
    expect(signedIn).not.toContain('ACME');
    const out = DiagnosticReport.of(snapshot({ auth: { state: { kind: 'signed-out' }, configDir: null } }), r).toMarkdown();
    expect(out).toContain('로그인 안 됨');
    const unknown = DiagnosticReport.of(snapshot({ auth: { state: { kind: 'unknown', reason: `Claude가 오류로 끝났어요: ${MAC_HOME}/x 없음` }, configDir: null } }), r).toMarkdown();
    expect(unknown).toContain('확인 못 함');
    expect(unknown).not.toContain('kimpyeonghwa');
  });

  it('로그인 상태가 이메일 대신 구독 이름이면 그대로 쓴다', () => {
    const md = DiagnosticReport.of(snapshot({ auth: { state: { kind: 'signed-in', who: 'Claude 구독', detail: null }, configDir: null } }), r).toMarkdown();
    expect(md).toContain('로그인됨 (Claude 구독)');
  });

  it('PATH에서 찾은 도구와 못 찾은 도구를 가려 보이고 경로는 ~로 줄인다', () => {
    const md = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(md).toContain('git: ~/homebrew/bin/git');
    expect(md).toContain('aws: 못 찾음');
  });

  it('한도 읽기의 마지막 성공 시각과 실패 이유를 보인다', () => {
    const md = DiagnosticReport.of(snapshot({ usage: { lastReadAt: null, failure: '읽지 못함' } }), r).toMarkdown();
    expect(md).toContain('마지막 성공: 아직 없음');
    expect(md).toContain('실패 이유: 읽지 못함');
  });

  it('업데이트 확인 결과를 보인다', () => {
    const md = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(md).toContain('0.1.5');
    const failed = DiagnosticReport.of(snapshot({ update: { checkedAt: null, latest: null, newer: false, failed: true } }), r).toMarkdown();
    expect(failed).toContain('확인 실패');
  });

  it('창 크기와 모니터 수를 보이고, 맥이면 창 모양과 전체 화면 여부를 보인다', () => {
    const md = DiagnosticReport.of(snapshot(), r).toMarkdown();
    expect(md).toContain('1280x820');
    expect(md).toContain('모니터 2개');
    expect(md).toContain('hiddenInset');
    expect(md).toContain('x 14, y 12');
    expect(md).toContain('전체 화면: 아니요');
  });

  it('맥이 아니면 창 모양 구역을 쓰지 않는다', () => {
    const md = DiagnosticReport.of(snapshot({ os: { platform: 'win32', version: '10.0.19045', arch: 'x64', chip: null }, mac: null }), r).toMarkdown();
    expect(md).toContain('Windows 10.0.19045');
    expect(md).not.toContain('titleBarStyle');
  });

  it('최근 로그는 마지막 50줄만 담고 비밀은 가린다', () => {
    const logs = Array.from({ length: 80 }, (_, i) => `l${i} ${FAKE_KEY} ${MAC_HOME}/p kimpyeonghwa@example.com`);
    const md = DiagnosticReport.of(snapshot({ logs }), r).toMarkdown();
    expect(md).toContain('l79 ');
    expect(md).toContain('l30 ');
    expect(md).not.toContain('l29 ');
    expect(md).toContain('최근 앱 오류 로그 (50줄)');
  });

  it('로그 속 ARN의 AWS 계정 번호 12자리를 가리고 몇 번 거쳐도 같다', () => {
    const line = 'denied arn:aws:iam::123456789012:role/dev and arn:aws:sts::210987654321:assumed-role/x/y';
    const once = r.text(line);
    expect(once).not.toMatch(/\d{12}/);
    expect(once).toContain('arn:aws:iam::<계정>:role/dev');
    expect(r.text(once)).toBe(once);
  });

  it('로그가 없으면 없다고 쓴다', () => {
    expect(DiagnosticReport.of(snapshot(), r).toMarkdown()).toContain('오류 기록 없음');
  });

  it('어떤 입력이어도 홈 경로·사용자 이름·이메일·토큰이 한 덩어리에 남지 않는다', () => {
    const md = DiagnosticReport.of(
      snapshot({
        workFolder: { path: `${MAC_HOME}/work`, exists: true },
        auth: { state: { kind: 'unknown', reason: `${FAKE_KEY} kimpyeonghwa@example.com` }, configDir: `${MAC_HOME}/.claude` },
        usage: { lastReadAt: null, failure: `${MAC_HOME}/bin failed for kimpyeonghwa@example.com` },
        logs: [`Bearer abcdefghijklmnop1234 ${WIN_HOME}\\x`],
      }),
      r,
    ).toMarkdown();
    for (const secret of ['kimpyeonghwa', 'example.com', FAKE_KEY, 'abcdefghijklmnop1234']) expect(md).not.toContain(secret);
  });
});
