/** 고를 수 있는 캐릭터 9종(역할에 기본 배정되지 않는다). 갈매기는 git 팀원(publisher)의 기본 캐릭터로 옮겼다. 키는 shared/character-ids.ts의 EXTRA_CHARACTER_IDS와 같다.
 * 형식은 characters-data.ts와 같다. 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. */
import type { PixelCharacter } from './characters-data.js';

export const EXTRA_CHARACTERS: Readonly<Record<string, PixelCharacter>> = {
  penguin: {
    name: "뒤뚱",
    animal: "펭귄",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#5B7BA8","S":"#3D5A85","H":"#9DB7D8","L":"#F4F8FC","Y":"#FFA94D"},
    frames: [
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBLLLBBLLLBS.', '.SBLWELLWELBS.', '.SBLEELLEELBS.', '.SBPLLYYLLPBS.', '.SBBLLMMLLBBS.', '.SBBBLLLLBBBS.', 'SBBBBLLLLBBBBS', 'SBBBBLLLLBBBBS', '.SBBBLLLLBBBS.', '..YYY....YYY..'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBLLLBBLLLBS.', '.SBLLLLLLLLBS.', '.SBLEELLEELBS.', '.SBPLLYYLLPBS.', '.SBBLLMMLLBBS.', '.SBBBLLLLBBBS.', 'SBBBBLLLLBBBBS', 'SBBBBLLLLBBBBS', '.SBBBLLLLBBBS.', '..YYY....YYY..'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBLLLBBLLLBS.', '.SBLEELLEELBS.', '.SBLLLLLLLLBS.', '.SBPLLYYLLPBS.', '.SBBLMMMMLBBS.', '.SBBBLLLLBBBS.', 'SBBBBLLLLBBBBS', 'SBBBBLLLLBBBBS', '.SBBBLLLLBBBS.', '..YYY....YYY..'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBLLLBBLLLBS.', '.SBLLELLELLBS.', '.SBLELLLLELBS.', '.SBPLLYYLLPBS.', '.SBBLLMMLLBBS.', '.SBBBLLLLBBBS.', 'SBBBBLLLLBBBBS', 'SBBBBLLLLBBBBS', '.SBBBLLLLBBBS.', '..YYY....YYY..'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBLLLBBLLLBS.', '.SBLLLLLLLLBS.', '.SBLEELLEELBS.', '.SBPLLYYLLPBS.', '.SBBLLMLLLBBS.', '.SBBBLLLLBBBS.', 'SBBBBLLLLBBBBS', 'SBBBBLLLLBBBBS', '.SBBBLLLLBBBS.', '..YYY....YYY..'],
    ],
  },
  lobster: {
    name: "랍이",
    animal: "바닷가재",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#E8625A","S":"#B8403F","H":"#F8A59B","L":"#F6C9B0"},
    frames: [
      ['.HH........HH.', 'HBBS......SBBH', 'HBSS.SSSS.SSBH', '.SS.SBBBBS.SS.', '...SBBBBBBS...', '..SWEBBBBWES..', '..SEEBBBBEES..', '..SPBBMMBBPS..', '...SBLLLLBS...', '....SLLLLS....', '..S..SSSS..S..', '.S.S......S.S.'],
      ['.HH........HH.', 'HBBS......SBBH', 'HBSS.SSSS.SSBH', '.SS.SBBBBS.SS.', '...SBBBBBBS...', '..SBBBBBBBBS..', '..SEEBBBBEES..', '..SPBBMMBBPS..', '...SBLLLLBS...', '....SLLLLS....', '..S..SSSS..S..', '.S.S......S.S.'],
      ['.HH........HH.', 'HBBS......SBBH', 'HBSS.SSSS.SSBH', '.SS.SBBBBS.SS.', '...SBBBBBBS...', '..SEEBBBBEES..', '..SBBBBBBBBS..', '..SPBMMMMBPS..', '...SBLLLLBS...', '....SLLLLS....', '..S..SSSS..S..', '.S.S......S.S.'],
      ['.HH........HH.', 'HBBS......SBBH', 'HBSS.SSSS.SSBH', '.SS.SBBBBS.SS.', '...SBBBBBBS...', '..SBEBBBBEBS..', '..SEBBBBBBES..', '..SPBBMMBBPS..', '...SBLLLLBS...', '....SLLLLS....', '..S..SSSS..S..', '.S.S......S.S.'],
      ['.HH........HH.', 'HBBS......SBBH', 'HBSS.SSSS.SSBH', '.SS.SBBBBS.SS.', '...SBBBBBBS...', '..SBBBBBBBBS..', '..SEEBBBBEES..', '..SPBBMBBBPS..', '...SBLLLLBS...', '....SLLLLS....', '..S..SSSS..S..', '.S.S......S.S.'],
    ],
  },
  shrimp: {
    name: "새롱",
    animal: "새우",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FFA48A","S":"#E0725A","H":"#FFD0C2","L":"#FFE6DC"},
    frames: [
      ['..S........S..', '...S......S...', '...SBBBBBBS...', '..SBBBBBBBBS..', '..BBWEBBWEBB..', '..BBEEBBEEBB..', '..BPBBMMBBPB..', '..SBBBLLBBBS..', '...SBLLLLBS...', '....SBLLBS....', '...HSSBBSSH...', '..HHH.SS.HHH..'],
      ['..S........S..', '...S......S...', '...SBBBBBBS...', '..SBBBBBBBBS..', '..BBBBBBBBBB..', '..BBEEBBEEBB..', '..BPBBMMBBPB..', '..SBBBLLBBBS..', '...SBLLLLBS...', '....SBLLBS....', '...HSSBBSSH...', '..HHH.SS.HHH..'],
      ['..S........S..', '...S......S...', '...SBBBBBBS...', '..SBBBBBBBBS..', '..BBEEBBEEBB..', '..BBBBBBBBBB..', '..BPBMMMMBPB..', '..SBBBLLBBBS..', '...SBLLLLBS...', '....SBLLBS....', '...HSSBBSSH...', '..HHH.SS.HHH..'],
      ['..S........S..', '...S......S...', '...SBBBBBBS...', '..SBBBBBBBBS..', '..BBBEBBEBBB..', '..BBEBBBBEBB..', '..BPBBMMBBPB..', '..SBBBLLBBBS..', '...SBLLLLBS...', '....SBLLBS....', '...HSSBBSSH...', '..HHH.SS.HHH..'],
      ['..S........S..', '...S......S...', '...SBBBBBBS...', '..SBBBBBBBBS..', '..BBBBBBBBBB..', '..BBEEBBEEBB..', '..BPBBMBBBPB..', '..SBBBLLBBBS..', '...SBLLLLBS...', '....SBLLBS....', '...HSSBBSSH...', '..HHH.SS.HHH..'],
    ],
  },
  frog: {
    name: "개굴",
    animal: "개구리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#8FD66B","S":"#5FA83F","H":"#D2F2B8","L":"#F3FBD8"},
    frames: [
      ['..SSSS..SSSS..', '.SBWEBSSBWEBS.', 'SBBEEBBBBEEBBS', 'SBPBBBBBBBBPBS', 'SBBBBBMMBBBBBS', 'SBBLLLLLLLLBBS', '.SBLLLLLLLLBS.', '.SBBLLLLLLBBS.', '.SSBBBBBBBBSS.', '.SBS......SBS.', 'SBBBS....SBBBS', 'SSSSS....SSSSS'],
      ['..SSSS..SSSS..', '.SBBBBSSBBBBS.', 'SBBEEBBBBEEBBS', 'SBPBBBBBBBBPBS', 'SBBBBBMMBBBBBS', 'SBBLLLLLLLLBBS', '.SBLLLLLLLLBS.', '.SBBLLLLLLBBS.', '.SSBBBBBBBBSS.', '.SBS......SBS.', 'SBBBS....SBBBS', 'SSSSS....SSSSS'],
      ['..SSSS..SSSS..', '.SBEEBSSBEEBS.', 'SBBBBBBBBBBBBS', 'SBPBBBBBBBBPBS', 'SBBBBMMMMBBBBS', 'SBBLLLLLLLLBBS', '.SBLLLLLLLLBS.', '.SBBLLLLLLBBS.', '.SSBBBBBBBBSS.', '.SBS......SBS.', 'SBBBS....SBBBS', 'SSSSS....SSSSS'],
      ['..SSSS..SSSS..', '.SBBEBSSBEBBS.', 'SBBEBBBBBBEBBS', 'SBPBBBBBBBBPBS', 'SBBBBBMMBBBBBS', 'SBBLLLLLLLLBBS', '.SBLLLLLLLLBS.', '.SBBLLLLLLBBS.', '.SSBBBBBBBBSS.', '.SBS......SBS.', 'SBBBS....SBBBS', 'SSSSS....SSSSS'],
      ['..SSSS..SSSS..', '.SBBBBSSBBBBS.', 'SBBEEBBBBEEBBS', 'SBPBBBBBBBBPBS', 'SBBBBBMBBBBBBS', 'SBBLLLLLLLLBBS', '.SBLLLLLLLLBS.', '.SBBLLLLLLBBS.', '.SSBBBBBBBBSS.', '.SBS......SBS.', 'SBBBS....SBBBS', 'SSSSS....SSSSS'],
    ],
  },
  axolotl: {
    name: "우파",
    animal: "우파루파",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F9B6CF","S":"#E07FA6","H":"#FFE0EC","L":"#FFDDE9","Z":"#F4678F"},
    frames: [
      ['ZZ..SSSSSS..ZZ', '.ZZSBBBBBBSZZ.', 'ZZSBBBBBBBBSZZ', '.ZSWEBBBBWESZ.', '..SEEBBBBEES..', '..SPBBMMBBPS..', '...SBBBBBBS...', '...SBLLLLBS...', '..SBBLLLLBBS..', '..SBBLLLLBBS..', '..SBBS..SBBS..', '..SSS....SSS..'],
      ['ZZ..SSSSSS..ZZ', '.ZZSBBBBBBSZZ.', 'ZZSBBBBBBBBSZZ', '.ZSBBBBBBBBSZ.', '..SEEBBBBEES..', '..SPBBMMBBPS..', '...SBBBBBBS...', '...SBLLLLBS...', '..SBBLLLLBBS..', '..SBBLLLLBBS..', '..SBBS..SBBS..', '..SSS....SSS..'],
      ['ZZ..SSSSSS..ZZ', '.ZZSBBBBBBSZZ.', 'ZZSBBBBBBBBSZZ', '.ZSEEBBBBEESZ.', '..SBBBBBBBBS..', '..SPBMMMMBPS..', '...SBBBBBBS...', '...SBLLLLBS...', '..SBBLLLLBBS..', '..SBBLLLLBBS..', '..SBBS..SBBS..', '..SSS....SSS..'],
      ['ZZ..SSSSSS..ZZ', '.ZZSBBBBBBSZZ.', 'ZZSBBBBBBBBSZZ', '.ZSBEBBBBEBSZ.', '..SEBBBBBBES..', '..SPBBMMBBPS..', '...SBBBBBBS...', '...SBLLLLBS...', '..SBBLLLLBBS..', '..SBBLLLLBBS..', '..SBBS..SBBS..', '..SSS....SSS..'],
      ['ZZ..SSSSSS..ZZ', '.ZZSBBBBBBSZZ.', 'ZZSBBBBBBBBSZZ', '.ZSBBBBBBBBSZ.', '..SEEBBBBEES..', '..SPBBMBBBPS..', '...SBBBBBBS...', '...SBLLLLBS...', '..SBBLLLLBBS..', '..SBBLLLLBBS..', '..SBBS..SBBS..', '..SSS....SSS..'],
    ],
  },
  nudibranch: {
    name: "민숭",
    animal: "갯민숭달팽이",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#9B8CF2","S":"#6C5CC8","H":"#D2CBFF","Y":"#FFB36B"},
    frames: [
      ['..Y.Y....Y.Y..', '..Y.YSSSSY.Y..', '...SBBBBBBS...', '..SBWEBBWEBS..', '.SBBEEBBEEBBS.', '.SPBBBBBBBBPS.', '.SBBBBMMBBBBS.', '.SBBBBBBBBBBS.', 'SBBBBBBBBBBBBS', 'SSBBBBBBBBBBSS', 'YSSBBBBBBBBSSY', '.YY.SSSSSS.YY.'],
      ['..Y.Y....Y.Y..', '..Y.YSSSSY.Y..', '...SBBBBBBS...', '..SBBBBBBBBS..', '.SBBEEBBEEBBS.', '.SPBBBBBBBBPS.', '.SBBBBMMBBBBS.', '.SBBBBBBBBBBS.', 'SBBBBBBBBBBBBS', 'SSBBBBBBBBBBSS', 'YSSBBBBBBBBSSY', '.YY.SSSSSS.YY.'],
      ['..Y.Y....Y.Y..', '..Y.YSSSSY.Y..', '...SBBBBBBS...', '..SBEEBBEEBS..', '.SBBBBBBBBBBS.', '.SPBBBBBBBBPS.', '.SBBBMMMMBBBS.', '.SBBBBBBBBBBS.', 'SBBBBBBBBBBBBS', 'SSBBBBBBBBBBSS', 'YSSBBBBBBBBSSY', '.YY.SSSSSS.YY.'],
      ['..Y.Y....Y.Y..', '..Y.YSSSSY.Y..', '...SBBBBBBS...', '..SBBEBBEBBS..', '.SBBEBBBBEBBS.', '.SPBBBBBBBBPS.', '.SBBBBMMBBBBS.', '.SBBBBBBBBBBS.', 'SBBBBBBBBBBBBS', 'SSBBBBBBBBBBSS', 'YSSBBBBBBBBSSY', '.YY.SSSSSS.YY.'],
      ['..Y.Y....Y.Y..', '..Y.YSSSSY.Y..', '...SBBBBBBS...', '..SBBBBBBBBS..', '.SBBEEBBEEBBS.', '.SPBBBBBBBBPS.', '.SBBBBMBBBBBS.', '.SBBBBBBBBBBS.', 'SBBBBBBBBBBBBS', 'SSBBBBBBBBBBSS', 'YSSBBBBBBBBSSY', '.YY.SSSSSS.YY.'],
    ],
  },
  angelfish: {
    name: "금비",
    animal: "엔젤피시",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FFD36B","S":"#E0A030","H":"#FFEDB0","X":"#8B78D6"},
    frames: [
      ['......SS......', '.....SXXS.....', '....SXXXXS....', '..SSBBXXBBSS..', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', 'SBPBBBMMBBBPBS', '.SBBBBBBBBBBS.', '..SSBBXXBBSS..', '....SXXXXS....', '.....SXXS.....', '......SS......'],
      ['......SS......', '.....SXXS.....', '....SXXXXS....', '..SSBBXXBBSS..', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', 'SBPBBBMMBBBPBS', '.SBBBBBBBBBBS.', '..SSBBXXBBSS..', '....SXXXXS....', '.....SXXS.....', '......SS......'],
      ['......SS......', '.....SXXS.....', '....SXXXXS....', '..SSBBXXBBSS..', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', 'SBPBBMMMMBBPBS', '.SBBBBBBBBBBS.', '..SSBBXXBBSS..', '....SXXXXS....', '.....SXXS.....', '......SS......'],
      ['......SS......', '.....SXXS.....', '....SXXXXS....', '..SSBBXXBBSS..', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', 'SBPBBBMMBBBPBS', '.SBBBBBBBBBBS.', '..SSBBXXBBSS..', '....SXXXXS....', '.....SXXS.....', '......SS......'],
      ['......SS......', '.....SXXS.....', '....SXXXXS....', '..SSBBXXBBSS..', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', 'SBPBBBMBBBBPBS', '.SBBBBBBBBBBS.', '..SSBBXXBBSS..', '....SXXXXS....', '.....SXXS.....', '......SS......'],
    ],
  },
  duck: {
    name: "꽥이",
    animal: "오리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FFD95E","S":"#E0A93A","H":"#FFF0A8","Y":"#FF9E4D"},
    frames: [
      ['......SS......', '.....SBBS.....', '...SSBBBBSS...', '..SBBBBBBBBS..', '.SBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '.SPBBYYYYBBPS.', '.SBBBBYYBBBBS.', 'SBHHBBBBBBHHBS', 'SBHBBBBBBBBHBS', '.SSBBBBBBBBSS.', '..YY......YY..'],
      ['......SS......', '.....SBBS.....', '...SSBBBBSS...', '..SBBBBBBBBS..', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SPBBYYYYBBPS.', '.SBBBBYYBBBBS.', 'SBHHBBBBBBHHBS', 'SBHBBBBBBBBHBS', '.SSBBBBBBBBSS.', '..YY......YY..'],
      ['......SS......', '.....SBBS.....', '...SSBBBBSS...', '..SBBBBBBBBS..', '.SBEEBBBBEEBS.', '.SBBBBBBBBBBS.', '.SPBBYYYYBBPS.', '.SBBBBYYBBBBS.', 'SBHHBBBBBBHHBS', 'SBHBBBBBBBBHBS', '.SSBBBBBBBBSS.', '..YY......YY..'],
      ['......SS......', '.....SBBS.....', '...SSBBBBSS...', '..SBBBBBBBBS..', '.SBBEBBBBEBBS.', '.SBEBBBBBBEBS.', '.SPBBYYYYBBPS.', '.SBBBBYYBBBBS.', 'SBHHBBBBBBHHBS', 'SBHBBBBBBBBHBS', '.SSBBBBBBBBSS.', '..YY......YY..'],
      ['......SS......', '.....SBBS.....', '...SSBBBBSS...', '..SBBBBBBBBS..', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SPBBYYYYBBPS.', '.SBBBBYYBBBBS.', 'SBHHBBBBBBHHBS', 'SBHBBBBBBBBHBS', '.SSBBBBBBBBSS.', '..YY......YY..'],
    ],
  },
  marlin: {
    name: "삐죽",
    animal: "청새치",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#4F8FE0","S":"#2F63B0","H":"#A6CBF7","L":"#E5F1FF","Y":"#D5DEEA"},
    frames: [
      ['......YY......', '......YY......', '....SSYYSS....', '..SSBBBBBBSS..', '.SBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '.SPBBBMMBBBPS.', '.SBBLLLLLLBBS.', 'SBBBLLLLLLBBBS', '.SBBBLLLLBBBS.', '..SSBBBBBBSS..', '..HH..SS..HH..'],
      ['......YY......', '......YY......', '....SSYYSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SPBBBMMBBBPS.', '.SBBLLLLLLBBS.', 'SBBBLLLLLLBBBS', '.SBBBLLLLBBBS.', '..SSBBBBBBSS..', '..HH..SS..HH..'],
      ['......YY......', '......YY......', '....SSYYSS....', '..SSBBBBBBSS..', '.SBEEBBBBEEBS.', '.SBBBBBBBBBBS.', '.SPBBMMMMBBPS.', '.SBBLLLLLLBBS.', 'SBBBLLLLLLBBBS', '.SBBBLLLLBBBS.', '..SSBBBBBBSS..', '..HH..SS..HH..'],
      ['......YY......', '......YY......', '....SSYYSS....', '..SSBBBBBBSS..', '.SBBEBBBBEBBS.', '.SBEBBBBBBEBS.', '.SPBBBMMBBBPS.', '.SBBLLLLLLBBS.', 'SBBBLLLLLLBBBS', '.SBBBLLLLBBBS.', '..SSBBBBBBSS..', '..HH..SS..HH..'],
      ['......YY......', '......YY......', '....SSYYSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SPBBBMBBBBPS.', '.SBBLLLLLLBBS.', 'SBBBLLLLLLBBBS', '.SBBBLLLLBBBS.', '..SSBBBBBBSS..', '..HH..SS..HH..'],
    ],
  },
};
