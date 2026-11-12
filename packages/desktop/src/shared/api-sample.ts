/**
 * 자동 생성한 요청에 미리 채울 예시 값. 모델을 부르지 않고 필드 이름·타입·검증 규칙(class-validator, Bean Validation)만 읽는다.
 * 규칙이 있으면 규칙을 먼저 따르고(@IsEmail → 메일 주소, @Min·@Max → 범위 안 숫자), 없으면 이름으로 짐작한다(email, page, price …).
 */

export interface FieldRule {
  /** 데코레이터·애너테이션 이름(@ 없이, `field:` 같은 대상 접두사 없이) */
  readonly name: string;
  /** 괄호 안 글(없으면 빈 글) */
  readonly args: string;
}

export interface FieldShape {
  readonly name: string;
  readonly type: string;
  readonly rules: readonly FieldRule[];
  readonly optional: boolean;
}

/** enum 이름 → 값들(선언 순서) */
export type EnumIndex = ReadonlyMap<string, readonly string[]>;

const RULE_RE = /@(?:\w+:)?(\w+)\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?/g;

/** `@IsInt() @Min(1)` 같은 글에서 규칙 목록 */
export function parseRules(text: string): FieldRule[] {
  return [...text.matchAll(RULE_RE)].map((m) => ({ name: m[1] as string, args: (m[2] ?? '').replace(/^\(|\)$/g, '').trim() }));
}

/** TS `enum X { A = 'a', B }` · Java/Kotlin `enum X { A, B }` 를 읽는다 */
export function indexEnums(texts: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of texts) {
    for (const m of t.matchAll(/\benum\s+(?:class\s+)?(\w+)\s*(?:\([^)]*\))?\s*(?::\s*\w+\s*)?\{([^}]*)\}/g)) {
      const body = (m[2] as string).split(';')[0] as string;
      const values = body
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== '')
        .map((x) => {
          const lit = /=\s*(['"`])(.*?)\1/.exec(x);
          if (lit !== null) return lit[2] as string;
          return /^(\w+)/.exec(x)?.[1] ?? '';
        })
        .filter((x) => x !== '');
      if (values.length > 0 && !out.has(m[1] as string)) out.set(m[1] as string, values);
    }
  }
  return out;
}

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const ISO = '2026-01-15T09:00:00.000Z';
const PAST_ISO = '2000-01-15T09:00:00.000Z';
const FUTURE_ISO = '2030-01-15T09:00:00.000Z';

const NUMBER_TYPE = /^(number|bigint|int|Integer|long|Long|short|Short|double|Double|float|Float|BigDecimal|BigInteger|Int|byte|Byte)$/;
const BOOL_TYPE = /^(boolean|Boolean)$/;
const STRING_TYPE = /^(string|String|char|Character|CharSequence)$/;
const DATE_TYPE = /^(Date|LocalDateTime|ZonedDateTime|OffsetDateTime|Instant|Timestamp)$/;

const STRING_BY_NAME: readonly (readonly [RegExp, string])[] = [
  [/e-?mail/i, 'user@example.com'],
  [/^(password|passwd|pwd)$|password$/i, 'Passw0rd!'],
  [/phone|mobile|^tel/i, '010-1234-5678'],
  [/^(image|avatar|thumbnail|photo)(url)?$|image_?url$/i, 'https://example.com/image.png'],
  [/url$|^link$|website|homepage/i, 'https://example.com'],
  [/uuid/i, UUID],
  [/^(user_?name|nick_?name|name|first_?name|last_?name|full_?name)$/i, 'kim'],
  [/title|subject/i, 'Sample title'],
  [/description|content|^body$|memo|note|comment|message|text|reason/i, 'Sample text'],
  [/address/i, 'Seoul'],
  [/zip|postal/i, '06000'],
  [/country/i, 'KR'],
  [/currency/i, 'KRW'],
  [/^(lang|language|locale)$/i, 'ko'],
  [/slug/i, 'sample-slug'],
  [/color|colour/i, 'blue'],
  [/code$/i, 'ABC123'],
  [/(^id$|Id$|_id$)/, '1'],
  [/(At|_at|date|Date|time|Time)$/, ISO],
  [/^(sort|order_?by)$/i, 'createdAt'],
  [/^(order|direction|dir)$/i, 'desc'],
];

const NUMBER_BY_NAME: readonly (readonly [RegExp, number])[] = [
  [/^age$/i, 30],
  [/^page$/i, 1],
  [/^(limit|size|take|per_?page|page_?size)$/i, 10],
  [/^(offset|skip)$/i, 0],
  [/price|amount|total|cost|fee|balance/i, 1000],
  [/^(quantity|qty|count)$/i, 1],
  [/^year$/i, 2026],
  [/^(month|day|months|days)$/i, 1],
  [/rating|score|stars/i, 5],
];

const baseType = (type: string): string =>
  type
    .trim()
    .replace(/\s*\|\s*(null|undefined)\b/g, '')
    .replace(/\?$/, '')
    .split(/[<|&]/)[0]
    ?.trim()
    .replace(/^.*\./, '') ?? '';

/** `{ example: 'p1' }`, `(example = "p1")` 의 값 */
function exampleIn(rules: readonly FieldRule[]): unknown {
  for (const r of rules) {
    if (!/^(ApiProperty|ApiPropertyOptional|Schema|ApiModelProperty)$/.test(r.name)) continue;
    const m = /\bexample\s*[:=]\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|(-?\d+(?:\.\d+)?)|(true|false))/.exec(r.args);
    if (m === null) continue;
    if (m[2] !== undefined) return m[2];
    if (m[3] !== undefined) return Number(m[3]);
    return m[4] === 'true';
  }
  return undefined;
}

/** `(1)`, `(min = 3, max = 9)`, `(3, 9)` 에서 숫자 하나 */
const numArg = (args: string, name: string | null, index: number): number | undefined => {
  if (name !== null) {
    const named = new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`).exec(args);
    if (named !== null) return Number(named[1]);
    if (/=/.test(args)) return undefined;
  }
  const nums = args.split(',').map((x) => x.trim());
  const v = nums[index];
  return v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;
};

/** 숫자 범위(최소·최대)와 정수인지 */
function numberBounds(rules: readonly FieldRule[]): { min?: number | undefined; max?: number | undefined; int: boolean } {
  const out: { min?: number | undefined; max?: number | undefined; int: boolean } = { int: false };
  for (const r of rules) {
    if (/^(Min|DecimalMin)$/.test(r.name)) out.min = numArg(r.args.replace(/["']/g, ''), 'value', 0);
    else if (/^(Max|DecimalMax)$/.test(r.name)) out.max = numArg(r.args.replace(/["']/g, ''), 'value', 0);
    else if (/^(IsPositive|Positive)$/.test(r.name)) out.min = Math.max(out.min ?? 1, 1);
    else if (/^(PositiveOrZero|Min0)$/.test(r.name)) out.min = Math.max(out.min ?? 0, 0);
    else if (/^(IsNegative|Negative)$/.test(r.name)) out.max = -1;
    else if (/^(IsInt|Digits)$/.test(r.name)) out.int = true;
  }
  return out;
}

/** 글자 길이 범위 */
function lengthBounds(rules: readonly FieldRule[]): { min?: number | undefined; max?: number | undefined } {
  const out: { min?: number | undefined; max?: number | undefined } = {};
  for (const r of rules) {
    if (r.name === 'Length') {
      out.min = numArg(r.args, 'min', 0);
      out.max = numArg(r.args, 'max', 1);
    } else if (r.name === 'Size') {
      out.min = numArg(r.args, 'min', 0);
      out.max = numArg(r.args, 'max', 1);
    } else if (r.name === 'MinLength') out.min = numArg(r.args, null, 0);
    else if (r.name === 'MaxLength') out.max = numArg(r.args, null, 0);
    else if (r.name === 'IsNotEmpty' || r.name === 'NotBlank' || r.name === 'NotEmpty') out.min = Math.max(out.min ?? 1, 1);
  }
  return out;
}

const fitLength = (text: string, b: { min?: number | undefined; max?: number | undefined }): string => {
  let t = text;
  if (b.min !== undefined && t.length < b.min) t = t + 'x'.repeat(b.min - t.length);
  if (b.max !== undefined && b.max >= 0 && t.length > b.max) t = t.slice(0, b.max);
  return t;
};

const firstLiteral = (args: string): unknown => {
  const m = /(?:(['"`])((?:\\.|(?!\1).)*)\1|(-?\d+(?:\.\d+)?))/.exec(args);
  if (m === null) return undefined;
  return m[2] !== undefined ? m[2] : Number(m[3]);
};

const has = (rules: readonly FieldRule[], re: RegExp): boolean => rules.some((r) => re.test(r.name));

export const ExampleValue = {
  /** 필드 하나의 예시 값. 클래스·배열처럼 직접 정할 수 없는 타입이면 undefined */
  forField(f: FieldShape, enums: EnumIndex = new Map()): unknown {
    const example = exampleIn(f.rules);
    if (example !== undefined) return example;
    const rules = f.rules;
    const type = baseType(f.type);
    const isEnum = rules.find((r) => r.name === 'IsEnum');
    if (isEnum !== undefined) {
      const values = enums.get(isEnum.args.split(',')[0]?.trim().replace(/^.*\./, '') ?? '');
      if (values !== undefined && values.length > 0) return values[0];
    }
    const isIn = rules.find((r) => r.name === 'IsIn');
    if (isIn !== undefined) {
      const v = firstLiteral(isIn.args);
      if (v !== undefined) return v;
    }
    const enumValues = enums.get(type);
    if (enumValues !== undefined && enumValues.length > 0) return enumValues[0];
    const lit = /^(['"])(.*?)\1/.exec(f.type.trim());
    if (lit !== null) return lit[2];

    if (BOOL_TYPE.test(type) || has(rules, /^(IsBoolean|AssertTrue)$/)) return has(rules, /^AssertTrue$/) ? true : false;
    if (NUMBER_TYPE.test(type) || has(rules, /^(IsInt|IsNumber|Min|Max|IsPositive|Positive|PositiveOrZero|Digits|DecimalMin|DecimalMax)$/)) {
      const b = numberBounds(rules);
      let v = NUMBER_BY_NAME.find(([re]) => re.test(f.name))?.[1] ?? 1;
      if (b.min !== undefined && v < b.min) v = b.min;
      if (b.max !== undefined && v > b.max) v = b.max;
      return b.int || /^(int|Integer|long|Long|short|Short|Int|byte|Byte|BigInteger)$/.test(type) ? Math.round(v) : v;
    }
    if (type === 'UUID' || has(rules, /^IsUUID$/)) return UUID;
    if (type === 'LocalDate') return '2026-01-15';
    if (type === 'LocalTime') return '09:00:00';
    if (DATE_TYPE.test(type) || has(rules, /^(IsDateString|IsISO8601|IsDate|Past|Future|PastOrPresent|FutureOrPresent)$/)) {
      return has(rules, /^(Past|PastOrPresent)$/) ? PAST_ISO : has(rules, /^(Future|FutureOrPresent)$/) ? FUTURE_ISO : ISO;
    }
    if (!STRING_TYPE.test(type) && type !== '' && type !== 'any' && type !== 'unknown' && rules.length === 0) return undefined;
    let text: string;
    if (has(rules, /^(IsEmail|Email)$/)) text = 'user@example.com';
    else if (has(rules, /^(IsUrl|URL|Url)$/)) text = 'https://example.com';
    else if (has(rules, /^IsPhoneNumber$/)) text = '010-1234-5678';
    else if (has(rules, /^IsNumberString$/)) text = '1';
    else if (has(rules, /^IsHexColor$/)) text = '#3399ff';
    else text = STRING_BY_NAME.find(([re]) => re.test(f.name))?.[1] ?? 'sample';
    return fitLength(text, lengthBounds(rules));
  },

  /** 경로 변수·쿼리 값(글자). pipes 는 Nest 파이프 이름(ParseIntPipe 등), fallback 은 코드에 적힌 기본값 */
  forParam(name: string, type: string, pipes: readonly string[] = [], fallback?: string): string {
    if (fallback !== undefined && fallback !== '') return fallback;
    if (pipes.includes('ParseUUIDPipe')) return UUID;
    const t = pipes.includes('ParseIntPipe') || pipes.includes('ParseFloatPipe') ? 'number' : pipes.includes('ParseBoolPipe') ? 'boolean' : type || 'string';
    const v = ExampleValue.forField({ name, type: t, rules: [], optional: false });
    return v === undefined || v === null ? 'sample' : String(v);
  },
};
