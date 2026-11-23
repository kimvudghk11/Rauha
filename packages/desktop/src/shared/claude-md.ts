/**
 * 사용자의 Claude Code 설정(~/.claude/CLAUDE.md)과 그 안의 @import 를 rauha 팀원에게도 그대로 건다.
 * rauha 팀원은 계정을 나누려고 자기 설정 폴더(CLAUDE_CONFIG_DIR)를 써서 ~/.claude 를 못 본다(2026-11-24 회사 룰이 안 먹던 원인).
 * 읽기만 한다. 비밀 파일·글이 아닌 파일은 import 해도 읽지 않는다. 경로는 슬래시로 다룬다.
 */
const IMPORT = /(^|\s)@((?:~[\\/]|\/|[A-Za-z]:[\\/]|\.{1,2}[\\/])[^\s`'"<>|]+)/g;
const TEXT_FILE = /\.(md|markdown|mdc|txt)$/i;
const SECRET_NAME = /(^|\/)(\.env(\..*)?|\.credentials\.json|credentials(\.json)?|id_(rsa|ed25519|ecdsa|dsa))$|\.(pem|key|p12|pfx)$/i;
const MAX_DEPTH = 4;
const MAX_FILES = 20;
export const CLAUDE_MD_CHARS = 60_000;

const slash = (p: string): string => p.replace(/\\/g, '/');

/** 글 속 @import 경로들(코드 블록·인라인 코드 안은 빼고, 나온 순서대로) */
export function claudeMdImports(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, ' ');
    for (const m of plain.matchAll(IMPORT)) out.push(m[2]!.replace(/[.,;:)\]]+$/, ''));
  }
  return out;
}

/** import 경로를 절대 경로로: ~ 는 home, 상대 경로는 그 파일이 있는 폴더 기준 */
function resolveImport(ref: string, fromFile: string, home: string): string {
  const r = slash(ref);
  if (r.startsWith('~/')) return normalize(`${slash(home).replace(/\/+$/, '')}/${r.slice(2)}`);
  if (/^(\/|[A-Za-z]:\/)/.test(r)) return normalize(r);
  const dir = slash(fromFile).replace(/\/[^/]*$/, '');
  return normalize(`${dir}/${r}`);
}

function normalize(p: string): string {
  const drive = /^[A-Za-z]:/.exec(p)?.[0] ?? '';
  const parts: string[] = [];
  for (const seg of p.slice(drive.length).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `${drive}/${parts.join('/')}`;
}

/**
 * CLAUDE.md 와 그 import 를 따라 읽어 한 글로 잇는다(깊이·파일 수·글자 한도 안에서, 같은 파일은 한 번만).
 * read: 절대 경로 → 내용(없거나 못 읽으면 null). files: 실제로 읽은 파일.
 */
export function expandClaudeMd(rootFile: string, read: (path: string) => string | null, home: string, maxChars = CLAUDE_MD_CHARS): { text: string; files: string[] } {
  const seen = new Set<string>();
  const files: string[] = [];
  const parts: string[] = [];
  const visit = (path: string, depth: number): void => {
    const key = path.toLowerCase();
    if (seen.has(key) || files.length >= MAX_FILES) return;
    seen.add(key);
    if (depth > 0 && (!TEXT_FILE.test(path) || SECRET_NAME.test(path))) return;
    const text = read(path);
    if (text === null) return;
    files.push(path);
    parts.push(depth === 0 ? text.trim() : `<!-- @import ${path} -->\n${text.trim()}`);
    if (depth >= MAX_DEPTH) return;
    for (const ref of claudeMdImports(text)) visit(resolveImport(ref, path, home), depth + 1);
  };
  visit(normalize(slash(rootFile)), 0);
  const joined = parts.join('\n\n');
  return { text: joined.length > maxChars ? `${joined.slice(0, maxChars)}\n…(잘림)` : joined, files };
}
