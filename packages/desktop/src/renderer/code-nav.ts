import type { SearchFileHits } from '../shared/code-api.js';
import { groupLocations, isTsLikePath, lineColToOffset, navFailText, wordAt, type NavApi } from '../shared/ts-nav.js';

export interface CodeNavDeps {
  readonly api: NavApi;
  /** 지금 보는 파일(없으면 null) */
  readonly active: () => string | null;
  /** 그 파일의 편집기 글(저장 전 글 포함) */
  readonly textOf: (path: string) => string | null;
  readonly openAt: (path: string, line: number, column: number) => Promise<void>;
  /** 찾은 위치 목록을 Search 칸에 보인다 */
  readonly showResults: (title: string, files: readonly SearchFileHits[]) => void;
  /** 그 이름을 전체 찾기(낱말 단위·대소문자 구분)로 찾는다 */
  readonly searchByName: (word: string) => void;
  readonly say: (text: string) => void;
  /** 앞서 띄운 안내를 거둔다 */
  readonly clear: () => void;
}

/**
 * 정의로 이동(F12·Ctrl/Cmd+클릭)과 참조 찾기(Shift+F12). TypeScript/JavaScript 파일은 언어 도구(main 의 worker)에 묻고,
 * 그 밖의 파일이나 도구가 못 쓰일 때는 커서 아래 이름으로 전체 찾기를 대신 한다.
 */
export function createCodeNav(d: CodeNavDeps): { go: (kind: 'definition' | 'references', line: number, column: number) => Promise<void> } {
  let seq = 0;

  async function go(kind: 'definition' | 'references', line: number, column: number): Promise<void> {
    const path = d.active();
    if (path === null) return;
    const text = d.textOf(path);
    const offset = text === null ? null : lineColToOffset(text, line, column);
    const word = text === null || offset === null ? null : wordAt(text, offset);
    if (text === null || word === null) {
      d.say('Put the cursor on a name first.');
      return;
    }
    const mine = ++seq;
    const byName = (why: string): void => {
      d.say(`${why} Searched for “${word}” by name instead.`);
      d.searchByName(word);
    };
    if (!isTsLikePath(path)) {
      d.searchByName(word);
      return;
    }
    d.say(kind === 'definition' ? `Finding the definition of ${word}…` : `Finding references to ${word}…`);
    const req = { path, text, line, column };
    if (kind === 'definition') {
      const r = await d.api.definition(req);
      if (mine !== seq) return;
      if (!r.ok) {
        byName(navFailText(r.reason));
        return;
      }
      const first = r.locations[0];
      if (first === undefined) {
        byName('No definition found.');
      } else if (r.locations.length === 1) {
        d.clear();
        await d.openAt(first.path, first.line, first.column);
      } else {
        d.clear();
        d.showResults(`${r.locations.length} definitions of ${word}`, groupLocations(r.locations, 200).files);
      }
      return;
    }
    const r = await d.api.references(req);
    if (mine !== seq) return;
    if (!r.ok) {
      byName(navFailText(r.reason));
      return;
    }
    const count = r.files.reduce((n, f) => n + f.hits.length, 0);
    if (count === 0) {
      byName('No references found.');
      return;
    }
    d.clear();
    d.showResults(`${count} reference${count === 1 ? '' : 's'} to ${word} in ${r.files.length} file${r.files.length === 1 ? '' : 's'}${r.truncated ? ' (more not shown)' : ''}`, r.files);
  }

  return { go };
}
