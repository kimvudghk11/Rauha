/** 숲속 친구들 세트 C조 8마리(숲·들판 동물). 형식은 ../characters-data.ts와 같다. 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. */
import type { CharacterRole } from '../characters.js';
import type { PixelCharacter } from '../characters-data.js';

export const FOREST_C: Partial<Record<CharacterRole, PixelCharacter>> = {
  chief: {
    name: "하랑",
    animal: "늑대",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#6C7F9E","S":"#36435C","H":"#A9BAD2","L":"#C9D2E0","X":"#3C4863","Y":"#F2C14E"},
    frames: [
      ['.SS........SS.', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBYEBBYEBBBS', 'SBBBEEBBEEBBBS', 'HSBBBBLLBBBBSH', '.HSBBLDDLBBSH.', '..SSBLLLLBSS..', '...SBLMMLBS...', '....SLLLLS....', '.....SSSS.....'],
      ['.SS........SS.', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBBBBBBBBBS', 'SBBBEEBBEEBBBS', 'HSBBBBLLBBBBSH', '.HSBBLDDLBBSH.', '..SSBLLLLBSS..', '...SBLMMLBS...', '....SLLLLS....', '.....SSSS.....'],
      ['.SS........SS.', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBEEBBEEBBBS', 'SBBBBBBBBBBBBS', 'HSBBBBLLBBBBSH', '.HSBBLDDLBBSH.', '..SSBLLLLBSS..', '...SBMMMMBS...', '....SLLLLS....', '.....SSSS.....'],
      ['.SS........SS.', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBEBBEBBBBS', 'SBBBEBBBBEBBBS', 'HSBBBBLLBBBBSH', '.HSBBLDDLBBSH.', '..SSBLLLLBSS..', '...SBLMMLBS...', '....SLLLLS....', '.....SSSS.....'],
      ['.SS........SS.', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBBBBBBBBBS', 'SBBBEEBBEEBBBS', 'HSBBBBLLBBBBSH', '.HSBBLDDLBBSH.', '..SSBLLLLBSS..', '...SBLMLLBS...', '....SLLLLS....', '.....SSSS.....'],
    ],
  },
  bm: {
    name: "윙윙",
    animal: "벌",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FFD54F","S":"#C98F1A","H":"#FFEFA8","K":"#3B2F2F","A":"#E4F3FC","N":"#8FB8D8"},
    frames: [
      ['..K........K..', '...K.SSSS.K...', 'NN.SBBBBBBS.NN', 'NANSWEBBWESNAN', 'NNNSEEBBEESNNN', '..SPBBMMBBPS..', '..SKKKKKKKKS..', '..SBBBBBBBBS..', '..SKKKKKKKKS..', '...SBBBBBBS...', '....SKKKKS....', '.....SSSS.....'],
      ['..K........K..', '...K.SSSS.K...', 'NN.SBBBBBBS.NN', 'NANSBBBBBBSNAN', 'NNNSEEBBEESNNN', '..SPBBMMBBPS..', '..SKKKKKKKKS..', '..SBBBBBBBBS..', '..SKKKKKKKKS..', '...SBBBBBBS...', '....SKKKKS....', '.....SSSS.....'],
      ['..K........K..', '...K.SSSS.K...', 'NN.SBBBBBBS.NN', 'NANSEEBBEESNAN', 'NNNSBBBBBBSNNN', '..SPBMMMMBPS..', '..SKKKKKKKKS..', '..SBBBBBBBBS..', '..SKKKKKKKKS..', '...SBBBBBBS...', '....SKKKKS....', '.....SSSS.....'],
      ['..K........K..', '...K.SSSS.K...', 'NN.SBBBBBBS.NN', 'NANSBEBBEBSNAN', 'NNNSEBBBBESNNN', '..SPBBMMBBPS..', '..SKKKKKKKKS..', '..SBBBBBBBBS..', '..SKKKKKKKKS..', '...SBBBBBBS...', '....SKKKKS....', '.....SSSS.....'],
      ['..K........K..', '...K.SSSS.K...', 'NN.SBBBBBBS.NN', 'NANSBBBBBBSNAN', 'NNNSEEBBEESNNN', '..SPBBMBBBPS..', '..SKKKKKKKKS..', '..SBBBBBBBBS..', '..SKKKKKKKKS..', '...SBBBBBBS...', '....SKKKKS....', '.....SSSS.....'],
    ],
  },
  marketer: {
    name: "깍깍",
    animal: "까치",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#39445F","S":"#10151F","H":"#3D84D6","G":"#5FD0B8","L":"#F4F6FA","Y":"#C9CFDC","T":"#2C6BB8"},
    frames: [
      ['.......SSSS...', '......SBBBBS..', '.....SBBBWBS..', '.....SBBBBBSYY', '....SBBBBLLSY.', '..SSBBBBBLLLS.', 'STGGHHHBBLLLS.', 'SBTTHHBBBLLS..', '.SSSSSBBBLS...', '.......SSSS...', '.......S..S...', '.......SS.SS..'],
      ['.......SSSS...', '......SBBBBS..', '.....SBBBBBS..', '.....SBBBBBSYY', '....SBBBBLLSY.', '..SSBBBBBLLLS.', 'STGGHHHBBLLLS.', 'SBTTHHBBBLLS..', '.SSSSSBBBLS...', '.......SSSS...', '.......S..S...', '.......SS.SS..'],
      ['.......SSSS...', '......SBBBBS..', '.....SBBLLBS..', '.....SBBBBBSYY', '....SBBBBLLSY.', '..SSBBBBBLLLS.', 'STGGHHHBBLLLS.', 'SBTTHHBBBLLS..', '.SSSSSBBBLS...', '.......SSSS...', '.......S..S...', '.......SS.SS..'],
      ['.......SSSS...', '......SBBBBS..', '.....SBBBBBS..', '.....SBBBWBSYY', '....SBBBBLLSY.', '..SSBBBBBLLLS.', 'STGGHHHBBLLLS.', 'SBTTHHBBBLLS..', '.SSSSSBBBLS...', '.......SSSS...', '.......S..S...', '.......SS.SS..'],
      ['.......SSSS...', '......SBBBBS..', '.....SBBBBBS..', '.....SBBBLBSYY', '....SBBBBLLSY.', '..SSBBBBBLLLS.', 'STGGHHHBBLLLS.', 'SBTTHHBBBLLS..', '.SSSSSBBBLS...', '.......SSSS...', '.......S..S...', '.......SS.SS..'],
    ],
  },
  growth: {
    name: "뿔돌",
    animal: "사슴벌레",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#4A2A1E","S":"#1F100A","H":"#7A4A33","T":"#B8683C","R":"#7B4430"},
    frames: [
      ['.SS........SS.', '...S......S...', '....S.SS.S....', '..SSBBBBBBSS..', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', 'STSBBBMMBBBSTS', 'STTSRRRRRRSTTS', 'SRTTSRRRRSTTRS', 'SRRTTRRRRTTRRS', '.SRRTTSSTTRRS.', '..SS.S..S.SS..'],
      ['.SS........SS.', '...S......S...', '....S.SS.S....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', 'STSBBBMMBBBSTS', 'STTSRRRRRRSTTS', 'SRTTSRRRRSTTRS', 'SRRTTRRRRTTRRS', '.SRRTTSSTTRRS.', '..SS.S..S.SS..'],
      ['.SS........SS.', '...S......S...', '....S.SS.S....', '..SSBBBBBBSS..', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', 'STSBBMMMMBBSTS', 'STTSRRRRRRSTTS', 'SRTTSRRRRSTTRS', 'SRRTTRRRRTTRRS', '.SRRTTSSTTRRS.', '..SS.S..S.SS..'],
      ['.SS........SS.', '...S......S...', '....S.SS.S....', '..SSBBBBBBSS..', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', 'STSBBBMMBBBSTS', 'STTSRRRRRRSTTS', 'SRTTSRRRRSTTRS', 'SRRTTRRRRTTRRS', '.SRRTTSSTTRRS.', '..SS.S..S.SS..'],
      ['.SS........SS.', '...S......S...', '....S.SS.S....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', 'STSBBBMBBBBSTS', 'STTSRRRRRRSTTS', 'SRTTSRRRRSTTRS', 'SRRTTRRRRTTRRS', '.SRRTTSSTTRRS.', '..SS.S..S.SS..'],
    ],
  },
  uxdesigner: {
    name: "느릿",
    animal: "거북이",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#A9D58A","S":"#4F6F3A","Z":"#8E5A2B","X":"#C98A4B","Q":"#5E3A1B"},
    frames: [
      ['....SSSSSS....', '..SSZZZZZZSS..', '.SZZZXXXXZZZS.', 'SZZXXXXXXXXZZS', 'SZZZXXXXXXZZZS', 'SQZSBBBBBBSZQS', '.SSBWEBBWEBSS.', '.SSBEEBBEEBSS.', '..SPBBMMBBPS..', '..SBBBBBBBBS..', '.SBS.SSSS.SBS.', '.SSS......SSS.'],
      ['....SSSSSS....', '..SSZZZZZZSS..', '.SZZZXXXXZZZS.', 'SZZXXXXXXXXZZS', 'SZZZXXXXXXZZZS', 'SQZSBBBBBBSZQS', '.SSBBBBBBBBSS.', '.SSBEEBBEEBSS.', '..SPBBMMBBPS..', '..SBBBBBBBBS..', '.SBS.SSSS.SBS.', '.SSS......SSS.'],
      ['....SSSSSS....', '..SSZZZZZZSS..', '.SZZZXXXXZZZS.', 'SZZXXXXXXXXZZS', 'SZZZXXXXXXZZZS', 'SQZSBBBBBBSZQS', '.SSBEEBBEEBSS.', '.SSBBBBBBBBSS.', '..SPBMMMMBPS..', '..SBBBBBBBBS..', '.SBS.SSSS.SBS.', '.SSS......SSS.'],
      ['....SSSSSS....', '..SSZZZZZZSS..', '.SZZZXXXXZZZS.', 'SZZXXXXXXXXZZS', 'SZZZXXXXXXZZZS', 'SQZSBBBBBBSZQS', '.SSBBEBBEBBSS.', '.SSBEBBBBEBSS.', '..SPBBMMBBPS..', '..SBBBBBBBBS..', '.SBS.SSSS.SBS.', '.SSS......SSS.'],
      ['....SSSSSS....', '..SSZZZZZZSS..', '.SZZZXXXXZZZS.', 'SZZXXXXXXXXZZS', 'SZZZXXXXXXZZZS', 'SQZSBBBBBBSZQS', '.SSBBBBBBBBSS.', '.SSBEEBBEEBSS.', '..SPBBMBBBPS..', '..SBBBBBBBBS..', '.SBS.SSSS.SBS.', '.SSS......SSS.'],
    ],
  },
  brand: {
    name: "솔잎",
    animal: "고라니",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#D8BE78","S":"#8C7438","H":"#F4E7B8","L":"#F6EBCB","X":"#FBF1D2"},
    frames: [
      ['.SSSS....SSSS.', 'SBBBBS..SBBBBS', 'SBXXBBSSBBXXBS', 'SBXXBBBBBBXXBS', 'SBXXBBBBBBXXBS', '.SBBBBBBBBBBS.', '.SBBWEBBWEBBS.', '.SBBEEBBEEBBS.', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '..SBWLLLLWBS..', '...SSWSSWSS...'],
      ['.SSSS....SSSS.', 'SBBBBS..SBBBBS', 'SBXXBBSSBBXXBS', 'SBXXBBBBBBXXBS', 'SBXXBBBBBBXXBS', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '..SBWLLLLWBS..', '...SSWSSWSS...'],
      ['.SSSS....SSSS.', 'SBBBBS..SBBBBS', 'SBXXBBSSBBXXBS', 'SBXXBBBBBBXXBS', 'SBXXBBBBBBXXBS', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBBBBBBBBBBS.', '.SBBLLDDLLBBS.', '..SBLMMMMLBS..', '..SBWLLLLWBS..', '...SSWSSWSS...'],
      ['.SSSS....SSSS.', 'SBBBBS..SBBBBS', 'SBXXBBSSBBXXBS', 'SBXXBBBBBBXXBS', 'SBXXBBBBBBXXBS', '.SBBBBBBBBBBS.', '.SBBBEBBEBBBS.', '.SBBEBBBBEBBS.', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '..SBWLLLLWBS..', '...SSWSSWSS...'],
      ['.SSSS....SSSS.', 'SBBBBS..SBBBBS', 'SBXXBBSSBBXXBS', 'SBXXBBBBBBXXBS', 'SBXXBBBBBBXXBS', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBBEEBBEEBBS.', '.SBBLLDDLLBBS.', '..SBLLMLLLBS..', '..SBWLLLLWBS..', '...SSWSSWSS...'],
    ],
  },
  securitychecker: {
    name: "멧돌",
    animal: "멧돼지",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#8C6A4F","S":"#4F3A2B","H":"#B0896A","N":"#F2A7A0"},
    frames: [
      ['.SS...SS...SS.', 'SBBS.SHHS.SBBS', 'SBBBSBBBBSBBBS', '.SBBBBBBBBBBS.', '.SBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '.SBBBNNNNBBBS.', '.SPBNDNNDNBPS.', '..SWNNMMNNWS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SSS....SSS..'],
      ['.SS...SS...SS.', 'SBBS.SHHS.SBBS', 'SBBBSBBBBSBBBS', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBBBNNNNBBBS.', '.SPBNDNNDNBPS.', '..SWNNMMNNWS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SSS....SSS..'],
      ['.SS...SS...SS.', 'SBBS.SHHS.SBBS', 'SBBBSBBBBSBBBS', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBBBBBBBBBBS.', '.SBBBNNNNBBBS.', '.SPBNDNNDNBPS.', '..SWNMMMMNWS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SSS....SSS..'],
      ['.SS...SS...SS.', 'SBBS.SHHS.SBBS', 'SBBBSBBBBSBBBS', '.SBBBBBBBBBBS.', '.SBBEBBBBEBBS.', '.SBEBBBBBBEBS.', '.SBBBNNNNBBBS.', '.SPBNDNNDNBPS.', '..SWNNMMNNWS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SSS....SSS..'],
      ['.SS...SS...SS.', 'SBBS.SHHS.SBBS', 'SBBBSBBBBSBBBS', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBBBNNNNBBBS.', '.SPBNDNNDNBPS.', '..SWNNMNNNWS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SSS....SSS..'],
    ],
  },
  releaser: {
    name: "밤콩",
    animal: "박쥐",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#6E5FA0","S":"#40356A","H":"#A99BD6","X":"#A092D0","Z":"#F4A6C0"},
    frames: [
      ['..SS......SS..', '..SZS....SZS..', '..SZBSSSSBZS..', '..SBBBBBBBBS..', '..SBWEBBWEBS..', '..SBEEBBEEBS..', '..SPBBMMBBPS..', 'SSSSBWBBWBSSSS', 'SXXSSBBBBSSXXS', 'SXXXSSBBSSXXXS', '.SXSXSSSSXSXS.', '..S.S.S..S.S.S'],
      ['..SS......SS..', '..SZS....SZS..', '..SZBSSSSBZS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBBMMBBPS..', 'SSSSBWBBWBSSSS', 'SXXSSBBBBSSXXS', 'SXXXSSBBSSXXXS', '.SXSXSSSSXSXS.', '..S.S.S..S.S.S'],
      ['..SS......SS..', '..SZS....SZS..', '..SZBSSSSBZS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SBBBBBBBBS..', '..SPBMMMMBPS..', 'SSSSBWBBWBSSSS', 'SXXSSBBBBSSXXS', 'SXXXSSBBSSXXXS', '.SXSXSSSSXSXS.', '..S.S.S..S.S.S'],
      ['..SS......SS..', '..SZS....SZS..', '..SZBSSSSBZS..', '..SBBBBBBBBS..', '..SBBEBBEBBS..', '..SBEBBBBEBS..', '..SPBBMMBBPS..', 'SSSSBWBBWBSSSS', 'SXXSSBBBBSSXXS', 'SXXXSSBBSSXXXS', '.SXSXSSSSXSXS.', '..S.S.S..S.S.S'],
      ['..SS......SS..', '..SZS....SZS..', '..SZBSSSSBZS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBBMBBBPS..', 'SSSSBWBBWBSSSS', 'SXXSSBBBBSSXXS', 'SXXXSSBBSSXXXS', '.SXSXSSSSXSXS.', '..S.S.S..S.S.S'],
    ],
  },
};
