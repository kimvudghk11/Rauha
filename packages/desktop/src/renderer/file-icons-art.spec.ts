import { describe, expect, it } from 'vitest';
import { iconFor } from '../shared/file-icon.js';
import { allIconKeys, isKnownIcon, symbolFor } from './file-icons-art.js';

const FILES = ['a.ts', 'a.tsx', 'a.js', 'a.json', 'a.md', 'a.css', 'a.scss', 'a.html', 'a.py', 'a.go', 'a.rs', 'a.yml', 'a.toml', 'a.csv', 'a.png', 'a.svg', 'a.pdf', 'a.zip', 'a.woff2', 'a.mp3', 'a.mp4', 'a.sql', 'a.sh',
  'package.json', 'yarn.lock', 'README.md', 'LICENSE', '.gitignore', 'Dockerfile', 'tsconfig.json', 'a.spec.ts', '.env', 'CLAUDE.md', 'Makefile', 'cert.pem', '.editorconfig', 'vite.config.ts'];
const FOLDERS = ['src', 'test', 'docs', 'node_modules', 'dist', '.git', '.github', '.vscode', 'api', 'db', 'styles', 'utils', 'types', 'hooks', 'assets', 'scripts', 'components', 'packages', 'config', 'lib', 'whatever'];

describe('아이콘 그림', () => {
  it('파일 이름 규칙이 고르는 키는 모두 그림이 있다', () => {
    for (const n of FILES) expect(isKnownIcon(iconFor(n, false, false)), n).toBe(true);
    for (const n of FOLDERS) for (const open of [false, true]) expect(isKnownIcon(iconFor(n, true, open)), `${n} ${open}`).toBe(true);
  });
  it('모든 키는 안쪽 그림과 색이 있다', () => {
    for (const k of allIconKeys()) {
      const s = symbolFor(k);
      expect(s.body.length, k).toBeGreaterThan(20);
      expect(s.tone, k).toBeTruthy();
    }
  });
  it('종류가 다르면 모양이 다르다(같은 모양으로 뭉치지 않는다)', () => {
    const shapes = new Set(['ts', 'md', 'json', 'pkg', 'git', 'docker', 'test', 'img', 'lock', 'config'].map((k) => symbolFor(k).body));
    expect(shapes.size).toBe(10);
  });
  it('폴더 종류마다 안쪽 그림이 다르다', () => {
    const shapes = new Set(['folder-src', 'folder-test', 'folder-docs', 'folder-modules', 'folder-git', 'folder-api'].map((k) => symbolFor(k).body));
    expect(shapes.size).toBe(6);
  });
  it('정해지지 않은 키는 기본 문서 그림이다', () => {
    expect(isKnownIcon('nope')).toBe(false);
    expect(symbolFor('nope').tone).toBe('gray');
  });
});
