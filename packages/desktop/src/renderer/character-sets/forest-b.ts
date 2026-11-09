/** 숲속 친구들 세트 B조(글쓰기·디자인·운영·디버깅·위험 점검·계획·분할) 도트 7마리. 형식은 characters-data.ts와 같다.
 * 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. 격자 14x12, '.'은 빈칸. */
import type { PixelCharacter } from '../characters-data.js';
import type { CharacterRole } from '../characters.js';

export const FOREST_B: Partial<Record<CharacterRole, PixelCharacter>> = {
  writer: {
    name: "딱지",
    animal: "딱따구리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F6EFE0","S":"#7B8399","H":"#FFFFFF","L":"#FFF9EC","R":"#E5484D","K":"#3B3F4F","Y":"#8E96A8","O":"#FFB347"},
    frames: [
      ['....SKRRKS....', '..SSKKRRKKSS..', '.SKKKBBBBKKKS.', '.SKBWEBBWEBKS.', '.SBBEEBBEEBBS.', '.SBPBYYYYBPBS.', '.SBBBBMMBBBBS.', '..SSBBBBBBSS..', '.SKKBLLLLBKKS.', '.SKHKLLLLKHKS.', '..SKKLLLLKKS..', '...OO....OO...'],
      ['....SKRRKS....', '..SSKKRRKKSS..', '.SKKKBBBBKKKS.', '.SKBBBBBBBBKS.', '.SBBEEBBEEBBS.', '.SBPBYYYYBPBS.', '.SBBBBMMBBBBS.', '..SSBBBBBBSS..', '.SKKBLLLLBKKS.', '.SKHKLLLLKHKS.', '..SKKLLLLKKS..', '...OO....OO...'],
      ['....SKRRKS....', '..SSKKRRKKSS..', '.SKKKBBBBKKKS.', '.SKBEEBBEEBKS.', '.SBBBBBBBBBBS.', '.SBPBYYYYBPBS.', '.SBBBMMMMBBBS.', '..SSBBBBBBSS..', '.SKKBLLLLBKKS.', '.SKHKLLLLKHKS.', '..SKKLLLLKKS..', '...OO....OO...'],
      ['....SKRRKS....', '..SSKKRRKKSS..', '.SKKKBBBBKKKS.', '.SKBBEBBEBBKS.', '.SBBEBBBBEBBS.', '.SBPBYYYYBPBS.', '.SBBBBMMBBBBS.', '..SSBBBBBBSS..', '.SKKBLLLLBKKS.', '.SKHKLLLLKHKS.', '..SKKLLLLKKS..', '...OO....OO...'],
      ['....SKRRKS....', '..SSKKRRKKSS..', '.SKKKBBBBKKKS.', '.SKBBBBBBBBKS.', '.SBBEEBBEEBBS.', '.SBPBYYYYBPBS.', '.SBBBBMBBBBBS.', '..SSBBBBBBSS..', '.SKKBLLLLBKKS.', '.SKHKLLLLKHKS.', '..SKKLLLLKKS..', '...OO....OO...'],
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
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#9AA0AE","S":"#6B7488","H":"#C9CEDA","L":"#F4F1EA","K":"#323646"},
    frames: [
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SKKKLLLLKKKS.', '.SKKWELLWEKKS.', '.SKKEELLEEKKS.', '.SKPLLLLLLPKS.', '..SKKLMMLKKS..', '...SKLLLLKS...', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SKKKLLLLKKKS.', '.SKKLLLLLLKKS.', '.SKKEELLEEKKS.', '.SKPLLLLLLPKS.', '..SKKLMMLKKS..', '...SKLLLLKS...', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SKKKLLLLKKKS.', '.SKKEELLEEKKS.', '.SKKLLLLLLKKS.', '.SKPLLLLLLPKS.', '..SKKMMMMKKS..', '...SKLLLLKS...', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SKKKLLLLKKKS.', '.SKKLELLELKKS.', '.SKKELLLLEKKS.', '.SKPLLLLLLPKS.', '..SKKLMMLKKS..', '...SKLLLLKS...', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
      ['..SS......SS..', '.SLLSSSSSSLLS.', '.SKKKLLLLKKKS.', '.SKKLLLLLLKKS.', '.SKKEELLEEKKS.', '.SKPLLLLLLPKS.', '..SKKLMLLKKS..', '...SKLLLLKS...', '..SBBBLLBBBS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '..SSS....SSS..'],
    ],
  },
};
