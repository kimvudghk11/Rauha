/** 대화 보기: "내가 한 말"과 "Claude 가 한 일"을 나눠 보이기 위한 묶기·요약(순수 규칙) */
import type { TranscriptEntry } from './claude-history.js';

export interface Turn {
  /** 내가 한 말(없으면 빈 글) */
  readonly ask: string;
  /** 그 뒤 Claude 의 답 글을 이은 것 */
  readonly answer: string;
  /** 그 뒤 Claude 가 쓴 도구 줄("Edit src/a.ts" 처럼 이름 + 대상) */
  readonly tools: readonly string[];
}

export function groupTurns(entries: readonly TranscriptEntry[]): Turn[] {
  const out: { ask: string; answer: string[]; tools: string[] }[] = [];
  for (const e of entries) {
    if (e.role === 'user') {
      out.push({ ask: e.text, answer: [], tools: [] });
      continue;
    }
    if (out.length === 0) out.push({ ask: '', answer: [], tools: [] });
    const t = out[out.length - 1]!;
    if (e.text !== '') t.answer.push(e.text);
    t.tools.push(...(e.tools ?? []));
  }
  return out.map((t) => ({ ask: t.ask, answer: t.answer.join('\n\n'), tools: t.tools }));
}

const KIND: readonly (readonly [RegExp, string])[] = [
  [/^(Edit|Write|MultiEdit|NotebookEdit|fs_write|apply_patch)\b/i, 'Edited'],
  [/^(Bash|PowerShell|execute_bash|shell|exec)\b/i, 'Ran'],
  [/^(Read|fs_read|NotebookRead)\b/i, 'Read'],
  [/^(Grep|Glob|WebSearch|WebFetch|search|grep)\b/i, 'Searched'],
];
const ORDER = ['Edited', 'Ran', 'Read', 'Searched', 'Used'];
const target = (line: string): string => line.replace(/^\S+\s*/, '').trim();

/** 한 일 요약: 종류별 수와 대상 앞 3개(고침 · 실행 · 읽음 · 찾음 · 그 밖) */
export function actionSummary(tools: readonly string[]): { label: string; count: number; sample: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const line of tools) {
    const label = KIND.find(([re]) => re.test(line))?.[1] ?? 'Used';
    const list = groups.get(label) ?? [];
    list.push(label === 'Used' ? line : target(line) || line);
    groups.set(label, list);
  }
  return ORDER.filter((l) => groups.has(l)).map((label) => {
    const items = groups.get(label)!;
    return { label, count: items.length, sample: [...new Set(items)].slice(0, 3) };
  });
}

/** 고친(쓴) 파일들, 중복 없이 */
export function touchedFiles(tools: readonly string[]): string[] {
  return [...new Set(tools.filter((l) => KIND[0]![0].test(l)).map(target).filter((t) => t !== ''))];
}
