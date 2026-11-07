import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ApprovalView, type BoardView, type RauhaApi } from '../shared/ipc.js';

const api: RauhaApi = {
  submit: (text) => ipcRenderer.invoke(IPC.submit, text),
  stop: (id) => ipcRenderer.send(IPC.stop, id),
  onBoard: (listener) => {
    ipcRenderer.on(IPC.board, (_e, board: BoardView) => listener(board));
  },
  boardNow: () => ipcRenderer.invoke(IPC.boardNow),
  onApprovals: (listener) => {
    ipcRenderer.on(IPC.approvals, (_e, list: readonly ApprovalView[]) => listener(list));
  },
  approvalsNow: () => ipcRenderer.invoke(IPC.approvalsNow),
  listRules: () => ipcRenderer.invoke(IPC.rulesList),
  addRule: (rule) => ipcRenderer.invoke(IPC.rulesAdd, rule),
  removeRule: (id) => ipcRenderer.invoke(IPC.rulesRemove, id),
  reviewApproval: (id) => ipcRenderer.invoke(IPC.approvalReview, id),
  answerApproval: (id, choice) => ipcRenderer.send(IPC.approvalAnswer, id, choice),
  platform: process.platform,
  onOpenTab: (listener) => {
    ipcRenderer.on(IPC.openTab, (_e, tab: string) => listener(tab));
  },
  findTerminalRauha: () => ipcRenderer.invoke(IPC.terminalFind),
  removeTerminalRauha: (paths) => ipcRenderer.invoke(IPC.terminalRemove, paths),
  onOpenJob: (listener) => {
    ipcRenderer.on(IPC.openJob, (_e, jobId: string) => listener(jobId));
  },
};

contextBridge.exposeInMainWorld('rauha', api);
