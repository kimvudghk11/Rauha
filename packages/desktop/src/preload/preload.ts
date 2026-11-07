import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type BoardView, type RauhaApi } from '../shared/ipc.js';

const api: RauhaApi = {
  submit: (text) => ipcRenderer.invoke(IPC.submit, text),
  stop: (id) => ipcRenderer.send(IPC.stop, id),
  onBoard: (listener) => {
    ipcRenderer.on(IPC.board, (_e, board: BoardView) => listener(board));
  },
  boardNow: () => ipcRenderer.invoke(IPC.boardNow),
};

contextBridge.exposeInMainWorld('rauha', api);
