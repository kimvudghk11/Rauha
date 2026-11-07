/**
 * 캐릭터 그림. 화면은 그림을 이 함수(spriteFor) 하나로만 얻는다.
 * 지금 격자는 시안(screens-v3)에서 옮긴 임시 그림이다. 팀원 22명의 그림이 나오면 여기만 바꿔 끼운다.
 * 격자 한 글자 = 픽셀 하나, '.'은 빈칸. 프레임이 둘 이상이면 앞이 평소, 뒤가 깜빡임이다.
 */
export const CHARACTER_ROLES = ['delfi', 'turtle', 'crab', 'octopus', 'puffer'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export interface Sprite {
  readonly palette: Readonly<Record<string, string>>;
  readonly frames: readonly (readonly string[])[];
}

const DELFI = [
  '......SS......',
  '.....SBS......',
  '...HHBBBBH....',
  '..HBBBBBBBBH..',
  '.HBBBBBBBBBBH.',
  '.BBWEBBBBWEBB.',
  '.BBEEBBBBEEBB.',
  'SBPPBMBBMBPPBS',
  'SSBBLLMMLLBBSS',
  '..BBLLLLLLBB..',
  '...SBLLLLBS...',
  '....SSSSSS....',
];
const DELFI_BLINK = DELFI.map((row, i) => (i === 5 ? '.BBBBBBBBBBBB.' : i === 6 ? '.BBSSBBBBSSBB.' : row));

const SPRITES: Readonly<Record<CharacterRole, Sprite>> = {
  delfi: {
    palette: { B: '#6FBDEB', S: '#4596CC', H: '#C4E8FF', L: '#DDF2FF', E: '#1D2B3A', W: '#FFFFFF', P: '#F7A9C2', M: '#1D2B3A' },
    frames: [DELFI, DELFI_BLINK],
  },
  turtle: {
    palette: { S: '#4FA57E', G: '#84D9AE', g: '#C9EFD9', K: '#A7DDBF', E: '#1D2B3A', W: '#FFFFFF', P: '#F7A9C2' },
    frames: [['............', '...SSSS.....', '..SGgGgS.KKK', '.SGGGGGGSKWE', '.SgGgGgGSKKP', 'SSSSSSSSSSK.', '.KK....KK...', '............']],
  },
  crab: {
    palette: { C: '#F3958F', D: '#D9706A', E: '#1D2B3A', W: '#FFFFFF', P: '#FFC9C4' },
    frames: [['.CC......CC.', 'C.C......C.C', '.CC.W..W.CC.', '..C.E..E.C..', '..CCCCCCCC..', '.CPCCCCCCPC.', '.DCCCCCCCCD.', '..D.D..D.D..']],
  },
  octopus: {
    palette: { P: '#C3B4F5', p: '#E2DAFB', D: '#9C89E0', E: '#1D2B3A', W: '#FFFFFF', K: '#F7A9C2' },
    frames: [['...pPPPP....', '..pPPPPPPP..', '.pPPPPPPPPP.', '.PWEPPPPWEP.', '.PKPPPPPPKP.', '.PD.PDDP.DP.', '.P..P..P..P.', 'D..D..D..D..']],
  },
  puffer: {
    palette: { Y: '#FFDB7A', y: '#E0B54A', L: '#FFF0C2', E: '#1D2B3A', W: '#FFFFFF', F: '#F3C25E', P: '#F7A9C2' },
    frames: [['..y..y..y...', '...YYYYY....', 'y.YYYYYYY.y.', '.YWEYYYWEY.F', 'yYPYYYYYPYFF', '.YYLLLLLYY.F', 'y.YLLLLLY.y.', '...YYYYY....']],
  },
};

export function spriteFor(role: CharacterRole): Sprite {
  return SPRITES[role];
}
