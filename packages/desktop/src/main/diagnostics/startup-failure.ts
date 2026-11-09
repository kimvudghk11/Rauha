export interface StartupFailure {
  readonly title: string;
  readonly body: string;
}

const REASON_MAX = 240;

/**
 * 앱을 시작하다 던진 오류를 사람이 읽는 오류 창 글로 바꾼다.
 * 이걸 안 하면 창이 하나도 안 뜨고 아무 말 없이 꺼진 것처럼 보인다. 스택은 로그에만 남기고 여기엔 첫 줄만 쓴다.
 */
export function startupFailure(error: unknown, logPath: string): StartupFailure {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const first = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? '알 수 없는 오류';
  const reason = first.length > REASON_MAX ? `${first.slice(0, REASON_MAX - 1)}…` : first;
  const hint = /프롬프트 파일/.test(first) ? '앱 파일이 빠진 것 같아요. 앱을 지우고 최신 설치 파일로 다시 설치해 주세요.' : '앱을 완전히 끝내고 다시 열어 보세요. 계속되면 아래 로그 파일을 알려 주세요.';
  return { title: 'rauha를 열지 못했어요', body: `${reason}\n\n${hint}\n로그: ${logPath}` };
}
