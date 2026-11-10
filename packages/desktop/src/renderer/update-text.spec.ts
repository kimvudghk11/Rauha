import { describe, expect, it } from 'vitest';
import type { UpdateView } from '../shared/update-record.js';
import { bannerText, checkedText, GATEKEEPER_NOTE, MAC_INSTALL_NOTE } from './update-text.js';

const view = (over: Partial<UpdateView> = {}): UpdateView => ({ current: '0.1.1', checkedAt: null, latest: '0.1.2', newer: true, showBanner: true, hasDownload: true, checking: false, failed: false, failReason: null, canInstall: false, install: { phase: 'idle', percent: null }, attempt: null, ...over });

describe('bannerText', () => {
  it('새 버전을 v 붙여 알린다', () => {
    expect(bannerText(view())).toBe('New version v0.1.2 available');
  });

  it('내 컴퓨터용 설치 파일이 아직 없으면 그렇게 알린다', () => {
    expect(bannerText(view({ hasDownload: false }))).toBe('New version v0.1.2 available · installer for this computer is being prepared');
  });
});

describe('checkedText', () => {
  it('확인 중이면 확인 중이라고 쓴다', () => {
    expect(checkedText(view({ checking: true }), '')).toBe('Checking…');
  });

  it('실패는 한 줄로 조용히 쓴다', () => {
    expect(checkedText(view({ failed: true }), '')).toBe('Could not check right now');
  });

  it('실패는 이유까지 쓴다', () => {
    expect(checkedText(view({ failed: true, failReason: 'No internet connection' }), '')).toBe('Could not check: No internet connection');
  });

  it('아직 확인한 적이 없으면 그렇게 쓴다', () => {
    expect(checkedText(view(), '')).toBe('Not checked yet');
  });

  it('나중에로 미룬 새 버전도 새 버전이라고 쓴다', () => {
    expect(checkedText(view({ checkedAt: 'x', showBanner: false }), 'Today')).toBe('Last checked Today · New version v0.1.2 available');
  });

  it('마지막 확인 시각과 최신 여부를 쓴다', () => {
    expect(checkedText(view({ checkedAt: 'x', latest: '0.1.1', newer: false, showBanner: false }), 'Today 3:20 PM')).toBe('Last checked Today 3:20 PM · You are up to date (v0.1.1)');
    expect(checkedText(view({ checkedAt: 'x' }), 'Today 3:20 PM')).toBe('Last checked Today 3:20 PM · New version v0.1.2 available');
  });
});

describe('MAC_INSTALL_NOTE', () => {
  it('Applications에 덮어쓰고 quarantine을 푸는 한 줄 명령을 안내한다', () => {
    expect(MAC_INSTALL_NOTE).toContain('Applications');
    expect(MAC_INSTALL_NOTE).toContain('xattr -dr com.apple.quarantine /Applications/rauha.app');
  });
});

describe('GATEKEEPER_NOTE', () => {
  it('첫 설치 경고는 한 번뿐이고 앱 안 업데이트로 받은 파일에는 안 뜬다고 알린다', () => {
    expect(GATEKEEPER_NOTE).toContain('first install');
    expect(GATEKEEPER_NOTE).toContain('Update now');
  });
});
