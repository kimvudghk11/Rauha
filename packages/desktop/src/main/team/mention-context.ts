import { MentionedFile, mentionedPaths } from '../../shared/file-mention.js';

/** 작업 폴더 안 파일을 안전하게 읽는 길(코드 탭의 CodeFiles.read 가 같은 모양). 비밀 파일·밖·링크 검사는 그쪽이 한다. */
export interface MentionReader {
  read(path: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}

/**
 * 요청 글의 `@파일` 언급을 읽어 팀에 줄 참고 파일 목록으로 바꾼다. 서비스는 읽고 모으기만 한다.
 * 읽지 못한 파일(없음·비밀·밖·링크 …)은 조용히 뺀다 — 비밀 파일이 있다는 사실도 알리지 않는다. 너무 커서 못 연 파일만 경로로 남긴다.
 */
export async function resolveMentions(request: string, reader: MentionReader): Promise<MentionedFile[]> {
  const out: MentionedFile[] = [];
  for (const mention of mentionedPaths(request)) {
    const r = await reader.read(mention.path);
    if (r.ok) out.push(MentionedFile.of(mention.path, Buffer.byteLength(r.text), r.text, mention.lines));
    else if (r.reason === 'too-big') out.push(MentionedFile.of(mention.path, null, null, mention.lines));
  }
  return out;
}
