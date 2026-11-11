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
  it('숫자 키는 열 개까지라 열한째 탭(Settings)은 Click 으로 적고, DB 는 여섯째(Ctrl+6)다', () => {
    const rows = shortcutSheet('win32').find((g) => g.title === 'Switch tab')!.rows;
    expect(rows.find((r) => r.label === 'DB')?.keys).toBe('Ctrl+6');
    expect(rows.find((r) => r.label === 'Rules')?.keys).toBe('Ctrl+0');
    expect(rows.find((r) => r.label === 'Settings')?.keys).toBe('Click');
    expect(shortcutSheet('darwin').find((g) => g.title === 'Switch tab')!.rows.find((r) => r.label === 'DB')?.keys).toBe('⌘6');
  });
  it('모든 줄에 키와 설명이 있다', () => {
    for (const g of shortcutSheet('win32')) for (const r of g.rows) expect(r.keys !== '' && r.label !== '').toBe(true);
  });
});
