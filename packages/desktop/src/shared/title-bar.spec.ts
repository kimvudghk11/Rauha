import { describe, expect, it } from 'vitest';
import { isTahoeOrNewer, TITLE_BAR_HEIGHT, TRAFFIC_LIGHT, titleBarHeight, titleBarText, trafficLightPosition, trafficLightsRightEdge } from './title-bar.js';

describe('titleBarHeight', () => {
  it('맥에서는 VS Code와 같은 35px 제목줄을 창 맨 위에 둔다', () => {
    expect(titleBarHeight('darwin', false)).toBe(35);
  });

  it('맥 전체 화면에서는 신호등이 사라지므로 제목줄도 접는다', () => {
    expect(titleBarHeight('darwin', true)).toBe(0);
  });

  it('Windows와 Linux는 OS 기본 제목줄을 쓰므로 화면 안 제목줄이 없다', () => {
    expect(titleBarHeight('win32', false)).toBe(0);
    expect(titleBarHeight('linux', false)).toBe(0);
  });
});

describe('trafficLightPosition', () => {
  it('VS Code 방식: 높이 35에서 버튼 칸 16을 가운데에 두면 y 9, x는 y + 1이다', () => {
    expect(trafficLightPosition(35)).toEqual({ x: 10, y: 9 });
  });

  it('macOS 26(Tahoe) 이상은 버튼 칸 14로 계산해 y 10, x 11이다', () => {
    expect(trafficLightPosition(35, true)).toEqual({ x: 11, y: 10 });
  });

  it('제목줄 높이가 바뀌면 y도 같은 식으로 따라 바뀐다', () => {
    expect(trafficLightPosition(38).y).toBe(11);
    expect(trafficLightPosition(36).y).toBe(10);
  });

  it('버튼 칸 위아래 남는 여백은 아래가 같거나 1px 크다(세로 가운데)', () => {
    const { y } = trafficLightPosition(TITLE_BAR_HEIGHT);
    const below = TITLE_BAR_HEIGHT - y - TRAFFIC_LIGHT.box;
    expect(below - y).toBeGreaterThanOrEqual(0);
    expect(below - y).toBeLessThanOrEqual(1);
  });
});

describe('isTahoeOrNewer', () => {
  it('Darwin 25(macOS 26)부터 Tahoe로 본다', () => {
    expect(isTahoeOrNewer('25.0.0')).toBe(true);
    expect(isTahoeOrNewer('24.6.0')).toBe(false);
    expect(isTahoeOrNewer('')).toBe(false);
  });
});

describe('trafficLightsRightEdge', () => {
  it('신호등 세 개(지름 12, 간격 8)의 오른쪽 끝에 여백 16을 더해 Zed의 78 안팎이다', () => {
    expect(trafficLightsRightEdge()).toBe(11 + 36 + 16 + 16);
  });
});

describe('titleBarText', () => {
  it('작업 폴더가 있으면 앱 이름 뒤에 폴더 이름만 붙인다', () => {
    expect(titleBarText('rauha', '/Users/kim/work/bridge')).toBe('bridge — rauha');
  });

  it('Windows 경로와 끝 구분자도 폴더 이름만 뽑는다', () => {
    expect(titleBarText('rauha', ['C:', 'work', 'bridge', ''].join(String.fromCharCode(92)))).toBe('bridge — rauha');
  });

  it('폴더를 아직 안 골랐으면 앱 이름만 보인다', () => {
    expect(titleBarText('rauha', null)).toBe('rauha');
    expect(titleBarText('rauha', '')).toBe('rauha');
  });
});
