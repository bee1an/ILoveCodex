import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppMeta,
  AppSettings,
  AppSnapshot,
  AppUpdateState,
  CreateCustomProviderInput,
  CustomProviderDetail,
  UpdateCustomProviderInput,
  LoginEvent,
  LoginMethod,
  PortOccupant
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
  exportAccountsToFile: () => ipcRenderer.invoke('codex:export-accounts-to-file'),
  exportSelectedAccountsToFile: (accountIds: string[]) =>
    ipcRenderer.invoke('codex:export-selected-accounts-to-file', accountIds),
  activateAccount: (accountId: string) => ipcRenderer.invoke('codex:activate-account', accountId),
  activateBestAccount: () => ipcRenderer.invoke('codex:activate-best-account'),
  reorderAccounts: (accountIds: string[]) =>
    ipcRenderer.invoke('codex:reorder-accounts', accountIds),
  removeAccount: (accountId: string) => ipcRenderer.invoke('codex:remove-account', accountId),
  removeAccounts: (accountIds: string[]) => ipcRenderer.invoke('codex:remove-accounts', accountIds),
  updateAccountTags: (accountId: string, tagIds: string[]) =>
    ipcRenderer.invoke('codex:update-account-tags', accountId, tagIds),
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
