/**
 * 왼쪽 막대 탭 순서. 사용자가 끌어서 바꾼 순서(저장된 id 목록)를 기본 순서에 합친다.
 * 저장본에 없는 새 탭은 기본 위치 그대로 뒤에 붙고, 없어진 탭이나 중복은 버린다.
 */
export function mergeTabOrder(defaults: readonly string[], saved: unknown): string[] {
  const known = new Set(defaults);
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === 'string' && known.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  for (const id of defaults) if (!seen.has(id)) out.push(id);
  return out;
}

/** `id` 탭을 `target` 탭 앞(또는 뒤)으로 옮긴 새 순서. 같은 탭이거나 모르는 id 면 그대로. */
export function moveTab(order: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return [...order];
  const rest = order.filter((x) => x !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  rest.splice(at, 0, id);
  return rest;
}
