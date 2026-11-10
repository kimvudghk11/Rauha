/** 메인(글)과 작업자 칸의 비율 단계. 작업자가 늘면 작업자 쪽을 조금씩 넓힌다. */
export type RoomSplit = '0' | 'a' | 'b' | 'c';

/**
 * 보이는 작업자 방 수에 따른 단계: 0명은 메인만, 1~2명은 7:3, 3~4명은 6:4, 5명부터는 5:5.
 * (미리 고정해 두지 않고 일이 들어오는 만큼 늘어난다.)
 */
export function roomSplit(count: number): RoomSplit {
  if (!(count > 0)) return '0';
  if (count <= 2) return 'a';
  if (count <= 4) return 'b';
  return 'c';
}
