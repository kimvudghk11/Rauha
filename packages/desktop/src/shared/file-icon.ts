/** 파일·폴더 이름으로 아이콘 이름(키)을 고른다. 그림은 renderer/file-icons.ts가 키로 찾는다. */

const FOLDER_KIND: Readonly<Record<string, string>> = {
  src: 'src', lib: 'lib', dist: 'out', build: 'out', out: 'out', node_modules: 'modules', docs: 'docs', doc: 'docs',
  test: 'test', tests: 'test', __tests__: 'test', scripts: 'scripts', config: 'config', configs: 'config',
  public: 'assets', assets: 'assets', images: 'assets', components: 'components', packages: 'packages',
  '.git': 'git', '.github': 'github', '.vscode': 'vscode',
  api: 'api', routes: 'api', db: 'db', database: 'db', migrations: 'db', styles: 'styles', utils: 'utils', helpers: 'utils', types: 'types', hooks: 'hooks', static: 'assets', bin: 'scripts',
};

const EXT_ICON: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', json: 'json', md: 'md', mdx: 'md',
  css: 'css', scss: 'scss', html: 'html', vue: 'vue', svelte: 'svelte', py: 'py', go: 'go', rs: 'rs', java: 'java',
  kt: 'kt', swift: 'swift', c: 'c', cpp: 'cpp', h: 'h', cs: 'cs', rb: 'rb', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'ps1', bat: 'bat', sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  xml: 'xml', csv: 'csv', txt: 'txt', log: 'log', lock: 'lock', env: 'env', pem: 'key', key: 'key',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', ico: 'img', bmp: 'img', avif: 'img', svg: 'svg',
  mts: 'ts', cts: 'ts', jsonc: 'json', json5: 'json', htm: 'html', sass: 'scss', less: 'css', graphql: 'graphql', gql: 'graphql', lua: 'lua', dart: 'dart',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', webm: 'video', mkv: 'video', avi: 'video', '7z': 'zip', rar: 'zip', fish: 'sh', cmd: 'bat',
  pdf: 'pdf', zip: 'zip', tar: 'zip', gz: 'zip', dmg: 'zip', exe: 'exe', mp4: 'video', mov: 'video', mp3: 'audio',
};

const NAME_ICON: Readonly<Record<string, string>> = {
  'package.json': 'pkg', 'package-lock.json': 'lock', 'yarn.lock': 'lock', 'pnpm-lock.yaml': 'lock',
  dockerfile: 'docker', makefile: 'make', 'claude.md': 'claude', '.gitignore': 'git', '.gitattributes': 'git',
  '.gitmodules': 'git', '.gitkeep': 'git', '.editorconfig': 'editorconfig', '.dockerignore': 'docker',
  '.npmrc': 'config', '.nvmrc': 'config', '.prettierignore': 'config', '.eslintignore': 'config', '.browserslistrc': 'config', '.yarnrc.yml': 'config',
  'cargo.toml': 'pkg', 'pyproject.toml': 'pkg', 'requirements.txt': 'pkg', 'go.mod': 'pkg', gemfile: 'pkg', 'cargo.lock': 'lock', 'go.sum': 'lock', 'composer.lock': 'lock', 'gemfile.lock': 'lock',
};

export function iconFor(name: string, isDir: boolean, open: boolean): string {
  const n = name.toLowerCase();
  if (isDir) {
    const kind = FOLDER_KIND[n];
    return `${kind === undefined ? 'folder' : `folder-${kind}`}${open ? '-open' : ''}`;
  }
  const byName = NAME_ICON[n];
  if (byName !== undefined) return byName;
  if (n === '.env' || n.startsWith('.env.')) return 'env';
  if (/^tsconfig.*\.json$/.test(n)) return 'tsconfig';
  if (/^[\w-]+\.config\.[cm]?[jt]s$/.test(n) ||/^\.?eslintrc/.test(n) || /^eslint\.config\./.test(n) || /^\.?prettier(rc|\.config)/.test(n)) return 'config';
  if (/^docker-compose.*\.ya?ml$/.test(n)) return 'docker';
  if (/^(readme|changelog|contributing)(\.|$)/.test(n)) return 'readme';
  if (/^license(\.|$)/.test(n)) return 'license';
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(n)) return 'test';
  const dot = n.lastIndexOf('.');
  if (dot <= 0 || dot === n.length - 1) return 'file';
  return EXT_ICON[n.slice(dot + 1)] ?? 'file';
}
