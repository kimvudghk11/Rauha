/** 메뉴 막대(맥)·알림 영역(Windows) 아이콘이 받는 작업 한 줄 */
export interface TrayJob {
  readonly id: string;
  readonly request: string;
  readonly status: 'queued' | 'running' | 'waiting' | 'done' | 'stopped';
}

export type TrayItem =
  | { readonly kind: 'label'; readonly text: string }
  | { readonly kind: 'open' }
  | { readonly kind: 'job'; readonly id: string; readonly text: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'quit' };

export interface TrayView {
  /** 맥 메뉴 막대에서 아이콘 옆에 붙는 짧은 글자(없으면 빈 문자열) */
  readonly title: string;
  readonly tooltip: string;
  readonly items: readonly TrayItem[];
}

const MARK: Readonly<Record<TrayJob['status'], string>> = { running: '●', waiting: '◐', queued: '○', done: '✓', stopped: '■' };
const RECENT = 3;
const TEXT_MAX = 40;

const short = (text: string): string => {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line;
};

/**
 * 작업판과 기다리는 허락 수로 아이콘 글자·툴팁·메뉴를 정한다. jobs 는 오래된 것부터.
 * 허락이 기다리면 "!n", 아니면 도는(진행·기다림) 작업 수, 일이 없으면 글자 없음.
 */
export function trayView(p: { jobs: readonly TrayJob[]; pending: number }): TrayView {
  const count = (s: TrayJob['status']): number => p.jobs.filter((j) => j.status === s).length;
  const active = count('running') + count('waiting');
  const queued = count('queued');
  const title = p.pending > 0 ? `!${p.pending}` : active > 0 ? String(active) : '';
  const parts = [active > 0 ? `일하는 중 ${active}` : '', queued > 0 ? `대기 ${queued}` : '', p.pending > 0 ? `허락 기다림 ${p.pending}` : ''].filter((x) => x !== '');
  const tooltip = p.pending > 0 ? `rauha · 허락 ${p.pending}개 기다리는 중` : active > 0 ? `rauha · ${active}개 일하는 중` : 'rauha · 쉬는 중';
  const live = p.jobs.filter((j) => j.status === 'running' || j.status === 'waiting' || j.status === 'queued');
  const over = p.jobs.filter((j) => j.status === 'done' || j.status === 'stopped').reverse();
  const recent = [...live, ...over].slice(0, RECENT);
  const waitingJob = p.jobs.find((j) => j.status === 'waiting');
  const items: TrayItem[] = [{ kind: 'label', text: parts.length === 0 ? '쉬는 중이에요' : parts.join(' · ') }, { kind: 'open' }];
  if (p.pending > 0 && waitingJob !== undefined) items.push({ kind: 'job', id: waitingJob.id, text: `허락 기다리는 작업 보기 (${p.pending})` });
  if (recent.length > 0) {
    items.push({ kind: 'separator' }, { kind: 'label', text: '최근 작업' });
    for (const j of recent) items.push({ kind: 'job', id: j.id, text: `${MARK[j.status]} ${short(j.request)}` });
  }
  items.push({ kind: 'separator' }, { kind: 'quit' });
  return { title, tooltip, items };
}
