import type { PixelCharacter } from '../characters-data.js';

export type CharacterTable = Readonly<Record<string, PixelCharacter | undefined>>;

const own = (table: CharacterTable, key: string): PixelCharacter | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** 세트 순수 규칙: 사용자가 고른 캐릭터 > 현재 세트의 그 역할 > 기본 세트의 그 역할. */
export function resolveCharacter(role: string, picked: PixelCharacter | undefined, current: CharacterTable, fallback: CharacterTable): PixelCharacter | undefined {
  return picked ?? own(current, role) ?? own(fallback, role);
}

/** 세트 데이터의 흠을 글로 돌려준다(없으면 빈 목록). 비어 있는 역할은 건너뛴다. 이름·동물 중복, 프레임 수·크기, 팔레트 밖 글자를 본다. */
export function setProblems(chars: CharacterTable): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  const animals = new Set<string>();
  for (const [role, c] of Object.entries(chars)) {
    if (c === undefined) continue;
    if (c.name.trim() === '' || c.animal.trim() === '') out.push(`${role}: 이름이나 동물이 비었다`);
    if (names.has(c.name)) out.push(`${role}: 이름 겹침 ${c.name}`);
    if (animals.has(c.animal)) out.push(`${role}: 동물 겹침 ${c.animal}`);
    names.add(c.name);
    animals.add(c.animal);
    if (c.frames.length !== 5) out.push(`${role}: 프레임이 ${c.frames.length}개`);
    const h = c.frames[0]?.length ?? 0;
    const w = c.frames[0]?.[0]?.length ?? 0;
    c.frames.forEach((frame, i) => {
      if (frame.length !== h) out.push(`${role}: 프레임 ${i} 줄 수가 다르다`);
      for (const row of frame) {
        if (row.length !== w) out.push(`${role}: 프레임 ${i} 줄 길이가 다르다`);
        for (const ch of row) if (ch !== '.' && c.colors[ch] === undefined) out.push(`${role}: 팔레트에 없는 글자 '${ch}'`);
      }
    });
  }
  return [...new Set(out)];
}
