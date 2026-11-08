import { describe, expect, it } from 'vitest';
import type { UpdateView } from '../shared/update-record.js';
import { bannerText, checkedText, MAC_INSTALL_NOTE } from './update-text.js';

const view = (over: Partial<UpdateView> = {}): UpdateView => ({ current: '0.1.1', checkedAt: null, latest: '0.1.2', newer: true, showBanner: true, hasDownload: true, checking: false, failed: false, failReason: null, canInstall: false, install: { phase: 'idle', percent: null }, attempt: null, ...over });

describe('bannerText', () => {
  it('새 버전을 v 붙여 알린다', () => {
    expect(bannerText(view())).toBe('새 버전 v0.1.2가 있어요');
  });

  it('내 컴퓨터용 설치 파일이 아직 없으면 그렇게 알린다', () => {
    expect(bannerText(view({ hasDownload: false }))).toBe('새 버전 v0.1.2가 있어요 · 내 컴퓨터용 설치 파일을 준비 중이에요');
  });
});

describe('checkedText', () => {
  it('확인 중이면 확인 중이라고 쓴다', () => {
    expect(checkedText(view({ checking: true }), '')).toBe('확인하는 중…');
  });

  it('실패는 한 줄로 조용히 쓴다', () => {
    expect(checkedText(view({ failed: true }), '')).toBe('지금은 확인하지 못했어요');
  });

  it('실패는 이유까지 쓴다', () => {
    expect(checkedText(view({ failed: true, failReason: '인터넷에 연결되어 있지 않아요' }), '')).toBe('확인하지 못했어요: 인터넷에 연결되어 있지 않아요');
  });

  it('아직 확인한 적이 없으면 그렇게 쓴다', () => {
    expect(checkedText(view(), '')).toBe('아직 확인하지 않았어요');
  });

  it('나중에로 미룬 새 버전도 새 버전이라고 쓴다', () => {
    expect(checkedText(view({ checkedAt: 'x', showBanner: false }), '오늘')).toBe('마지막 확인 오늘 · 새 버전 v0.1.2가 있어요');
  });

  it('마지막 확인 시각과 최신 여부를 쓴다', () => {
    expect(checkedText(view({ checkedAt: 'x', latest: '0.1.1', newer: false, showBanner: false }), '오늘 오후 3:20')).toBe('마지막 확인 오늘 오후 3:20 · 최신 버전이에요 (v0.1.1)');
    expect(checkedText(view({ checkedAt: 'x' }), '오늘 오후 3:20')).toBe('마지막 확인 오늘 오후 3:20 · 새 버전 v0.1.2가 있어요');
  });
});

describe('MAC_INSTALL_NOTE', () => {
  it('Applications에 덮어쓰고 quarantine을 푸는 한 줄 명령을 안내한다', () => {
    expect(MAC_INSTALL_NOTE).toContain('Applications');
    expect(MAC_INSTALL_NOTE).toContain('xattr -dr com.apple.quarantine /Applications/rauha.app');
  });
});
