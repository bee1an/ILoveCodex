import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AccountWakeSchedule,
  AccountTransferFormat,
  AppMeta,
  AppSettings,
  AppSnapshot,
  AppUpdateState,
  CopyCodexSessionToProviderInput,
  CopyCodexSessionToProviderResult,
  CopyCodexSkillInput,
  CopyCodexSkillResult,
  CreateCustomProviderInput,
  CustomProviderDetail,
  CodexSessionDetail,
  CodexSessionProjectsResult,
  CodexSessionsResult,
  CodexSkillDetail,
  CodexSkillsResult,
  ListCodexSessionProjectsInput,
  ListCodexSessionsInput,
  ReadCodexSessionDetailInput,
  UpdateCustomProviderInput,
  LoginEvent,
  LoginMethod,
  PortOccupant,
  TokenCostDetail,
  TokenCostReadOptions,
  UpdateAccountWakeScheduleInput,
  WakeAccountRateLimitsInput
} from '../shared/codex'

// Custom APIs for renderer
const codexApp = {
  getSnapshot: () => ipcRenderer.invoke('codex:get-snapshot'),
  getAppMeta: (): Promise<AppMeta> => ipcRenderer.invoke('codex:get-app-meta'),
  getUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:get-update-state'),
  updateSettings: (nextSettings: Partial<AppSettings>) =>
    ipcRenderer.invoke('codex:update-settings', nextSettings),
  openMainWindow: () => ipcRenderer.invoke('codex:open-main-window'),
  openCodex: () => ipcRenderer.invoke('codex:open-codex'),
  importCurrentAccount: () => ipcRenderer.invoke('codex:import-current-account'),
  importAccountsFromFile: () => ipcRenderer.invoke('codex:import-accounts-from-file'),
  exportAccountsToFile: (format?: AccountTransferFormat) =>
    ipcRenderer.invoke('codex:export-accounts-to-file', format),
  exportSelectedAccountsToFile: (accountIds: string[], format?: AccountTransferFormat) =>
    ipcRenderer.invoke('codex:export-selected-accounts-to-file', accountIds, format),
  activateAccount: (accountId: string) => ipcRenderer.invoke('codex:activate-account', accountId),
  activateBestAccount: () => ipcRenderer.invoke('codex:activate-best-account'),
  reorderAccounts: (accountIds: string[]) =>
    ipcRenderer.invoke('codex:reorder-accounts', accountIds),
  removeAccount: (accountId: string) => ipcRenderer.invoke('codex:remove-account', accountId),
  removeAccounts: (accountIds: string[]) => ipcRenderer.invoke('codex:remove-accounts', accountIds),
  updateAccountTags: (accountId: string, tagIds: string[]) =>
    ipcRenderer.invoke('codex:update-account-tags', accountId, tagIds),
  getAccountWakeSchedule: (accountId: string): Promise<AccountWakeSchedule | null> =>
    ipcRenderer.invoke('codex:get-account-wake-schedule', accountId),
  updateAccountWakeSchedule: (accountId: string, input: UpdateAccountWakeScheduleInput) =>
    ipcRenderer.invoke('codex:update-account-wake-schedule', accountId, input),
  deleteAccountWakeSchedule: (accountId: string) =>
    ipcRenderer.invoke('codex:delete-account-wake-schedule', accountId),
  createTag: (name: string) => ipcRenderer.invoke('codex:create-tag', name),
  updateTag: (tagId: string, name: string) => ipcRenderer.invoke('codex:update-tag', tagId, name),
  deleteTag: (tagId: string) => ipcRenderer.invoke('codex:delete-tag', tagId),
  listProviders: () => ipcRenderer.invoke('codex:list-providers'),
  getProvider: (providerId: string): Promise<CustomProviderDetail> =>
    ipcRenderer.invoke('codex:get-provider', providerId),
  reorderProviders: (providerIds: string[]) =>
    ipcRenderer.invoke('codex:reorder-providers', providerIds),
  createProvider: (input: CreateCustomProviderInput) =>
    ipcRenderer.invoke('codex:create-provider', input),
  updateProvider: (providerId: string, input: UpdateCustomProviderInput) =>
    ipcRenderer.invoke('codex:update-provider', providerId, input),
  removeProvider: (providerId: string) => ipcRenderer.invoke('codex:remove-provider', providerId),
  openProviderInCodex: (providerId: string) =>
    ipcRenderer.invoke('codex:open-provider-in-codex', providerId),
  openAccountInCodex: (accountId: string) =>
    ipcRenderer.invoke('codex:open-account-in-codex', accountId),
  openAccountInIsolatedCodex: (accountId: string) =>
    ipcRenderer.invoke('codex:open-account-in-isolated-codex', accountId),
  readAccountRateLimits: (accountId: string) =>
    ipcRenderer.invoke('codex:read-account-rate-limits', accountId),
  wakeAccountRateLimits: (accountId: string, input?: WakeAccountRateLimitsInput) =>
    ipcRenderer.invoke('codex:wake-account-rate-limits', accountId, input),
  readTokenCost: (input?: TokenCostReadOptions): Promise<TokenCostDetail> =>
    ipcRenderer.invoke('codex:read-token-cost', input),
  listCodexSessionProjects: (
    input?: ListCodexSessionProjectsInput
  ): Promise<CodexSessionProjectsResult> =>
    ipcRenderer.invoke('codex:list-session-projects', input),
  listCodexSessions: (input?: ListCodexSessionsInput): Promise<CodexSessionsResult> =>
    ipcRenderer.invoke('codex:list-sessions', input),
  readCodexSessionDetail: (input: ReadCodexSessionDetailInput): Promise<CodexSessionDetail> =>
    ipcRenderer.invoke('codex:read-session-detail', input),
  copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ): Promise<CopyCodexSessionToProviderResult> =>
    ipcRenderer.invoke('codex:copy-session-to-provider', input),
  listCodexSkills: (): Promise<CodexSkillsResult> => ipcRenderer.invoke('codex:list-skills'),
  readCodexSkillDetail: (instanceId: string, skillDirName: string): Promise<CodexSkillDetail> =>
    ipcRenderer.invoke('codex:read-skill-detail', instanceId, skillDirName),
  copyCodexSkill: (input: CopyCodexSkillInput): Promise<CopyCodexSkillResult> =>
    ipcRenderer.invoke('codex:copy-skill', input),
  getLocalGatewayStatus: () => ipcRenderer.invoke('codex:get-local-gateway-status'),
  startLocalGateway: () => ipcRenderer.invoke('codex:start-local-gateway'),
  stopLocalGateway: () => ipcRenderer.invoke('codex:stop-local-gateway'),
  rotateLocalGatewayKey: () => ipcRenderer.invoke('codex:rotate-local-gateway-key'),
  checkForUpdates: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:check-for-updates'),
  downloadUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('codex:install-update'),
  startLogin: (method: LoginMethod) => ipcRenderer.invoke('codex:start-login', method),
  getLoginPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:get-login-port-occupant'),
  killLoginPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:kill-login-port-occupant'),
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppSnapshot): void =>
      callback(payload)
    ipcRenderer.on('codex:snapshot-updated', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:snapshot-updated', listener)
    }
  },
  onUpdateState: (callback: (state: AppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppUpdateState): void =>
      callback(payload)
    ipcRenderer.on('codex:update-state', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:update-state', listener)
    }
  },
  onLoginEvent: (callback: (event: LoginEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LoginEvent): void =>
      callback(payload)
    ipcRenderer.on('codex:login-event', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:login-event', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('codexApp', codexApp)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.codexApp = codexApp
}
