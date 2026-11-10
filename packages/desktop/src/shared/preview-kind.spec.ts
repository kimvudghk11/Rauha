import { describe, expect, it } from 'vitest';
import { imageMimeOf, previewKindOf, workImagePath, MAX_IMAGE_BYTES } from './preview-kind.js';

describe('미리보기 종류', () => {
  it('마크다운 파일은 렌더 미리보기를 쓴다', () => {
    expect(previewKindOf('README.md')).toBe('markdown');
    expect(previewKindOf('docs/Guide.MD')).toBe('markdown');
    expect(previewKindOf('a.markdown')).toBe('markdown');
    expect(previewKindOf('a.mdx')).toBe('markdown');
  });
  it('그림 파일은 이미지 뷰어를 쓴다', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.ico']) expect(previewKindOf(n), n).toBe('image');
  });
  it('그 밖의 파일은 미리보기가 없다', () => {
    for (const n of ['a.ts', 'a.txt', 'png', '.png.bak', 'Makefile', 'a.pdf']) expect(previewKindOf(n), n).toBeNull();
  });
  it('그림 종류별 MIME을 돌려주고 모르는 확장자는 null이다', () => {
    expect(imageMimeOf('a.png')).toBe('image/png');
    expect(imageMimeOf('a.jpg')).toBe('image/jpeg');
    expect(imageMimeOf('a.JPEG')).toBe('image/jpeg');
    expect(imageMimeOf('a.gif')).toBe('image/gif');
    expect(imageMimeOf('a.webp')).toBe('image/webp');
    expect(imageMimeOf('a.svg')).toBe('image/svg+xml');
    expect(imageMimeOf('a.ico')).toBe('image/x-icon');
    expect(imageMimeOf('a.ts')).toBeNull();
    expect(imageMimeOf('noext')).toBeNull();
  });
  it('이미지 크기 상한은 5MB다', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('마크다운 속 이미지 경로', () => {
  it('마크다운 파일 폴더 기준 상대 경로를 작업 폴더 기준으로 바꾼다', () => {
    expect(workImagePath('README.md', 'assets/logo.png')).toBe('assets/logo.png');
    expect(workImagePath('docs/guide.md', 'img/a.png')).toBe('docs/img/a.png');
    expect(workImagePath('docs/guide.md', './img/a.png')).toBe('docs/img/a.png');
    expect(workImagePath('docs/guide.md', '../assets/a.png')).toBe('assets/a.png');
    expect(workImagePath('docs/deep/guide.md', '../../a.gif')).toBe('a.gif');
  });
  it('작업 폴더 밖으로 나가는 경로는 막는다', () => {
    expect(workImagePath('README.md', '../a.png')).toBeNull();
    expect(workImagePath('docs/guide.md', '../../a.png')).toBeNull();
    expect(workImagePath('docs/guide.md', 'a/../../../b.png')).toBeNull();
  });
  it('주소(http·data·file 등)와 절대 경로는 막는다', () => {
    for (const src of ['http://x.com/a.png', 'https://x.com/a.png', 'data:image/png;base64,AAAA', 'file:///etc/a.png', '//x.com/a.png', '/a.png', '\\a.png', 'C:\\a.png', 'C:/a.png', 'javascript:alert(1)']) {
      expect(workImagePath('README.md', src), src).toBeNull();
    }
  });
  it('그림이 아닌 확장자는 막는다', () => {
    expect(workImagePath('README.md', 'a.txt')).toBeNull();
    expect(workImagePath('README.md', '.env')).toBeNull();
    expect(workImagePath('README.md', 'a')).toBeNull();
  });
  it('쿼리·해시는 떼고 퍼센트 인코딩은 풀어 준다', () => {
    expect(workImagePath('README.md', 'a%20b.png?raw=true')).toBe('a b.png');
    expect(workImagePath('README.md', 'a.png#x')).toBe('a.png');
  });
  it('인코딩된 .. 도 막는다', () => {
    expect(workImagePath('README.md', '%2e%2e/a.png')).toBeNull();
    expect(workImagePath('README.md', 'x/%2E%2E/%2e%2e/a.png')).toBeNull();
  });
  it('깨진 인코딩·빈 값·NUL은 null이다', () => {
    expect(workImagePath('README.md', '%E0%A4%A.png')).toBeNull();
    expect(workImagePath('README.md', '')).toBeNull();
    expect(workImagePath('README.md', 'a\0.png')).toBeNull();
  });
});
