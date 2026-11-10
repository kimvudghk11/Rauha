import { describe, expect, it } from 'vitest';
import { installGuide, MAC_INSTALL_COMMAND } from './install-guide.js';

const newer = { newer: true, latest: '0.2.0', hasDownload: true };

describe('installGuide', () => {
  it('맥은 한 줄 설치 명령을 복사하게 주고 내려받기는 보이지 않는다', () => {
    const g = installGuide('darwin', newer);
    expect(g.copy).toBe(MAC_INSTALL_COMMAND);
    expect(g.copy).toContain('scripts/install-mac.sh | bash');
    expect(g.download).toBe(false);
  });

  it('Windows는 설치 파일 내려받기를 보인다(없으면 보이지 않는다)', () => {
    expect(installGuide('win32', newer)).toMatchObject({ copy: null, download: true });
    expect(installGuide('win32', { newer: false, latest: null, hasDownload: false }).download).toBe(false);
  });

  it('확인 결과가 있으면 새 버전 여부를 첫 줄에 말한다', () => {
    expect(installGuide('darwin', newer).lines[0]).toBe('New version 0.2.0 available.');
    expect(installGuide('win32', { newer: false, latest: '0.1.2', hasDownload: true }).lines[0]).toBe('You are up to date.');
    expect(installGuide('darwin', null).lines).toHaveLength(1);
  });
});
