export type LoginMethod = 'browser' | 'device'

export interface AppSettings {
  usagePollingMinutes: number
  statusBarAccountIds: string[]
}

export interface CreditsSnapshot {
  hasCredits: boolean
  unlimited: boolean
  balance: number | null
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
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
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
  activeAccountId?: string
  currentSession: CurrentSessionSummary | null
  loginInProgress: boolean
  settings: AppSettings
  usageByAccountId: Record<string, AccountRateLimits>
}

export interface LoginAttempt {
  attemptId: string
  method: LoginMethod
}

export interface LoginEvent {
  attemptId: string
  method: LoginMethod
  phase: 'starting' | 'waiting' | 'success' | 'error' | 'cancelled'
  message: string
  authUrl?: string
  localCallbackUrl?: string
  verificationUrl?: string
  deviceCode?: string
  rawOutput?: string
  snapshot?: AppSnapshot
}

export function remainingPercent(value?: number | null): number {
  return Math.max(0, Math.min(100, 100 - (value ?? 0)))
}

function normalizeTimestamp(value?: number | null): number | null {
  if (!value) {
    return null
  }

  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function formatRelativeReset(value?: number | null): string {
  const normalized = normalizeTimestamp(value)
  if (!normalized) {
    return '--'
  }

  const diffMs = normalized - Date.now()
  if (diffMs <= 0) {
    return '即将重置'
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }

  return `${minutes}分钟`
}

function accountHasUsage(rateLimits?: AccountRateLimits): boolean {
  return Boolean(rateLimits?.primary || rateLimits?.secondary)
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

  return [...accounts].sort((left, right) => {
    const leftUsage = usageByAccountId[left.id]
    const rightUsage = usageByAccountId[right.id]
    const leftHasUsage = accountHasUsage(leftUsage)
    const rightHasUsage = accountHasUsage(rightUsage)

    if (leftHasUsage !== rightHasUsage) {
      return leftHasUsage ? -1 : 1
    }

    const leftPrimary = remainingPercent(leftUsage?.primary?.usedPercent)
    const rightPrimary = remainingPercent(rightUsage?.primary?.usedPercent)
    if (leftPrimary !== rightPrimary) {
      return rightPrimary - leftPrimary
    }

    const leftSecondary = remainingPercent(leftUsage?.secondary?.usedPercent)
    const rightSecondary = remainingPercent(rightUsage?.secondary?.usedPercent)
    if (leftSecondary !== rightSecondary) {
      return rightSecondary - leftSecondary
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
  })[0]
}
