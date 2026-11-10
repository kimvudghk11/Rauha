import { describe, expect, it } from 'vitest';
import { displayKey, isVisible, parseWindowFile, restoreBounds, type Rect, placeOnDisplay, isAutomatedRun, testDisplay } from './window-state.js';

const main: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const second: Rect = { x: 1920, y: 0, width: 2560, height: 1400 };
const win = (x: number, y: number, width = 1000, height = 700) => ({ x, y, width, height, maximized: false });

describe('displayKey', () => {
  it('모니터 순서가 달라도 같은 구성은 같은 이름표다', () => {
    expect(displayKey([main, second])).toBe(displayKey([second, main]));
  });

  it('모니터를 빼면 이름표가 달라진다', () => {
    expect(displayKey([main, second])).not.toBe(displayKey([main]));
  });
});

describe('isVisible', () => {
  it('모니터 안에 있으면 보인다', () => {
    expect(isVisible(win(100, 100), [main])).toBe(true);
  });

  it('두 모니터에 걸쳐 있어도 한쪽에 충분히 걸리면 보인다', () => {
    expect(isVisible(win(1500, 100), [main, second])).toBe(true);
  });

  it('모니터가 빠져 화면 밖에 있으면 안 보인다', () => {
    expect(isVisible(win(2200, 100), [main])).toBe(false);
  });

  it('귀퉁이만 걸친 창은 안 보이는 것으로 본다', () => {
    expect(isVisible(win(1880, 100), [main])).toBe(false);
  });
});

describe('restoreBounds', () => {
  const fallback = { width: 1280, height: 820 };

  it('저장된 위치가 보이면 그대로 쓴다', () => {
    expect(restoreBounds(win(2100, 50), [main, second], fallback)).toEqual({ x: 2100, y: 50, width: 1000, height: 700, maximized: false });
  });

  it('모니터가 빠져 화면 밖이면 주 모니터 가운데로 옮긴다', () => {
    expect(restoreBounds(win(2100, 50), [main], fallback)).toEqual({ x: 460, y: 170, width: 1000, height: 700, maximized: false });
  });

  it('주 모니터보다 큰 창은 모니터 크기로 줄인다', () => {
    const r = restoreBounds(win(3000, 0, 2400, 1300), [main], fallback);
    expect(r).toMatchObject({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('저장된 값이 없으면 기본 크기를 주 모니터 가운데에 둔다', () => {
    expect(restoreBounds(null, [main], fallback)).toEqual({ x: 320, y: 110, width: 1280, height: 820, maximized: false });
  });

  it('최대화 여부는 옮겨도 기억한다', () => {
    expect(restoreBounds({ ...win(5000, 0), maximized: true }, [main], fallback).maximized).toBe(true);
  });
});

describe('parseWindowFile', () => {
  it('구성별로 저장된 창을 읽고 틀린 값은 버린다', () => {
    const file = parseWindowFile({ a: { x: 1, y: 2, width: 800, height: 600, maximized: true }, b: { x: 'z' }, c: { x: 0, y: 0, width: 50, height: 50 }, d: 5 });
    expect(Object.keys(file)).toEqual(['a']);
    expect(file['a']).toEqual({ x: 1, y: 2, width: 800, height: 600, maximized: true });
  });

  it('파일 모양이 틀리면 빈 기록이다', () => {
    expect(parseWindowFile(null)).toEqual({});
    expect(parseWindowFile([])).toEqual({});
  });
});

describe('확인용 모니터 지정', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1600, height: 860 }];
  it('2를 주면 두 번째 모니터 가운데에 놓는다', () => {
    expect(placeOnDisplay('2', areas, { width: 1280, height: 820 })).toEqual({ x: 1920 + 160, y: 20, width: 1280, height: 820, maximized: false });
  });
  it('없는 모니터나 이상한 값이면 null이다', () => {
    expect(placeOnDisplay('3', areas, { width: 1280, height: 820 })).toBeNull();
    expect(placeOnDisplay('x', areas, { width: 1280, height: 820 })).toBeNull();
    expect(placeOnDisplay(undefined, areas, { width: 1280, height: 820 })).toBeNull();
  });
  it('모니터보다 큰 창은 모니터 크기로 줄인다', () => {
    expect(placeOnDisplay('1', [{ x: 0, y: 0, width: 800, height: 600 }], { width: 1280, height: 820 })).toEqual({ x: 0, y: 0, width: 800, height: 600, maximized: false });
  });
});

describe('시험 실행은 1번 모니터에 뜨지 않는다', () => {
  it('RAUHA_ 환경 변수가 있으면 시험 실행이고, 평범한 실행은 아니다', () => {
    expect(isAutomatedRun({ RAUHA_DATA_DIR: 'x' })).toBe(true);
    expect(isAutomatedRun({ PATH: 'x' })).toBe(false);
    expect(isAutomatedRun({ RAUHA_DISPLAY: '2' })).toBe(false);
  });
  it('시험 실행은 기본 2번 모니터, 직접 정하면 그 값, 평범한 실행은 정하지 않는다', () => {
    expect(testDisplay({ RAUHA_FAKE_TEAM: '1' })).toBe('2');
    expect(testDisplay({ RAUHA_FAKE_TEAM: '1', RAUHA_DISPLAY: '3' })).toBe('3');
    expect(testDisplay({})).toBeUndefined();
  });
});
