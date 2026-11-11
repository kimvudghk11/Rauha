import { RecentFiles } from '../shared/file-mention.js';

/** 코드 탭에서 최근 연 파일(작업 폴더 기준 경로). 채팅의 @파일 후보가 이 순서를 앞세운다. 앱 안에서만 기억한다. */
let recent = RecentFiles.empty();

export const noteOpened = (path: string): void => {
  recent = recent.opened(path);
};
export const noteGone = (path: string): void => {
  recent = recent.forgot(path);
};
export const clearRecent = (): void => {
  recent = RecentFiles.empty();
};
export const recentList = (): readonly string[] => recent.list();
