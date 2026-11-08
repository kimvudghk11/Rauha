/** 구문 색을 입힐 언어. 화면이 이 이름을 편집기 언어 확장으로 바꾼다. */
export type CodeLanguage = 'plain' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'json' | 'css' | 'html' | 'markdown' | 'python' | 'java' | 'yaml' | 'xml' | 'sql' | 'rust' | 'cpp' | 'go' | 'shell' | 'toml' | 'properties' | 'dockerfile';

const BY_EXTENSION: Readonly<Record<string, CodeLanguage>> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', json5: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', py: 'python', pyw: 'python', java: 'java', kt: 'java', kts: 'java',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', xsd: 'xml', plist: 'xml', csproj: 'xml', sql: 'sql', rs: 'rust',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', go: 'go', sh: 'shell', bash: 'shell', zsh: 'shell',
  toml: 'toml', ini: 'properties', cfg: 'properties', properties: 'properties', env: 'properties',
};

const BY_NAME: Readonly<Record<string, CodeLanguage>> = {
  dockerfile: 'dockerfile', '.gitignore': 'properties', '.editorconfig': 'properties', '.bashrc': 'shell', '.zshrc': 'shell', '.babelrc': 'json', '.eslintrc': 'json', '.prettierrc': 'json',
};

/** 파일 이름으로 언어를 고른다. 모르면 plain. */
export function languageOf(fileName: string): CodeLanguage {
  const name = fileName.toLowerCase();
  const byName = BY_NAME[name];
  if (byName !== undefined) return byName;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? 'plain' : (BY_EXTENSION[name.slice(dot + 1)] ?? 'plain');
}

/** 기본 들여쓰기 스페이스 수: 웹·설정 언어는 2, 그 밖은 4 */
export function defaultIndentSize(language: CodeLanguage): number {
  return ['javascript', 'typescript', 'jsx', 'tsx', 'json', 'css', 'html', 'yaml', 'xml', 'markdown'].includes(language) ? 2 : 4;
}
