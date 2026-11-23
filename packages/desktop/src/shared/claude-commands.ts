/**
 * 사용자가 Claude Code 에 등록해 둔 명령(~/.claude/commands/*.md, 작업 폴더의 .claude/commands)을 rauha 채팅에서도 /이름 으로 쓴다.
 * Claude Code 와 같은 규칙: /이름 → 이름.md, /폴더:이름 → 폴더/이름.md, 앞머리(---) 빼고, $ARGUMENTS·$1… 에 친 글.
 */
const SEGMENT = /^[A-Za-z0-9가-힣_-][A-Za-z0-9가-힣_.-]{0,63}$/;

/** 화면 → main: Claude Code 명령을 찾아 펼친다(없으면 null) */
export const CLAUDE_COMMAND_IPC = 'claude-command:expand';

/** 명령 이름 → 명령 폴더 안의 상대 경로. 이상한 이름(경로 벗어남·빈 조각)은 null */
export function claudeCommandPath(name: string): string | null {
  const parts = name.split(':');
  if (parts.some((p) => !SEGMENT.test(p) || p.startsWith('.') || p.includes('..'))) return null;
  return `${parts.join('/')}.md`;
}

/** 명령 파일 내용에 친 글을 넣어 보낼 글로 */
export function expandClaudeCommand(body: string, args: string): string {
  const text = body
    .replace(/^﻿/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .trim();
  const words = args.trim() === '' ? [] : args.trim().split(/\s+/);
  const usesArgs = /\$ARGUMENTS|\$[1-9]/.test(text);
  const filled = text.replace(/\$ARGUMENTS/g, args.trim()).replace(/\$([1-9])/g, (_m, n: string) => words[Number(n) - 1] ?? '');
  return usesArgs || args.trim() === '' ? filled.trim() : `${filled}\n\n${args.trim()}`;
}
