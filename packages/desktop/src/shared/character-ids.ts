/**
 * 역할에 기본 배정되지 않고 팀 설정에서만 고를 수 있는 캐릭터의 id.
 * 그림 데이터는 renderer/characters-extra.ts에 있고, 저장된 설정의 검증(TeamSettings)이 이 목록으로 새 id를 알아본다.
 * 기본 23마리의 id는 역할 id(MemberRole)와 같다.
 */
export const EXTRA_CHARACTER_IDS = ['penguin', 'lobster', 'shrimp', 'frog', 'axolotl', 'nudibranch', 'angelfish', 'duck', 'marlin'] as const;
