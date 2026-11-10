import { describe, expect, it } from 'vitest';
import { BlogNote, MANUAL_MARK } from './blog-note.js';
import { BlogRedactor } from './blog-redact.js';
import { RecordEntry, type RecordInput } from './record-book.js';

const entry = (over: Partial<RecordInput> = {}, memo = ''): RecordEntry =>
  RecordEntry.capture({
    id: 'r1',
    request: '결제 서버 타임아웃 원인 찾아줘',
    result: '원인은 DB 연결 풀이 10개로 작아서였어요.\n풀 크기를 50으로 늘렸어요.\n부하 테스트로 확인했고 통과했어요.',
    status: 'done',
    stopReason: null,
    roles: ['디버거'],
    stages: ['원인 찾기', '고치기'],
    queuedAt: '2026-11-01T10:00:00Z',
    endedAt: '2026-11-01T10:30:00Z',
    repo: 'bridge-backend',
    files: ['src/db/pool.ts', '.env'],
    approvals: [
      { tool: 'Bash', headline: 'terraform apply 실행', reason: '인프라를 바꿔요', decision: 'deny', note: null, at: '2026-11-01T10:10:00Z' },
      { tool: 'Edit', headline: 'pool.ts 고치기', reason: '', decision: 'once', note: null, at: '2026-11-01T10:15:00Z' },
    ],
    direction: { recommended: '풀 크기 늘리기', chosen: '쿼리 줄이기', reason: '비용을 아끼려고' },
    ...over,
  }, ).withMemo(memo);

const section = (note: BlogNote, id: string) => note.sections.find((s) => s.id === id);

describe('블로그 정리 노트', () => {
  it('기록에 근거가 있는 칸은 채우고 없는 칸은 직접 채우기로 둔다', () => {
    const note = BlogNote.compose([entry({ result: null, approvals: [], direction: null, stages: [] })], { length: 'detailed', snippets: [] });
    expect(section(note, 'problem')?.needsInput).toBe(false);
    expect(section(note, 'cause')?.needsInput).toBe(true);
    expect(section(note, 'solution')?.needsInput).toBe(true);
    expect(section(note, 'lesson')?.needsInput).toBe(true);
    expect(note.toMarkdown({ title: 't' })).toContain(MANUAL_MARK);
  });

  it('원인은 결과 요약에 원인 말이 있을 때만 적고 지어내지 않는다', () => {
    const withCause = BlogNote.compose([entry()], { length: 'normal', snippets: [] });
    expect(section(withCause, 'cause')?.lines.join('\n')).toContain('연결 풀');
    const without = BlogNote.compose([entry({ result: '고쳤어요.' })], { length: 'normal', snippets: [] });
    expect(section(without, 'cause')?.lines.join('\n')).not.toContain('연결 풀');
  });

  it('시도한 것에는 막힌 허락과 다르게 고른 방향이 실패로 들어간다', () => {
    const text = section(BlogNote.compose([entry()], { length: 'normal', snippets: [] }), 'attempts')!.lines.join('\n');
    expect(text).toContain('terraform apply 실행');
    expect(text).toContain('허락하지 않음');
    expect(text).toContain('쿼리 줄이기');
  });

  it('멈춘 작업은 해결 칸을 비우고 멈춘 이유를 시도한 것에 남긴다', () => {
    const note = BlogNote.compose([entry({ status: 'stopped', stopReason: '한도에 닿았어요' })], { length: 'normal', snippets: [] });
    expect(section(note, 'solution')?.needsInput).toBe(true);
    expect(section(note, 'attempts')?.lines.join('\n')).toContain('한도에 닿았어요');
  });

  it('배운 점은 메모가 있을 때만 채운다', () => {
    expect(section(BlogNote.compose([entry({}, '풀 크기는 처음부터 재 보자')], { length: 'short', snippets: [] }), 'lesson')?.lines.join('')).toContain('풀 크기는');
    expect(section(BlogNote.compose([entry()], { length: 'short', snippets: [] }), 'lesson')?.needsInput).toBe(true);
  });

  it('글 길이에 따라 들어가는 칸이 다르다', () => {
    const ids = (length: 'short' | 'normal' | 'detailed') => BlogNote.compose([entry()], { length, snippets: [] }).sections.map((s) => s.id);
    expect(ids('short')).toEqual(['problem', 'solution', 'lesson']);
    expect(ids('normal')).toEqual(['problem', 'cause', 'attempts', 'solution', 'lesson']);
    expect(ids('detailed')).toEqual(['problem', 'cause', 'attempts', 'solution', 'lesson', 'repro']);
  });

  it('제목과 태그 후보는 각각 세 개이고 서로 다르다', () => {
    const note = BlogNote.compose([entry()], { length: 'normal', snippets: [] });
    expect(new Set(note.titles()).size).toBe(3);
    expect(new Set(note.tags()).size).toBe(3);
    expect(note.titles()[0]).not.toContain('찾아줘');
    expect(note.titles()[0]).toBe('결제 서버 타임아웃 원인 찾기, 원인부터 해결까지');
  });

  it('비밀 파일은 바뀐 파일 목록에도 이름이 나오지 않는다', () => {
    const md = BlogNote.compose([entry()], { length: 'detailed', snippets: [] }).toMarkdown({ title: 't' });
    expect(md).not.toContain('.env');
    expect(md).toContain('src/db/pool.ts');
  });

  it('코드 조각은 넘겨 준 것만 들어가고 비밀 파일 모양이면 빠진다', () => {
    const none = BlogNote.compose([entry()], { length: 'normal', snippets: [] }).toMarkdown({ title: 't' });
    expect(none).not.toContain('```');
    const note = BlogNote.compose([entry()], { length: 'normal', snippets: ['pool.max = 50;', 'DB_HOST=a\nDB_PASS=b'] });
    const md = note.toMarkdown({ title: 't' });
    expect(md).toContain('pool.max = 50;');
    expect(md).not.toContain('DB_PASS');
    expect(note.droppedSnippets).toBe(1);
  });

  it('가림 함수를 거치면 레포 이름과 키가 글에 남지 않는다', () => {
    const red = BlogRedactor.create({ repoNames: ['bridge-backend'], companyNames: ['브릿지페이'], userName: 'kimbo', homePath: '/Users/kimbo' }, []);
    const note = BlogNote.compose([entry({ request: '브릿지페이 결제 장애 고쳐줘 (AKIAIOSFODNN7EXAMPLE)' }, '10.1.2.3 에서 재현')], { length: 'detailed', snippets: ['curl https://pay.brigde.co.kr'] }, (s) => red.apply(s).text);
    const md = note.toMarkdown({ title: note.titles()[0]! });
    for (const leak of ['bridge-backend', '브릿지페이', 'AKIAIOSFODNN7EXAMPLE', '10.1.2.3', 'pay.brigde']) expect(md, leak).not.toContain(leak);
  });

  it('기록이 없으면 글감이 없다', () => {
    expect(BlogNote.compose([], { length: 'normal', snippets: [] }).hasMaterial()).toBe(false);
    expect(BlogNote.compose([entry()], { length: 'normal', snippets: [] }).hasMaterial()).toBe(true);
  });

  it('여러 기록을 고르면 번호를 붙여 모은다', () => {
    const note = BlogNote.compose([entry(), entry({ id: 'r2', request: '두 번째 문제 고쳐줘' })], { length: 'short', snippets: [] });
    const problem = section(note, 'problem')!.lines.join('\n');
    expect(problem).toContain('(1)');
    expect(problem).toContain('(2)');
  });
});

describe('블로그 글 틀과 front-matter', () => {
  const note = (redact?: (s: string) => string) => BlogNote.compose([entry({}, '풀 크기는 처음부터 부하로 정하자')], { length: 'normal', snippets: [] }, redact);

  it('틀을 고르지 않으면 지금까지처럼 트러블슈팅 틀이고 제목은 # 로 시작한다', () => {
    const md = note().toMarkdown({ title: '제목' });
    expect(md.startsWith('# 제목')).toBe(true);
    expect(md).toContain('## 문제 상황');
    expect(md).toContain('## 해결');
  });
  it('틀마다 소제목이 다르다(포트폴리오·TIL·개발일지)', () => {
    expect(note().toMarkdown({ title: 't', template: 'portfolio' })).toMatch(/## 배경[\s\S]*## 결과/);
    const til = note().toMarkdown({ title: 't', template: 'til' });
    expect(til).toContain('## 오늘 배운 것');
    expect(til).not.toContain('## 원인 추정');
    expect(note().toMarkdown({ title: 't', template: 'devlog' })).toMatch(/## 오늘 한 일[\s\S]*## 막힌 곳[\s\S]*## 내일 할 일/);
  });
  it('근거 없는 칸은 틀이 달라도 지어내지 않고 직접 채우기로 둔다', () => {
    const md = BlogNote.compose([entry({ result: null, approvals: [], direction: null, stages: [] })], { length: 'normal', snippets: [] }).toMarkdown({ title: 't', template: 'devlog' });
    expect(md).toContain(MANUAL_MARK);
  });
  it('front-matter를 켜면 제목·태그·날짜가 --- 사이에 들어가고 본문에는 # 제목과 태그 줄이 없다', () => {
    const md = note().toMarkdown({ title: '결제 "타임아웃"', tags: ['AWS', '회고'], frontMatter: true, date: '2026-11-10' });
    expect(md.startsWith('---\ntitle: "결제 \\"타임아웃\\""\ntags: [AWS, 회고]\ndate: 2026-11-10\n---\n')).toBe(true);
    expect(md).not.toMatch(/^# /m);
    expect(md).not.toContain('태그:');
  });
  it('front-matter를 끄면 front-matter 없이 # 제목과 #태그 줄이 나온다', () => {
    const md = note().toMarkdown({ title: '제목', tags: ['AWS'], frontMatter: false });
    expect(md).not.toContain('---\ntitle');
    expect(md).toContain('태그: #AWS');
  });
  it('front-matter의 제목·태그도 가림 함수를 거친다', () => {
    const md = note((s) => s.replace(/악메/g, '○○')).toMarkdown({ title: '악메 결제', tags: ['악메'], frontMatter: true, date: '2026-11-10' });
    expect(md).toContain('title: "○○ 결제"');
    expect(md).toContain('tags: [○○]');
    expect(md).not.toContain('악메');
  });
  it('제목의 줄바꿈은 front-matter를 깨지 않게 공백으로 바꾼다', () => {
    const md = note().toMarkdown({ title: '첫 줄\n---\n둘째', frontMatter: true, date: '2026-11-10' });
    expect(md.split('\n').filter((l) => l === '---')).toHaveLength(2);
  });
});
