/**
 * 맥에서 새 앱을 어디에 덮어쓸지 정하는 순수 규칙.
 * Downloads나 dmg 안에서 바로 연 앱은 읽기 전용 임시 경로(App Translocation, /Volumes)에서 돌기 때문에,
 * 거기를 덮어쓰면 조용히 실패하고 옛 앱이 다시 열린다. 그런 경우 Applications에 설치한다.
 */

export type TargetWhy = 'in-place' | 'translocated' | 'disk-image' | 'outside-applications' | 'not-writable';

export interface MacTarget {
  /** 새 앱을 둘 .app 폴더 */
  readonly path: string;
  /** 지금 실행 중인 위치와 다른 곳에 설치하는지 */
  readonly relocated: boolean;
  readonly why: TargetWhy;
}

export interface MacTargetInput {
  /** 지금 실행 중인 .app 폴더 */
  readonly bundle: string;
  readonly home: string;
  /** 그 폴더(또는 없으면 가장 가까운 윗 폴더)에 쓸 수 있는지 */
  readonly canWrite: (dir: string) => boolean;
}

export const APP_NAME = 'Rauha.app';

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** 앱을 둘 곳을 정한다. 쓸 수 있는 곳이 하나도 없으면 null. */
export function chooseMacTarget(input: MacTargetInput): MacTarget | null {
  const { bundle, home, canWrite } = input;
  const userApps = `${home.replace(/\/+$/, '')}/Applications`;
  const parent = parentOf(bundle);
  let why: TargetWhy = 'in-place';
  if (bundle.includes('/AppTranslocation/')) why = 'translocated';
  else if (bundle.startsWith('/Volumes/')) why = 'disk-image';
  else if (parent !== '/Applications' && parent !== userApps) why = 'outside-applications';
  else if (!canWrite(parent)) why = 'not-writable';
  if (why === 'in-place') return { path: bundle, relocated: false, why };
  for (const dir of ['/Applications', userApps]) {
    // 쓸 수 없다고 한 그 폴더를 다시 고르지 않는다
    if (why === 'not-writable' && dir === parent) continue;
    if (canWrite(dir)) return { path: `${dir}/${APP_NAME}`, relocated: true, why };
  }
  return null;
}

/** 모달에 "어디에 설치하는지"를 알리는 한 줄 */
export function targetNote(target: MacTarget): string {
  const where = `설치 위치: ${target.path}`;
  switch (target.why) {
    case 'in-place':
      return where;
    case 'translocated':
      return `${where} (앱이 Downloads 같은 임시 위치에서 열려 있어서 Applications에 설치해요)`;
    case 'disk-image':
      return `${where} (앱이 설치 파일(dmg) 안에서 열려 있어서 Applications에 설치해요)`;
    case 'outside-applications':
      return `${where} (앱이 Applications 밖에 있어서 Applications에 설치해요)`;
    case 'not-writable':
      return `${where} (원래 위치에 쓸 권한이 없어서 이곳에 설치해요)`;
  }
}
