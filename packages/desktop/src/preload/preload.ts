import { contextBridge, ipcRenderer } from 'electron';
import { GIT_FUNCTIONS, type GitApi } from '../shared/git-api.js';
import type { UpdateView } from '../shared/update-record.js';
import type { LoginView } from '../shared/claude-login.js';
import { IPC, type ApprovalView, type BoardView, type RauhaApi } from '../shared/ipc.js';

const git = Object.fromEntries(GIT_FUNCTIONS.map((fn) => [fn, (root: string, arg: unknown) => ipcRenderer.invoke(IPC.gitCall, fn, root, arg ?? {})])) as unknown as GitApi;

const api: RauhaApi = {
  git,
  submit: (text) => ipcRenderer.invoke(IPC.submit, text),
  stop: (id) => ipcRenderer.send(IPC.stop, id),
  goDeeper: (id) => ipcRenderer.invoke(IPC.deeper, id),
  onBoard: (listener) => {
    ipcRenderer.on(IPC.board, (_e, board: BoardView) => listener(board));
  },
  boardNow: () => ipcRenderer.invoke(IPC.boardNow),
  onApprovals: (listener) => {
    ipcRenderer.on(IPC.approvals, (_e, list: readonly ApprovalView[]) => listener(list));
  },
  approvalsNow: () => ipcRenderer.invoke(IPC.approvalsNow),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  getUsage: () => ipcRenderer.invoke(IPC.usageGet),
  listAccounts: () => ipcRenderer.invoke(IPC.accountsList),
  pickFolder: () => ipcRenderer.invoke(IPC.folderPick),
  listRepos: () => ipcRenderer.invoke(IPC.reposList),
  getCommands: () => ipcRenderer.invoke(IPC.commandsGet),
  saveCommands: (book) => ipcRenderer.invoke(IPC.commandsSave, book),
  listDefaultRules: () => ipcRenderer.invoke(IPC.defaultRulesList),
  applyDefaultRule: (op) => ipcRenderer.invoke(IPC.defaultRulesApply, op),
  getTeam: () => ipcRenderer.invoke(IPC.teamGet),
  applyTeam: (op) => ipcRenderer.invoke(IPC.teamApply, op),
  draftRule: (sentence) => ipcRenderer.invoke(IPC.rulesDraft, sentence),
  listRules: () => ipcRenderer.invoke(IPC.rulesList),
  addRule: (rule) => ipcRenderer.invoke(IPC.rulesAdd, rule),
  removeRule: (id) => ipcRenderer.invoke(IPC.rulesRemove, id),
  reviewApproval: (id) => ipcRenderer.invoke(IPC.approvalReview, id),
  answerApproval: (id, choice) => ipcRenderer.send(IPC.approvalAnswer, id, choice),
  platform: process.platform,
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    dismiss: () => ipcRenderer.invoke(IPC.updateDismiss),
    onState: (listener) => {
      ipcRenderer.on(IPC.updateState, (_e, view: UpdateView) => listener(view));
    },
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.authStatus),
    login: () => ipcRenderer.invoke(IPC.authLogin),
    cancel: () => ipcRenderer.send(IPC.authCancel),
    onState: (listener) => {
      ipcRenderer.on(IPC.authState, (_e, view: LoginView) => listener(view));
    },
  },
  onOpenTab: (listener) => {
    ipcRenderer.on(IPC.openTab, (_e, tab: string) => listener(tab));
  },
  onFullScreen: (listener) => {
    ipcRenderer.on(IPC.fullScreen, (_e, on: boolean) => listener(on));
  },
  findTerminalRauha: () => ipcRenderer.invoke(IPC.terminalFind),
  removeTerminalRauha: (paths) => ipcRenderer.invoke(IPC.terminalRemove, paths),
  onOpenJob: (listener) => {
    ipcRenderer.on(IPC.openJob, (_e, jobId: string) => listener(jobId));
  },
};

contextBridge.exposeInMainWorld('rauha', api);
