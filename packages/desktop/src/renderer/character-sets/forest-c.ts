/** 숲속 친구들 세트 C조 8마리(숲·들판 동물). 형식은 ../characters-data.ts와 같다. 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. */
import type { CharacterRole } from '../characters.js';
import type { PixelCharacter } from '../characters-data.js';

export const FOREST_C: Partial<Record<CharacterRole, PixelCharacter>> = {
  chief: {
    name: "하랑",
    animal: "늑대",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#9AA5B8","S":"#5F6B82","H":"#C9D1DE","L":"#EEF1F6","X":"#F2B8C6"},
    frames: [
      ['..S........S..', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBWEBBWEBBBS', 'SBBBEEBBEEBBBS', 'SBPBBLLLLBBPBS', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '...SBLLLLBS...', '....SSLLSS....', '.....SSSS.....'],
      ['..S........S..', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBBBBBBBBBS', 'SBBBEEBBEEBBBS', 'SBPBBLLLLBBPBS', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '...SBLLLLBS...', '....SSLLSS....', '.....SSSS.....'],
      ['..S........S..', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBEEBBEEBBBS', 'SBBBBBBBBBBBBS', 'SBPBBLLLLBBPBS', '.SBBLLDDLLBBS.', '..SBLMMMMLBS..', '...SBLLLLBS...', '....SSLLSS....', '.....SSSS.....'],
      ['..S........S..', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBEBBEBBBBS', 'SBBBEBBBBEBBBS', 'SBPBBLLLLBBPBS', '.SBBLLDDLLBBS.', '..SBLLMMLLBS..', '...SBLLLLBS...', '....SSLLSS....', '.....SSSS.....'],
      ['..S........S..', '.SXS......SXS.', '.SXBS....SBXS.', '.SBBBSSSSBBBS.', 'SBBBBBBBBBBBBS', 'SBBBEEBBEEBBBS', 'SBPBBLLLLBBPBS', '.SBBLLDDLLBBS.', '..SBLLMLLLBS..', '...SBLLLLBS...', '....SSLLSS....', '.....SSSS.....'],
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
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#2F3A4F","S":"#1B2230","H":"#4B79B8","L":"#F4F6FA"},
    frames: [
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBHHBBBBBBS.', '.SLWELLLLWELS.', '.SLEELLLLEELS.', '.SPLLLDDLLLPS.', '.SLLLLMMLLLLS.', 'SBBBLLLLLLBBBS', 'SBHBLLLLLLBHBS', 'SBHBBLLLLBBHBS', '.SSBSBBBBSBSS.', '...SSBHHBSS...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBHHBBBBBBS.', '.SLLLLLLLLLLS.', '.SLEELLLLEELS.', '.SPLLLDDLLLPS.', '.SLLLLMMLLLLS.', 'SBBBLLLLLLBBBS', 'SBHBLLLLLLBHBS', 'SBHBBLLLLBBHBS', '.SSBSBBBBSBSS.', '...SSBHHBSS...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBHHBBBBBBS.', '.SLEELLLLEELS.', '.SLLLLLLLLLLS.', '.SPLLLDDLLLPS.', '.SLLLMMMMLLLS.', 'SBBBLLLLLLBBBS', 'SBHBLLLLLLBHBS', 'SBHBBLLLLBBHBS', '.SSBSBBBBSBSS.', '...SSBHHBSS...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBHHBBBBBBS.', '.SLLELLLLELLS.', '.SLELLLLLLELS.', '.SPLLLDDLLLPS.', '.SLLLLMMLLLLS.', 'SBBBLLLLLLBBBS', 'SBHBLLLLLLBHBS', 'SBHBBLLLLBBHBS', '.SSBSBBBBSBSS.', '...SSBHHBSS...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBHHBBBBBBS.', '.SLLLLLLLLLLS.', '.SLEELLLLEELS.', '.SPLLLDDLLLPS.', '.SLLLLMLLLLLS.', 'SBBBLLLLLLBBBS', 'SBHBLLLLLLBHBS', 'SBHBBLLLLBBHBS', '.SSBSBBBBSBSS.', '...SSBHHBSS...'],
    ],
  },
  growth: {
    name: "뿔돌",
    animal: "사슴벌레",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#7A3F2B","S":"#3E1E14","H":"#C0764F","L":"#D8B08A"},
    frames: [
      ['..SSS....SSS..', '.SBBBS..SBBBS.', '.SBBS....SBBS.', '.SBS.SSSS.SBS.', '..SSWEBBWESS..', '...SEEBBEES...', '..SPBBMMBBPS..', '.SBBBBBBBBBBS.', 'SBHBBBSSBBBBBS', 'SBHBBBSSBBBBBS', '.SBBBBSSBBBBS.', 'SS.SS.SSSS.SS.'],
      ['..SSS....SSS..', '.SBBBS..SBBBS.', '.SBBS....SBBS.', '.SBS.SSSS.SBS.', '..SSBBBBBBSS..', '...SEEBBEES...', '..SPBBMMBBPS..', '.SBBBBBBBBBBS.', 'SBHBBBSSBBBBBS', 'SBHBBBSSBBBBBS', '.SBBBBSSBBBBS.', 'SS.SS.SSSS.SS.'],
      ['..SSS....SSS..', '.SBBBS..SBBBS.', '.SBBS....SBBS.', '.SBS.SSSS.SBS.', '..SSEEBBEESS..', '...SBBBBBBS...', '..SPBMMMMBPS..', '.SBBBBBBBBBBS.', 'SBHBBBSSBBBBBS', 'SBHBBBSSBBBBBS', '.SBBBBSSBBBBS.', 'SS.SS.SSSS.SS.'],
      ['..SSS....SSS..', '.SBBBS..SBBBS.', '.SBBS....SBBS.', '.SBS.SSSS.SBS.', '..SSBEBBEBSS..', '...SEBBBBES...', '..SPBBMMBBPS..', '.SBBBBBBBBBBS.', 'SBHBBBSSBBBBBS', 'SBHBBBSSBBBBBS', '.SBBBBSSBBBBS.', 'SS.SS.SSSS.SS.'],
      ['..SSS....SSS..', '.SBBBS..SBBBS.', '.SBBS....SBBS.', '.SBS.SSSS.SBS.', '..SSBBBBBBSS..', '...SEEBBEES...', '..SPBBMBBBPS..', '.SBBBBBBBBBBS.', 'SBHBBBSSBBBBBS', 'SBHBBBSSBBBBBS', '.SBBBBSSBBBBS.', 'SS.SS.SSSS.SS.'],
    ],
  },
  uxdesigner: {
    name: "느릿",
    animal: "거북이",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#A9D58A","S":"#5E8F46","H":"#D2F2B8","X":"#C98A4B","Z":"#8E5A2B","Q":"#E3B97A"},
    frames: [
      ['....SSSSSS....', '..SSBBBBBBSS..', '..SBBBBBBBBS..', '..SBWEBBWEBS..', '..SBEEBBEEBS..', '..SPBBMMBBPS..', '.ZZZSBBBBSZZZ.', 'ZXXXZZZZZZXXXZ', 'ZXQXXZXXZXXQXZ', 'ZXXXZXXXXZXXXZ', '.ZZXXZXXZXXZZ.', '.SBS.ZZZZ.SBS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBBMMBBPS..', '.ZZZSBBBBSZZZ.', 'ZXXXZZZZZZXXXZ', 'ZXQXXZXXZXXQXZ', 'ZXXXZXXXXZXXXZ', '.ZZXXZXXZXXZZ.', '.SBS.ZZZZ.SBS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SBBBBBBBBS..', '..SPBMMMMBPS..', '.ZZZSBBBBSZZZ.', 'ZXXXZZZZZZXXXZ', 'ZXQXXZXXZXXQXZ', 'ZXXXZXXXXZXXXZ', '.ZZXXZXXZXXZZ.', '.SBS.ZZZZ.SBS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '..SBBBBBBBBS..', '..SBBEBBEBBS..', '..SBEBBBBEBS..', '..SPBBMMBBPS..', '.ZZZSBBBBSZZZ.', 'ZXXXZZZZZZXXXZ', 'ZXQXXZXXZXXQXZ', 'ZXXXZXXXXZXXXZ', '.ZZXXZXXZXXZZ.', '.SBS.ZZZZ.SBS.'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '..SBBBBBBBBS..', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBBMBBBPS..', '.ZZZSBBBBSZZZ.', 'ZXXXZZZZZZXXXZ', 'ZXQXXZXXZXXQXZ', 'ZXXXZXXXXZXXXZ', '.ZZXXZXXZXXZZ.', '.SBS.ZZZZ.SBS.'],
    ],
  },
  brand: {
    name: "솔잎",
    animal: "고라니",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#C9915B","S":"#8A5A32","H":"#E6BC8C","L":"#F6E3C8","X":"#F2B8A8"},
    frames: [
      ['.SSSS....SSSS.', 'SBXXBS..SBXXBS', 'SBXXBSSSSBXXBS', '.SBBBBBBBBBBS.', '..SBWEBBWEBS..', '..SBEEBBEEBS..', '..SPBLLLLBPS..', '..SBLLDDLLBS..', '..SBLLMMLLBS..', '..SBLWLLWLBS..', '...SBBLLBBS...', '...SSS..SSS...'],
      ['.SSSS....SSSS.', 'SBXXBS..SBXXBS', 'SBXXBSSSSBXXBS', '.SBBBBBBBBBBS.', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBLLLLBPS..', '..SBLLDDLLBS..', '..SBLLMMLLBS..', '..SBLWLLWLBS..', '...SBBLLBBS...', '...SSS..SSS...'],
      ['.SSSS....SSSS.', 'SBXXBS..SBXXBS', 'SBXXBSSSSBXXBS', '.SBBBBBBBBBBS.', '..SBEEBBEEBS..', '..SBBBBBBBBS..', '..SPBLLLLBPS..', '..SBLLDDLLBS..', '..SBLMMMMLBS..', '..SBLWLLWLBS..', '...SBBLLBBS...', '...SSS..SSS...'],
      ['.SSSS....SSSS.', 'SBXXBS..SBXXBS', 'SBXXBSSSSBXXBS', '.SBBBBBBBBBBS.', '..SBBEBBEBBS..', '..SBEBBBBEBS..', '..SPBLLLLBPS..', '..SBLLDDLLBS..', '..SBLLMMLLBS..', '..SBLWLLWLBS..', '...SBBLLBBS...', '...SSS..SSS...'],
      ['.SSSS....SSSS.', 'SBXXBS..SBXXBS', 'SBXXBSSSSBXXBS', '.SBBBBBBBBBBS.', '..SBBBBBBBBS..', '..SBEEBBEEBS..', '..SPBLLLLBPS..', '..SBLLDDLLBS..', '..SBLLMLLLBS..', '..SBLWLLWLBS..', '...SBBLLBBS...', '...SSS..SSS...'],
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
