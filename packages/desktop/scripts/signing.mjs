// 맥 서명·공증을 켤지, 켜면 electron-builder 설정을 어떻게 바꿀지. 비밀 값은 읽지도 쓰지도 않고 "있는지"만 본다.
export const SIGNING_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'CSC_LINK', 'CSC_KEY_PASSWORD'];

/** 다섯 환경 변수가 모두 비어 있지 않을 때만 서명·공증한다. 하나라도 없으면 지금처럼 ad-hoc. */
export function signingEnabled(env) {
  return SIGNING_ENV.every((name) => typeof env[name] === 'string' && env[name].trim() !== '');
}

/** ad-hoc 설정(identity "-", 공증 없음)을 서명·공증 설정으로 바꾼 글. 바꿀 줄이 없으면 던진다(설정이 바뀌었는데 조용히 ad-hoc으로 가면 안 된다). */
export function signedConfigText(yml) {
  const rules = [
    [/^\s*identity:\s*"-"\s*\r?\n/m, ''],
    [/^(\s*)hardenedRuntime:\s*false/m, '$1hardenedRuntime: true'],
    [/^(\s*)notarize:\s*false/m, '$1notarize: true'],
  ];
  let out = yml;
  for (const [re, to] of rules) {
    if (!re.test(out)) throw new Error(`electron-builder.yml에서 바꿀 줄을 찾지 못했어요: ${re}`);
    out = out.replace(re, to);
  }
  return out;
}
