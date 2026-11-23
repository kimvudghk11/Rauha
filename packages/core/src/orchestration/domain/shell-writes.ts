const DEVNULL = /^(\/dev\/(null|stdout|stderr)|nul|\$null|&\d|-)$/i;

/** heredoc 본문(<<WORD … WORD)을 지운다. 본문 안의 > 는 쓰기가 아니다 */
function dropHeredocs(command: string): string {
  const lines = command.split('\n');
  const out: string[] = [];
  let end: string | null = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m !== null) end = m[2]!;
  }
  return out.join('\n');
}

/** 따옴표 안의 글을 같은 길이의 빈칸으로(위치는 그대로) — 따옴표 안의 > 는 쓰기가 아니다 */
function blankQuotes(text: string): { readonly masked: string; readonly original: string } {
  let masked = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      masked += ch === quote ? ch : ' ';
      if (ch === quote) quote = null;
    } else {
      if (ch === "'" || ch === '"') quote = ch;
      masked += ch;
    }
  }
  return { masked, original: text };
}

/** 원래 글의 at 위치부터 낱말 하나(따옴표면 그 안) */
function wordAt(original: string, at: number): string {
  const rest = original.slice(at).replace(/^\s+/, '');
  const q = rest[0];
  if (q === '"' || q === "'") {
    const close = rest.indexOf(q, 1);
    return close > 0 ? rest.slice(1, close) : rest.slice(1);
  }
  return /^[^\s;&|<>()]+/.exec(rest)?.[0] ?? '';
}

/** 명령을 낱말로(따옴표는 벗긴다) */
function words(segment: string): string[] {
  return [...segment.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/**
 * 셸(bash·PowerShell) 명령이 쓰는 파일들: 리디렉션(>, >>, 1>, &>), tee, sed -i, Set-Content·Add-Content·Out-File.
 * 팀원 권한(테스트 팀원은 테스트만 …)을 Bash 로 돌아가지 못하게 가드가 쓴다. 확실히 쓰는 것만 뽑는다(헷갈리면 뽑지 않는다).
 */
export function shellWriteTargets(command: string): string[] {
  const body = dropHeredocs(command);
  const { masked, original } = blankQuotes(body);
  const found: string[] = [];
  const add = (p: string): void => {
    const clean = p.trim();
    if (clean !== '' && !DEVNULL.test(clean) && !found.includes(clean)) found.push(clean);
  };
  // 리디렉션: => <= -> 같은 연산자는 빼고, 2>&1 같은 fd 복사도 뺀다
  for (const m of masked.matchAll(/(?<![=<>\-!])(?:\d|&)?>>?(?![>&=])/g)) add(wordAt(original, m.index! + m[0].length));
  for (const segment of masked.split(/[|;&\n]+/)) {
    const start = masked.indexOf(segment);
    const w = words(original.slice(start, start + segment.length));
    const cmd = (w[0] ?? '').toLowerCase();
    if (cmd === 'tee') w.slice(1).filter((x) => !x.startsWith('-')).forEach(add);
    if (cmd === 'sed' && w.some((x) => /^-i/.test(x) || x === '--in-place')) {
      // sed -i [-e] 'script' files… : 스크립트(첫 비옵션 또는 -e 다음) 뒤가 파일
      const rest = w.slice(1);
      const files: string[] = [];
      let scriptSeen = rest.some((x) => x === '-e' || x === '--expression');
      for (let i = 0; i < rest.length; i++) {
        const x = rest[i]!;
        if (x === '-e' || x === '--expression') {
          i++;
          continue;
        }
        if (x.startsWith('-')) continue;
        if (!scriptSeen) {
          scriptSeen = true;
          continue;
        }
        files.push(x);
      }
      files.forEach(add);
    }
    if (/^(set-content|add-content|out-file)$/.test(cmd)) {
      const at = w.findIndex((x) => /^-(path|filepath|literalpath)$/i.test(x));
      if (at >= 0 && w[at + 1] !== undefined) add(w[at + 1]!);
      else {
        const plain = w.slice(1).find((x) => !x.startsWith('-'));
        if (plain !== undefined) add(plain);
      }
    }
  }
  return found;
}
