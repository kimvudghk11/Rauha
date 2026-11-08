/** 목록을 한도만큼만 동시에 돌려 결과를 넣은 순서대로 돌려준다(폴더 훑기에서 git을 수십 개 한꺼번에 띄우지 않게). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await work(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, lane));
  return results;
}
