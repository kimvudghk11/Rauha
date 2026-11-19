import type { PixelCharacter } from '../characters-data.js';

/**
 * 큰 회사 부서(2026-11-18)로 늘어난 역할의 캐릭터. 그림을 새로 그리지 않고, 같은 세트의 다른 역할 캐릭터를 바탕으로
 * 색(색상만 돌림)·이름·직함을 바꿔 만든다. 눈·피부(사람 세트)는 그대로 둔다.
 */
export const DERIVED_ROLES = [
  'pm', 'accountant', 'finops', 'analyst', 'dataengineer', 'legal', 'support', 'voc', 'sales', 'recruiter', 'qa',
  'frontend', 'backend', 'ios', 'android', 'crossplatform', 'content', 'performance', 'pr',
  'copywriter', 'video', 'productdesigner', 'graphic', 'md', 'ecommerce', 'logistics',
] as const;
export type DerivedRole = (typeof DERIVED_ROLES)[number];

/** 새 역할 → 바탕이 될 기존 역할(겹치지 않게 하나씩) */
const BASE: Readonly<Record<DerivedRole, string>> = {
  pm: 'planner', accountant: 'bm', finops: 'operator', analyst: 'growth', dataengineer: 'surveyor', legal: 'reviewer', support: 'answerer',
  voc: 'marketer', sales: 'brand', recruiter: 'writer', qa: 'tester', frontend: 'uxdesigner', backend: 'implementer', ios: 'designer',
  android: 'splitter', crossplatform: 'publisher', content: 'releaser', performance: 'riskchecker', pr: 'chief',
  // 사업 하나를 할 수 있는 회사(2026-11-19): 남은 바탕(디버깅·보안·라우터)을 먼저 쓰고, 나머지는 같은 바탕을 다른 색으로
  copywriter: 'debugger', video: 'securitychecker', productdesigner: 'router', graphic: 'uxdesigner', md: 'bm', ecommerce: 'marketer', logistics: 'operator',
};

/** 동물 세트에서 바탕 동물 앞에 붙이는 색 이름과 돌릴 색상(도) */
const TINT: Readonly<Record<DerivedRole, readonly [string, number]>> = {
  pm: ['보라', 270], accountant: ['금빛', 45], finops: ['초록', 120], analyst: ['하늘', 195], dataengineer: ['남색', 230], legal: ['회색', 0],
  support: ['분홍', 330], voc: ['주황', 25], sales: ['빨강', 355], recruiter: ['연두', 90], qa: ['청록', 170], frontend: ['노랑', 55],
  backend: ['갈색', 30], ios: ['은빛', 210], android: ['풀빛', 105], crossplatform: ['자주', 300], content: ['살구', 20], performance: ['진홍', 345], pr: ['민트', 155],
  copywriter: ['라벤더', 250], video: ['산호', 10], productdesigner: ['올리브', 80], graphic: ['자홍', 280], md: ['비취', 160], ecommerce: ['코발트', 200], logistics: ['구리', 15],
};

/** 사람 세트의 직함 */
const TITLE: Readonly<Record<DerivedRole, string>> = {
  pm: '프로덕트 매니저', accountant: '회계사', finops: '클라우드 비용 담당', analyst: '데이터 분석가', dataengineer: '데이터 엔지니어', legal: '법무 담당', support: '고객 지원',
  voc: '고객 의견 담당', sales: '영업 담당', recruiter: '채용 담당', qa: 'QA 엔지니어', frontend: '프론트엔드 개발자', backend: '서버 개발자', ios: 'iOS 개발자',
  android: '안드로이드 개발자', crossplatform: '앱 개발자', content: '콘텐츠 마케터', performance: '퍼포먼스 마케터', pr: 'PR 담당',
  copywriter: '카피라이터', video: '영상 PD', productdesigner: '상품 디자이너', graphic: '그래픽 디자이너', md: '상품기획 MD', ecommerce: '이커머스 매니저', logistics: '물류 담당',
};

/** 사람 세트의 직함 앞말(세트끼리 직함이 겹치지 않게) */
const PREFIX: Readonly<Record<string, string>> = { office: '', school: '학생 ', cafe: '카페 ', fantasy: '길드 ' };

/** 세트마다 새 역할 이름(DERIVED_ROLES 순서). 세트 안·세트끼리 기존 이름과 겹치지 않게 골랐다. */
const NAMES: Readonly<Record<string, readonly string[]>> = {
  ocean: ['물결', '파도', '산호', '진주', '해초', '조약', '모래', '물방', '윤슬', '바람', '갯벌', '등대', '닻별', '물보', '방울', '쪽빛', '너울', '포말', '해무', '고둥', '멍게', '미역', '조개', '해달', '파랑', '물살'],
  forest: ['솔방', '도란', '버섯', '이끼', '단풍', '은행', '개울', '풀잎', '밤톨', '산들', '다람', '고사', '오솔', '숲내', '나뭇', '가랑', '꽃잎', '들꽃', '송이', '개암', '산딸', '다래', '머루', '청솔', '이슬', '풀벌'],
  farm: ['짚단', '보리', '밀알', '옥수', '감자', '고구', '호박', '수박', '참외', '콩알', '들깨', '쌀알', '배추', '무청', '마늘', '양파', '상추', '깨송', '볏짚', '홍시', '대추', '오이', '감귤', '고추', '완두', '메밀'],
  space: ['위성', '혜성', '은하', '퀘이', '펄서', '궤도', '항성', '성운', '달빛', '토성', '목성', '화성', '금성', '수성', '블랙', '중력', '광년', '감마', '베가', '우주', '로켓', '유성', '오로', '시리', '안드', '북극'],
  office: ['서윤', '지후', '민재', '수아', '예준', '시우', '지아', '건우', '나연', '우진', '다은', '현서', '준혁', '소율', '태윤', '하준', '은채', '도현', '라온', '시안', '시윤', '지안', '로하', '서아', '가온', '준서'],
  school: ['민서', '윤호', '주원', '하윤', '서준', '예서', '지환', '수빈', '연우', '다인', '태민', '유진', '승현', '가윤', '지성', '나은', '현우', '채은', '도하', '아린', '재윤', '서하', '민준', '지유', '시은', '다솜'],
  cafe: ['마들', '스콘', '카라', '머핀', '쿠키', '타르', '에클', '브리', '베이', '와플', '크레', '젤라', '모카', '에스', '카푸', '아포', '바닐', '캐러', '시나', '비스', '마카', '휘낭', '슈크', '티라', '파운', '몽블'],
  fantasy: ['카엘', '리아나', '테오', '로웬', '엘라', '가렛', '셀린', '페릭', '실비', '다리온', '이브', '셀레스', '브람', '케인', '아델', '펠릭스', '이졸데', '바렌', '에린', '루시엔', '오베론', '마리엘', '탈리아', '에드릭', '세라핀', '노엘'],
};
const KIND: Readonly<Record<string, 'animal' | 'people' | 'fantasy'>> = { ocean: 'animal', forest: 'animal', farm: 'animal', space: 'animal', office: 'people', school: 'people', cafe: 'people', fantasy: 'fantasy' };
/** 색을 돌리지 않는 글자: 눈(E·W), 사람 세트는 피부·볼·입(B·S·P·M) */
const KEEP = { animal: new Set(['E', 'W']), people: new Set(['E', 'W', 'B', 'S', 'P', 'M']), fantasy: new Set(['E', 'W', 'B', 'S', 'P', 'M']) } as const;

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) return null;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** 채도가 있는 색만 hue 로 돌린다(회색·검정·흰색은 그대로). 순수 함수. */
export function tint(hex: string, hue: number): string {
  const hsl = hexToHsl(hex);
  if (hsl === null || hsl[1] < 0.15) return hex;
  return hslToHex((((hsl[0] + hue) % 360) + 360) % 360, hsl[1], hsl[2]);
}

/** 세트(id)의 캐릭터 표에 새 역할 캐릭터를 더한다. 바탕 역할이 없으면 그 역할은 건너뛴다(기본 세트로 되돌아간다). */
export function withDerivedRoles<T extends Readonly<Partial<Record<string, PixelCharacter>>>>(setId: string, chars: T): T & Partial<Record<DerivedRole, PixelCharacter>> {
  const kind = KIND[setId] ?? 'animal';
  const names = NAMES[setId] ?? NAMES['ocean']!;
  const out: Record<string, PixelCharacter> = {};
  DERIVED_ROLES.forEach((role, i) => {
    const base = chars[BASE[role]];
    if (base === undefined) return;
    const [word, hue] = TINT[role];
    const colors = Object.fromEntries(Object.entries(base.colors).map(([k, v]) => [k, KEEP[kind].has(k) ? v : tint(v, hue)]));
    out[role] = { name: names[i]!, animal: kind === 'animal' ? `${word} ${base.animal}` : `${PREFIX[setId] ?? ''}${TITLE[role]}`, colors, frames: base.frames };
  });
  return { ...chars, ...out };
}
