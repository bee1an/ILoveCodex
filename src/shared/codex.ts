export type LoginMethod = 'browser' | 'device'
export type AppLanguage = 'zh-CN' | 'en'
export type AppTheme = 'light' | 'dark' | 'system'

export interface AppSettings {
  usagePollingMinutes: number
  statusBarAccountIds: string[]
  language: AppLanguage
  theme: AppTheme
  checkForUpdatesOnStartup: boolean
  codexDesktopExecutablePath: string
}

export interface CustomProviderSummary {
  id: string
  name?: string
  baseUrl: string
  model: string
  fastMode: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface CustomProviderDetail extends CustomProviderSummary {
  apiKey: string
}

export interface CreateCustomProviderInput {
  name?: string
  baseUrl: string
  apiKey: string
  model?: string
  fastMode?: boolean
}

export interface UpdateCustomProviderInput {
  name?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  fastMode?: boolean
}

export interface CodexInstanceDefaults {
  rootDir: string
  defaultCodexHome: string
}

export interface CodexInstanceSummary {
  id: string
  name: string
  codexHome: string
  bindAccountId?: string
  extraArgs: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
  lastLaunchedAt?: string
  lastPid?: number
  running: boolean
  initialized: boolean
}

export interface CreateCodexInstanceInput {
  name: string
  codexHome?: string
  bindAccountId?: string
  extraArgs?: string
}

export interface UpdateCodexInstanceInput {
  name?: string
  bindAccountId?: string | null
  extraArgs?: string
}

export interface AppMeta {
  version: string
  githubUrl: string | null
  platform?: string
  isPackaged?: boolean
}

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'unsupported'
  | 'error'

export type AppUpdateDelivery = 'auto' | 'external'

export interface AppUpdateState {
  status: AppUpdateStatus
  delivery: AppUpdateDelivery
  currentVersion: string
  availableVersion?: string
  downloadProgress?: number
  checkedAt?: string
  message?: string
  externalDownloadUrl?: string
  supported: boolean
}

export interface CreditsSnapshot {
  hasCredits: boolean
  unlimited: boolean
  balance: number | null
  approxLocalMessages?: number | null
  approxCloudMessages?: number | null
}

export interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface AccountRateLimitEntry {
  limitId: string | null
  limitName: string | null
  planType: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
}

export interface AccountRateLimits {
  limitId: string | null
  limitName: string | null
  planType: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  credits: CreditsSnapshot | null
  limits: AccountRateLimitEntry[]
  fetchedAt: string
}

export interface AccountSummary {
  id: string
  email?: string
  name?: string
  accountId?: string
  tagIds: string[]
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface AccountTag {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface CurrentSessionSummary {
  email?: string
  name?: string
  accountId?: string
  lastRefresh?: string
  storedAccountId?: string
}

export interface AppSnapshot {
  accounts: AccountSummary[]
  providers: CustomProviderSummary[]
  tags: AccountTag[]
  codexInstances: CodexInstanceSummary[]
  codexInstanceDefaults: CodexInstanceDefaults
  activeAccountId?: string
  currentSession: CurrentSessionSummary | null
  loginInProgress: boolean
  settings: AppSettings
  usageByAccountId: Record<string, AccountRateLimits>
  usageErrorByAccountId: Record<string, string>
}

export interface LoginAttempt {
  attemptId: string
  method: LoginMethod
}

export interface PortOccupant {
  pid: number
  command: string
}

export interface LoginEvent {
  attemptId: string
  method: LoginMethod
  phase: 'starting' | 'waiting' | 'success' | 'error' | 'cancelled'
  message: string
  authUrl?: string
  localCallbackUrl?: string
  verificationUrl?: string
  userCode?: string
  rawOutput?: string
  snapshot?: AppSnapshot
}

export type CliSettingsKey = keyof AppSettings

export interface CliError {
  code: number
  message: string
}

export interface CliResult<T> {
  ok: boolean
  data: T | null
  error: CliError | null
}

export interface CliAccountListPayload {
  accounts: AccountSummary[]
  activeAccountId?: string
  currentSession: CurrentSessionSummary | null
}

export interface CliLoginResult {
  attemptId: string
  method: LoginMethod
  phase: LoginEvent['phase']
  snapshot: AppSnapshot | null
}

export type HealthCheckStatus = 'pass' | 'warn' | 'fail'

export interface HealthCheckResult {
  id: string
  status: HealthCheckStatus
  summary: string
  detail?: string
}

export interface DoctorReport {
  checkedAt: string
  ok: boolean
  checks: HealthCheckResult[]
}

export interface ProviderCheckReport {
  checkedAt: string
  providerId: string
  providerName?: string
  baseUrl: string
  model: string
  ok: boolean
  latencyMs: number | null
  httpStatus: number | null
  availableModels: string[]
  checks: HealthCheckResult[]
}

export function remainingPercent(value?: number | null): number {
  return Math.max(0, Math.min(100, 100 - (value ?? 0)))
}

export function usagePollingIntervalMs(usagePollingMinutes: number): number {
  return Math.max(1, usagePollingMinutes) * 60 * 1000
}

export function usagePollDueInMs(
  rateLimits: AccountRateLimits | undefined,
  usagePollingMinutes: number,
  now = Date.now()
): number {
  const fetchedAt = rateLimits?.fetchedAt
  if (!fetchedAt) {
    return 0
  }

  const fetchedAtMs = Date.parse(fetchedAt)
  if (Number.isNaN(fetchedAtMs)) {
    return 0
  }

  const elapsedMs = Math.max(0, now - fetchedAtMs)
  return Math.max(0, usagePollingIntervalMs(usagePollingMinutes) - elapsedMs)
}

export function shouldAutoPollUsage(
  rateLimits: AccountRateLimits | undefined,
  usagePollingMinutes: number,
  now = Date.now()
): boolean {
  return usagePollDueInMs(rateLimits, usagePollingMinutes, now) === 0
}

function normalizeTimestamp(value?: number | null): number | null {
  if (!value) {
    return null
  }

  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function formatRelativeReset(
  value?: number | null,
  language: AppLanguage = 'zh-CN'
): string {
  const normalized = normalizeTimestamp(value)
  if (!normalized) {
    return '--'
  }

  const diffMs = normalized - Date.now()
  if (diffMs <= 0) {
    return language === 'en' ? 'Soon' : '即将重置'
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    if (language === 'en') {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`
    }

    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }

  if (hours > 0) {
    if (language === 'en') {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }

    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }

  return language === 'en' ? `${minutes}m` : `${minutes}分钟`
}

function accountHasUsage(rateLimits?: AccountRateLimits): boolean {
  return Boolean(rateLimits?.primary || rateLimits?.secondary)
}

interface AccountQuotaScore {
  hasUsage: boolean
  hasBothWindows: boolean
  hasAvailableQuota: boolean
  bottleneckRemaining: number
  combinedRemaining: number
  primaryRemaining: number
  secondaryRemaining: number
}

function accountQuotaScore(rateLimits?: AccountRateLimits): AccountQuotaScore {
  const hasUsage = accountHasUsage(rateLimits)
  const hasBothWindows = Boolean(rateLimits?.primary && rateLimits?.secondary)
  const primaryRemaining = rateLimits?.primary
    ? remainingPercent(rateLimits.primary.usedPercent)
    : -1
  const secondaryRemaining = rateLimits?.secondary
    ? remainingPercent(rateLimits.secondary.usedPercent)
    : -1
  const hasAvailableQuota = hasBothWindows && primaryRemaining > 0 && secondaryRemaining > 0

  return {
    hasUsage,
    hasBothWindows,
    hasAvailableQuota,
    bottleneckRemaining: hasBothWindows ? Math.min(primaryRemaining, secondaryRemaining) : -1,
    combinedRemaining: hasBothWindows ? primaryRemaining + secondaryRemaining : -1,
    primaryRemaining,
    secondaryRemaining
  }
}

function timestampScore(value?: string): number {
  if (!value) {
    return -1
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

export function resolveBestAccount(
  accounts: AccountSummary[],
  usageByAccountId: Record<string, AccountRateLimits>,
  activeAccountId?: string
): AccountSummary | null {
  if (!accounts.length) {
    return null
  }

  const rankedAccounts = [...accounts].sort((left, right) => {
    const leftUsage = usageByAccountId[left.id]
    const rightUsage = usageByAccountId[right.id]
    const leftQuota = accountQuotaScore(leftUsage)
    const rightQuota = accountQuotaScore(rightUsage)

    if (leftQuota.hasAvailableQuota !== rightQuota.hasAvailableQuota) {
      return leftQuota.hasAvailableQuota ? -1 : 1
    }

    if (leftQuota.hasBothWindows !== rightQuota.hasBothWindows) {
      return leftQuota.hasBothWindows ? -1 : 1
    }

    if (leftQuota.bottleneckRemaining !== rightQuota.bottleneckRemaining) {
      return rightQuota.bottleneckRemaining - leftQuota.bottleneckRemaining
    }

    if (leftQuota.combinedRemaining !== rightQuota.combinedRemaining) {
      return rightQuota.combinedRemaining - leftQuota.combinedRemaining
    }

    if (leftQuota.primaryRemaining !== rightQuota.primaryRemaining) {
      return rightQuota.primaryRemaining - leftQuota.primaryRemaining
    }

    if (leftQuota.secondaryRemaining !== rightQuota.secondaryRemaining) {
      return rightQuota.secondaryRemaining - leftQuota.secondaryRemaining
    }

    if (leftQuota.hasUsage !== rightQuota.hasUsage) {
      return leftQuota.hasUsage ? -1 : 1
    }

    const leftIsActive = left.id === activeAccountId
    const rightIsActive = right.id === activeAccountId
    if (leftIsActive !== rightIsActive) {
      return leftIsActive ? -1 : 1
    }

    const leftFetchedAt = timestampScore(leftUsage?.fetchedAt)
    const rightFetchedAt = timestampScore(rightUsage?.fetchedAt)
    if (leftFetchedAt !== rightFetchedAt) {
      return rightFetchedAt - leftFetchedAt
    }

    const leftUsedAt = timestampScore(left.lastUsedAt)
    const rightUsedAt = timestampScore(right.lastUsedAt)
    if (leftUsedAt !== rightUsedAt) {
      return rightUsedAt - leftUsedAt
    }

    return (left.email ?? left.name ?? left.accountId ?? left.id).localeCompare(
      right.email ?? right.name ?? right.accountId ?? right.id
    )
  })

  return (
    rankedAccounts.find((account) => accountQuotaScore(usageByAccountId[account.id]).hasAvailableQuota) ??
    null
  )
}

export function statusBarAccounts(
  settings: AppSettings,
  accounts: AccountSummary[],
  activeAccountId?: string
): AccountSummary[] {
  const selectedIds = settings.statusBarAccountIds
    .map((accountId) => accounts.find((account) => account.id === accountId))
    .filter((account): account is AccountSummary => Boolean(account))
    .slice(0, 5)

  if (selectedIds.length) {
    return selectedIds
  }

  if (activeAccountId) {
    const activeAccount = accounts.find((account) => account.id === activeAccountId)
    if (activeAccount) {
      return [activeAccount]
    }
  }

  return accounts.slice(0, 1)
}
