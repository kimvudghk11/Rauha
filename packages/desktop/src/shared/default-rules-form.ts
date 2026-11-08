import type { DefaultVariant } from '@rauha/core/jobs';

const TOOLS = ['Bash', 'Write', 'Edit', 'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
const PREFIX = new RegExp(`^((?:${TOOLS.join('|')})(?:\\s*,\\s*(?:${TOOLS.join('|')}))*)\\s*:\\s*`);

/** 기본 규칙의 "찾을 글" 경우들을 고치는 칸의 글로: 한 줄이 한 경우, 줄 안의 글은 " + "로 잇는다(모두 들어 있어야 맞음). 도구가 정해져 있으면 줄 앞에 "Bash:" */
export function variantsToText(variants: readonly DefaultVariant[]): string {
  return variants.map((v) => `${v.tools.length > 0 ? `${v.tools.join(', ')}: ` : ''}${v.includes.join(' + ')}`).join('\n');
}

/** 위 글을 다시 경우들로. 빈 줄·빈 글은 버린다. */
export function variantsFromText(text: string): DefaultVariant[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const m = PREFIX.exec(line);
      const rest = m === null ? line : line.slice(m[0].length);
      return { tools: m === null ? [] : m[1]!.split(',').map((t) => t.trim()), includes: rest.split('+').map((s) => s.trim()).filter((s) => s !== '') };
    })
    .filter((v) => v.includes.length > 0);
}
