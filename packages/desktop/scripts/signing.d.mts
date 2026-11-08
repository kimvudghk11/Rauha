export const SIGNING_ENV: readonly string[];
export function signingEnabled(env: Record<string, string | undefined>): boolean;
export function signedConfigText(yml: string): string;
