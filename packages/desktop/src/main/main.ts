import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { JobRunner } from '@rauha/core/jobs';
import { boardView, IPC } from '../shared/ipc.js';
import { demoWork } from './demo-work.js';
import { measureTyping } from './measure-typing.js';

/** VS Code Dark Modern 바탕색. 창이 그려지기 전 번쩍이지 않게 같은 색으로 연다. */
const BACKGROUND = '#1f1f1f';

let window: BrowserWindow | null = null;

const runner = JobRunner.start({
  work: demoWork,
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  onChange: (board) => window?.webContents.send(IPC.board, boardView(board)),
});

ipcMain.handle(IPC.submit, (_e, text: unknown) => {
  const job = typeof text === 'string' ? runner.submit(text) : null;
  return job === null ? null : boardView(runner.board).jobs.find((j) => j.id === job.id) ?? null;
});
ipcMain.on(IPC.stop, (_e, id: unknown) => {
  if (typeof id === 'string') runner.stop(id);
});
ipcMain.handle(IPC.boardNow, () => boardView(runner.board));

function open(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: BACKGROUND,
    title: 'rauha',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('closed', () => (window = null));
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
  const shot = process.env['RAUHA_SMOKE_SHOT'];
  if (shot !== undefined) window.webContents.once('did-finish-load', () => void smoke(shot));
  const typing = process.env['RAUHA_MEASURE_TYPING'];
  if (typing !== undefined)
    window.webContents.once('did-finish-load', () =>
      void measureTyping(window!, typing, () => ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 초안', 'VPC 피어링 정리 문서', '정산 배치 알림'].forEach((t) => runner.submit(t))).then(() => app.quit()),
    );
}

/** 확인용: 일 5개를 연달아 넣고 화면을 찍은 뒤 끝낸다(RAUHA_SMOKE_SHOT=찍을 png 경로). */
async function smoke(path: string): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  for (const text of ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 초안', 'VPC 피어링 정리 문서', '정산 배치 알림']) runner.submit(text);
  await new Promise((r) => setTimeout(r, 800));
  const width = Number(process.env['RAUHA_SMOKE_WIDTH'] ?? '0');
  if (width > 0) {
    window?.setSize(width, 640);
    await new Promise((r) => setTimeout(r, 400));
  }
  const image = await window!.webContents.capturePage();
  writeFileSync(path, image.toPNG());
  console.log(JSON.stringify(boardView(runner.board)));
  app.quit();
}

void app.whenReady().then(open);
app.on('window-all-closed', () => app.quit());
