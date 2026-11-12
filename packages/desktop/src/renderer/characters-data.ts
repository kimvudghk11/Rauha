/** 캐릭터 23종 픽셀 데이터(시안 characters.html의 RAUHA_CHARACTERS에서 옮김). 역할 id → 이름·동물·색·프레임.
 * 프레임 순서: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠. 격자 한 글자 = 픽셀 하나, '.'은 빈칸. */
export interface PixelCharacter {
  readonly name: string;
  readonly animal: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly frames: readonly (readonly string[])[];
}

export const PIXEL_CHARACTERS: Readonly<Record<string, PixelCharacter>> = {
  intake: {
    name: "Delfi",
    animal: "돌고래",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#6FBDEB","S":"#4596CC","H":"#C4E8FF","L":"#DDF2FF"},
    frames: [
      ['......SS......', '.....SBS......', '...HHBBBBH....', '..HBBBBBBBBH..', '.HBBBBBBBBBBH.', '.BBWEBBBBWEBB.', '.BBEEBBBBEEBB.', 'SBPPBMBBMBPPBS', 'SSBBLLMMLLBBSS', '..BBLLLLLLBB..', '...SBLLLLBS...', '....SSSSSS....'],
      ['......SS......', '.....SBS......', '...HHBBBBH....', '..HBBBBBBBBH..', '.HBBBBBBBBBBH.', '.BBBBBBBBBBBB.', '.BBEEBBBBEEBB.', 'SBPPBMBBMBPPBS', 'SSBBLLMMLLBBSS', '..BBLLLLLLBB..', '...SBLLLLBS...', '....SSSSSS....'],
      ['......SS......', '.....SBS......', '...HHBBBBH....', '..HBBBBBBBBH..', '.HBBBBBBBBBBH.', '.BBEBBBBBBEBB.', '.BEBEBBBBEBEB.', 'SBPPBMMMMBPPBS', 'SSBBLLMMLLBBSS', '..BBLLLLLLBB..', '...SBLLLLBS...', '....SSSSSS....'],
      ['......SS......', '.....SBS......', '...HHBBBBH....', '..HBBBBBBBBH..', '.HBBBBBBBBBBH.', '.BBEBBBBBBEBB.', '.BBBEBBBBEBBB.', 'SBBBBBMMBBBBBS', 'SSBBLMLLMLBBSS', '..BBLLLLLLBB..', '...SBLLLLBS...', '....SSSSSS....'],
      ['......SS......', '.....SBS......', '...HHBBBBH....', '..HBBBBBBBBH..', '.HBBBBBBBBBBH.', '.BBBBBBBBBBBB.', '.BBEEBBBBEEBB.', 'SBPPBBMMBBPPBS', 'SSBBLLLLLLBBSS', '..BBLLLLLLBB..', '...SBLLLLBS...', '....SSSSSS....'],
    ],
  },
  tester: {
    name: "집게",
    animal: "게",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F3958F","S":"#D9706A","H":"#FFC9C4"},
    frames: [
      ['..............', '..HS......HS..', 'HHBS......HBHS', 'SBBS......SBBS', '.SS.HHHHHS.HS.', '..HHBBBBBBHS..', '.HBWEBBBBWEBS.', '.HBEEBBBBEEBS.', '.SPPBMBBMBPPS.', '..SSBBMMBBSS..', '....SSSSSS....', '.S.S......S.S.'],
      ['..............', '..HS......HS..', 'HHBS......HBHS', 'SBBS......SBBS', '.SS.HHHHHS.HS.', '..HHBBBBBBHS..', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.SPPBMBBMBPPS.', '..SSBBMMBBSS..', '....SSSSSS....', '.S.S......S.S.'],
      ['..............', '..HS......HS..', 'HHBS......HBHS', 'SBBS......SBBS', '.SS.HHHHHS.HS.', '..HHBBBBBBHS..', '.HBEBBBBBBEBS.', '.HEBEBBBBEBES.', '.SPPBMMMMBPPS.', '..SSBBMMBBSS..', '....SSSSSS....', '.S.S......S.S.'],
      ['..............', '..HS......HS..', 'HHBS......HBHS', 'SBBS......SBBS', '.SS.HHHHHS.HS.', '..HHBBBBBBHS..', '.HBEBBBBBBEBS.', '.HBBEBBBBEBBS.', '.SBBBBMMBBBBS.', '..SSBMBBMBSS..', '....SSSSSS....', '.S.S......S.S.'],
      ['..............', '..HS......HS..', 'HHBS......HBHS', 'SBBS......SBBS', '.SS.HHHHHS.HS.', '..HHBBBBBBHS..', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.SPPBBMMBBPPS.', '..SSBBBBBBSS..', '....SSSSSS....', '.S.S......S.S.'],
    ],
  },
  implementer: {
    name: "토비",
    animal: "거북",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#84D9AE","S":"#4FA57E","H":"#C9EFD9","X":"#A7DDBF"},
    frames: [
      ['....SSSSSS....', '..SSBBHHBBSS..', '.SBBHBBBBHBBS.', 'SBBHBBBBBBHBBS', 'SBBBBBBBBBBBBS', 'SSBBXXXXXXBBSS', '.SSXXXXXXXXSS.', '..XWEXXXXWEX..', '..XEEXXXXEEX..', '..PPXMXXMXPP..', '.SXXXXMMXXXXS.', '..SS......SS..'],
      ['....SSSSSS....', '..SSBBHHBBSS..', '.SBBHBBBBHBBS.', 'SBBHBBBBBBHBBS', 'SBBBBBBBBBBBBS', 'SSBBXXXXXXBBSS', '.SSXXXXXXXXSS.', '..XXXXXXXXXX..', '..XEEXXXXEEX..', '..PPXMXXMXPP..', '.SXXXXMMXXXXS.', '..SS......SS..'],
      ['....SSSSSS....', '..SSBBHHBBSS..', '.SBBHBBBBHBBS.', 'SBBHBBBBBBHBBS', 'SBBBBBBBBBBBBS', 'SSBBXXXXXXBBSS', '.SSXXXXXXXXSS.', '..XEXXXXXXEX..', '..EXEXXXXEXE..', '..PPXMMMMXPP..', '.SXXXXMMXXXXS.', '..SS......SS..'],
      ['....SSSSSS....', '..SSBBHHBBSS..', '.SBBHBBBBHBBS.', 'SBBHBBBBBBHBBS', 'SBBBBBBBBBBBBS', 'SSBBXXXXXXBBSS', '.SSXXXXXXXXSS.', '..XEXXXXXXEX..', '..XXEXXXXEXX..', '..XXXXMMXXXX..', '.SXXXMXXMXXXS.', '..SS......SS..'],
      ['....SSSSSS....', '..SSBBHHBBSS..', '.SBBHBBBBHBBS.', 'SBBHBBBBBBHBBS', 'SBBBBBBBBBBBBS', 'SSBBXXXXXXBBSS', '.SSXXXXXXXXSS.', '..XXXXXXXXXX..', '..XEEXXXXEEX..', '..PPXXMMXXPP..', '.SXXXXXXXXXXS.', '..SS......SS..'],
    ],
  },
  reviewer: {
    name: "나리",
    animal: "가오리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#8EA2F5","S":"#6479D1","H":"#C2CCFB","Y":"#FFDB7A"},
    frames: [
      ['................', '................', '...YYYYHHYYYY...', '..HYWEYYYYWEYS..', '.HBYEEYBBYEEYBS.', 'SBBYYYYBBYYYYBBS', '.HBPPBMBBMBPPBS.', '.SBBBBBMMBBBBBS.', '..SSSBBBBBBSSS..', '.....SSBBSS.....', '.......SS.......', '.......SS.......'],
      ['................', '................', '...YYYYHHYYYY...', '..HYBBYYYYBBYS..', '.HBYEEYBBYEEYBS.', 'SBBYYYYBBYYYYBBS', '.HBPPBMBBMBPPBS.', '.SBBBBBMMBBBBBS.', '..SSSBBBBBBSSS..', '.....SSBBSS.....', '.......SS.......', '.......SS.......'],
      ['................', '................', '...YYYYHHYYYY...', '..HYEBYYYYBEYS..', '.HBEBEYBBYEBEBS.', 'SBBYYYYBBYYYYBBS', '.HBPPBMMMMBPPBS.', '.SBBBBBMMBBBBBS.', '..SSSBBBBBBSSS..', '.....SSBBSS.....', '.......SS.......', '.......SS.......'],
      ['................', '................', '...YYYYHHYYYY...', '..HYEBYYYYBEYS..', '.HBYBEYBBYEBYBS.', 'SBBYYYYBBYYYYBBS', '.HBBBBBMMBBBBBS.', '.SBBBBMBBMBBBBS.', '..SSSBBBBBBSSS..', '.....SSBBSS.....', '.......SS.......', '.......SS.......'],
      ['................', '................', '...YYYYHHYYYY...', '..HYBBYYYYBBYS..', '.HBYEEYBBYEEYBS.', 'SBBYYYYBBYYYYBBS', '.HBPPBBMMBBPPBS.', '.SBBBBBBBBBBBBS.', '..SSSBBBBBBSSS..', '.....SSBBSS.....', '.......SS.......', '.......SS.......'],
    ],
  },
  router: {
    name: "마루",
    animal: "해마",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#6ED6C9","S":"#3FA89B","H":"#B9F1EA","L":"#E3FAF6"},
    frames: [
      ['....S.S.S.....', '.....HBHS.....', '...HHBBBBHS...', '...WEBBBBWE...', '..SEEBBBBEES..', '...PPMBBMPP...', '...SSBMMBSS...', '.....HBBS.....', '....HBLLBS....', '....HLLLLS....', '....SLLLLBS...', '.....SLLSSS...'],
      ['....S.S.S.....', '.....HBHS.....', '...HHBBBBHS...', '...HBBBBBBS...', '..SEEBBBBEES..', '...PPMBBMPP...', '...SSBMMBSS...', '.....HBBS.....', '....HBLLBS....', '....HLLLLS....', '....SLLLLBS...', '.....SLLSSS...'],
      ['....S.S.S.....', '.....HBHS.....', '...HHBBBBHS...', '...EBBBBBBE...', '..EBEBBBBEBE..', '...PPMMMMPP...', '...SSBMMBSS...', '.....HBBS.....', '....HBLLBS....', '....HLLLLS....', '....SLLLLBS...', '.....SLLSSS...'],
      ['....S.S.S.....', '.....HBHS.....', '...HHBBBBHS...', '...EBBBBBBE...', '..SBEBBBBEBS..', '...HBBMMBBS...', '...SSMBBMSS...', '.....HBBS.....', '....HBLLBS....', '....HLLLLS....', '....SLLLLBS...', '.....SLLSSS...'],
      ['....S.S.S.....', '.....HBHS.....', '...HHBBBBHS...', '...HBBBBBBS...', '..SEEBBBBEES..', '...PPBMMBPP...', '...SSBBBBSS...', '.....HBBS.....', '....HBLLBS....', '....HLLLLS....', '....SLLLLBS...', '.....SLLSSS...'],
    ],
  },
  answerer: {
    name: "몽실",
    animal: "물범",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#D5DEEA","S":"#A3B3CB","H":"#FFFFFF","L":"#F4F8FC","X":"#9FB0C8"},
    frames: [
      ['..............', '..............', '...XHHHHHX....', '..HBBBBBBBXS..', '.HBWEBBBBWEBS.', '.HBEEBBBBEEBS.', '.HPPBBBBBBPPS.', '.HBBBBDDBBBBS.', '.SBLLMLLMLLBS.', '..SLLLMMLLLS..', 'S..LLLLLLLL..S', 'SS..LLLLLL..SS'],
      ['..............', '..............', '...XHHHHHX....', '..HBBBBBBBXS..', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.HPPBBBBBBPPS.', '.HBBBBDDBBBBS.', '.SBLLMLLMLLBS.', '..SLLLMMLLLS..', 'S..LLLLLLLL..S', 'SS..LLLLLL..SS'],
      ['..............', '..............', '...XHHHHHX....', '..HBBBBBBBXS..', '.HBEBBBBBBEBS.', '.HEBEBBBBEBES.', '.HPPBBBBBBPPS.', '.HBBBBDDBBBBS.', '.SBLLMMMMLLBS.', '..SLLLMMLLLS..', 'S..LLLLLLLL..S', 'SS..LLLLLL..SS'],
      ['..............', '..............', '...XHHHHHX....', '..HBBBBBBBXS..', '.HBEBBBBBBEBS.', '.HBBEBBBBEBBS.', '.HBBBBBBBBBBS.', '.HBBBBDDBBBBS.', '.SBLLLMMLLLBS.', '..SLLMLLMLLS..', 'S..LLLLLLLL..S', 'SS..LLLLLL..SS'],
      ['..............', '..............', '...XHHHHHX....', '..HBBBBBBBXS..', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.HPPBBBBBBPPS.', '.HBBBBDDBBBBS.', '.SBLLLMMLLLBS.', '..SLLLLLLLLS..', 'S..LLLLLLLL..S', 'SS..LLLLLL..SS'],
    ],
  },
  surveyor: {
    name: "별이",
    animal: "불가사리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FF9E64","S":"#D7743C","H":"#FFC9A3","Y":"#FFE2C4"},
    frames: [
      ['......HS......', '......HS......', '.....HBBS.....', 'SHHHHBBBBHHHHS', '.SBBWEBBWEBBS.', '..SBEEBBEEBS..', '...PPMBBMPP...', '...HBBMMBBS...', '..HBBBSSBBBS..', '..HBBS..SBBS..', '.HBBS....SBBS.', '.SSS......SSS.'],
      ['......HS......', '......HS......', '.....HBBS.....', 'SHHHHBBBBHHHHS', '.SBBBBBBBBBBS.', '..SBEEBBEEBS..', '...PPMBBMPP...', '...HBBMMBBS...', '..HBBBSSBBBS..', '..HBBS..SBBS..', '.HBBS....SBBS.', '.SSS......SSS.'],
      ['......HS......', '......HS......', '.....HBBS.....', 'SHHHHBBBBHHHHS', '.SBBEBBBBEBBS.', '..SEBEBBEBES..', '...PPMMMMPP...', '...HBBMMBBS...', '..HBBBSSBBBS..', '..HBBS..SBBS..', '.HBBS....SBBS.', '.SSS......SSS.'],
      ['......HS......', '......HS......', '.....HBBS.....', 'SHHHHBBBBHHHHS', '.SBBEBBBBEBBS.', '..SBBEBBEBBS..', '...HBBMMBBS...', '...HBMBBMBS...', '..HBBBSSBBBS..', '..HBBS..SBBS..', '.HBBS....SBBS.', '.SSS......SSS.'],
      ['......HS......', '......HS......', '.....HBBS.....', 'SHHHHBBBBHHHHS', '.SBBBBBBBBBBS.', '..SBEEBBEEBS..', '...PPBMMBPP...', '...HBBBBBBS...', '..HBBBSSBBBS..', '..HBBS..SBBS..', '.HBBS....SBBS.', '.SSS......SSS.'],
    ],
  },
  writer: {
    name: "잉크",
    animal: "오징어",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F2B38C","S":"#CC8760","H":"#FFD9BF"},
    frames: [
      ['......HS......', '....SHBBHS....', '...SBBBBBBS...', '...HBBBBBBS...', '..HBBBBBBBBS..', '..HWEBBBBWES..', '.HBEEBBBBEEBS.', '.HPPBMBBMBPPS.', '.SBBBBMMBBBBS.', '..HSBSBBSBSS..', '..S.S.HS.S.S..', '.S..S.S..S.S..'],
      ['......HS......', '....SHBBHS....', '...SBBBBBBS...', '...HBBBBBBS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.HPPBMBBMBPPS.', '.SBBBBMMBBBBS.', '..HSBSBBSBSS..', '..S.S.HS.S.S..', '.S..S.S..S.S..'],
      ['......HS......', '....SHBBHS....', '...SBBBBBBS...', '...HBBBBBBS...', '..HBBBBBBBBS..', '..HEBBBBBBES..', '.HEBEBBBBEBES.', '.HPPBMMMMBPPS.', '.SBBBBMMBBBBS.', '..HSBSBBSBSS..', '..S.S.HS.S.S..', '.S..S.S..S.S..'],
      ['......HS......', '....SHBBHS....', '...SBBBBBBS...', '...HBBBBBBS...', '..HBBBBBBBBS..', '..HEBBBBBBES..', '.HBBEBBBBEBBS.', '.HBBBBMMBBBBS.', '.SBBBMBBMBBBS.', '..HSBSBBSBSS..', '..S.S.HS.S.S..', '.S..S.S..S.S..'],
      ['......HS......', '....SHBBHS....', '...SBBBBBBS...', '...HBBBBBBS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.HPPBBMMBBPPS.', '.SBBBBBBBBBBS.', '..HSBSBBSBSS..', '..S.S.HS.S.S..', '.S..S.S..S.S..'],
    ],
  },
  designer: {
    name: "소라",
    animal: "소라게",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F7A9C2","S":"#D77C9C","H":"#FFD3E1","X":"#F3E3C3","Y":"#D9B98A"},
    frames: [
      ['..............', '...XXXXXXXX...', '..XXXYYYXXXX..', '..XXXXYXYXXX..', '..XXYXYXYXXX..', '..XXXYYYXXXX..', '...XXBBBBXX...', '...WEBBBBWE...', '..HEEBBBBEES..', '..PPBMBBMBPP..', '...SBBMMBBS...', '..S.SSSSSS.S..'],
      ['..............', '...XXXXXXXX...', '..XXXYYYXXXX..', '..XXXXYXYXXX..', '..XXYXYXYXXX..', '..XXXYYYXXXX..', '...XXBBBBXX...', '...HBBBBBBS...', '..HEEBBBBEES..', '..PPBMBBMBPP..', '...SBBMMBBS...', '..S.SSSSSS.S..'],
      ['..............', '...XXXXXXXX...', '..XXXYYYXXXX..', '..XXXXYXYXXX..', '..XXYXYXYXXX..', '..XXXYYYXXXX..', '...XXBBBBXX...', '...EBBBBBBE...', '..EBEBBBBEBE..', '..PPBMMMMBPP..', '...SBBMMBBS...', '..S.SSSSSS.S..'],
      ['..............', '...XXXXXXXX...', '..XXXYYYXXXX..', '..XXXXYXYXXX..', '..XXYXYXYXXX..', '..XXXYYYXXXX..', '...XXBBBBXX...', '...EBBBBBBE...', '..HBEBBBBEBS..', '..SBBBMMBBBS..', '...SBMBBMBS...', '..S.SSSSSS.S..'],
      ['..............', '...XXXXXXXX...', '..XXXYYYXXXX..', '..XXXXYXYXXX..', '..XXYXYXYXXX..', '..XXXYYYXXXX..', '...XXBBBBXX...', '...HBBBBBBS...', '..HEEBBBBEES..', '..PPBBMMBBPP..', '...SBBBBBBS...', '..S.SSSSSS.S..'],
    ],
  },
  operator: {
    name: "웅이",
    animal: "고래",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#4F8FDB","S":"#2F68B0","H":"#8FBDF5","L":"#CFE6FF"},
    frames: [
      ['......L..L......', '.......LL.......', '.....HHBBHS.....', '...HHBBBBBBHS...', '.HHBBBBBBBBBBHS.', '.HBBWEBBBBWEBBS.', '.HBBEEBBBBEEBBS.', '.HBPPBMBBMBPPBS.', '.SBLLLLMMLLLLBS.', 'S.LLLLLLLLLLLL.S', 'SS.LLLLLLLLLL.SS', '......LLLL......'],
      ['......L..L......', '.......LL.......', '.....HHBBHS.....', '...HHBBBBBBHS...', '.HHBBBBBBBBBBHS.', '.HBBBBBBBBBBBBS.', '.HBBEEBBBBEEBBS.', '.HBPPBMBBMBPPBS.', '.SBLLLLMMLLLLBS.', 'S.LLLLLLLLLLLL.S', 'SS.LLLLLLLLLL.SS', '......LLLL......'],
      ['......L..L......', '.......LL.......', '.....HHBBHS.....', '...HHBBBBBBHS...', '.HHBBBBBBBBBBHS.', '.HBBEBBBBBBEBBS.', '.HBEBEBBBBEBEBS.', '.HBPPBMMMMBPPBS.', '.SBLLLLMMLLLLBS.', 'S.LLLLLLLLLLLL.S', 'SS.LLLLLLLLLL.SS', '......LLLL......'],
      ['......L..L......', '.......LL.......', '.....HHBBHS.....', '...HHBBBBBBHS...', '.HHBBBBBBBBBBHS.', '.HBBEBBBBBBEBBS.', '.HBBBEBBBBEBBBS.', '.HBBBBBMMBBBBBS.', '.SBLLLMLLMLLLBS.', 'S.LLLLLLLLLLLL.S', 'SS.LLLLLLLLLL.SS', '......LLLL......'],
      ['......L..L......', '.......LL.......', '.....HHBBHS.....', '...HHBBBBBBHS...', '.HHBBBBBBBBBBHS.', '.HBBBBBBBBBBBBS.', '.HBBEEBBBBEEBBS.', '.HBPPBBMMBBPPBS.', '.SBLLLLLLLLLLBS.', 'S.LLLLLLLLLLLL.S', 'SS.LLLLLLLLLL.SS', '......LLLL......'],
    ],
  },
  debugger: {
    name: "반딧",
    animal: "아귀",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#8B86E6","S":"#625DBE","H":"#C0BCF8","Y":"#FFE27A"},
    frames: [
      ['........YY....', '......SSYY....', '......S.......', '....HHBHHS....', '...HBBBBBBS...', '..HWEBBBBWES..', '.HBEEBBBBEEBS.', '.HPPBMBBMBPPS.', '.SBBBBMMBBBBS.', 'S.SBBWBBWBBS.S', 'S..SBBBBBBS..S', '....SSSSSS....'],
      ['........YY....', '......SSYY....', '......S.......', '....HHBHHS....', '...HBBBBBBS...', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.HPPBMBBMBPPS.', '.SBBBBMMBBBBS.', 'S.SBBWBBWBBS.S', 'S..SBBBBBBS..S', '....SSSSSS....'],
      ['........YY....', '......SSYY....', '......S.......', '....HHBHHS....', '...HBBBBBBS...', '..HEBBBBBBES..', '.HEBEBBBBEBES.', '.HPPBMMMMBPPS.', '.SBBBBMMBBBBS.', 'S.SBBWBBWBBS.S', 'S..SBBBBBBS..S', '....SSSSSS....'],
      ['........YY....', '......SSYY....', '......S.......', '....HHBHHS....', '...HBBBBBBS...', '..HEBBBBBBES..', '.HBBEBBBBEBBS.', '.HBBBBMMBBBBS.', '.SBBBMBBMBBBS.', 'S.SBBWBBWBBS.S', 'S..SBBBBBBS..S', '....SSSSSS....'],
      ['........YY....', '......SSYY....', '......S.......', '....HHBHHS....', '...HBBBBBBS...', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.HPPBBMMBBPPS.', '.SBBBBBBBBBBS.', 'S.SBBWBBWBBS.S', 'S..SBBBBBBS..S', '....SSSSSS....'],
    ],
  },
  riskchecker: {
    name: "가시",
    animal: "성게",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#D9608A","S":"#A83B63","H":"#F2A0BE"},
    frames: [
      ['..S...SS...S..', '...S..SS..S...', 'S...HHBBHS...S', '.S.HBBBBBBS.S.', '..HWEBBBBWES..', 'SSBEEBBBBEEBSS', 'SSPPBMBBMBPPSS', '..SBBBMMBBBS..', '.S.SBBBBBBS.S.', 'S...SSBBSS...S', '...S..SS..S...', '..S...SS...S..'],
      ['..S...SS...S..', '...S..SS..S...', 'S...HHBBHS...S', '.S.HBBBBBBS.S.', '..HBBBBBBBBS..', 'SSBEEBBBBEEBSS', 'SSPPBMBBMBPPSS', '..SBBBMMBBBS..', '.S.SBBBBBBS.S.', 'S...SSBBSS...S', '...S..SS..S...', '..S...SS...S..'],
      ['..S...SS...S..', '...S..SS..S...', 'S...HHBBHS...S', '.S.HBBBBBBS.S.', '..HEBBBBBBES..', 'SSEBEBBBBEBESS', 'SSPPBMMMMBPPSS', '..SBBBMMBBBS..', '.S.SBBBBBBS.S.', 'S...SSBBSS...S', '...S..SS..S...', '..S...SS...S..'],
      ['..S...SS...S..', '...S..SS..S...', 'S...HHBBHS...S', '.S.HBBBBBBS.S.', '..HEBBBBBBES..', 'SSBBEBBBBEBBSS', 'SSBBBBMMBBBBSS', '..SBBMBBMBBS..', '.S.SBBBBBBS.S.', 'S...SSBBSS...S', '...S..SS..S...', '..S...SS...S..'],
      ['..S...SS...S..', '...S..SS..S...', 'S...HHBBHS...S', '.S.HBBBBBBS.S.', '..HBBBBBBBBS..', 'SSBEEBBBBEEBSS', 'SSPPBBMMBBPPSS', '..SBBBBBBBBS..', '.S.SBBBBBBS.S.', 'S...SSBBSS...S', '...S..SS..S...', '..S...SS...S..'],
    ],
  },
  planner: {
    name: "뽀글",
    animal: "복어",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FFDB7A","S":"#E0B54A","H":"#FFF0C2","L":"#FFF6D6"},
    frames: [
      ['..............', '....S.HS.S....', '..S.HHBBHS.S..', '...HBBBBBBS...', '..HWEBBBBWES..', '.SBEEBBBBEEBS.', '..PPBMLLMBPP..', 'S.HBLLMMLLBS.S', '..HLLLLLLLLS..', '..SLLLLLLLLS..', '.....LLLL.....', '..............'],
      ['..............', '....S.HS.S....', '..S.HHBBHS.S..', '...HBBBBBBS...', '..HBBBBBBBBS..', '.SBEEBBBBEEBS.', '..PPBMLLMBPP..', 'S.HBLLMMLLBS.S', '..HLLLLLLLLS..', '..SLLLLLLLLS..', '.....LLLL.....', '..............'],
      ['..............', '....S.HS.S....', '..S.HHBBHS.S..', '...HBBBBBBS...', '..HEBBBBBBES..', '.SEBEBBBBEBES.', '..PPBMMMMBPP..', 'S.HBLLMMLLBS.S', '..HLLLLLLLLS..', '..SLLLLLLLLS..', '.....LLLL.....', '..............'],
      ['..............', '....S.HS.S....', '..S.HHBBHS.S..', '...HBBBBBBS...', '..HEBBBBBBES..', '.SBBEBBBBEBBS.', '..HBBLMMLBBS..', 'S.HBLMLLMLBS.S', '..HLLLLLLLLS..', '..SLLLLLLLLS..', '.....LLLL.....', '..............'],
      ['..............', '....S.HS.S....', '..S.HHBBHS.S..', '...HBBBBBBS...', '..HBBBBBBBBS..', '.SBEEBBBBEEBS.', '..PPBLMMLBPP..', 'S.HBLLLLLLBS.S', '..HLLLLLLLLS..', '..SLLLLLLLLS..', '.....LLLL.....', '..............'],
    ],
  },
  chief: {
    name: "수염",
    animal: "바다코끼리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#B89378","S":"#8C6B52","H":"#D9BCA5","L":"#F0E0D2","Y":"#FFDB7A"},
    frames: [
      ['.....Y.YY.Y.....', '.....YYYYYY.....', '....HBBBBBBS....', '...HBBBBBBBBS...', '..HBWEBBBBBWES..', '.HBBEEBBBBBEEBS.', '.HBPPBLDDLBBPPS.', '.HBBLLLLLLLLBBS.', '.SBBLLMLLMLLBBS.', '..SBLWLMMLWLBS..', '...SSWLLLLWSS...', '.....WSSSSW.....'],
      ['.....Y.YY.Y.....', '.....YYYYYY.....', '....HBBBBBBS....', '...HBBBBBBBBS...', '..HBBBBBBBBBBS..', '.HBBEEBBBBBEEBS.', '.HBPPBLDDLBBPPS.', '.HBBLLLLLLLLBBS.', '.SBBLLMLLMLLBBS.', '..SBLWLMMLWLBS..', '...SSWLLLLWSS...', '.....WSSSSW.....'],
      ['.....Y.YY.Y.....', '.....YYYYYY.....', '....HBBBBBBS....', '...HBBBBBBBBS...', '..HBEBBBBBBBES..', '.HBEBEBBBBBEBES.', '.HBPPBLDDLBBPPS.', '.HBBLLLLLLLLBBS.', '.SBBLLMMMMLLBBS.', '..SBLWLMMLWLBS..', '...SSWLLLLWSS...', '.....WSSSSW.....'],
      ['.....Y.YY.Y.....', '.....YYYYYY.....', '....HBBBBBBS....', '...HBBBBBBBBS...', '..HBEBBBBBBBES..', '.HBBBEBBBBBEBBS.', '.HBBBBLDDLBBBBS.', '.HBBLLLLLLLLBBS.', '.SBBLLLMMLLLBBS.', '..SBLWMLLMWLBS..', '...SSWLLLLWSS...', '.....WSSSSW.....'],
      ['.....Y.YY.Y.....', '.....YYYYYY.....', '....HBBBBBBS....', '...HBBBBBBBBS...', '..HBBBBBBBBBBS..', '.HBBEEBBBBBEEBS.', '.HBPPBLDDLBBPPS.', '.HBBLLLLLLLLBBS.', '.SBBLLLMMLLLBBS.', '..SBLWLLLLWLBS..', '...SSWLLLLWSS...', '.....WSSSSW.....'],
    ],
  },
  bm: {
    name: "달이",
    animal: "해달",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#C89B6D","S":"#9C7248","H":"#E6C7A0","L":"#F5E4CC","Y":"#FFDB7A"},
    frames: [
      ['..............', '..HS......HS..', '..HBHHHHHHBS..', '..HBBBBBBBBS..', '..HBWELLWEBS..', '.HBLEELLEELBS.', '.HBLLLDDLLLBS.', '.SBPPLLLLPPBS.', '..HLLMLLMLLS..', '..SBLLMMLLBS..', '...SSSHYSSS...', '.....SYYS.....'],
      ['..............', '..HS......HS..', '..HBHHHHHHBS..', '..HBBBBBBBBS..', '..HBLLLLLLBS..', '.HBLEELLEELBS.', '.HBLLLDDLLLBS.', '.SBPPLLLLPPBS.', '..HLLMLLMLLS..', '..SBLLMMLLBS..', '...SSSHYSSS...', '.....SYYS.....'],
      ['..............', '..HS......HS..', '..HBHHHHHHBS..', '..HBBBBBBBBS..', '..HBELLLLEBS..', '.HBELELLELEBS.', '.HBLLLDDLLLBS.', '.SBPPLLLLPPBS.', '..HLLMMMMLLS..', '..SBLLMMLLBS..', '...SSSHYSSS...', '.....SYYS.....'],
      ['..............', '..HS......HS..', '..HBHHHHHHBS..', '..HBBBBBBBBS..', '..HBELLLLEBS..', '.HBLLELLELLBS.', '.HBLLLDDLLLBS.', '.SBLLLLLLLLBS.', '..HLLLMMLLLS..', '..SBLMLLMLBS..', '...SSSHYSSS...', '.....SYYS.....'],
      ['..............', '..HS......HS..', '..HBHHHHHHBS..', '..HBBBBBBBBS..', '..HBLLLLLLBS..', '.HBLEELLEELBS.', '.HBLLLDDLLLBS.', '.SBPPLLLLPPBS.', '..HLLLMMLLLS..', '..SBLLLLLLBS..', '...SSSHYSSS...', '.....SYYS.....'],
    ],
  },
  marketer: {
    name: "주홍",
    animal: "흰동가리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FF8A3D","S":"#D1601A","H":"#FFB87F"},
    frames: [
      ['..............', '.....SSSS.....', '....SSSSSS....', '..WWWWWWWWWW..', '..WWWWWWWWWW..', '.BBWEBBBBWEBB.', '.BBEEBBBBEEBB.', 'SBPPBMBBMBPPBS', 'S.BBBBMMBBBB.S', '..BBBBBBBBBB..', '....BBBBBB....', '..............'],
      ['..............', '.....SSSS.....', '....SSSSSS....', '..WWWWWWWWWW..', '..WWWWWWWWWW..', '.BBBBBBBBBBBB.', '.BBEEBBBBEEBB.', 'SBPPBMBBMBPPBS', 'S.BBBBMMBBBB.S', '..BBBBBBBBBB..', '....BBBBBB....', '..............'],
      ['..............', '.....SSSS.....', '....SSSSSS....', '..WWWWWWWWWW..', '..WWWWWWWWWW..', '.BBEBBBBBBEBB.', '.BEBEBBBBEBEB.', 'SBPPBMMMMBPPBS', 'S.BBBBMMBBBB.S', '..BBBBBBBBBB..', '....BBBBBB....', '..............'],
      ['..............', '.....SSSS.....', '....SSSSSS....', '..WWWWWWWWWW..', '..WWWWWWWWWW..', '.BBEBBBBBBEBB.', '.BBBEBBBBEBBB.', 'SBBBBBMMBBBBBS', 'S.BBBMBBMBBB.S', '..BBBBBBBBBB..', '....BBBBBB....', '..............'],
      ['..............', '.....SSSS.....', '....SSSSSS....', '..WWWWWWWWWW..', '..WWWWWWWWWW..', '.BBBBBBBBBBBB.', '.BBEEBBBBEEBB.', 'SBPPBBMMBBPPBS', 'S.BBBBBBBBBB.S', '..BBBBBBBBBB..', '....BBBBBB....', '..............'],
    ],
  },
  growth: {
    name: "펄떡",
    animal: "연어",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#FF7F8E","S":"#D45566","H":"#FFB1BB","L":"#FFE0E4","X":"#C94A5C"},
    frames: [
      ['..............', '......SS......', '....HXBBXS....', '...XBBBXBBX...', '..HWEBBBBWES..', '.HBEEBBBBEEBS.', '.SPPBMBBMBPPS.', '..HBLLMMLLBS..', '..SLLLLLLLLS..', '...LLLLLLLL...', '.....LSSL.....', '....SS..SS....'],
      ['..............', '......SS......', '....HXBBXS....', '...XBBBXBBX...', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.SPPBMBBMBPPS.', '..HBLLMMLLBS..', '..SLLLLLLLLS..', '...LLLLLLLL...', '.....LSSL.....', '....SS..SS....'],
      ['..............', '......SS......', '....HXBBXS....', '...XBBBXBBX...', '..HEBBBBBBES..', '.HEBEBBBBEBES.', '.SPPBMMMMBPPS.', '..HBLLMMLLBS..', '..SLLLLLLLLS..', '...LLLLLLLL...', '.....LSSL.....', '....SS..SS....'],
      ['..............', '......SS......', '....HXBBXS....', '...XBBBXBBX...', '..HEBBBBBBES..', '.HBBEBBBBEBBS.', '.SBBBBMMBBBBS.', '..HBLMLLMLBS..', '..SLLLLLLLLS..', '...LLLLLLLL...', '.....LSSL.....', '....SS..SS....'],
      ['..............', '......SS......', '....HXBBXS....', '...XBBBXBBX...', '..HBBBBBBBBS..', '.HBEEBBBBEEBS.', '.SPPBBMMBBPPS.', '..HBLLLLLLBS..', '..SLLLLLLLLS..', '...LLLLLLLL...', '.....LSSL.....', '....SS..SS....'],
    ],
  },
  uxdesigner: {
    name: "무니",
    animal: "문어",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#C3B4F5","S":"#9C89E0","H":"#E2DAFB"},
    frames: [
      ['......HS......', '...HHHBBHHS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '..PPBMBBMBPP..', '...SBBMMBBS...', '.HS.HBSSBS.HS.', '.HS.HS..HS.HS.', '.HS.HS..SS.SS.', 'SS.SS....SS.SS'],
      ['......HS......', '...HHHBBHHS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '..PPBMBBMBPP..', '...SBBMMBBS...', '.HS.HBSSBS.HS.', '.HS.HS..HS.HS.', '.HS.HS..SS.SS.', 'SS.SS....SS.SS'],
      ['......HS......', '...HHHBBHHS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBEBBBBBBEBS.', '.SEBEBBBBEBES.', '..PPBMMMMBPP..', '...SBBMMBBS...', '.HS.HBSSBS.HS.', '.HS.HS..HS.HS.', '.HS.HS..SS.SS.', 'SS.SS....SS.SS'],
      ['......HS......', '...HHHBBHHS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBEBBBBBBEBS.', '.SBBEBBBBEBBS.', '..SBBBMMBBBS..', '...SBMBBMBS...', '.HS.HBSSBS.HS.', '.HS.HS..HS.HS.', '.HS.HS..SS.SS.', 'SS.SS....SS.SS'],
      ['......HS......', '...HHHBBHHS...', '..HBBBBBBBBS..', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '..PPBBMMBBPP..', '...SBBBBBBS...', '.HS.HBSSBS.HS.', '.HS.HS..HS.HS.', '.HS.HS..SS.SS.', 'SS.SS....SS.SS'],
    ],
  },
  brand: {
    name: "말랑",
    animal: "해파리",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#E08CF0","S":"#B25FC4","H":"#F5C6FA","X":"#F3CFFA"},
    frames: [
      ['..............', '...HHHHHHHS...', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.HBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '..PPBMBBMBPP..', '.HBBBBMMBBBBS.', '.SBSBSBBSBSBS.', '..X.X.XX.X.X..', '...X.X.XX.X.X.', '..X.X.XX.X.X..'],
      ['..............', '...HHHHHHHS...', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.HBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '..PPBMBBMBPP..', '.HBBBBMMBBBBS.', '.SBSBSBBSBSBS.', '..X.X.XX.X.X..', '...X.X.XX.X.X.', '..X.X.XX.X.X..'],
      ['..............', '...HHHHHHHS...', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.HBEBBBBBBEBS.', '.SEBEBBBBEBES.', '..PPBMMMMBPP..', '.HBBBBMMBBBBS.', '.SBSBSBBSBSBS.', '..X.X.XX.X.X..', '...X.X.XX.X.X.', '..X.X.XX.X.X..'],
      ['..............', '...HHHHHHHS...', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.HBEBBBBBBEBS.', '.SBBEBBBBEBBS.', '..HBBBMMBBBS..', '.HBBBMBBMBBBS.', '.SBSBSBBSBSBS.', '..X.X.XX.X.X..', '...X.X.XX.X.X.', '..X.X.XX.X.X..'],
      ['..............', '...HHHHHHHS...', '..HBBBBBBBBS..', '.HBBBBBBBBBBS.', '.HBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '..PPBBMMBBPP..', '.HBBBBBBBBBBS.', '.SBSBSBBSBSBS.', '..X.X.XX.X.X..', '...X.X.XX.X.X.', '..X.X.XX.X.X..'],
    ],
  },
  securitychecker: {
    name: "단단",
    animal: "조개",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F0D9A8","S":"#C9AE74","H":"#FFF1CF","X":"#E3C687"},
    frames: [
      ['......WW......', '.....HWWS.....', '...HSBSSBSS...', '..HSBBBBBBSS..', '.HBBBBBBBBBBS.', '.HBWEBBBBWEBS.', '.HBEEBBBBEEBS.', '.HPPBMXXMBPPS.', '.SXXXXMMXXXXS.', '..XXXXXXXXXX..', '...XXXXXXXX...', '.....XXXX.....'],
      ['......WW......', '.....HWWS.....', '...HSBSSBSS...', '..HSBBBBBBSS..', '.HBBBBBBBBBBS.', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.HPPBMXXMBPPS.', '.SXXXXMMXXXXS.', '..XXXXXXXXXX..', '...XXXXXXXX...', '.....XXXX.....'],
      ['......WW......', '.....HWWS.....', '...HSBSSBSS...', '..HSBBBBBBSS..', '.HBBBBBBBBBBS.', '.HBEBBBBBBEBS.', '.HEBEBBBBEBES.', '.HPPBMMMMBPPS.', '.SXXXXMMXXXXS.', '..XXXXXXXXXX..', '...XXXXXXXX...', '.....XXXX.....'],
      ['......WW......', '.....HWWS.....', '...HSBSSBSS...', '..HSBBBBBBSS..', '.HBBBBBBBBBBS.', '.HBEBBBBBBEBS.', '.HBBEBBBBEBBS.', '.HBBBXMMXBBBS.', '.SXXXMXXMXXXS.', '..XXXXXXXXXX..', '...XXXXXXXX...', '.....XXXX.....'],
      ['......WW......', '.....HWWS.....', '...HSBSSBSS...', '..HSBBBBBBSS..', '.HBBBBBBBBBBS.', '.HBBBBBBBBBBS.', '.HBEEBBBBEEBS.', '.HPPBXMMXBPPS.', '.SXXXXXXXXXXS.', '..XXXXXXXXXX..', '...XXXXXXXX...', '.....XXXX.....'],
    ],
  },
  releaser: {
    name: "휘리",
    animal: "날치",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#B6E36B","S":"#80B33A","H":"#DDF5AE","L":"#F0FBD6","X":"#CFEFA0"},
    frames: [
      ['..............', 'X............X', 'XX..........XX', 'XXX..HHHS..XXX', '.XX.HBBBBS.XX.', '..XWEBBBBWEX..', '...EEBBBBEE...', '...PPMLLMPP...', '...SLLMMLLS...', '....LLLLLL....', '.....HLLS.....', '.....SSSS.....'],
      ['..............', 'X............X', 'XX..........XX', 'XXX..HHHS..XXX', '.XX.HBBBBS.XX.', '..XHBBBBBBHX..', '...EEBBBBEE...', '...PPMLLMPP...', '...SLLMMLLS...', '....LLLLLL....', '.....HLLS.....', '.....SSSS.....'],
      ['..............', 'X............X', 'XX..........XX', 'XXX..HHHS..XXX', '.XX.HBBBBS.XX.', '..XEBBBBBBEX..', '..EHEBBBBESE..', '...PPMMMMPP...', '...SLLMMLLS...', '....LLLLLL....', '.....HLLS.....', '.....SSSS.....'],
      ['..............', 'X............X', 'XX..........XX', 'XXX..HHHS..XXX', '.XX.HBBBBS.XX.', '..XEBBBBBBEX..', '...HEBBBBES...', '...HBLMMLBS...', '...SLMLLMLS...', '....LLLLLL....', '.....HLLS.....', '.....SSSS.....'],
      ['..............', 'X............X', 'XX..........XX', 'XXX..HHHS..XXX', '.XX.HBBBBS.XX.', '..XHBBBBBBHX..', '...EEBBBBEE...', '...PPLMMLPP...', '...SLLLLLLS...', '....LLLLLL....', '.....HLLS.....', '.....SSSS.....'],
    ],
  },
  splitter: {
    name: "톱이",
    animal: "톱상어",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#9DB4CC","S":"#6F89A6","H":"#CFDDEB","L":"#EAF1F8","X":"#F3E3C3"},
    frames: [
      ['......SS......', '.....HBBS.....', '...HHBBBBHS...', '..HWEBBBBWES..', '..HEEBBBBEES..', '.SPPBBBBBBPPS.', 'S.HBLMLLMLBS.S', 'S.SLLLMMLLLS.S', '...LLLLLLLL...', '.....HXXS.....', '.....XXXX.....', '......XX......'],
      ['......SS......', '.....HBBS.....', '...HHBBBBHS...', '..HBBBBBBBBS..', '..HEEBBBBEES..', '.SPPBBBBBBPPS.', 'S.HBLMLLMLBS.S', 'S.SLLLMMLLLS.S', '...LLLLLLLL...', '.....HXXS.....', '.....XXXX.....', '......XX......'],
      ['......SS......', '.....HBBS.....', '...HHBBBBHS...', '..HEBBBBBBES..', '..EBEBBBBEBE..', '.SPPBBBBBBPPS.', 'S.HBLMMMMLBS.S', 'S.SLLLMMLLLS.S', '...LLLLLLLL...', '.....HXXS.....', '.....XXXX.....', '......XX......'],
      ['......SS......', '.....HBBS.....', '...HHBBBBHS...', '..HEBBBBBBES..', '..HBEBBBBEBS..', '.SBBBBBBBBBBS.', 'S.HBLLMMLLBS.S', 'S.SLLMLLMLLS.S', '...LLLLLLLL...', '.....HXXS.....', '.....XXXX.....', '......XX......'],
      ['......SS......', '.....HBBS.....', '...HHBBBBHS...', '..HBBBBBBBBS..', '..HEEBBBBEES..', '.SPPBBBBBBPPS.', 'S.HBLLMMLLBS.S', 'S.SLLLLLLLLS.S', '...LLLLLLLL...', '.....HXXS.....', '.....XXXX.....', '......XX......'],
    ],
  },
  publisher: {
    name: "갈매",
    animal: "갈매기",
    colors: {"E":"#1D2B3A","W":"#FFFFFF","P":"#F7A9C2","M":"#1D2B3A","D":"#1D2B3A","B":"#F4F8FC","S":"#A3B3CB","H":"#FFFFFF","X":"#7F93AE","Y":"#FFA94D"},
    frames: [
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBWEBBBBWEBS.', '.SBEEBBBBEEBS.', '.SBPBBYYBBPBS.', 'XXSBBBMMBBBSXX', 'XXXSBBBBBBSXXX', '.XXSBBBBBBSXX.', '..SSBBBBBBSS..', '....SSSSSS....', '...YY....YY...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBPBBYYBBPBS.', 'XXSBBBMMBBBSXX', 'XXXSBBBBBBSXXX', '.XXSBBBBBBSXX.', '..SSBBBBBBSS..', '....SSSSSS....', '...YY....YY...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBBBBBBBBBBS.', '.SBPBBYYBBPBS.', 'XXSBBMMMMBBSXX', 'XXXSBBBBBBSXXX', '.XXSBBBBBBSXX.', '..SSBBBBBBSS..', '....SSSSSS....', '...YY....YY...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBEBBBBEBBS.', '.SBEBBBBBBEBS.', '.SBPBBYYBBPBS.', 'XXSBBBMMBBBSXX', 'XXXSBBBBBBSXXX', '.XXSBBBBBBSXX.', '..SSBBBBBBSS..', '....SSSSSS....', '...YY....YY...'],
      ['....SSSSSS....', '..SSBBBBBBSS..', '.SBBBBBBBBBBS.', '.SBBBBBBBBBBS.', '.SBEEBBBBEEBS.', '.SBPBBYYBBPBS.', 'XXSBBBMBBBBSXX', 'XXXSBBBBBBSXXX', '.XXSBBBBBBSXX.', '..SSBBBBBBSS..', '....SSSSSS....', '...YY....YY...'],
    ],
  },
};
