/** 앞 대화를 팀원 입력에 싣는 블록. 앞 대화가 없으면 빈 글(입력에서 빠진다). */
export function conversationBlock(conversation: string | null): string {
  return conversation !== null ? `<conversation>\n${conversation}\n</conversation>` : '';
}
