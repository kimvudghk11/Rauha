import { describe, expect, it } from 'vitest';
import { ContainerRef, DockerInputError, ExecLine, ImageRef, NetworkName, TailLines, VolumeName } from './docker-names.js';

describe('컨테이너 이름·ID', () => {
  it('영문·숫자·_ . - 로 이루어진 이름과 12자리 ID를 받는다', () => {
    expect(ContainerRef.parse('rauha-test-web_1').value).toBe('rauha-test-web_1');
    expect(ContainerRef.parse('3f2a9c1b7d4e').value).toBe('3f2a9c1b7d4e');
  });
  it('앞뒤 공백은 지운다', () => {
    expect(ContainerRef.parse('  web  ').value).toBe('web');
  });
  it('옵션처럼 읽히는 - 로 시작하는 값은 거절한다', () => {
    expect(() => ContainerRef.parse('--privileged')).toThrow(DockerInputError);
    expect(() => ContainerRef.parse('-f')).toThrow(/cannot start with "-"/);
  });
  it('빈 값·글이 아닌 값·공백이나 셸 기호가 든 값은 거절한다', () => {
    for (const bad of ['', '   ', undefined, 5, 'a b', 'a;rm', 'a$(x)', 'a/b', 'a\nb', '_x', '.x']) expect(() => ContainerRef.parse(bad)).toThrow(DockerInputError);
  });
  it('128자를 넘는 이름은 거절한다', () => {
    expect(() => ContainerRef.parse('a'.repeat(129))).toThrow(/too long/);
    expect(ContainerRef.parse('a'.repeat(128)).value).toHaveLength(128);
  });
});

describe('볼륨·네트워크 이름', () => {
  it('같은 규칙으로 옵션처럼 읽히는 값을 거절한다', () => {
    expect(VolumeName.parse('pgdata').value).toBe('pgdata');
    expect(NetworkName.parse('bridge').value).toBe('bridge');
    expect(() => VolumeName.parse('-v')).toThrow(DockerInputError);
    expect(() => NetworkName.parse('--all')).toThrow(DockerInputError);
  });
});

describe('이미지 이름', () => {
  it('repo:tag·레지스트리 주소·다이제스트를 받는다', () => {
    expect(ImageRef.parse('busybox').value).toBe('busybox');
    expect(ImageRef.parse('alpine:3.20').value).toBe('alpine:3.20');
    expect(ImageRef.parse('ghcr.io/acme/web:1.2.3').value).toBe('ghcr.io/acme/web:1.2.3');
    expect(ImageRef.parse('localhost:5000/team/app@sha256:' + 'a'.repeat(64)).value).toContain('@sha256:');
  });
  it('- 로 시작하거나 공백·셸 기호·연속 슬래시·상위 경로가 든 이름은 거절한다', () => {
    for (const bad of ['-x', '--rm', 'a b', 'a;b', 'a//b', 'a/../b', 'a/', '', 'a`b`', 'a|b']) expect(() => ImageRef.parse(bad)).toThrow(DockerInputError);
  });
  it('255자를 넘으면 거절한다', () => {
    expect(() => ImageRef.parse('a'.repeat(256))).toThrow(/too long/);
  });
});

describe('컨테이너 안 한 줄 명령', () => {
  it('한 줄 글만 받고 앞뒤 공백을 지운다', () => {
    expect(ExecLine.parse('  ls -la /tmp ').value).toBe('ls -la /tmp');
  });
  it('빈 값·줄바꿈·제어 문자·너무 긴 글은 거절한다', () => {
    for (const bad of ['', '  ', 'a\nb', 'a\u0000b', 'x'.repeat(4001), 3]) expect(() => ExecLine.parse(bad)).toThrow(DockerInputError);
  });
});

describe('로그 줄 수', () => {
  it('정하지 않으면 200줄이고 1..5000 정수만 받는다', () => {
    expect(TailLines.parse(undefined).value).toBe(200);
    expect(TailLines.parse(50).value).toBe(50);
    for (const bad of [0, 5001, 1.5, '10', -1, null]) expect(() => TailLines.parse(bad)).toThrow(DockerInputError);
  });
});
