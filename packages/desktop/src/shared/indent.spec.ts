import { describe, expect, it } from 'vitest';
import { applicableConfigs, editorConfigFor, globToRegExp, parseEditorConfig } from './editor-config.js';
import { chooseIndent, detectIndent } from './indent.js';

describe('파일 내용에서 들여쓰기 알아내기', () => {
  it('스페이스 2칸씩 들어가면 2칸이다', () => {
    expect(detectIndent('a {\n  b {\n    c\n  }\n}\n')).toEqual({ unit: 'space', size: 2 });
  });

  it('스페이스 4칸씩 들어가면 4칸이다', () => {
    expect(detectIndent('def f():\n    if x:\n        y\n    z\n')).toEqual({ unit: 'space', size: 4 });
  });

  it('탭으로 시작하는 줄이 많으면 탭이다', () => {
    expect(detectIndent('a {\n\tb\n\tc {\n\t\td\n\t}\n}\n')).toEqual({ unit: 'tab', size: 4 });
  });

  it('들여쓴 줄이 없으면 알 수 없다', () => {
    expect(detectIndent('a\nb\n')).toBeNull();
    expect(detectIndent('')).toBeNull();
  });

  it('주석의 " * " 정렬 줄은 들여쓰기로 세지 않는다', () => {
    expect(detectIndent('/**\n * x\n * y\n */\nfunction f() {\n  return 1;\n}\n')).toEqual({ unit: 'space', size: 2 });
  });

  it('모든 들여쓴 줄이 같은 폭이면 그 폭을 한 단계로 본다', () => {
    expect(detectIndent('a:\n    b\n    c\n')).toEqual({ unit: 'space', size: 4 });
  });
});

describe('들여쓰기 정하기', () => {
  it('.editorconfig가 파일 내용보다 먼저다', () => {
    expect(chooseIndent({ indent_style: 'space', indent_size: '4' }, { unit: 'tab', size: 4 }, 2)).toEqual({ unit: 'space', size: 4, tabWidth: 4, source: 'editorconfig' });
  });

  it('indent_size = tab 이면 탭이고 너비는 tab_width를 따른다', () => {
    expect(chooseIndent({ indent_size: 'tab', tab_width: '8' }, null, 2)).toMatchObject({ unit: 'tab', size: 8, tabWidth: 8, source: 'editorconfig' });
  });

  it('설정이 없으면 내용에서 알아낸 값을 쓴다', () => {
    expect(chooseIndent({}, { unit: 'space', size: 4 }, 2)).toEqual({ unit: 'space', size: 4, tabWidth: 4, source: 'detected' });
  });

  it('아무 근거가 없으면 기본값을 쓴다', () => {
    expect(chooseIndent({}, null, 2)).toEqual({ unit: 'space', size: 2, tabWidth: 4, source: 'default' });
  });

  it('indent_style만 탭이고 크기가 없으면 알아낸 탭 너비나 4를 쓴다', () => {
    expect(chooseIndent({ indent_style: 'tab' }, null, 2)).toMatchObject({ unit: 'tab', size: 4 });
  });

  it('말이 안 되는 숫자는 무시한다', () => {
    expect(chooseIndent({ indent_size: '999' }, null, 2)).toMatchObject({ unit: 'space', size: 2, source: 'default' });
  });
});

describe('.editorconfig 읽기', () => {
  it('root와 구간을 읽고 키·값을 소문자로 맞춘다', () => {
    const c = parseEditorConfig('# 주석\nroot = true\n\n[*]\nIndent_Style = Space\nindent_size = 2 # 두 칸\n\n[*.py]\nindent_size = 4\n');
    expect(c.root).toBe(true);
    expect(c.sections).toEqual([
      { glob: '*', props: { indent_style: 'space', indent_size: '2' } },
      { glob: '*.py', props: { indent_size: '4' } },
    ]);
  });

  it('구간 앞의 root 말고는 root로 보지 않는다', () => {
    expect(parseEditorConfig('[*]\nroot = true\n').root).toBe(false);
  });

  it('글롭: * 는 폴더 구분을 넘지 않고 ** 는 넘는다', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false);
    expect(globToRegExp('src/**.ts').test('src/x/a.ts')).toBe(true);
  });

  it('글롭: {a,b}와 {1..3}과 [abc]', () => {
    expect(globToRegExp('*.{js,ts}').test('a.ts')).toBe(true);
    expect(globToRegExp('*.{js,ts}').test('a.py')).toBe(false);
    expect(globToRegExp('f{1..3}').test('f2')).toBe(true);
    expect(globToRegExp('f{1..3}').test('f4')).toBe(false);
    expect(globToRegExp('[ab].x').test('b.x')).toBe(true);
    expect(globToRegExp('[!ab].x').test('b.x')).toBe(false);
  });

  it('값은 가까운 파일, 뒤쪽 구간이 앞을 덮는다', () => {
    const outer = { dir: '', parsed: parseEditorConfig('[*]\nindent_style = space\nindent_size = 2\n[*.py]\nindent_size = 4\n') };
    const inner = { dir: 'web', parsed: parseEditorConfig('[*.ts]\nindent_style = tab\n') };
    expect(editorConfigFor([outer, inner], 'web/src/a.ts')).toEqual({ indent_style: 'tab', indent_size: '2' });
    expect(editorConfigFor([outer, inner], 'tools/a.py')).toEqual({ indent_style: 'space', indent_size: '4' });
  });

  it('다른 폴더의 설정은 적용되지 않는다', () => {
    const other = { dir: 'web', parsed: parseEditorConfig('[*]\nindent_size = 8\n') };
    expect(editorConfigFor([other], 'api/a.ts')).toEqual({});
  });

  it('root = true 를 만나면 더 바깥 설정은 쓰지 않는다', () => {
    const files = [
      { dir: 'a', parsed: parseEditorConfig('root = true\n[*]\nx = 1\n') },
      { dir: '', parsed: parseEditorConfig('[*]\nx = 2\n') },
    ];
    expect(applicableConfigs(files).map((f) => f.dir)).toEqual(['a']);
  });
});
