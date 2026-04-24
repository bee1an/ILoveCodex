import type { CodexAuthPayload } from './codex-auth'
import type { AccountRateLimits, AccountSummary, AccountTransferFormat } from '../shared/codex'
import {
  decodeJwtPayload,
  resolveChatGptAccountIdFromTokens,
  resolveJwtStringClaim,
  resolveOpenAiAuthClaim
} from '../shared/openai-auth'
import {
  type AccountExportSource,
  type JsonRecord,
  type ResolvedExportAccount,
  type TemplateAccountRecord,
  DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED,
  DEFAULT_ACCOUNT_CONCURRENCY,
  DEFAULT_ACCOUNT_NOTES,
  DEFAULT_ACCOUNT_PLATFORM,
  DEFAULT_ACCOUNT_PRIORITY,
  DEFAULT_ACCOUNT_RATE_MULTIPLIER,
  DEFAULT_ACCOUNT_TYPE,
  DEFAULT_PRIVACY_MODE,
  OPENAI_OAUTH_CLIENT_ID,
  SUB2API_DATA_TYPE,
  SUB2API_DATA_VERSION,
  normalizeIsoTimestamp,
  readOptionalString,
  readRequiredString,
  resolveOpenAiAuthStringClaimFromTokens,
  toEpochSeconds,
  toIsoFromEpochSeconds,
  toIsoFromJwtExp
} from './codex-account-template-import'

function toSecondsUntilJwtExp(token?: string): number | undefined {
  const payload = decodeJwtPayload(token)
  if (typeof payload.exp !== 'number') {
    return undefined
  }

  return Math.max(0, Math.floor(payload.exp - Date.now() / 1000))
}

function resolvePlanType(
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined
): string | null {
  if (rateLimits?.planType) {
    return rateLimits.planType
  }

  const idPayload = decodeJwtPayload(auth.tokens?.id_token)
  const authClaim = resolveOpenAiAuthClaim(idPayload)
  return typeof authClaim.chatgpt_plan_type === 'string' ? authClaim.chatgpt_plan_type : null
}

function resolveChatGptUserId(auth: CodexAuthPayload): string | undefined {
  const idPayload = decodeJwtPayload(auth.tokens?.id_token)
  return (
    resolveOpenAiAuthStringClaimFromTokens(
      auth.tokens?.id_token,
      auth.tokens?.access_token,
      'chatgpt_user_id'
    ) ??
    resolveOpenAiAuthStringClaimFromTokens(
      auth.tokens?.id_token,
      auth.tokens?.access_token,
      'user_id'
    ) ??
    resolveJwtStringClaim(idPayload, 'sub')
  )
}

function resolveOrganizationId(auth: CodexAuthPayload): string | undefined {
  return resolveOpenAiAuthStringClaimFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    'organization_id'
  )
}

function resolveSubscriptionExpiresAt(auth: CodexAuthPayload): string | undefined {
  const payloads = [
    decodeJwtPayload(auth.tokens?.id_token),
    decodeJwtPayload(auth.tokens?.access_token)
  ]

  for (const payload of payloads) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    const resolved = normalizeIsoTimestamp(authClaim['chatgpt_subscription_active_until'])
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function toResetAfterSeconds(resetAt?: string): number | undefined {
  if (!resetAt) {
    return undefined
  }

  const parsed = Date.parse(resetAt)
  if (Number.isNaN(parsed)) {
    return undefined
  }

  return Math.max(0, Math.floor((parsed - Date.now()) / 1000))
}

function resolveExportName(account: AccountSummary): string {
  return account.email ?? account.name ?? account.accountId ?? account.id
}

export function buildTemplateAccountExport(
  account: AccountSummary,
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined,
  exportedAt: string
): TemplateAccountRecord {
  const accessToken = readRequiredString(auth.tokens?.access_token, 'access_token')
  const idToken = readRequiredString(auth.tokens?.id_token, 'id_token')
  const refreshToken = readOptionalString(auth.tokens?.refresh_token)
  const accountId = resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id ?? account.accountId
  )
  const email = account.email
  const name = resolveExportName(account)
  const planType = resolvePlanType(auth, rateLimits)
  const primaryResetAt = toIsoFromEpochSeconds(rateLimits?.primary?.resetsAt)
  const secondaryResetAt = toIsoFromEpochSeconds(rateLimits?.secondary?.resetsAt)
  const primaryUsedPercent = rateLimits?.primary?.usedPercent ?? 0
  const secondaryUsedPercent = rateLimits?.secondary?.usedPercent ?? 0

  return {
    name,
    notes: DEFAULT_ACCOUNT_NOTES,
    platform: DEFAULT_ACCOUNT_PLATFORM,
    type: DEFAULT_ACCOUNT_TYPE,
    credentials: {
      _token_version: 1,
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      chatgpt_account_id: readRequiredString(accountId, 'chatgpt_account_id'),
      chatgpt_user_id: resolveChatGptUserId(auth),
      client_id: OPENAI_OAUTH_CLIENT_ID,
      email,
      expires_at: toIsoFromJwtExp(accessToken),
      expires_in: toSecondsUntilJwtExp(accessToken),
      organization_id: resolveOrganizationId(auth),
      plan_type: planType,
      scope: null,
      token_type: null
    },
    extra: {
      codex_5h_reset_after_seconds: toResetAfterSeconds(primaryResetAt),
      codex_5h_reset_at: primaryResetAt,
      codex_5h_used_percent: primaryUsedPercent,
      codex_5h_window_minutes: rateLimits?.primary?.windowDurationMins,
      codex_7d_reset_after_seconds: toResetAfterSeconds(secondaryResetAt),
      codex_7d_reset_at: secondaryResetAt,
      codex_7d_used_percent: secondaryUsedPercent,
      codex_7d_window_minutes: rateLimits?.secondary?.windowDurationMins,
      codex_primary_over_secondary_percent: primaryUsedPercent - secondaryUsedPercent,
      codex_primary_reset_after_seconds: toResetAfterSeconds(primaryResetAt),
      codex_primary_reset_at: primaryResetAt,
      codex_primary_used_percent: primaryUsedPercent,
      codex_primary_window_minutes: rateLimits?.primary?.windowDurationMins,
      codex_secondary_reset_after_seconds: toResetAfterSeconds(secondaryResetAt),
      codex_secondary_reset_at: secondaryResetAt,
      codex_secondary_used_percent: secondaryUsedPercent,
      codex_secondary_window_minutes: rateLimits?.secondary?.windowDurationMins,
      codex_usage_updated_at: rateLimits?.fetchedAt ?? exportedAt,
      email,
      privacy_mode: DEFAULT_PRIVACY_MODE
    },
    concurrency: DEFAULT_ACCOUNT_CONCURRENCY,
    priority: DEFAULT_ACCOUNT_PRIORITY,
    rate_multiplier: DEFAULT_ACCOUNT_RATE_MULTIPLIER,
    auto_pause_on_expired: DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED
  }
}

function buildResolvedExportAccount(
  source: AccountExportSource,
  exportedAt: string
): ResolvedExportAccount {
  const accessToken = readRequiredString(source.auth.tokens?.access_token, 'access_token')
  const idToken = readRequiredString(source.auth.tokens?.id_token, 'id_token')
  const accountId = resolveChatGptAccountIdFromTokens(
    source.auth.tokens?.id_token,
    source.auth.tokens?.access_token,
    source.auth.tokens?.account_id ?? source.account.accountId
  )

  return {
    id: source.account.id,
    email: source.account.email ?? resolveJwtStringClaim(decodeJwtPayload(idToken), 'email'),
    accountName: resolveExportName(source.account),
    accountId: readRequiredString(accountId, 'account_id'),
    userId: resolveChatGptUserId(source.auth),
    organizationId: resolveOrganizationId(source.auth),
    planType: resolvePlanType(source.auth, source.rateLimits),
    accessToken,
    refreshToken: readOptionalString(source.auth.tokens?.refresh_token),
    idToken,
    lastRefresh: normalizeIsoTimestamp(source.auth.last_refresh) ?? exportedAt,
    expiresAt: toIsoFromJwtExp(accessToken) ?? toIsoFromJwtExp(idToken),
    subscriptionExpiresAt: resolveSubscriptionExpiresAt(source.auth),
    authMode: source.auth.auth_mode,
    openAiApiKey: source.auth.OPENAI_API_KEY,
    createdAt: toEpochSeconds(source.account.createdAt) ?? toEpochSeconds(exportedAt) ?? 0,
    lastUsed:
      toEpochSeconds(source.account.lastUsedAt) ??
      toEpochSeconds(source.account.updatedAt) ??
      toEpochSeconds(exportedAt) ??
      0,
    rateLimits: source.rateLimits
  }
}

function buildSub2apiCredentials(account: ResolvedExportAccount): JsonRecord {
  const credentials: JsonRecord = {
    access_token: account.accessToken
  }

  if (account.refreshToken) {
    credentials['refresh_token'] = account.refreshToken
  }
  if (account.idToken) {
    credentials['id_token'] = account.idToken
  }
  if (account.email) {
    credentials['email'] = account.email
  }
  if (account.accountId) {
    credentials['chatgpt_account_id'] = account.accountId
  }
  if (account.userId) {
    credentials['chatgpt_user_id'] = account.userId
  }
  if (account.organizationId) {
    credentials['organization_id'] = account.organizationId
  }
  if (account.planType) {
    credentials['plan_type'] = account.planType
  }
  if (account.expiresAt) {
    credentials['expires_at'] = account.expiresAt
  }
  if (account.subscriptionExpiresAt) {
    credentials['subscription_expires_at'] = account.subscriptionExpiresAt
  }

  return credentials
}

function buildCockpitQuota(rateLimits?: AccountRateLimits): JsonRecord | undefined {
  if (!rateLimits?.primary && !rateLimits?.secondary) {
    return undefined
  }

  return {
    hourly_percentage: rateLimits.primary?.usedPercent ?? 0,
    hourly_reset_time: rateLimits.primary?.resetsAt ?? undefined,
    hourly_window_minutes: rateLimits.primary?.windowDurationMins ?? undefined,
    hourly_window_present: Boolean(rateLimits.primary),
    weekly_percentage: rateLimits.secondary?.usedPercent ?? 0,
    weekly_reset_time: rateLimits.secondary?.resetsAt ?? undefined,
    weekly_window_minutes: rateLimits.secondary?.windowDurationMins ?? undefined,
    weekly_window_present: Boolean(rateLimits.secondary)
  }
}

function buildCockpitToolsAccountExport(account: ResolvedExportAccount): JsonRecord {
  const payload: JsonRecord = {
    id: account.id,
    email: account.email ?? '',
    auth_mode: account.authMode ?? 'chatgpt',
    openai_api_key: account.openAiApiKey ?? null,
    user_id: account.userId,
    plan_type: account.planType ?? undefined,
    auth_file_plan_type: account.planType ?? undefined,
    account_id: account.accountId,
    organization_id: account.organizationId,
    account_name: account.accountName,
    tokens: {
      id_token: account.idToken,
      access_token: account.accessToken,
      refresh_token: account.refreshToken
    },
    created_at: account.createdAt,
    last_used: account.lastUsed
  }

  const quota = buildCockpitQuota(account.rateLimits)
  if (quota) {
    payload['quota'] = quota
  }

  return payload
}

function buildSub2apiAccountExport(account: ResolvedExportAccount): JsonRecord {
  return {
    name: account.accountName,
    platform: DEFAULT_ACCOUNT_PLATFORM,
    type: DEFAULT_ACCOUNT_TYPE,
    credentials: buildSub2apiCredentials(account),
    concurrency: 0,
    priority: 0
  }
}

function buildCliProxyApiAccountExport(account: ResolvedExportAccount): JsonRecord {
  return {
    id_token: account.idToken,
    access_token: account.accessToken,
    refresh_token: account.refreshToken ?? '',
    account_id: account.accountId,
    last_refresh: account.lastRefresh,
    email: account.email ?? '',
    type: 'codex',
    expired: account.expiresAt ?? ''
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function serializeAccountExport(
  sources: AccountExportSource[],
  exportedAt: string,
  format: AccountTransferFormat = 'codexdock'
): string {
  if (format === 'codexdock') {
    return serializeJson({
      exported_at: exportedAt,
      proxies: [],
      accounts: sources.map(({ account, auth, rateLimits }) =>
        buildTemplateAccountExport(account, auth, rateLimits, exportedAt)
      )
    })
  }

  const resolvedAccounts = sources.map((source) => buildResolvedExportAccount(source, exportedAt))

  switch (format) {
    case 'cockpit_tools':
      return serializeJson(
        resolvedAccounts.map((account) => buildCockpitToolsAccountExport(account))
      )
    case 'sub2api':
      return serializeJson({
        exported_at: exportedAt.replace(/\.\d{3}Z$/, 'Z'),
        proxies: [],
        accounts: resolvedAccounts.map((account) => buildSub2apiAccountExport(account)),
        type: SUB2API_DATA_TYPE,
        version: SUB2API_DATA_VERSION
      })
    case 'cliproxyapi': {
      const payload = resolvedAccounts.map((account) => buildCliProxyApiAccountExport(account))
      return serializeJson(payload.length === 1 ? payload[0] : payload)
    }
    default:
      return serializeJson({
        exported_at: exportedAt,
        proxies: [],
        accounts: sources.map(({ account, auth, rateLimits }) =>
          buildTemplateAccountExport(account, auth, rateLimits, exportedAt)
        )
      })
  }
}
