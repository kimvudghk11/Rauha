import { DocExcerpt } from '../../domain/doc-excerpt.js';

/** 파일 하나에서 넣는 최대 글자 수와 묶음 전체 상한. 넘치면 팀원이 직접 연다. */
const MAX_FILE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 40_000;

export interface FileContent {
  readonly path: string;
  /** 없는 파일이면 null */
  readonly content: string | null;
}

/**
 * 팀원을 부르기 직전에 rauha가 읽은 파일 묶음. 팀원이 같은 파일을 도구로 여는 턴을 없앤다.
 * 턴 하나마다 그때까지의 대화 전체를 다시 보내므로, 줄인 턴만큼 토큰이 준다.
 */
export class FilesBlockDto {
  private constructor(
    private readonly included: readonly { path: string; body: string }[],
    private readonly skipped: readonly string[],
  ) {}

  /**
   * focus(이번 요청·업무 제목·수용 기준)가 있으면 긴 문서(SPEC·DESIGN 같은 .md)는 목차 + 맞는 절만 넣는다.
   * 실측: 작은 태스크에서 12.5K자 SPEC 이 테스트·구현 팀원에게 통째로 갔고 쓰인 곳은 600자 한 절이었다.
   */
  static of(files: readonly FileContent[], focus = ''): FilesBlockDto {
    const seen = new Set<string>();
    const included: { path: string; body: string }[] = [];
    const skipped: string[] = [];
    let total = 0;
    for (const file of files) {
      if (file.content === null || seen.has(file.path)) continue;
      seen.add(file.path);
      const excerpt = focus === '' ? null : DocExcerpt.of(file.path, file.content, focus);
      const body = excerpt !== null && !excerpt.isWhole() ? excerpt.text() : numbered(file.content);
      if (total + body.length > MAX_TOTAL_CHARS) {
        skipped.push(file.path);
        continue;
      }
      total += body.length;
      included.push({ path: file.path, body });
    }
    return new FilesBlockDto(included, skipped);
  }

  toBlock(): string {
    if (this.included.length === 0 && this.skipped.length === 0) return '';
    return [
      '<files>',
      'rauha가 이 호출 직전에 읽은 현재 내용입니다(줄 번호는 Read와 같습니다). 이 파일들은 다시 열지 말고, 직접 고친 뒤에만 다시 여세요.',
      ...this.included.map((f) => `<file path="${f.path}">\n${f.body}\n</file>`),
      ...(this.skipped.length > 0 ? [`분량 때문에 넣지 못한 파일(필요하면 Read로 여세요): ${this.skipped.join(', ')}`] : []),
      '</files>',
    ].join('\n');
  }
}

function numbered(content: string): string {
  const cut = content.length > MAX_FILE_CHARS;
  const text = cut ? content.slice(0, MAX_FILE_CHARS) : content;
  const lines = text.replace(/\n$/, '').split('\n').map((line, i) => `${i + 1}\t${line}`);
  if (cut) lines.push(`… (여기서 잘렸습니다. 뒷부분은 Read로 ${lines.length + 1}행부터 여세요)`);
  return lines.join('\n');
}
