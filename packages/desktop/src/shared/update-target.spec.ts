import { describe, expect, it } from 'vitest';
import { chooseMacTarget, targetNote } from './update-target.js';

const HOME = '/Users/kim';
const all = () => true;
const only = (...dirs: string[]) => (dir: string) => dirs.includes(dir);

describe('맥 설치 위치 정하기', () => {
  it('Applications 안의 앱이고 쓸 수 있으면 그 자리에 덮어쓴다', () => {
    expect(chooseMacTarget({ bundle: '/Applications/Rauha.app', home: HOME, canWrite: all })).toEqual({ path: '/Applications/Rauha.app', relocated: false, why: 'in-place' });
  });

  it('사용자 Applications 안의 앱도 그 자리에 덮어쓴다', () => {
    expect(chooseMacTarget({ bundle: '/Users/kim/Applications/Rauha.app', home: HOME, canWrite: all })?.relocated).toBe(false);
  });

  it('App Translocation 경로에서 열린 앱은 /Applications/Rauha.app에 설치한다', () => {
    const t = chooseMacTarget({ bundle: '/private/var/folders/ab/xyz/T/AppTranslocation/1234-5678/d/Rauha.app', home: HOME, canWrite: all });
    expect(t).toEqual({ path: '/Applications/Rauha.app', relocated: true, why: 'translocated' });
  });

  it('dmg 안(/Volumes)에서 열린 앱도 Applications에 설치한다', () => {
    expect(chooseMacTarget({ bundle: '/Volumes/Rauha 0.1.4/Rauha.app', home: HOME, canWrite: all })).toMatchObject({ path: '/Applications/Rauha.app', why: 'disk-image' });
  });

  it('Downloads 같은 Applications 밖 폴더에서 연 앱도 Applications에 설치한다', () => {
    expect(chooseMacTarget({ bundle: '/Users/kim/Downloads/Rauha.app', home: HOME, canWrite: all })).toMatchObject({ path: '/Applications/Rauha.app', why: 'outside-applications' });
  });

  it('Applications 하위 폴더도 밖으로 본다', () => {
    expect(chooseMacTarget({ bundle: '/Applications/Tools/Rauha.app', home: HOME, canWrite: all })).toMatchObject({ why: 'outside-applications', path: '/Applications/Rauha.app' });
  });

  it('/Applications에 쓸 수 없으면(표준 사용자) 사용자 Applications에 설치한다', () => {
    const t = chooseMacTarget({ bundle: '/Users/kim/Downloads/Rauha.app', home: HOME, canWrite: only('/Users/kim/Applications') });
    expect(t).toEqual({ path: '/Users/kim/Applications/Rauha.app', relocated: true, why: 'outside-applications' });
  });

  it('/Applications 안의 앱인데 쓸 수 없으면 사용자 Applications으로 옮긴다', () => {
    const t = chooseMacTarget({ bundle: '/Applications/Rauha.app', home: HOME, canWrite: only('/Users/kim/Applications') });
    expect(t).toEqual({ path: '/Users/kim/Applications/Rauha.app', relocated: true, why: 'not-writable' });
  });

  it('쓸 수 있는 곳이 하나도 없으면 null이다', () => {
    expect(chooseMacTarget({ bundle: '/Volumes/x/Rauha.app', home: HOME, canWrite: () => false })).toBeNull();
    expect(chooseMacTarget({ bundle: '/Applications/Rauha.app', home: HOME, canWrite: () => false })).toBeNull();
  });

  it('설치 위치 안내 글은 위치와 이유를 알린다', () => {
    expect(targetNote({ path: '/Applications/Rauha.app', relocated: false, why: 'in-place' })).toBe('설치 위치: /Applications/Rauha.app');
    expect(targetNote({ path: '/Applications/Rauha.app', relocated: true, why: 'translocated' })).toContain('임시 위치');
    expect(targetNote({ path: '/Applications/Rauha.app', relocated: true, why: 'disk-image' })).toContain('dmg');
    expect(targetNote({ path: '/Users/kim/Applications/Rauha.app', relocated: true, why: 'not-writable' })).toContain('권한');
  });
});
