import { contextBridge, ipcRenderer } from 'electron';
import { GIT_FUNCTIONS, type GitApi } from '../shared/git-api.js';
import { CHECKPOINT_FUNCTIONS, CHECKPOINT_IPC, type CheckpointApi, type CheckpointReply } from '../shared/checkpoint-api.js';
import type { UpdateView } from '../shared/update-record.js';
import type { LoginView } from '../shared/claude-login.js';
import { API_IPC } from '../shared/api-ipc.js';
import { DB_IPC } from '../shared/db-api.js';
import { CONNECTOR_IPC, type ConnectorListView } from '../shared/connector-api.js';
import { PLUGIN_IPC } from '../shared/plugin-api.js';
import { DOCKER_IPC, type DockerLogEvent } from '../shared/docker-api.js';
import { DATA_IPC } from '../shared/data-api.js';
import { CLAUDE_HISTORY_IPC } from '../shared/claude-history-ipc.js';
import { EXTERNAL_AI_IPC } from '../shared/external-ai-ipc.js';
import { BLOG_IPC } from '../shared/blog-dto.js';
import { CODE_IPC } from '../shared/code-api.js';
import { NAV_IPC } from '../shared/ts-nav.js';
import { TERM_IPC, type TermEvent } from '../shared/terminal-api.js';
import { exposeUsageBridge } from './usage-bridge.js';
import { IPC, type ApprovalView, type BoardView, type RauhaApi } from '../shared/ipc.js';

const git = Object.fromEntries(GIT_FUNCTIONS.map((fn) => [fn, (root: string, arg: unknown) => ipcRenderer.invoke(IPC.gitCall, fn, root, arg ?? {})])) as unknown as GitApi;

const checkpoint = Object.fromEntries(
  CHECKPOINT_FUNCTIONS.map((fn) => [
    fn,
    async (arg: unknown) => {
      const reply = (await ipcRenderer.invoke(CHECKPOINT_IPC.call, fn, arg ?? {})) as CheckpointReply;
      if (!reply.ok) throw new Error(reply.error);
      return reply.data;
    },
  ]),
) as unknown as CheckpointApi;

const api: RauhaApi = {
  git,
  checkpoint,
  submit: (text, images) => ipcRenderer.invoke(IPC.submit, text, images),
  stop: (id) => ipcRenderer.send(IPC.stop, id),
  goDeeper: (id) => ipcRenderer.invoke(IPC.deeper, id),
  followUp: (parentId, text) => ipcRenderer.invoke(IPC.followUp, parentId, text),
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
  chatHistoryNow: () => ipcRenderer.invoke(IPC.chatHistoryNow),
  clearChatHistory: () => ipcRenderer.invoke(IPC.chatHistoryClear),
  listAccounts: () => ipcRenderer.invoke(IPC.accountsList),
  pickFolder: () => ipcRenderer.invoke(IPC.folderPick),
  recentFolderStatus: () => ipcRenderer.invoke(IPC.recentFoldersCheck),
  forgetRecentFolder: (path) => ipcRenderer.invoke(IPC.recentFoldersForget, path),
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
  claudeHistory: {
    list: () => ipcRenderer.invoke(CLAUDE_HISTORY_IPC.list),
    open: (id) => ipcRenderer.invoke(CLAUDE_HISTORY_IPC.open, id),
  },
  externalAi: {
    status: () => ipcRenderer.invoke(EXTERNAL_AI_IPC.status),
    ask: (id, prompt) => ipcRenderer.invoke(EXTERNAL_AI_IPC.ask, id, prompt),
    login: (id, switchAccount) => ipcRenderer.invoke(EXTERNAL_AI_IPC.login, id, switchAccount === true),
    logout: (id) => ipcRenderer.invoke(EXTERNAL_AI_IPC.logout, id),
    install: (id) => ipcRenderer.invoke(EXTERNAL_AI_IPC.install, id),
  },
  blog: {
    context: () => ipcRenderer.invoke(BLOG_IPC.context),
    draft: (request) => ipcRenderer.invoke(BLOG_IPC.draft, request),
    save: (request) => ipcRenderer.invoke(BLOG_IPC.save, request),
  },
  code: {
    tree: (path) => ipcRenderer.invoke(CODE_IPC.tree, path),
    read: (path) => ipcRenderer.invoke(CODE_IPC.read, path),
    readImage: (path) => ipcRenderer.invoke(CODE_IPC.image, path),
    write: (req) => ipcRenderer.invoke(CODE_IPC.write, req),
    stat: (paths) => ipcRenderer.invoke(CODE_IPC.stat, paths),
    changes: () => ipcRenderer.invoke(CODE_IPC.changes),
    diff: (path) => ipcRenderer.invoke(CODE_IPC.diff, path),
    blame: (path) => ipcRenderer.invoke(CODE_IPC.blame, path),
    search: (options) => ipcRenderer.invoke(CODE_IPC.search, options),
    cancelSearch: (id) => ipcRenderer.invoke(CODE_IPC.searchCancel, id),
    definition: (req) => ipcRenderer.invoke(NAV_IPC.definition, req),
    references: (req) => ipcRenderer.invoke(NAV_IPC.references, req),
    diagnostics: (req) => ipcRenderer.invoke(NAV_IPC.diagnostics, req),
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
    open: (req) => ipcRenderer.invoke(TERM_IPC.open, req),
    write: (id, data) => ipcRenderer.invoke(TERM_IPC.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(TERM_IPC.resize, id, cols, rows),
    ack: (id, n) => ipcRenderer.invoke(TERM_IPC.ack, id, n),
    close: (id) => ipcRenderer.invoke(TERM_IPC.close, id),
    closeAll: () => ipcRenderer.invoke(TERM_IPC.closeAll),
    onEvent: (listener) => {
      ipcRenderer.on(TERM_IPC.event, (_e, event: TermEvent) => listener(event));
    },
  },
  plugins: {
    list: () => ipcRenderer.invoke(PLUGIN_IPC.list),
    refresh: () => ipcRenderer.invoke(PLUGIN_IPC.refresh),
    install: (input) => ipcRenderer.invoke(PLUGIN_IPC.install, input),
    uninstall: (id) => ipcRenderer.invoke(PLUGIN_IPC.uninstall, id),
    enable: (id) => ipcRenderer.invoke(PLUGIN_IPC.enable, id),
    disable: (id) => ipcRenderer.invoke(PLUGIN_IPC.disable, id),
    addMarketplace: (source) => ipcRenderer.invoke(PLUGIN_IPC.addMarketplace, source),
    removeMarketplace: (name) => ipcRenderer.invoke(PLUGIN_IPC.removeMarketplace, name),
    removeSkill: (name) => ipcRenderer.invoke(PLUGIN_IPC.removeSkill, name),
  },
  connectors: {
    list: () => ipcRenderer.invoke(CONNECTOR_IPC.list),
    refresh: () => ipcRenderer.invoke(CONNECTOR_IPC.refresh),
    addPreset: (id) => ipcRenderer.invoke(CONNECTOR_IPC.addPreset, id),
    addCustom: (input) => ipcRenderer.invoke(CONNECTOR_IPC.addCustom, input),
    connect: (id) => ipcRenderer.invoke(CONNECTOR_IPC.connect, id),
    cancel: (id) => ipcRenderer.invoke(CONNECTOR_IPC.cancel, id),
    remove: (id) => ipcRenderer.invoke(CONNECTOR_IPC.remove, id),
    onChange: (listener) => {
      const handler = (_e: unknown, view: ConnectorListView) => listener(view);
      ipcRenderer.on(CONNECTOR_IPC.changed, handler);
      return () => void ipcRenderer.removeListener(CONNECTOR_IPC.changed, handler);
    },
  },
  db: {
    list: () => ipcRenderer.invoke(DB_IPC.list),
    addPath: (req) => ipcRenderer.invoke(DB_IPC.addPath, req),
    pick: () => ipcRenderer.invoke(DB_IPC.pick),
    addServer: (req) => ipcRenderer.invoke(DB_IPC.addServer, req),
    editServer: (req) => ipcRenderer.invoke(DB_IPC.editServer, req),
    testServer: (req) => ipcRenderer.invoke(DB_IPC.testServer, req),
    unlock: (req) => ipcRenderer.invoke(DB_IPC.unlock, req),
    remove: (id) => ipcRenderer.invoke(DB_IPC.remove, id),
    retag: (req) => ipcRenderer.invoke(DB_IPC.retag, req),
    tables: (id) => ipcRenderer.invoke(DB_IPC.tables, id),
    detail: (req) => ipcRenderer.invoke(DB_IPC.detail, req),
    graph: (id) => ipcRenderer.invoke(DB_IPC.graph, id),
    rows: (req) => ipcRenderer.invoke(DB_IPC.rows, req),
    query: (req) => ipcRenderer.invoke(DB_IPC.query, req),
    cancel: (key) => ipcRenderer.invoke(DB_IPC.cancel, key),
    exportCsv: (req) => ipcRenderer.invoke(DB_IPC.exportCsv, req),
  },
  docker: {
    status: () => ipcRenderer.invoke(DOCKER_IPC.status),
    containers: () => ipcRenderer.invoke(DOCKER_IPC.containers),
    images: () => ipcRenderer.invoke(DOCKER_IPC.images),
    volumes: () => ipcRenderer.invoke(DOCKER_IPC.volumes),
    networks: () => ipcRenderer.invoke(DOCKER_IPC.networks),
    start: (id) => ipcRenderer.invoke(DOCKER_IPC.start, id),
    stop: (id) => ipcRenderer.invoke(DOCKER_IPC.stop, id),
    restart: (id) => ipcRenderer.invoke(DOCKER_IPC.restart, id),
    remove: (req) => ipcRenderer.invoke(DOCKER_IPC.remove, req),
    inspect: (id) => ipcRenderer.invoke(DOCKER_IPC.inspect, id),
    logs: (req) => ipcRenderer.invoke(DOCKER_IPC.logs, req),
    logsStop: (streamId) => ipcRenderer.invoke(DOCKER_IPC.logsStop, streamId),
    onLogEvent: (listener) => {
      ipcRenderer.on(DOCKER_IPC.logEvent, (_e, event: DockerLogEvent) => listener(event));
    },
    composeFind: () => ipcRenderer.invoke(DOCKER_IPC.composeFind),
    composeList: () => ipcRenderer.invoke(DOCKER_IPC.composeList),
    compose: (req) => ipcRenderer.invoke(DOCKER_IPC.compose, req),
    exec: (req) => ipcRenderer.invoke(DOCKER_IPC.exec, req),
    imageRemove: (req) => ipcRenderer.invoke(DOCKER_IPC.imageRemove, req),
    imagePull: (req) => ipcRenderer.invoke(DOCKER_IPC.imagePull, req),
    volumeRemove: (req) => ipcRenderer.invoke(DOCKER_IPC.volumeRemove, req),
    networkRemove: (req) => ipcRenderer.invoke(DOCKER_IPC.networkRemove, req),
  },
  api: {
    send: (req) => ipcRenderer.invoke(API_IPC.send, req),
    cancel: (key) => ipcRenderer.invoke(API_IPC.cancel, key),
    collections: {
      get: () => ipcRenderer.invoke(API_IPC.collectionsGet),
      apply: (op) => ipcRenderer.invoke(API_IPC.collectionsApply, op),
    },
    env: {
      get: () => ipcRenderer.invoke(API_IPC.envGet),
      apply: (op) => ipcRenderer.invoke(API_IPC.envApply, op),
    },
    history: {
      get: () => ipcRenderer.invoke(API_IPC.historyGet),
      remove: (id) => ipcRenderer.invoke(API_IPC.historyRemove, id),
      clear: () => ipcRenderer.invoke(API_IPC.historyClear),
    },
    import: (req) => ipcRenderer.invoke(API_IPC.import, req),
    export: (req, save) => ipcRenderer.invoke(API_IPC.export, req, save === true),
    projects: {
      list: () => ipcRenderer.invoke(API_IPC.projectsList),
      sync: (req) => ipcRenderer.invoke(API_IPC.projectsSync, req),
    },
    tests: {
      plan: (req) => ipcRenderer.invoke(API_IPC.testsPlan, req),
      run: (req) => ipcRenderer.invoke(API_IPC.testsRun, req),
      save: (planId) => ipcRenderer.invoke(API_IPC.testsSave, planId),
    },
    cookies: {
      get: () => ipcRenderer.invoke(API_IPC.cookiesGet),
      clear: (domain) => ipcRenderer.invoke(API_IPC.cookiesClear, domain),
    },
    saveBody: (historyId) => ipcRenderer.invoke(API_IPC.saveBody, historyId),
    pickFile: () => ipcRenderer.invoke(API_IPC.pickFile),
    runFolder: (req) => ipcRenderer.invoke(API_IPC.runFolder, req),
    cancelRun: () => ipcRenderer.invoke(API_IPC.runCancel),
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
