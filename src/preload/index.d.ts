import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountRateLimits,
  AppMeta,
  AppSettings,
  AppSnapshot,
  LoginAttempt,
  LoginEvent,
  LoginMethod,
  PortOccupant
} from '../shared/codex'

interface CodexDesktopApi {
  getSnapshot: () => Promise<AppSnapshot>
  getAppMeta: () => Promise<AppMeta>
  updateSettings: (nextSettings: Partial<AppSettings>) => Promise<AppSnapshot>
  openMainWindow: () => Promise<AppSnapshot>
  importCurrentAccount: () => Promise<AppSnapshot>
  activateAccount: (accountId: string) => Promise<AppSnapshot>
  activateBestAccount: () => Promise<AppSnapshot>
  reorderAccounts: (accountIds: string[]) => Promise<AppSnapshot>
  removeAccount: (accountId: string) => Promise<AppSnapshot>
  updateAccountTags: (accountId: string, tagIds: string[]) => Promise<AppSnapshot>
  createTag: (name: string) => Promise<AppSnapshot>
  updateTag: (tagId: string, name: string) => Promise<AppSnapshot>
  deleteTag: (tagId: string) => Promise<AppSnapshot>
  openAccountInCodex: (accountId: string) => Promise<AppSnapshot>
  readAccountRateLimits: (accountId: string) => Promise<AccountRateLimits>
  startLogin: (method: LoginMethod) => Promise<LoginAttempt>
  getLoginPortOccupant: () => Promise<PortOccupant | null>
  killLoginPortOccupant: () => Promise<PortOccupant | null>
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => () => void
  onLoginEvent: (callback: (event: LoginEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    codexApp: CodexDesktopApi
  }
}
