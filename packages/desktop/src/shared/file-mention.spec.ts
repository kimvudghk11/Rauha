import { describe, expect, it } from 'vitest';
import { activeMention, completeMention, FileMention, MentionedFile, mentionedPaths, rankMentionFiles, RecentFiles, withAttachments } from './file-mention.js';

describe('FileMention.fromToken', () => {
  it('슬래시나 확장자가 있는 글자는 파일 경로로 읽는다', () => {
    expect(FileMention.fromToken('src/foo.ts')?.path).toBe('src/foo.ts');
    expect(FileMention.fromToken('README.md')?.path).toBe('README.md');
  });
  it('폴더 이름처럼 슬래시도 확장자도 없는 글자는 파일로 읽지 않는다', () => {
    expect(FileMention.fromToken('api-server')).toBeNull();
  });
  it('문장 끝 구두점은 경로에 넣지 않는다', () => {
    expect(FileMention.fromToken('src/foo.ts,')?.path).toBe('src/foo.ts');
    expect(FileMention.fromToken('src/foo.ts.')?.path).toBe('src/foo.ts');
  });
  it('역슬래시는 슬래시로 맞춘다', () => {
    expect(FileMention.fromToken('src\\a\\b.ts')?.path).toBe('src/a/b.ts');
  });
  it('작업 폴더 밖을 가리키는 경로는 받지 않는다(.. 절대 경로 드라이브 UNC)', () => {
    for (const bad of ['../x.ts', 'a/../../x.ts', '/etc/passwd', 'C:/x.ts', 'C:\\x.ts', '\\\\host\\share\\x.ts', '~/x.ts']) expect(FileMention.fromToken(bad), bad).toBeNull();
  });
  it('.git 안쪽과 NUL이 든 경로는 받지 않는다', () => {
    expect(FileMention.fromToken('.git/config')).toBeNull();
    expect(FileMention.fromToken('a/.git/hooks/x.sh')).toBeNull();
    expect(FileMention.fromToken('a\0b.ts')).toBeNull();
  });
  it('제어 문자·보이지 않는 글자·방향 바꾸기 글자가 든 경로와 짧은 .git 이름은 받지 않는다', () => {
    for (const bad of ['src/a\u0007.ts', 'src/a\u001b[31m.ts', 'src/a\u0085.ts', 'src/a\u007f.ts', 'src/a\u202e.ts', 'src/a\u200b.ts', '.g\u200cit/config', 'GIT~1/config', 'sub/git~2/hooks']) {
      expect(FileMention.fromToken(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(FileMention.fromToken('docs/한글 아닌-이름_1.md')).not.toBeNull();
  });

  it('폴더를 가리키는 끝 슬래시는 받지 않는다', () => {
    expect(FileMention.fromToken('src/')).toBeNull();
  });
  it('끝에 :줄 또는 :시작-끝 이 붙으면 줄 범위로 따로 읽는다', () => {
    const m = FileMention.fromToken('src/a.ts:10-20');
    expect(m?.path).toBe('src/a.ts');
    expect(m?.lines).toBe('10-20');
    expect(FileMention.fromToken('src/a.ts:7')?.lines).toBe('7');
    expect(FileMention.fromToken('src/a.ts')?.lines).toBeNull();
  });
});

describe('mentionedPaths', () => {
  it('글 어디서든 @로 가리킨 파일 경로를 순서대로 모은다', () => {
    expect(mentionedPaths('@src/a.ts 와 @docs/b.md 를 비교해줘').map((m) => m.path)).toEqual(['src/a.ts', 'docs/b.md']);
  });
  it('같은 파일을 여러 번 가리켜도 한 번만 센다', () => {
    expect(mentionedPaths('@a/x.ts 그리고 @a/x.ts')).toHaveLength(1);
  });
  it('이메일처럼 앞에 글자가 붙은 @는 언급이 아니다', () => {
    expect(mentionedPaths('mail me at a@b.com')).toEqual([]);
  });
  it('폴더 이름만 가리킨 @는 파일이 아니다', () => {
    expect(mentionedPaths('@api-server 결제 고쳐줘')).toEqual([]);
  });
  it('한 번에 5개까지만 받는다', () => {
    const text = Array.from({ length: 8 }, (_, i) => `@f${i}.ts`).join(' ');
    expect(mentionedPaths(text)).toHaveLength(5);
  });
  it('줄바꿈 뒤의 @도 알아본다', () => {
    expect(mentionedPaths('봐줘\n@src/a.ts').map((m) => m.path)).toEqual(['src/a.ts']);
  });
});

describe('activeMention / completeMention', () => {
  it('커서가 @글자 끝에 있으면 그 글자를 검색어로 돌려준다', () => {
    expect(activeMention('고쳐줘 @src/fo', 11)).toEqual({ start: 4, end: 11, query: 'src/fo' });
  });
  it('@만 쳤으면 검색어가 비어 있다', () => {
    expect(activeMention('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });
  it('커서 앞 글자 사이에 공백이 있으면 언급 중이 아니다', () => {
    expect(activeMention('@src/a.ts 고쳐', 12)).toBeNull();
  });
  it('단어 중간의 @(이메일)는 언급 중이 아니다', () => {
    expect(activeMention('a@b', 3)).toBeNull();
  });
  it('고르면 @경로 와 공백 하나로 바꾸고 커서를 그 뒤에 둔다', () => {
    const d = activeMention('보자 @fo 이거', 6)!;
    expect(completeMention('보자 @fo 이거', d, 'src/foo.ts')).toEqual({ text: '보자 @src/foo.ts 이거', caret: 15 });
  });
  it('뒤에 공백이 없으면 공백을 하나 붙인다', () => {
    const d = activeMention('@fo', 3)!;
    expect(completeMention('@fo', d, 'a/foo.ts')).toEqual({ text: '@a/foo.ts ', caret: 10 });
  });
});

describe('rankMentionFiles', () => {
  const paths = ['src/a.ts', 'src/b.ts', 'docs/readme.md', 'src/deep/c.ts'];
  it('검색어가 없으면 최근 연 파일을 앞에 두고 나머지는 가나다순으로 둔다', () => {
    expect(rankMentionFiles('', paths, ['src/deep/c.ts', 'docs/readme.md'], 10)).toEqual(['src/deep/c.ts', 'docs/readme.md', 'src/a.ts', 'src/b.ts']);
  });
  it('검색어가 같은 정도로 맞으면 최근 연 파일이 먼저다', () => {
    expect(rankMentionFiles('src/', paths, ['src/b.ts'], 10)[0]).toBe('src/b.ts');
  });
  it('검색어에 안 맞는 파일은 뺀다', () => {
    expect(rankMentionFiles('readme', paths, [], 10)).toEqual(['docs/readme.md']);
  });
  it('최근 목록에만 있고 실제로는 없는 파일은 보이지 않는다', () => {
    expect(rankMentionFiles('', paths, ['gone.ts'], 10)).not.toContain('gone.ts');
  });
  it('limit 개까지만 돌려준다', () => {
    expect(rankMentionFiles('', paths, [], 2)).toHaveLength(2);
  });
  it('비밀 파일 이름은 목록에 있어도 보이지 않는다', () => {
    expect(rankMentionFiles('', ['.env', 'app/.env.local', 'key.pem', 'a.ts'], [], 10)).toEqual(['a.ts']);
  });
  it('node_modules·.git·생성물 폴더 안 파일은 보이지 않는다', () => {
    expect(rankMentionFiles('', ['node_modules/x/i.js', 'a/dist/b.js', '.git/HEAD', 'a.ts'], [], 10)).toEqual(['a.ts']);
  });
});

describe('RecentFiles', () => {
  it('가장 최근에 연 것이 맨 앞이고 같은 파일은 앞으로 옮겨 한 번만 둔다', () => {
    const r = RecentFiles.empty().opened('a').opened('b').opened('a');
    expect(r.list()).toEqual(['a', 'b']);
  });
  it('20개를 넘으면 오래된 것부터 버린다', () => {
    let r = RecentFiles.empty();
    for (let i = 0; i < 25; i++) r = r.opened(`f${i}`);
    expect(r.list()).toHaveLength(20);
    expect(r.list()[0]).toBe('f24');
  });
  it('이름이 바뀌거나 지워진 파일은 목록에서 뺀다', () => {
    expect(RecentFiles.empty().opened('a').opened('b').forgot('a').list()).toEqual(['b']);
  });
});

describe('MentionedFile / withAttachments', () => {
  it('작은 파일은 앞부분 40줄까지 넣는다', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const f = MentionedFile.of('a.ts', 600, text, null);
    expect(f.head?.split('\n')).toHaveLength(40);
    expect(f.truncated).toBe(true);
  });
  it('큰 파일은 경로와 크기만 넣고 앞부분은 넣지 않는다', () => {
    expect(MentionedFile.of('a.ts', 100_000, 'x'.repeat(100), null).head).toBeNull();
  });
  it('앞부분은 2000자에서 자른다', () => {
    expect(MentionedFile.of('a.ts', 5000, 'x'.repeat(5000), null).head?.length).toBe(2000);
  });
  it('글을 못 읽은 파일(너무 큼)은 경로만 담는다', () => {
    expect(MentionedFile.of('a.ts', null, null, null).head).toBeNull();
  });
  it('요청 앞에 참고 파일 블록을 붙인다', () => {
    const f = MentionedFile.of('src/a.ts', 12, 'const a = 1;', '3-4');
    const out = withAttachments([f], [], '이거 고쳐줘');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('줄 3-4');
    expect(out).toContain('const a = 1;');
    expect(out.endsWith('이거 고쳐줘')).toBe(true);
  });
  it('앞부분에 코드 울타리가 들어 있어도 깨지지 않게 더 긴 울타리를 쓴다', () => {
    const f = MentionedFile.of('a.md', 20, '```js\nx\n```', null);
    expect(withAttachments([f], [], '요청')).toContain('````');
  });
  it('붙일 것이 없으면 요청을 그대로 둔다', () => {
    expect(withAttachments([], [], '요청')).toBe('요청');
  });
  it('이미지 경로가 있으면 Read 로 열어 보라고 알린다', () => {
    const out = withAttachments([], ['C:/data/attachments/j1/1.png'], '이 화면 고쳐줘');
    expect(out).toContain('C:/data/attachments/j1/1.png');
    expect(out).toContain('Read');
  });
});
