import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, GutterMarker, gutter, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { LineMark } from '../shared/code-changes.js';
import type { CodeLanguage } from '../shared/code-language.js';
import type { Indent } from '../shared/indent.js';

/** index.html의 CSP(style-src)에 같은 값이 있어야 편집기 스타일이 적용된다 */
export const STYLE_NONCE = 'rauha-cm';

/** VS Code Dark Modern 색 */
const C = { bg: '#1f1f1f', fg: '#cccccc', gutter: '#6e7681', gutterActive: '#cccccc', line: '#ffffff0a', sel: '#264f78', cursor: '#aeafad', match: '#515c6a', panel: '#252526', border: '#2b2b2b', input: '#313131', accent: '#0078d4' };

const theme = EditorView.theme(
  {
    '&': { color: C.fg, backgroundColor: C.bg, height: '100%', fontSize: '13px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'Consolas, "Cascadia Code", "D2Coding", Menlo, monospace', lineHeight: '1.55', overflow: 'auto' },
    '.cm-content': { caretColor: C.cursor, padding: '6px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: C.cursor },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: C.sel },
    '.cm-activeLine': { backgroundColor: C.line },
    '.cm-gutters': { backgroundColor: C.bg, color: C.gutter, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: C.gutterActive },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 20px', minWidth: '44px' },
    '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 4px' },
    '.cm-selectionMatch': { backgroundColor: '#3a3d41' },
    '.cm-searchMatch': { backgroundColor: '#ea5c0055', outline: '1px solid #ea5c0088' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: C.match },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: '#0064001a', outline: '1px solid #888' },
    '.cm-foldPlaceholder': { backgroundColor: C.input, border: 'none', color: C.gutter },
    '.cm-panels': { backgroundColor: C.panel, color: C.fg, borderColor: C.border },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${C.border}` },
    '.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px', padding: '6px 28px 6px 8px', fontSize: '12px' },
    '.cm-search br': { display: 'none' },
    '.cm-search input, .cm-search button': { fontSize: '12px', color: C.fg, backgroundColor: C.input, border: `1px solid ${C.border}`, borderRadius: '3px', padding: '2px 7px', margin: 0 },
    '.cm-search input:focus': { outline: `1px solid ${C.accent}` },
    '.cm-search button': { cursor: 'pointer', backgroundImage: 'none' },
    '.cm-search button:hover': { backgroundColor: '#3c3c3c' },
    '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#9d9d9d' },
    '.cm-search [name=close]': { position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', color: '#9d9d9d', fontSize: '16px' },
    '.cm-changes': { width: '5px', marginRight: '3px' },
    '.cm-change': { width: '3px', height: '100%', marginLeft: '1px' },
    '.cm-change-added': { backgroundColor: '#2ea043' },
    '.cm-change-modified': { backgroundColor: '#0078d4' },
    '.cm-change-deleted': { height: '0', borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '5px solid #f85149', marginTop: '-4px', backgroundColor: 'transparent' },
    '.cm-tooltip': { backgroundColor: C.panel, border: `1px solid ${C.border}`, color: C.fg },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6a9955' },
  { tag: [t.string, t.special(t.string)], color: '#ce9178' },
  { tag: [t.number, t.integer, t.float], color: '#b5cea8' },
  { tag: [t.bool, t.null, t.atom, t.self], color: '#569cd6' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.keyword, t.definitionKeyword, t.operatorKeyword, t.modifier, t.unit], color: '#569cd6' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#dcdcaa' },
  { tag: [t.typeName, t.className, t.namespace], color: '#4ec9b0' },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], color: '#9cdcfe' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#9cdcfe' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket], color: '#d4d4d4' },
  { tag: t.tagName, color: '#569cd6' },
  { tag: [t.regexp, t.escape], color: '#d16969' },
  { tag: [t.meta, t.processingInstruction], color: '#9d9d9d' },
  { tag: t.heading, color: '#569cd6', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#3794ff', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.invalid, color: '#f44747' },
]);

/** 편집기 왼쪽 변경 표시(git): 새 줄 초록, 고친 줄 파랑, 지워진 자리 빨강. 글을 고치면 표시도 줄을 따라 움직인다. */
class ChangeMarker extends GutterMarker {
  constructor(private readonly kind: LineMark['kind']) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.kind === this.kind;
  }
  override toDOM(): Node {
    const d = document.createElement('div');
    d.className = `cm-change cm-change-${this.kind}`;
    return d;
  }
}
const MARKERS = { added: new ChangeMarker('added'), modified: new ChangeMarker('modified'), deleted: new ChangeMarker('deleted') } as const;
const setMarks = StateEffect.define<readonly LineMark[]>();

function buildMarks(doc: Text, marks: readonly LineMark[]): RangeSet<GutterMarker> {
  const placed: { from: number; kind: LineMark['kind'] }[] = [];
  for (const m of marks) {
    for (let n = Math.max(1, m.from); n <= Math.min(m.to, doc.lines); n++) placed.push({ from: doc.line(n).from, kind: m.kind });
    if (m.kind === 'deleted' && m.from > doc.lines) placed.push({ from: doc.line(doc.lines).from, kind: 'deleted' });
  }
  placed.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const p of placed) builder.add(p.from, p.from, MARKERS[p.kind]);
  return builder.finish();
}

const marksField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(setMarks)) next = buildMarks(tr.state.doc, e.value);
    return next;
  },
});

const PHRASES: Record<string, string> = {
  Find: 'Find',
  Replace: 'Replace with',
  next: 'Next',
  previous: 'Previous',
  all: 'All',
  'match case': 'Match case',
  regexp: 'Regex',
  'by word': 'Word',
  replace: 'Replace',
  'replace all': 'Replace all',
  close: 'Close',
  'Go to line': 'Go to line',
  go: 'Go',
  'Selection deleted': 'Selection deleted',
};

export function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case 'javascript': return javascript();
    case 'typescript': return javascript({ typescript: true });
    case 'jsx': return javascript({ jsx: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'json': return json();
    case 'css': return css();
    case 'html': return html();
    case 'markdown': return markdown();
    case 'python': return python();
    case 'java': return java();
    case 'yaml': return yaml();
    case 'xml': return xml();
    case 'sql': return sql();
    case 'rust': return rust();
    case 'cpp': return cpp();
    case 'go': return go();
    case 'shell': return StreamLanguage.define(shell);
    case 'toml': return StreamLanguage.define(toml);
    case 'properties': return StreamLanguage.define(properties);
    case 'dockerfile': return StreamLanguage.define(dockerFile);
    case 'plain': return [];
  }
}

export interface EditorHooks {
  /** 글이 바뀌었다 */
  readonly onChange: () => void;
  /** 커서 위치(1부터) */
  readonly onCursor: (line: number, column: number) => void;
}

/** 편집기 한 개. 파일마다 상태(되돌리기 기록·커서)를 따로 갖고, 탭을 바꿀 때 상태만 바꿔 끼운다. */
export class CodeEditor {
  private readonly view: EditorView;
  private readonly states = new Map<string, EditorState>();
  private readonly scrolls = new Map<string, number>();
  private current: string | null = null;

  constructor(parent: HTMLElement, private readonly hooks: EditorHooks) {
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '' }) });
  }

  private makeState(text: string, language: CodeLanguage, indent: Indent, readOnly: boolean): EditorState {
    const unit = indent.unit === 'tab' ? '\t' : ' '.repeat(indent.size);
    return EditorState.create({
      doc: text,
      extensions: [
        EditorView.cspNonce.of(STYLE_NONCE),
        EditorState.phrases.of(PHRASES),
        lineNumbers(),
        highlightActiveLineGutter(),
        marksField,
        gutter({ class: 'cm-changes', markers: (v) => v.state.field(marksField) }),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(highlight),
        bracketMatching(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        indentUnit.of(unit),
        EditorState.tabSize.of(indent.tabWidth),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        languageExtension(language),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.hooks.onChange();
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            this.hooks.onCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    });
  }

  /** 파일을 처음 열 때 상태를 만든다 */
  add(path: string, text: string, language: CodeLanguage, indent: Indent, readOnly: boolean): void {
    this.states.set(path, this.makeState(text, language, indent, readOnly));
  }

  /** 디스크 글로 통째로 바꾼다(되돌리기·다시 불러오기). 되돌리기 기록도 새로 시작한다. */
  replace(path: string, text: string, language: CodeLanguage, indent: Indent, readOnly: boolean): void {
    this.add(path, text, language, indent, readOnly);
    if (this.current === path) this.view.setState(this.states.get(path)!);
  }

  /** 파일 이름이 바뀌었다: 글·커서·되돌리기 기록을 새 경로 몫으로 옮긴다 */
  rename(from: string, to: string): void {
    const state = from === this.current ? this.view.state : this.states.get(from);
    if (state === undefined) return;
    const scroll = from === this.current ? this.view.scrollDOM.scrollTop : this.scrolls.get(from);
    this.states.delete(from);
    this.scrolls.delete(from);
    this.states.set(to, state);
    if (scroll !== undefined) this.scrolls.set(to, scroll);
    if (this.current === from) this.current = to;
  }

  has(path: string): boolean {
    return this.states.has(path);
  }

  /** 이 파일을 화면에 보인다 */
  show(path: string): void {
    this.remember();
    const state = this.states.get(path);
    if (state === undefined) return;
    this.current = path;
    this.view.setState(state);
    const top = this.scrolls.get(path) ?? 0;
    requestAnimationFrame(() => (this.view.scrollDOM.scrollTop = top));
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this.hooks.onCursor(line.number, head - line.from + 1);
  }

  /** 지금 화면 상태를 파일 몫으로 저장해 둔다 */
  private remember(): void {
    if (this.current === null) return;
    this.states.set(this.current, this.view.state);
    this.scrolls.set(this.current, this.view.scrollDOM.scrollTop);
  }

  remove(path: string): void {
    this.states.delete(path);
    this.scrolls.delete(path);
    if (this.current === path) this.current = null;
  }

  /** 보고 있는 파일의 글. 보고 있지 않은 파일은 저장해 둔 상태에서 읽는다. */
  textOf(path: string): string | null {
    if (this.current === path) return this.view.state.doc.toString();
    return this.states.get(path)?.doc.toString() ?? null;
  }

  /** 글자 수만 빠르게(수정 표시 비교 전에 길이부터 본다) */
  lengthOf(path: string): number | null {
    if (this.current === path) return this.view.state.doc.length;
    return this.states.get(path)?.doc.length ?? null;
  }

  /** 지금 고른 글(여러 개 고른 경우 마지막으로 고른 하나)과 그 줄 범위. 아무것도 안 골랐으면 null. 끝이 다음 줄 맨 앞이면 그 줄은 넣지 않는다. */
  selection(): { fromLine: number; toLine: number; text: string } | null {
    const { from, to } = this.view.state.selection.main;
    if (from === to) return null;
    const doc = this.view.state.doc;
    return { fromLine: doc.lineAt(from).number, toLine: doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to).number, text: doc.sliceString(from, to) };
  }

  /** 저장된 내용이 HEAD와 다른 줄을 왼쪽에 표시한다 */
  setMarks(path: string, marks: readonly LineMark[]): void {
    if (this.current === path) {
      this.view.dispatch({ effects: setMarks.of(marks) });
      return;
    }
    const state = this.states.get(path);
    if (state !== undefined) this.states.set(path, state.update({ effects: setMarks.of(marks) }).state);
  }

  /** 지금 보는 파일의 해당 줄·칸으로 가서 가운데에 보인다 */
  goto(line: number, column: number): void {
    const doc = this.view.state.doc;
    const l = doc.line(Math.min(Math.max(1, line), doc.lines));
    const anchor = Math.min(l.from + Math.max(0, column - 1), l.to);
    this.view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
  }

  focus(): void {
    this.view.focus();
  }

  hide(): void {
    this.remember();
    this.current = null;
    this.view.setState(EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), theme] }));
  }

  destroy(): void {
    this.view.destroy();
  }
}
