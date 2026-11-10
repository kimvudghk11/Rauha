import { describe, expect, it } from 'vitest';
import { AppVersion } from './app-update.js';
import { UpdateRecord } from './update-record.js';

const cur = AppVersion.parse('0.1.1')!;
const URL1 = 'https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/rauha-0.1.2-mac-arm64.dmg';
const found = (at = '2026-11-08T01:00:00.000Z') => UpdateRecord.empty().recordChecked({ latest: AppVersion.parse('v0.1.2'), downloadUrl: URL1 }, at);

describe('UpdateRecord', () => {
  it('이미 최신이면 설치 단추를 줄 수 없다(같은 버전을 다시 설치하지 않는다)', () => {
    const same = found().toView(AppVersion.parse('0.1.2')!, { canInstall: true });
    expect(same).toMatchObject({ newer: false, canInstall: false });
    expect(found().toView(cur, { canInstall: true }).canInstall).toBe(true);
  });

  it('처음에는 아무것도 모르고 배너도 없다', () => {
    const view = UpdateRecord.empty().toView(cur);
    expect(view).toMatchObject({ current: '0.1.1', checkedAt: null, latest: null, showBanner: false, hasDownload: false });
  });

  it('새 버전을 찾으면 배너를 보이고 확인 시각을 남긴다', () => {
    expect(found().toView(cur)).toMatchObject({ latest: '0.1.2', showBanner: true, hasDownload: true, checkedAt: '2026-11-08T01:00:00.000Z' });
  });

  it('나중에를 누르면 그 버전은 배너를 숨기고 확인 결과는 남는다', () => {
    const view = found().dismiss().toView(cur);
    expect(view).toMatchObject({ latest: '0.1.2', newer: true, showBanner: false });
  });

  it('나중에를 누른 뒤 더 높은 버전이 나오면 배너가 다시 보인다', () => {
    const next = found().dismiss().recordChecked({ latest: AppVersion.parse('0.1.3'), downloadUrl: null }, '2026-11-08T07:00:00.000Z');
    expect(next.toView(cur)).toMatchObject({ latest: '0.1.3', showBanner: true, hasDownload: false });
  });

  it('앱을 올려 최신이 되면 배너가 사라진다', () => {
    expect(found().toView(AppVersion.parse('0.1.2')!).showBanner).toBe(false);
  });

  it('내려받기 주소는 검증을 통과한 것만 돌려주고 아니면 null이다', () => {
    expect(found().downloadUrl()).toBe(URL1);
    const tampered = UpdateRecord.from({ latest: '0.1.2', downloadUrl: 'https://evil.example/x.dmg', checkedAt: 'x', dismissed: null });
    expect(tampered.downloadUrl()).toBeNull();
    expect(tampered.toView(cur).hasDownload).toBe(false);
  });

  it('파일에 저장했다가 읽으면 같은 상태다', () => {
    const back = UpdateRecord.from(JSON.parse(JSON.stringify(found().dismiss().toJSON())));
    expect(back.toView(cur)).toEqual(found().dismiss().toView(cur));
  });

  it('깨진 파일은 빈 상태로 연다', () => {
    expect(UpdateRecord.from(null).toView(cur).latest).toBeNull();
    expect(UpdateRecord.from({ latest: 5, checkedAt: 7, dismissed: {} }).toView(cur)).toMatchObject({ latest: null, checkedAt: null });
  });

  it('릴리스를 못 찾은 확인도 시각은 남기되 이전에 찾은 버전은 지우지 않는다', () => {
    const next = found().recordChecked(null, '2026-11-08T07:00:00.000Z');
    expect(next.toView(cur)).toMatchObject({ latest: '0.1.2', checkedAt: '2026-11-08T07:00:00.000Z' });
  });
});
