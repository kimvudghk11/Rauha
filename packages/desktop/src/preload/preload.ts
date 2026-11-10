import { contextBridge, ipcRenderer } from 'electron';
import { GIT_FUNCTIONS, type GitApi } from '../shared/git-api.js';
import type { UpdateView } from '../shared/update-record.js';
import type { LoginView } from '../shared/claude-login.js';
import { DATA_IPC } from '../shared/data-api.js';
import { BLOG_IPC } from '../shared/blog-dto.js';
import { BUG_IPC } from '../shared/bug-api.js';
import { CODE_IPC } from '../shared/code-api.js';
import { TERM_IPC, type TermEvent } from '../shared/terminal-api.js';
import { exposeUsageBridge } from './usage-bridge.js';
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
  resetConversation: (root) => ipcRenderer.invoke(IPC.conversationReset, { root }),
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
  updateRule: (rule) => ipcRenderer.invoke(IPC.rulesUpdate, rule),
  reviewApproval: (id) => ipcRenderer.invoke(IPC.approvalReview, id),
  answerApproval: (id, choice) => ipcRenderer.send(IPC.approvalAnswer, id, choice),
  platform: process.platform,
  todo: {
    get: () => ipcRenderer.invoke(DATA_IPC.todoGet),
    apply: (op) => ipcRenderer.invoke(DATA_IPC.todoApply, op),
    onChange: (listener) => {
      ipcRenderer.on(DATA_IPC.todoChanged, (_e, list) => listener(list));
    },
  },
  records: {
    get: () => ipcRenderer.invoke(DATA_IPC.recordsGet),
    apply: (op) => ipcRenderer.invoke(DATA_IPC.recordsApply, op),
    onChange: (listener) => {
      ipcRenderer.on(DATA_IPC.recordsChanged, (_e, book) => listener(book));
    },
  },
  blog: {
    context: () => ipcRenderer.invoke(BLOG_IPC.context),
    draft: (request) => ipcRenderer.invoke(BLOG_IPC.draft, request),
    save: (request) => ipcRenderer.invoke(BLOG_IPC.save, request),
  },
  bugs: {
    get: () => ipcRenderer.invoke(BUG_IPC.get),
    apply: (op) => ipcRenderer.invoke(BUG_IPC.apply, op),
    preview: () => ipcRenderer.invoke(BUG_IPC.preview),
    upload: (digest) => ipcRenderer.invoke(BUG_IPC.upload, digest),
    download: () => ipcRenderer.invoke(BUG_IPC.download),
  },
  code: {
    tree: (path) => ipcRenderer.invoke(CODE_IPC.tree, path),
    read: (path) => ipcRenderer.invoke(CODE_IPC.read, path),
    readImage: (path) => ipcRenderer.invoke(CODE_IPC.image, path),
    write: (req) => ipcRenderer.invoke(CODE_IPC.write, req),
    stat: (paths) => ipcRenderer.invoke(CODE_IPC.stat, paths),
    changes: () => ipcRenderer.invoke(CODE_IPC.changes),
    diff: (path) => ipcRenderer.invoke(CODE_IPC.diff, path),
    search: (options) => ipcRenderer.invoke(CODE_IPC.search, options),
    files: () => ipcRenderer.invoke(CODE_IPC.files),
    create: (req) => ipcRenderer.invoke(CODE_IPC.create, req),
    rename: (req) => ipcRenderer.invoke(CODE_IPC.rename, req),
    trash: (req) => ipcRenderer.invoke(CODE_IPC.trash, req),
    duplicate: (req) => ipcRenderer.invoke(CODE_IPC.duplicate, req),
    move: (req) => ipcRenderer.invoke(CODE_IPC.move, req),
    inspect: (req) => ipcRenderer.invoke(CODE_IPC.inspect, req),
    reveal: (req) => ipcRenderer.invoke(CODE_IPC.reveal, req),
  },
  terminal: {
    roots: () => ipcRenderer.invoke(TERM_IPC.roots),
    open: (rootPath) => ipcRenderer.invoke(TERM_IPC.open, rootPath),
    run: (id, line) => ipcRenderer.invoke(TERM_IPC.run, id, line),
    stop: (id) => ipcRenderer.invoke(TERM_IPC.stop, id),
    close: (id) => ipcRenderer.invoke(TERM_IPC.close, id),
    onEvent: (listener) => {
      ipcRenderer.on(TERM_IPC.event, (_e, event: TermEvent) => listener(event));
    },
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    dismiss: () => ipcRenderer.invoke(IPC.updateDismiss),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    cancel: () => ipcRenderer.invoke(IPC.updateCancel),
    onState: (listener) => {
      ipcRenderer.on(IPC.updateState, (_e, view: UpdateView) => listener(view));
    },
  },
  auth: {
    check: () => ipcRenderer.invoke(IPC.authStatus),
    login: () => ipcRenderer.invoke(IPC.authLogin),
    cancel: () => ipcRenderer.send(IPC.authCancel),
    onState: (listener) => {
      ipcRenderer.on(IPC.authState, (_e, view: LoginView) => listener(view));
    },
  },
  copyDiagnostics: () => ipcRenderer.invoke(IPC.diagnosticsCopy),
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
exposeUsageBridge();
