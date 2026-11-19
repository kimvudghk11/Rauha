/**
 * 화면을 다시 만들기 **전에** 스크롤 자리를 기억해 두고, 바꿔 끼운 뒤 되돌린다.
 * 다시 쓰는 칸(로그인·답변 취향·팀 설정)을 새 화면으로 옮기는 순간 원래 자리에서 빠져 높이가 줄고,
 * 브라우저가 스크롤을 깎는다. 다 만든 뒤에 읽으면 깎인 값을 지키게 되므로 만들기 전에 읽어야 한다.
 */
export function keepScroll(root: { scrollTop: number }): () => void {
  const top = root.scrollTop;
  return () => {
    root.scrollTop = top;
  };
}
