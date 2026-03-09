import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppMeta,
  AppSettings,
  AppSnapshot,
  LoginEvent,
  LoginMethod,
  PortOccupant
} from '../shared/codex'

// Custom APIs for renderer
const codexApp = {
  getSnapshot: () => ipcRenderer.invoke('codex:get-snapshot'),
  getAppMeta: (): Promise<AppMeta> => ipcRenderer.invoke('codex:get-app-meta'),
  updateSettings: (nextSettings: Partial<AppSettings>) =>
    ipcRenderer.invoke('codex:update-settings', nextSettings),
  openMainWindow: () => ipcRenderer.invoke('codex:open-main-window'),
  importCurrentAccount: () => ipcRenderer.invoke('codex:import-current-account'),
  activateAccount: (accountId: string) => ipcRenderer.invoke('codex:activate-account', accountId),
  activateBestAccount: () => ipcRenderer.invoke('codex:activate-best-account'),
  reorderAccounts: (accountIds: string[]) => ipcRenderer.invoke('codex:reorder-accounts', accountIds),
  removeAccount: (accountId: string) => ipcRenderer.invoke('codex:remove-account', accountId),
  updateAccountTags: (accountId: string, tagIds: string[]) =>
    ipcRenderer.invoke('codex:update-account-tags', accountId, tagIds),
  createTag: (name: string) => ipcRenderer.invoke('codex:create-tag', name),
  updateTag: (tagId: string, name: string) => ipcRenderer.invoke('codex:update-tag', tagId, name),
  deleteTag: (tagId: string) => ipcRenderer.invoke('codex:delete-tag', tagId),
  openAccountInCodex: (accountId: string) =>
    ipcRenderer.invoke('codex:open-account-in-codex', accountId),
  readAccountRateLimits: (accountId: string) =>
    ipcRenderer.invoke('codex:read-account-rate-limits', accountId),
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
