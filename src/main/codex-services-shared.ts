import {
  CodexAccountStore,
  CodexLoginCoordinator,
  getOpenAiCallbackPortOccupant,
  killOpenAiCallbackPortOccupant,
  type CodexAuthPayload
} from './codex-auth'
import { CodexInstanceStore } from './codex-instances'
import { resolveWindowsCodexDesktopExecutable } from './codex-launcher'
import { CodexProviderStore } from './codex-providers'
import { AccountRateLimitLookupError } from './codex-app-server'
import {
  type AccountRateLimits,
  type AccountSummary,
  type AccountTag,
  type AccountTransferFormat,
  type AccountWakeSchedule,
  type AppSettings,
  type AppSnapshot,
  type CodexInstanceDefaults,
  type CodexInstanceSummary,
  type CodexSessionDetail,
  type CodexSessionProjectsResult,
  type CodexSessionsResult,
  type CopyCodexSessionToProviderInput,
  type CopyCodexSessionToProviderResult,
  type CreateCodexInstanceInput,
  type CreateCustomProviderInput,
  type CurrentSessionSummary,
  type CustomProviderDetail,
  type CustomProviderSummary,
  type DoctorReport,
  type HealthCheckResult,
  type ListCodexSessionProjectsInput,
  type ListCodexSessionsInput,
  type LoginEvent,
  type LocalGatewayStatus,
  type ProviderCheckReport,
  type ReadCodexSessionDetailInput,
  type TokenCostDetail,
  type TokenCostReadOptions,
  type UpdateAccountWakeScheduleInput,
  type UpdateCodexInstanceInput,
  type UpdateCustomProviderInput,
  type WakeAccountRateLimitsInput,
  type WakeAccountRateLimitsResult
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { decodeJwtPayload } from '../shared/openai-auth'

const DEFAULT_CODEX_INSTANCE_ID = '__default__'
const CODEX_TOKEN_REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60_000
const BACKGROUND_AUTH_REFRESH_SKEW_MS = 5 * 60_000
const LOCAL_MOCK_OPEN_ERROR = 'Local mock accounts do not support opening Codex.'
const LOCAL_MOCK_OPEN_ISOLATED_ERROR = 'Local mock accounts do not support opening isolated Codex.'
const LOCAL_MOCK_MISSING_USAGE_ERROR = 'Local mock account is missing seeded rate limits.'
const LOCAL_MOCK_WAKE_RESPONSE_BODY =
  'Local mock wake skipped the real request and returned seeded quota data.'
const LOCAL_MOCK_USAGE_ERRORS_BY_ACCOUNT_ID: Record<string, string> = {
  'acct-local-plus-2': [
    'OpenAI token refresh failed (401): invalid_grant',
    'refresh_token_expired: The refresh token expired after the local mock retention window.',
    '请重新登录该账号后再刷新额度。'
  ].join('\n'),
  'acct-local-team': [
    'deactivated_workspace: The selected ChatGPT workspace is deactivated.',
    'workspace_id: ws_mock_deactivated',
    '请切换到仍可用的 workspace 后重试。'
  ].join('\n'),
  'acct-local-enterprise': [
    'Rate-limit lookup failed: 429 Too Many Requests',
    'retry_after: 120s',
    'request_id: req_mock_quota_throttled'
  ].join('\n'),
  'acct-local-free': [
    'Missing access token required for rate-limit lookup.',
    'auth_mode: oauth',
    '本地 mock：用于验证过期账号错误折叠显示。'
  ].join('\n')
}

function accessTokenExpiresSoon(token?: string, skewMs = 60_000): boolean {
  if (!token) {
    return true
  }

  const payload = decodeJwtPayload(token)
  if (typeof payload.exp !== 'number') {
    return false
  }

  return payload.exp * 1000 <= Date.now() + skewMs
}

function lastRefreshIsStale(
  lastRefresh?: string,
  intervalMs = CODEX_TOKEN_REFRESH_INTERVAL_MS
): boolean {
  if (!lastRefresh) {
    return false
  }

  const refreshedAt = Date.parse(lastRefresh)
  if (!Number.isFinite(refreshedAt)) {
    return true
  }

  return refreshedAt <= Date.now() - intervalMs
}

function authRefreshReason(
  auth: CodexAuthPayload,
  skewMs = 60_000
): 'expires-soon' | 'stale' | null {
  if (!auth.tokens?.refresh_token) {
    return null
  }

  if (accessTokenExpiresSoon(auth.tokens.access_token, skewMs)) {
    return 'expires-soon'
  }

  if (lastRefreshIsStale(auth.last_refresh)) {
    return 'stale'
  }

  return null
}

function comparableAuthPayload(auth: CodexAuthPayload): unknown {
  return {
    auth_mode: auth.auth_mode,
    OPENAI_API_KEY: auth.OPENAI_API_KEY,
    last_refresh: auth.last_refresh,
    tokens: {
      access_token: auth.tokens?.access_token,
      refresh_token: auth.tokens?.refresh_token,
      id_token: auth.tokens?.id_token,
      account_id: auth.tokens?.account_id
    }
  }
}

function authPayloadsEqualForRefresh(left: CodexAuthPayload, right: CodexAuthPayload): boolean {
  return (
    JSON.stringify(comparableAuthPayload(left)) === JSON.stringify(comparableAuthPayload(right))
  )
}

function accountErrorLabel(account: AccountSummary): string {
  return account.email ?? account.name ?? account.accountId ?? account.id
}

function accountInstanceLabel(account: AccountSummary): string {
  return `Account ${account.email ?? account.name ?? account.accountId ?? account.id}`
}

function customProviderLabel(provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>): string {
  return provider.name?.trim() || provider.baseUrl || 'custom'
}

function resolveOptionalAccountId(snapshot: AppSnapshot): string | null {
  return snapshot.activeAccountId ?? snapshot.accounts[0]?.id ?? null
}

function shouldRefreshStoredAuth(error: unknown, refreshToken?: string): boolean {
  if (!refreshToken || !(error instanceof Error)) {
    return false
  }

  if (error.message === 'Missing access token required for rate-limit lookup.') {
    return true
  }

  if (!(error instanceof AccountRateLimitLookupError)) {
    return false
  }

  return error.status === 401 || error.status === 403
}

function shouldClearStoredUsage(error: unknown): boolean {
  if (error instanceof AccountRateLimitLookupError) {
    return error.status === 401 || error.status === 403
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  if (
    message.includes('missing access token required for rate-limit lookup') ||
    message.includes('missing refresh token required for token refresh')
  ) {
    return true
  }

  if (!message.includes('openai token refresh failed')) {
    return false
  }

  return (
    message.includes('invalid_grant') ||
    message.includes('refresh_token_expired') ||
    message.includes('refresh_token_reused') ||
    message.includes('refresh_token_invalidated') ||
    message.includes('expired') ||
    message.includes('revoked') ||
    message.includes('already used') ||
    message.includes('invalid token')
  )
}

function makeHealthCheck(
  id: string,
  status: HealthCheckResult['status'],
  summary: string,
  detail?: string
): HealthCheckResult {
  return {
    id,
    status,
    summary,
    detail
  }
}

function reportIsOk(checks: HealthCheckResult[]): boolean {
  return !checks.some((check) => check.status === 'fail')
}

function appendPathSegment(baseUrl: string, segment: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(segment.replace(/^\/+/, ''), normalizedBaseUrl).toString()
}

function parseProviderModels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { data?: Array<{ id?: unknown }> }
    return (parsed.data ?? [])
      .map((entry) => (typeof entry.id === 'string' ? entry.id.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function extractProviderErrorDetail(raw: string): string | undefined {
  const normalized = raw.trim()
  if (!normalized) {
    return undefined
  }

  try {
    const parsed = JSON.parse(normalized) as {
      error?: unknown
      detail?: unknown
      message?: unknown
    }
    const candidate =
      (typeof parsed.detail === 'string' && parsed.detail) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      (typeof parsed.error === 'string' && parsed.error) ||
      normalized
    return candidate.trim() || undefined
  } catch {
    return normalized
  }
}

function localMockUsageError(accountId: string): string | null {
  const normalizedAccountId = accountId.trim().toLowerCase()
  for (const [mockAccountId, message] of Object.entries(LOCAL_MOCK_USAGE_ERRORS_BY_ACCOUNT_ID)) {
    if (
      normalizedAccountId === mockAccountId ||
      normalizedAccountId.endsWith(`:${mockAccountId}`)
    ) {
      return message
    }
  }

  return null
}

export interface CodexServices {
  getSnapshot(): Promise<AppSnapshot>
  accounts: {
    list(): Promise<AppSnapshot>
    importCurrent(): Promise<AppSnapshot>
    importFromAuthFile(authFile: string): Promise<AppSnapshot>
    importFromStateFile(stateFile: string): Promise<AppSnapshot>
    importFromTemplate(raw: string): Promise<AppSnapshot>
    exportToTemplate(accountIds?: string[], format?: AccountTransferFormat): Promise<string>
    activate(accountId: string): Promise<AppSnapshot>
    activateBest(): Promise<AppSnapshot>
    refreshExpiringSession(accountId: string): Promise<boolean>
    reorder(accountIds: string[]): Promise<AppSnapshot>
    remove(accountId: string): Promise<AppSnapshot>
    removeMany(accountIds: string[]): Promise<AppSnapshot>
    updateTags(accountId: string, tagIds: string[]): Promise<AppSnapshot>
    getWakeSchedule(accountId: string): Promise<AccountWakeSchedule | null>
    updateWakeSchedule(
      accountId: string,
      input: UpdateAccountWakeScheduleInput
    ): Promise<AppSnapshot>
    deleteWakeSchedule(accountId: string): Promise<AppSnapshot>
    updateWakeScheduleRuntime(
      accountId: string,
      patch: Partial<AccountWakeSchedule>
    ): Promise<AppSnapshot>
    get(accountId: string): Promise<AccountSummary>
  }
  tags: {
    create(name: string): Promise<AppSnapshot>
    update(tagId: string, name: string): Promise<AppSnapshot>
    remove(tagId: string): Promise<AppSnapshot>
    getAll(): Promise<AccountTag[]>
  }
  providers: {
    list(): Promise<CustomProviderSummary[]>
    create(input: CreateCustomProviderInput): Promise<AppSnapshot>
    reorder(providerIds: string[]): Promise<AppSnapshot>
    update(providerId: string, input: UpdateCustomProviderInput): Promise<AppSnapshot>
    remove(providerId: string): Promise<AppSnapshot>
    get(providerId: string): Promise<CustomProviderDetail>
    check(providerId: string): Promise<ProviderCheckReport>
    open(providerId: string, workspacePath?: string): Promise<AppSnapshot>
  }
  doctor: {
    run(): Promise<DoctorReport>
  }
  session: {
    current(): Promise<CurrentSessionSummary | null>
    projects(input?: ListCodexSessionProjectsInput): Promise<CodexSessionProjectsResult>
    list(input?: ListCodexSessionsInput): Promise<CodexSessionsResult>
    detail(input: ReadCodexSessionDetailInput): Promise<CodexSessionDetail>
    copyToProvider(
      input: CopyCodexSessionToProviderInput
    ): Promise<CopyCodexSessionToProviderResult>
  }
  settings: {
    get(): Promise<AppSettings>
    update(nextSettings: Partial<AppSettings>): Promise<AppSnapshot>
  }
  usage: {
    read(accountId?: string): Promise<AccountRateLimits>
    wake(
      accountId?: string,
      input?: WakeAccountRateLimitsInput
    ): Promise<WakeAccountRateLimitsResult>
  }
  cost: {
    read(input?: TokenCostReadOptions): Promise<TokenCostDetail>
  }
  gateway: {
    start(): Promise<AppSnapshot>
    stop(): Promise<AppSnapshot>
    status(): Promise<LocalGatewayStatus>
    rotateKey(): Promise<LocalGatewayStatus & { apiKey: string }>
  }
  login: {
    start(
      method: 'browser' | 'device'
    ): Promise<{ attemptId: string; method: 'browser' | 'device' }>
    isRunning(): boolean
    getPortOccupant: typeof getOpenAiCallbackPortOccupant
    killPortOccupant: typeof killOpenAiCallbackPortOccupant
  }
  codex: {
    show(workspacePath?: string): Promise<AppSnapshot>
    open(accountId?: string, workspacePath?: string): Promise<AppSnapshot>
    openIsolated(accountId: string, workspacePath?: string): Promise<AppSnapshot>
    instances: {
      list(): Promise<CodexInstanceSummary[]>
      getDefaults(): Promise<CodexInstanceDefaults>
      create(input: CreateCodexInstanceInput): Promise<CodexInstanceSummary>
      update(instanceId: string, input: UpdateCodexInstanceInput): Promise<CodexInstanceSummary>
      remove(instanceId: string): Promise<void>
      start(instanceId: string, workspacePath?: string): Promise<CodexInstanceSummary>
      stop(instanceId: string): Promise<CodexInstanceSummary>
    }
  }
}

export interface CreateCodexServicesOptions {
  userDataPath: string
  defaultWorkspacePath: string
  defaultCodexHome?: string
  platform: CodexPlatformAdapter
  emitLoginEvent?: (event: LoginEvent) => void
}

export { resolveWindowsCodexDesktopExecutable }

export interface StoredAuthRefreshResult {
  accountId: string
  auth: CodexAuthPayload
  refreshed: boolean
}

interface StoredUsageReadResult {
  accountId: string
  rateLimits: AccountRateLimits
}

interface StoredWakeReadResult {
  accountId: string
  requestResult: WakeAccountRateLimitsResult['requestResult']
}

export interface CodexServicesRuntimeContext {
  store: CodexAccountStore
  instanceStore: CodexInstanceStore
  providerStore: CodexProviderStore
  loginCoordinator: CodexLoginCoordinator
  options: CreateCodexServicesOptions
  authRefreshTasksByAccountId: Map<string, Promise<StoredAuthRefreshResult>>
  wakeTasksByAccountId: Map<string, Promise<WakeAccountRateLimitsResult>>
}

export {
  type StoredUsageReadResult,
  type StoredWakeReadResult,
  DEFAULT_CODEX_INSTANCE_ID,
  BACKGROUND_AUTH_REFRESH_SKEW_MS,
  LOCAL_MOCK_OPEN_ERROR,
  LOCAL_MOCK_OPEN_ISOLATED_ERROR,
  LOCAL_MOCK_MISSING_USAGE_ERROR,
  LOCAL_MOCK_WAKE_RESPONSE_BODY,
  LOCAL_MOCK_USAGE_ERRORS_BY_ACCOUNT_ID,
  accessTokenExpiresSoon,
  authRefreshReason,
  authPayloadsEqualForRefresh,
  accountErrorLabel,
  accountInstanceLabel,
  customProviderLabel,
  resolveOptionalAccountId,
  shouldRefreshStoredAuth,
  shouldClearStoredUsage,
  localMockUsageError,
  makeHealthCheck,
  reportIsOk,
  appendPathSegment,
  parseProviderModels,
  extractProviderErrorDetail
}
