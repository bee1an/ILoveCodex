import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountRateLimits,
  AccountWakeSchedule,
  AccountTransferFormat,
  AppMeta,
  AppSettings,
  AppSnapshot,
  AppUpdateState,
  CopyCodexSessionToProviderInput,
  CopyCodexSessionToProviderResult,
  CreateCustomProviderInput,
  CustomProviderDetail,
  CodexSessionDetail,
  CodexSessionProjectsResult,
  CodexSessionsResult,
  ListCodexSessionProjectsInput,
  ListCodexSessionsInput,
  ReadCodexSessionDetailInput,
  LoginAttempt,
  LoginEvent,
  LoginMethod,
  PortOccupant,
  TokenCostDetail,
  TokenCostReadOptions,
  LocalGatewayStatus,
  UpdateAccountWakeScheduleInput,
  WakeAccountRateLimitsInput,
  WakeAccountRateLimitsResult,
  UpdateCustomProviderInput
} from '../shared/codex'

interface CodexDesktopApi {
  getSnapshot: () => Promise<AppSnapshot>
  getAppMeta: () => Promise<AppMeta>
  getUpdateState: () => Promise<AppUpdateState>
  updateSettings: (nextSettings: Partial<AppSettings>) => Promise<AppSnapshot>
  openMainWindow: () => Promise<AppSnapshot>
  openCodex: () => Promise<AppSnapshot>
  importCurrentAccount: () => Promise<AppSnapshot>
  importAccountsFromFile: () => Promise<AppSnapshot>
  exportAccountsToFile: (format?: AccountTransferFormat) => Promise<AppSnapshot>
  exportSelectedAccountsToFile: (
    accountIds: string[],
    format?: AccountTransferFormat
  ) => Promise<AppSnapshot>
  activateAccount: (accountId: string) => Promise<AppSnapshot>
  activateBestAccount: () => Promise<AppSnapshot>
  reorderAccounts: (accountIds: string[]) => Promise<AppSnapshot>
  removeAccount: (accountId: string) => Promise<AppSnapshot>
  removeAccounts: (accountIds: string[]) => Promise<AppSnapshot>
  updateAccountTags: (accountId: string, tagIds: string[]) => Promise<AppSnapshot>
  getAccountWakeSchedule: (accountId: string) => Promise<AccountWakeSchedule | null>
  updateAccountWakeSchedule: (
    accountId: string,
    input: UpdateAccountWakeScheduleInput
  ) => Promise<AppSnapshot>
  deleteAccountWakeSchedule: (accountId: string) => Promise<AppSnapshot>
  createTag: (name: string) => Promise<AppSnapshot>
  updateTag: (tagId: string, name: string) => Promise<AppSnapshot>
  deleteTag: (tagId: string) => Promise<AppSnapshot>
  listProviders: () => Promise<AppSnapshot['providers']>
  getProvider: (providerId: string) => Promise<CustomProviderDetail>
  reorderProviders: (providerIds: string[]) => Promise<AppSnapshot>
  createProvider: (input: CreateCustomProviderInput) => Promise<AppSnapshot>
  updateProvider: (providerId: string, input: UpdateCustomProviderInput) => Promise<AppSnapshot>
  removeProvider: (providerId: string) => Promise<AppSnapshot>
  openProviderInCodex: (providerId: string) => Promise<AppSnapshot>
  openAccountInCodex: (accountId: string) => Promise<AppSnapshot>
  openAccountInIsolatedCodex: (accountId: string) => Promise<AppSnapshot>
  readAccountRateLimits: (accountId: string) => Promise<AccountRateLimits>
  wakeAccountRateLimits: (
    accountId: string,
    input?: WakeAccountRateLimitsInput
  ) => Promise<WakeAccountRateLimitsResult>
  readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>
  listCodexSessionProjects: (
    input?: ListCodexSessionProjectsInput
  ) => Promise<CodexSessionProjectsResult>
  listCodexSessions: (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult>
  readCodexSessionDetail: (input: ReadCodexSessionDetailInput) => Promise<CodexSessionDetail>
  copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ) => Promise<CopyCodexSessionToProviderResult>
  getLocalGatewayStatus: () => Promise<LocalGatewayStatus>
  startLocalGateway: () => Promise<AppSnapshot>
  stopLocalGateway: () => Promise<AppSnapshot>
  rotateLocalGatewayKey: () => Promise<LocalGatewayStatus & { apiKey: string }>
  checkForUpdates: () => Promise<AppUpdateState>
  downloadUpdate: () => Promise<AppUpdateState>
  installUpdate: () => Promise<void>
  startLogin: (method: LoginMethod) => Promise<LoginAttempt>
  getLoginPortOccupant: () => Promise<PortOccupant | null>
  killLoginPortOccupant: () => Promise<PortOccupant | null>
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => () => void
  onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
  onLoginEvent: (callback: (event: LoginEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    codexApp: CodexDesktopApi
  }
}
