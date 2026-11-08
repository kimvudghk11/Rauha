/**
 * 셸 명령을 비밀 파일 검사용으로 다시 쓰는 도우미(순수 함수). 이름을 따옴표·역슬래시·16진 표기·중괄호로
 * 쪼개 써도 같은 이름으로 이어 붙여 볼 수 있게 한다.
 */

/** 풀어서 실행하는 명령(base64 -d, xxd -r, eval, printf \x…). 비밀 파일이 있는 저장소에서는 이름을 가려 읽는 데 쓰일 수 있다. */
export const DECODE_AND_RUN = /\b(?:base64|base32|basenc|xxd|openssl\s+enc)\b[^|;&\n]*(?:\s-d\b|\s-D\b|\s-r\b|--decode)|\beval\b|\bprintf\b[^|;&\n]*\\(?:x[0-9a-fA-F]{2}|[0-7]{3})/i;

/** 같은 명령을 이름이 쪼개지지 않게 다시 쓴 모양들: 원래 그대로, 따옴표를 뺀 것, 16진·8진 표기를 풀고 역슬래시까지 뺀 것 */
export function commandVariants(command: string): string[] {
  const noQuotes = command.replace(/["']/g, '');
  const decoded = command
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, u: string) => String.fromCharCode(parseInt(u, 16)))
    .replace(/\$(?=["'])/g, '')
    .replace(/["'\\]/g, '');
  return [...new Set([command, noQuotes, decoded])];
}

/** `.en{v,}` → [.env, .en]. 중괄호는 겹쳐 있어도 편다. 최대 32개까지. */
export function expandBraces(word: string): string[] {
  const m = /^(.*?)\{([^{}]*)\}(.*)$/.exec(word);
  if (m === null || !(m[2] as string).includes(',')) return [word];
  const out = (m[2] as string).split(',').flatMap((alt) => expandBraces(`${m[1]}${alt}${m[3]}`));
  return out.slice(0, 32);
}

/** 셸 와일드카드(*, **, ?, [글자])를 정규식으로 맞춘다. 점 파일도 맞는 것으로 본다(PowerShell·cmd는 그렇다). */
export function shellGlobMatches(glob: string, value: string): boolean {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else source += '[^/]*';
    } else if (c === '?') {
      source += '[^/]';
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 2);
      if (close === -1) {
        source += '\\[';
      } else {
        source += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else {
      source += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
  }
  try {
    return new RegExp(`^${source}$`, 'i').test(value);
  } catch {
    return false;
  }
}

/** Windows가 만드는 8.3 짧은 이름(ENV~1, CREDEN~1.JSO)이 주어진 파일들 중 하나의 짧은 이름인지 */
export function isShortNameOf(word: string, files: readonly string[]): boolean {
  const last = word.split(/[\\/]/).pop() ?? word;
  const m = /^([^~\s]{1,6})~\d+(?:\.([^.\s]{0,3}))?$/.exec(last);
  if (m === null) return false;
  const prefix = (m[1] as string).toUpperCase();
  const ext = (m[2] ?? '').toUpperCase();
  return files.some((file) => {
    const name = (file.split(/[\\/]/).pop() ?? file).replace(/^\.+/, '');
    const dot = name.lastIndexOf('.');
    const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_$%'@!(){}^#&-]/g, '').slice(0, 6).toUpperCase();
    const e = (dot > 0 ? name.slice(dot + 1) : '').slice(0, 3).toUpperCase();
    return base === prefix && e === ext;
  });
}
