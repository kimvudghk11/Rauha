import type { NavDiagnostic, NavLocation } from '../../../shared/ts-nav.js';

/** main 과 TypeScript 언어 도구 worker 가 주고받는 말. 위치는 작업 폴더 기준 상대 경로로 돌려준다. */
export interface TsWorkerData {
  /** 작업 폴더의 실제 경로(realpath) */
  readonly root: string;
  /** typescript 의 lib.*.d.ts 가 든 폴더 */
  readonly libDir: string;
}

export interface TsFileView {
  /** 작업 폴더 기준 상대 경로(슬래시) */
  readonly file: string;
  /** 편집기에 있는 글(저장 전 글도 맞게) */
  readonly text: string;
}

export type TsRequest =
  | ({ readonly op: 'definition'; readonly offset: number } & TsFileView)
  | ({ readonly op: 'references'; readonly offset: number } & TsFileView)
  | ({ readonly op: 'diagnostics' } & TsFileView);

export type TsResponse =
  | { readonly op: 'definition'; readonly locations: readonly NavLocation[] }
  | { readonly op: 'references'; readonly locations: readonly NavLocation[]; readonly truncated: boolean }
  | { readonly op: 'diagnostics'; readonly items: readonly NavDiagnostic[]; readonly truncated: boolean; /** 의미(타입) 검사까지 했는가. lib 가 없으면 문법만 본다. */ readonly semantic: boolean };

export type TsWorkerIn = { readonly id: number; readonly req: TsRequest };
export type TsWorkerOut = { readonly id: number; readonly res: TsResponse } | { readonly id: number; readonly error: string } | { readonly ready: true };

/** 한 번에 돌려줄 참조·진단 상한 */
export const MAX_TS_REFERENCES = 500;
export const MAX_TS_DIAGNOSTICS = 200;
/** 프로젝트(tsconfig)에 든 파일이 이보다 많으면 열린 파일과 그 import 만 본다 */
export const MAX_TS_PROJECT_FILES = 4000;
