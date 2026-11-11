import { describe, expect, it } from 'vitest';
import { shortcutSheet } from './shortcut-sheet.js';
import { TABS } from '../renderer/tabs.js';

describe('단축키 안내', () => {
  it('Windows는 Ctrl, 맥은 ⌘로 보인다', () => {
    const win = shortcutSheet('win32').flatMap((g) => g.rows.map((r) => r.keys));
    const mac = shortcutSheet('darwin').flatMap((g) => g.rows.map((r) => r.keys));
    expect(win).toContain('Ctrl+P');
    expect(mac).toContain('⌘P');
    expect(win.some((k) => k.includes('⌘'))).toBe(false);
    expect(mac.some((k) => k.includes('Ctrl'))).toBe(false);
  });
  it('탭 전환 줄은 왼쪽 막대의 탭 이름과 순서가 같다', () => {
    const tabs = shortcutSheet('win32').find((g) => g.title === 'Switch tab')!;
    const order = TABS.filter((t) => !t.bottom).concat(TABS.filter((t) => t.bottom));
    expect(tabs.rows.map((r) => r.label)).toEqual(order.map((t) => t.label));
    expect(tabs.rows[0]?.keys).toBe('Ctrl+1');
  });
  it('모든 줄에 키와 설명이 있다', () => {
    for (const g of shortcutSheet('win32')) for (const r of g.rows) expect(r.keys !== '' && r.label !== '').toBe(true);
  });
});
