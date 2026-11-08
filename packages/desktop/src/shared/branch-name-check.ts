/**
 * 새 브랜치 이름을 git check-ref-format 규칙대로 미리 검사한다(화면이 입력할 때마다 쓴다).
 * 마지막 판단은 main의 BranchName.parse가 다시 한다. 여기는 "왜 안 되는지"를 쉬운 말로 알려 주는 쪽이다.
 */
export type BranchNameCheck = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string };

const BAD_CHARS = ['~', '^', ':', '?', '*', '[', '\\'];

export function checkBranchName(input: string, existing: readonly string[], remotes: readonly string[] = []): BranchNameCheck {
  const v = input.trim();
  const no = (reason: string): BranchNameCheck => ({ ok: false, reason });
  if (v === '') return no('이름을 입력해 주세요.');
  if (/\s/.test(v)) return no('공백은 쓸 수 없어요. - 나 _ 로 이어 주세요.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return no('눈에 안 보이는 제어 문자는 쓸 수 없어요.');
  const bad = BAD_CHARS.find((c) => v.includes(c));
  if (bad !== undefined) return no(`${bad} 문자는 쓸 수 없어요.`);
  if (v.includes('..')) return no('점 두 개(..)가 이어지면 안 돼요.');
  if (v.includes('@{')) return no('@{ 는 쓸 수 없어요.');
  if (v === '@') return no('@ 한 글자만으로는 만들 수 없어요.');
  if (v.includes('//')) return no('/ 가 두 번(//) 이어지면 안 돼요.');
  if (v.startsWith('-')) return no('맨 앞에 - 를 쓸 수 없어요.');
  if (v.startsWith('/') || v.endsWith('/')) return no('맨 앞이나 맨 뒤에 / 를 쓸 수 없어요.');
  if (v.split('/').some((p) => p.startsWith('.'))) return no('. 으로 시작하는 부분이 있으면 안 돼요.');
  if (v.endsWith('.')) return no('맨 뒤에 . 을 쓸 수 없어요.');
  if (v.split('/').some((p) => p.endsWith('.lock'))) return no('.lock 으로 끝나는 부분이 있으면 안 돼요.');
  if (existing.includes(v)) return no('이미 있는 브랜치 이름이에요.');
  if (remotes.some((r) => r.replace(/^[^/]+\//, '') === v)) return no('같은 이름이 원격에 있어요. 새로 만들지 말고 전환하면 이어서 쓸 수 있어요.');
  return { ok: true, name: v };
}

