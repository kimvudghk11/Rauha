/** 오늘 날짜(YYYY-MM-DD). UTC가 아니라 컴퓨터 시계가 있는 곳의 날짜다(한국에서 오전 0~9시에 어제로 나오지 않게). */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
