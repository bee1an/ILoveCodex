import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountRateLimits,
  AppSettings,
  AppSnapshot,
  LoginAttempt,
  LoginEvent,
  LoginMethod
} from '../shared/codex'

interface CodexDesktopApi {
  getSnapshot: () => Promise<AppSnapshot>
  updateSettings: (nextSettings: Partial<AppSettings>) => Promise<AppSnapshot>
  openMainWindow: () => Promise<AppSnapshot>
  importCurrentAccount: () => Promise<AppSnapshot>
  activateAccount: (accountId: string) => Promise<AppSnapshot>
  activateBestAccount: () => Promise<AppSnapshot>
  removeAccount: (accountId: string) => Promise<AppSnapshot>
  openAccountInCodex: (accountId: string) => Promise<AppSnapshot>
  readAccountRateLimits: (accountId: string) => Promise<AccountRateLimits>
  startLogin: (method: LoginMethod) => Promise<LoginAttempt>
  cancelLogin: () => Promise<void>
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => () => void
  onLoginEvent: (callback: (event: LoginEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    codexApp: CodexDesktopApi
  }
}
