import type { EditorConfigProps } from './indent.js';

interface Section {
  readonly glob: string;
  readonly props: EditorConfigProps;
}

/** .editorconfig 파일 하나를 읽은 것 */
export interface ParsedEditorConfig {
  readonly root: boolean;
  readonly sections: readonly Section[];
}

/** 파일 하나 + 그 파일이 있는 폴더(작업 폴더 기준, 슬래시, 작업 폴더 자신은 '') */
export interface EditorConfigFile {
  readonly dir: string;
  readonly parsed: ParsedEditorConfig;
}

/** .editorconfig 글을 읽는다. 모르는 줄은 건너뛴다. 키와 값은 소문자로 맞춘다(규격이 대소문자를 가리지 않는다). */
export function parseEditorConfig(text: string): ParsedEditorConfig {
  let root = false;
  const sections: { glob: string; props: Record<string, string> }[] = [];
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      sections.push({ glob: header[1], props: {} });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line
      .slice(eq + 1)
      .replace(/\s+[#;].*$/, '')
      .trim()
      .toLowerCase();
    const current = sections[sections.length - 1];
    if (current !== undefined) current.props[key] = value;
    else if (key === 'root') root = value === 'true';
  }
  return { root, sections };
}

/** `{a,b}` 와 `{1..3}` 를 정규식 묶음으로 바꾸며 glob 한 줄을 정규식으로 만든다. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        out += '.*';
        i++;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) out += '\\[';
      else {
        const body = glob.slice(i + 1, end);
        out += `[${body.startsWith('!') ? '^' : ''}${body.replace(/^!/, '').replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (c === '{') {
      const end = glob.indexOf('}', i + 1);
      const body = end < 0 ? null : glob.slice(i + 1, end);
      const range = body === null ? null : /^(-?\d+)\.\.(-?\d+)$/.exec(body);
      if (range?.[1] !== undefined && range[2] !== undefined && end >= 0) {
        out += `(?:${rangeAlternatives(Number(range[1]), Number(range[2]))})`;
        i = end;
      } else if (body !== null && body.includes(',')) {
        depth++;
        out += '(?:';
      } else out += '\\{';
    } else if (c === '}' && depth > 0) {
      depth--;
      out += ')';
    } else if (c === ',' && depth > 0) out += '|';
    else if (c === '\\' && i + 1 < glob.length) {
      out += escapeRegExp(glob.charAt(i + 1));
      i++;
    } else out += escapeRegExp(c);
  }
  return new RegExp(`^${out}$`);
}

const escapeRegExp = (s: string): string => s.replace(/[.+^$()|{}[\]\\/]/g, '\\$&');

function rangeAlternatives(a: number, b: number): string {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (hi - lo > 200) return '\\d+';
  const parts: number[] = [];
  for (let n = lo; n <= hi; n++) parts.push(n);
  return parts.join('|');
}

/** 구간 글롭이 이 파일(설정 파일이 있는 폴더 기준 상대 경로)에 맞는지. `/`가 없으면 어느 깊이의 이름에도 맞는다. */
export function sectionMatches(glob: string, relFromConfig: string): boolean {
  const anchored = glob.includes('/');
  const pattern = anchored ? glob.replace(/^\//, '') : `**/${glob}`;
  return globToRegExp(pattern).test(relFromConfig) || (!anchored && globToRegExp(glob).test(relFromConfig));
}

/**
 * 파일 하나에 적용되는 값. files는 작업 폴더에 가까운 쪽(바깥)부터 파일에 가장 가까운 쪽 순서이고,
 * 뒤에 오는 값이 앞을 덮는다. relPath는 작업 폴더 기준 슬래시 경로.
 */
export function editorConfigFor(files: readonly EditorConfigFile[], relPath: string): EditorConfigProps {
  const props: Record<string, string> = {};
  for (const file of files) {
    const rel = file.dir === '' ? relPath : relPath.startsWith(`${file.dir}/`) ? relPath.slice(file.dir.length + 1) : null;
    if (rel === null) continue;
    for (const section of file.parsed.sections) {
      if (sectionMatches(section.glob, rel)) Object.assign(props, section.props);
    }
  }
  return props;
}

/** 바깥으로 거슬러 올라가며 읽을 때, root = true 를 만나면 거기서 멈춘다. files는 가까운 쪽부터 온 목록. */
export function applicableConfigs(nearestFirst: readonly EditorConfigFile[]): EditorConfigFile[] {
  const kept: EditorConfigFile[] = [];
  for (const file of nearestFirst) {
    kept.push(file);
    if (file.parsed.root) break;
  }
  return kept.reverse();
}
