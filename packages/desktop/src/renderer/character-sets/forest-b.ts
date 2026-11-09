/** 숲속 친구들 세트 B조(글쓰기·디자인·운영·디버깅·위험 점검·계획·분할) 도트 7마리. 형식은 characters-data.ts와 같다.
 * 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. 격자 14x12, '.'은 빈칸. */
import type { PixelCharacter } from '../characters-data.js';
import type { CharacterRole } from '../characters.js';

export const FOREST_B: Partial<Record<CharacterRole, PixelCharacter>> = {
  writer: {
    name: "딱지",
    animal: "딱따구리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","S":"#2A2D3A","K":"#3A3D4A","L":"#FFFFFF","H":"#EFE3C6","R":"#E5484D","G":"#A7AFC2","O":"#6B7388","Y":"#8A8F9E"},
    frames: [
      ['.......SSS....', '.....SSRRRSS..', '....SRRRRRRRS.', '....SRRRRRRKS.', 'SGGGSWELLKKKS.', '.OOOSEELKKKKS.', '....SHHHSLLLLS', '....SHHHSKKKKS', '....SHHHSLLLLS', '.....SHHSKKKKS', '......SSSSKKKS', '.....YY.YY.SSS'],
      ['.......SSS....', '.....SSRRRSS..', '....SRRRRRRRS.', '....SRRRRRRKS.', 'SGGGSLLLLKKKS.', '.OOOSEELKKKKS.', '....SHHHSLLLLS', '....SHHHSKKKKS', '....SHHHSLLLLS', '.....SHHSKKKKS', '......SSSSKKKS', '.....YY.YY.SSS'],
      ['.......SSS....', '.....SSRRRSS..', '....SRRRRRRRS.', '....SRRRRRRKS.', 'SGGGSEELLKKKS.', '.OOOSLLLKKKKS.', '....SHHHSLLLLS', '....SHHHSKKKKS', '....SHHHSLLLLS', '.....SHHSKKKKS', '......SSSSKKKS', '.....YY.YY.SSS'],
      ['.......SSS....', '.....SSRRRSS..', '....SRRRRRRRS.', '....SRRRRRRKS.', 'SGGGSLELLKKKS.', '.OOOSELLKKKKS.', '....SHHHSLLLLS', '....SHHHSKKKKS', '....SHHHSLLLLS', '.....SHHSKKKKS', '......SSSSKKKS', '.....YY.YY.SSS'],
      ['..............', '.....SSRRRSS..', '....SRRRRRRRS.', '....SRRRRRRKS.', 'SGGGSLLLLKKKS.', '.OOOSEELKKKKS.', '....SHHHSLLLLS', '....SHHHSKKKKS', '....SHHHSLLLLS', '.....SHHSKKKKS', '......SSSSKKKS', '.....YY.YY.SSS'],
    ],
  },
  designer: {
    name: "루나",
    animal: "나비",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F59AC8","S":"#B8558F","H":"#FFD0E8","L":"#FFF1E0","K":"#8A5A3C"},
    frames: [
      ['..S........S..', 'HH.S......S.HH', 'HHHSSSSSSSSHHH', 'HHBSWELLWESBHH', 'HBBSEELLEESBBH', 'HBBSPLLLLPSBBH', 'HBBSLLMMLLSBBH', '.HBBSSKKSSBBH.', '.SBBBSKKSBBBS.', '..SBBSKKSBBS..', '...SSSKKSSS...', '......SS......'],
      ['..S........S..', 'HH.S......S.HH', 'HHHSSSSSSSSHHH', 'HHBSLLLLLLSBHH', 'HBBSEELLEESBBH', 'HBBSPLLLLPSBBH', 'HBBSLLMMLLSBBH', '.HBBSSKKSSBBH.', '.SBBBSKKSBBBS.', '..SBBSKKSBBS..', '...SSSKKSSS...', '......SS......'],
      ['..S........S..', 'HH.S......S.HH', 'HHHSSSSSSSSHHH', 'HHBSEELLEESBHH', 'HBBSLLLLLLSBBH', 'HBBSPLLLLPSBBH', 'HBBSLMMMMLSBBH', '.HBBSSKKSSBBH.', '.SBBBSKKSBBBS.', '..SBBSKKSBBS..', '...SSSKKSSS...', '......SS......'],
      ['..S........S..', 'HH.S......S.HH', 'HHHSSSSSSSSHHH', 'HHBSLELLELSBHH', 'HBBSELLLLESBBH', 'HBBSPLLLLPSBBH', 'HBBSLLMMLLSBBH', '.HBBSSKKSSBBH.', '.SBBBSKKSBBBS.', '..SBBSKKSBBS..', '...SSSKKSSS...', '......SS......'],
      ['..S........S..', 'HH.S......S.HH', 'HHHSSSSSSSSHHH', 'HHBSLLLLLLSBHH', 'HBBSEELLEESBBH', 'HBBSPLLLLPSBBH', 'HBBSLLMLLLSBBH', '.HBBSSKKSSBBH.', '.SBBBSKKSBBBS.', '..SBBSKKSBBS..', '...SSSKKSSS...', '......SS......'],
    ],
  },
  operator: {
    name: "두디",
    animal: "두더지",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#9A94B3","S":"#6A6488","H":"#C3BED6","L":"#D9D5E6","N":"#F59AB0","Y":"#FFE9B8"},
    frames: [
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', '.SBPBNNNNBPBS.', '.SBBBNMMNBBBS.', '..SBBBBBBBBS..', '.SBBBLLLLBBBS.', 'SYBBBLLLLBBBYS', 'SYYSBBBBBBSYYS', '.SSS.SSSS.SSS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBNNNNBPBS.', '.SBBBNMMNBBBS.', '..SBBBBBBBBS..', '.SBBBLLLLBBBS.', 'SYBBBLLLLBBBYS', 'SYYSBBBBBBSYYS', '.SSS.SSSS.SSS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', '.SBPBNNNNBPBS.', '.SBBBMMMMBBBS.', '..SBBBBBBBBS..', '.SBBBLLLLBBBS.', 'SYBBBLLLLBBBYS', 'SYYSBBBBBBSYYS', '.SSS.SSSS.SSS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', '.SBPBNNNNBPBS.', '.SBBBNMMNBBBS.', '..SBBBBBBBBS..', '.SBBBLLLLBBBS.', 'SYBBBLLLLBBBYS', 'SYYSBBBBBBSYYS', '.SSS.SSSS.SSS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBNNNNBPBS.', '.SBBBNMBNBBBS.', '..SBBBBBBBBS..', '.SBBBLLLLBBBS.', 'SYBBBLLLLBBBYS', 'SYYSBBBBBBSYYS', '.SSS.SSSS.SSS.'],
    ],
  },
  debugger: {
    name: "점이",
    animal: "무당벌레",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#E5534B","S":"#9E2F33","H":"#FF8A80","L":"#FFF1E0","K":"#2B2B3A"},
    frames: [
      ['...S......S...', '....S....S....', '...SSSSSSSS...', '..SLWELLWELS..', '..SLEELLEELS..', '.SBPLLLLLLPBS.', '.SBBLLMMLLBBS.', 'SBBKBBSSBBKBBS', 'SBKKBBSSBBBKKS', 'SBBBBBSSBBBBBS', '.SBBBBSSBBBBS.', '..SS.SSSS.SS..'],
      ['...S......S...', '....S....S....', '...SSSSSSSS...', '..SLLLLLLLLS..', '..SLEELLEELS..', '.SBPLLLLLLPBS.', '.SBBLLMMLLBBS.', 'SBBKBBSSBBKBBS', 'SBKKBBSSBBBKKS', 'SBBBBBSSBBBBBS', '.SBBBBSSBBBBS.', '..SS.SSSS.SS..'],
      ['...S......S...', '....S....S....', '...SSSSSSSS...', '..SLEELLEELS..', '..SLLLLLLLLS..', '.SBPLLLLLLPBS.', '.SBBLMMMMLBBS.', 'SBBKBBSSBBKBBS', 'SBKKBBSSBBBKKS', 'SBBBBBSSBBBBBS', '.SBBBBSSBBBBS.', '..SS.SSSS.SS..'],
      ['...S......S...', '....S....S....', '...SSSSSSSS...', '..SLLELLELLS..', '..SLELLLLELS..', '.SBPLLLLLLPBS.', '.SBBLLMMLLBBS.', 'SBBKBBSSBBKBBS', 'SBKKBBSSBBBKKS', 'SBBBBBSSBBBBBS', '.SBBBBSSBBBBS.', '..SS.SSSS.SS..'],
      ['...S......S...', '....S....S....', '...SSSSSSSS...', '..SLLLLLLLLS..', '..SLEELLEELS..', '.SBPLLLLLLPBS.', '.SBBLLMLLLBBS.', 'SBBKBBSSBBKBBS', 'SBKKBBSSBBBKKS', 'SBBBBBSSBBBBBS', '.SBBBBSSBBBBS.', '..SS.SSSS.SS..'],
    ],
  },
  riskchecker: {
    name: "쪼제",
    animal: "족제비",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#DB9F55","S":"#94602A","H":"#EBC088","L":"#FFF3DC","K":"#4A3220"},
    frames: [
      ['..SS......SS..', '.SBBS....SBBS.', '.SBBBSSSSBBBS.', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '...SBLLLLBS...', '..SBBLLLLBBSS.', '..SBBLLLLBBBSS', '..SBBBSSBBBKKS', '..SS......SSS.'],
      ['..SS......SS..', '.SBBS....SBBS.', '.SBBBSSSSBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '...SBLLLLBS...', '..SBBLLLLBBSS.', '..SBBLLLLBBBSS', '..SBBBSSBBBKKS', '..SS......SSS.'],
      ['..SS......SS..', '.SBBS....SBBS.', '.SBBBSSSSBBBS.', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', '.SBPBLLLLBPBS.', '..SBBMMMMBBS..', '...SBLLLLBS...', '..SBBLLLLBBSS.', '..SBBLLLLBBBSS', '..SBBBSSBBBKKS', '..SS......SSS.'],
      ['..SS......SS..', '.SBBS....SBBS.', '.SBBBSSSSBBBS.', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '...SBLLLLBS...', '..SBBLLLLBBSS.', '..SBBLLLLBBBSS', '..SBBBSSBBBKKS', '..SS......SSS.'],
      ['..SS......SS..', '.SBBS....SBBS.', '.SBBBSSSSBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMBLBBS..', '...SBLLLLBS...', '..SBBLLLLBBSS.', '..SBBLLLLBBBSS', '..SBBBSSBBBKKS', '..SS......SSS.'],
    ],
  },
  planner: {
    name: "도리",
    animal: "청설모",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#A98468","S":"#6F5038","H":"#D9BFA3","L":"#F6E8D6"},
    frames: [
      ['..S........S..', '.SBSSSSSSSSBS.', '.SBBBBBBBBBBS.', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '..SBLLLLLLBSHH', '..SBLLLLLLBSHH', '..SBBLLLLBBSHH', '...SBBBBBBSSHS', '...SSS..SSSS..'],
      ['..S........S..', '.SBSSSSSSSSBS.', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '..SBLLLLLLBSHH', '..SBLLLLLLBSHH', '..SBBLLLLBBSHH', '...SBBBBBBSSHS', '...SSS..SSSS..'],
      ['..S........S..', '.SBSSSSSSSSBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', '.SBPBLLLLBPBS.', '..SBBMMMMBBS..', '..SBLLLLLLBSHH', '..SBLLLLLLBSHH', '..SBBLLLLBBSHH', '...SBBBBBBSSHS', '...SSS..SSSS..'],
      ['..S........S..', '.SBSSSSSSSSBS.', '.SBBBBBBBBBBS.', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', '.SBPBLLLLBPBS.', '..SBBLMMLBBS..', '..SBLLLLLLBSHH', '..SBLLLLLLBSHH', '..SBBLLLLBBSHH', '...SBBBBBBSSHS', '...SSS..SSSS..'],
      ['..S........S..', '.SBSSSSSSSSBS.', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBPBLLLLBPBS.', '..SBBLMBLBBS..', '..SBLLLLLLBSHH', '..SBLLLLLLBSHH', '..SBBLLLLBBSHH', '...SBBBBBBSSHS', '...SSS..SSSS..'],
    ],
  },
  splitter: {
    name: "소소",
    animal: "오소리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#8E95A3","S":"#4F5668","K":"#25272F","L":"#F2EFE8","C":"#C9CEDA"},
    frames: [
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBWELLWEBBS.', '.SBBWELLWEBBS.', '.SLLKKLLKKLLS.', '..SLLKLLKLLS..', '..SLLLMMLLLS..', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBCCLLCCBBS.', '.SLLKKLLKKLLS.', '..SLLKLLKLLS..', '..SLLLMMLLLS..', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBCCLLCCBBS.', '.SBBKKLLKKBBS.', '.SLLKKLLKKLLS.', '..SLLKLLKLLS..', '..SLLMMMMLLS..', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBKWLLWKBBS.', '.SBBWKLLKWBBS.', '.SLLKKLLKKLLS.', '..SLLKLLKLLS..', '..SLLLMMLLLS..', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBKKLLKKBBS.', '.SBBCCLLCCBBS.', '.SLLKKLLKKLLS.', '..SLLKLLKLLS..', '..SLLLMLLLLS..', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
    ],
  },
};
