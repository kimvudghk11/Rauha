import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dependencyManifests, parseGoMod, parseGradle, parsePackageJson, parsePom, parseRequirements } from './manifests.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('의존성 파일 읽기', () => {
  it('package.json: 런타임과 개발용을 나눈다(깨진 JSON 이면 비운다)', () => {
    expect(parsePackageJson('{"dependencies":{"axios":"^1.6.0"},"devDependencies":{"vitest":"^3.0.0"}}')).toEqual([
      { name: 'axios', version: '^1.6.0', dev: false },
      { name: 'vitest', version: '^3.0.0', dev: true },
    ]);
    expect(parsePackageJson('{')).toEqual([]);
  });

  it('go.mod: 한 줄 require 와 묶음 require 를 모두 읽는다', () => {
    const text = 'module x\n\nrequire github.com/a/b v1.0.0\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/sys v0.1.0 // indirect\n)\n';
    expect(parseGoMod(text).map((d) => `${d.name}@${d.version}`)).toEqual(['github.com/a/b@v1.0.0', 'github.com/gin-gonic/gin@v1.9.1', 'golang.org/x/sys@v0.1.0']);
  });

  it('requirements.txt: 주석·옵션 줄은 빼고 이름과 버전 조건', () => {
    expect(parseRequirements('# c\n-r base.txt\nDjango==4.2  # web\nrequests>=2\nflask\n', false)).toEqual([
      { name: 'Django', version: '==4.2', dev: false },
      { name: 'requests', version: '>=2', dev: false },
      { name: 'flask', version: '(버전 없음)', dev: false },
    ]);
  });

  it('gradle·pom: 그룹:이름과 버전, 테스트용은 개발용으로', () => {
    expect(parseGradle(`implementation("org.springframework:spring-web:6.1.0")\ntestImplementation 'junit:junit:4.13'`)).toEqual([
      { name: 'org.springframework:spring-web', version: '6.1.0', dev: false },
      { name: 'junit:junit', version: '4.13', dev: true },
    ]);
    expect(parsePom('<dependency><groupId>g</groupId><artifactId>a</artifactId><version>1</version><scope>test</scope></dependency><dependency><groupId>h</groupId><artifactId>b</artifactId></dependency>')).toEqual([
      { name: 'g:a', version: '1', dev: true },
      { name: 'h:b', version: '(버전 관리 위임)', dev: false },
    ]);
  });

  it('저장소에서 git 이 추적하는 의존성 파일만(모노레포 패키지 포함) 읽는다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rauha-deps-'));
    dirs.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, 'package.json'), '{"devDependencies":{"vitest":"^3"}}');
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, 'packages', 'api', 'package.json'), '{"dependencies":{"express":"^4"}}');
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'package.json'), '{"dependencies":{"evil":"1"}}');
    writeFileSync(join(root, '.gitignore'), 'node_modules\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    const got = await dependencyManifests([{ name: 'mono', root }]);
    expect(got.map((m) => `${m.path}:${m.deps.map((d) => d.name).join(',')}`)).toEqual(['package.json:vitest', 'packages/api/package.json:express']);
  });
});
