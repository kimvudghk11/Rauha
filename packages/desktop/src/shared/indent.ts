/** 들여쓰기 한 칸의 모양 */
export interface Indent {
  readonly unit: 'tab' | 'space';
  /** 한 단계 너비(스페이스 수). 탭이면 탭 너비와 같다. */
  readonly size: number;
  /** 탭 문자 하나의 화면 너비 */
  readonly tabWidth: number;
  /** 어디서 정했나: .editorconfig · 파일 내용 · 기본값 */
  readonly source: 'editorconfig' | 'detected' | 'default';
}

export interface DetectedIndent {
  readonly unit: 'tab' | 'space';
  readonly size: number;
}

const SCAN_LINES = 3000;
const SIZES = [2, 4, 8, 3] as const;

/**
 * 파일 내용에서 들여쓰기를 알아낸다. 탭으로 시작하는 줄이 더 많으면 탭,
 * 아니면 줄마다 들여쓰기가 달라지는 폭(2·4·8·3)이 가장 흔한 값을 한 단계로 본다. 근거가 없으면 null.
 */
export function detectIndent(text: string): DetectedIndent | null {
  let tabs = 0;
  let spaces = 0;
  let previous = 0;
  const steps = new Map<number, number>();
  let sameWidth = new Map<number, number>();
  const lines = text.split('\n', SCAN_LINES);
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (line.startsWith('\t')) {
      tabs++;
      continue;
    }
    const width = /^ */.exec(line)?.[0].length ?? 0;
    // 주석 안의 " * " 줄은 정렬용이라 건너뛴다
    if (width > 0 && line.trimStart().startsWith('*')) continue;
    if (width > 0) {
      spaces++;
      sameWidth.set(width, (sameWidth.get(width) ?? 0) + 1);
    }
    const delta = Math.abs(width - previous);
    if (delta > 0 && width > 0) steps.set(delta, (steps.get(delta) ?? 0) + 1);
    previous = width;
  }
  if (tabs === 0 && spaces === 0) return null;
  if (tabs > spaces) return { unit: 'tab', size: 4 };
  let best: number | null = null;
  let bestCount = 0;
  for (const size of SIZES) {
    const count = steps.get(size) ?? 0;
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  if (best === null) {
    // 모든 들여쓴 줄이 같은 폭이면 그 폭을 한 단계로 본다
    sameWidth = new Map([...sameWidth].filter(([w]) => w <= 8));
    const only = [...sameWidth.keys()];
    return only.length === 1 && only[0] !== undefined && only[0] > 1 ? { unit: 'space', size: only[0] } : null;
  }
  return { unit: 'space', size: best };
}

/** .editorconfig에서 뽑은 값(키는 소문자) */
export type EditorConfigProps = Readonly<Record<string, string>>;

const positive = (v: string | undefined): number | null => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isInteger(n) && n > 0 && n <= 16 ? n : null;
};

/**
 * 들여쓰기를 정한다. .editorconfig → 파일 내용에서 알아낸 값 → 기본값(웹·YAML은 스페이스 2, 그 밖은 4) 순이다.
 * defaultSize: 기본값으로 쓸 스페이스 수.
 */
export function chooseIndent(props: EditorConfigProps, detected: DetectedIndent | null, defaultSize: number): Indent {
  const style = props['indent_style'] === 'tab' || props['indent_style'] === 'space' ? props['indent_style'] : null;
  const sizeProp = props['indent_size'];
  const tabWidthProp = positive(props['tab_width']);
  const sizeNumber = sizeProp === 'tab' ? null : positive(sizeProp);
  const configured = style !== null || sizeNumber !== null || sizeProp === 'tab' || tabWidthProp !== null;
  const unit: 'tab' | 'space' = style ?? (sizeProp === 'tab' ? 'tab' : (detected?.unit ?? 'space'));
  const detectedSize = detected !== null && detected.unit === unit ? detected.size : null;
  if (unit === 'tab') {
    const tabWidth = tabWidthProp ?? sizeNumber ?? detectedSize ?? 4;
    return { unit, size: tabWidth, tabWidth, source: configured ? 'editorconfig' : detected !== null ? 'detected' : 'default' };
  }
  const size = sizeNumber ?? (sizeProp === 'tab' ? tabWidthProp : null) ?? detectedSize ?? defaultSize;
  const source = configured && (style !== null || sizeNumber !== null) ? 'editorconfig' : detectedSize !== null ? 'detected' : 'default';
  return { unit, size, tabWidth: tabWidthProp ?? 4, source };
}
