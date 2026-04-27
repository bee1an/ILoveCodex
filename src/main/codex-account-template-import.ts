import type { CodexAuthPayload } from './codex-auth'
import type { AccountRateLimits, AccountSummary, RateLimitWindow } from '../shared/codex'
import {
  decodeJwtPayload,
  resolveChatGptAccountIdFromTokens,
  resolveJwtStringClaim,
  resolveOpenAiAuthClaim
} from '../shared/openai-auth'

const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEFAULT_ACCOUNT_NOTES = ''
const DEFAULT_ACCOUNT_PLATFORM = 'openai'
const DEFAULT_ACCOUNT_TYPE = 'oauth'
const DEFAULT_ACCOUNT_CONCURRENCY = 10
const DEFAULT_ACCOUNT_PRIORITY = 1
const DEFAULT_ACCOUNT_RATE_MULTIPLIER = 1
const DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED = false
const DEFAULT_PRIVACY_MODE = 'training_off'
const SUB2API_DATA_TYPE = 'sub2api-data'
const SUB2API_DATA_VERSION = 1

type JsonRecord = Record<string, unknown>

export interface TemplateCredentialsRecord {
  _token_version?: number
  access_token: string
  refresh_token?: string
  id_token: string
  chatgpt_account_id: string
  chatgpt_user_id?: string
  client_id?: string | null
  email?: string
  expires_at?: string
  expires_in?: number
  subscription_expires_at?: string
  organization_id?: string
  plan_type?: string | null
  scope?: string | null
  token_type?: string | null
}

export interface TemplateExtraRecord {
  codex_5h_reset_after_seconds?: number
  codex_5h_reset_at?: string
  codex_5h_used_percent?: number
  codex_5h_window_minutes?: number | null
  codex_7d_reset_after_seconds?: number
  codex_7d_reset_at?: string
  codex_7d_used_percent?: number
  codex_7d_window_minutes?: number | null
  codex_primary_over_secondary_percent?: number
  codex_primary_reset_after_seconds?: number
  codex_primary_reset_at?: string
  codex_primary_used_percent?: number
  codex_primary_window_minutes?: number | null
  codex_secondary_reset_after_seconds?: number
  codex_secondary_reset_at?: string
  codex_secondary_used_percent?: number
  codex_secondary_window_minutes?: number | null
  codex_usage_updated_at?: string
  email?: string
  privacy_mode?: string
}

export interface TemplateAccountRecord {
  name?: string
  notes?: string
  platform?: string
  type?: string
  credentials: TemplateCredentialsRecord
  extra?: TemplateExtraRecord
  concurrency?: number
  priority?: number
  rate_multiplier?: number
  auto_pause_on_expired?: boolean
  last_refresh?: string
}

export interface TemplateFileRecord {
  exported_at: string
  proxies: unknown[]
  accounts: TemplateAccountRecord[]
}

export interface AccountExportSource {
  account: AccountSummary
  auth: CodexAuthPayload
  rateLimits?: AccountRateLimits
}

interface ResolvedExportAccount {
  id: string
  email?: string
  accountName: string
  accountId: string
  userId?: string
  organizationId?: string
  planType?: string | null
  accessToken: string
  refreshToken?: string
  idToken: string
  lastRefresh: string
  expiresAt?: string
  subscriptionExpiresAt?: string
  authMode?: string
  openAiApiKey?: string | null
  createdAt: number
  lastUsed: number
  rateLimits?: AccountRateLimits
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readRequiredString(value: unknown, label: string, accountIndex?: number): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  const prefix =
    typeof accountIndex === 'number' ? `Template account #${accountIndex + 1}` : 'Template file'
  throw new Error(`${prefix} is missing required field: ${label}.`)
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return String(value)
  }

  return undefined
}

function readOptionalNullableString(value: unknown): string | null | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (value == null) {
    return null
  }

  return undefined
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function firstOptionalString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    const resolved = readOptionalString(value)
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function firstOptionalNullableString(...values: Array<unknown>): string | null | undefined {
  let sawNull = false

  for (const value of values) {
    const resolved = readOptionalNullableString(value)
    if (typeof resolved === 'string') {
      return resolved
    }
    if (resolved === null) {
      sawNull = true
    }
  }

  return sawNull ? null : undefined
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return normalizeIsoTimestamp(Number(trimmed))
    }

    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString()
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  const millis = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function toEpochSeconds(value?: string | number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  if (!value || typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Math.floor(parsed / 1000)
}

function toEpochSecondsFromRelative(offsetSeconds?: number, baseTime?: string): number | null {
  if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    return null
  }

  const base = Date.parse(baseTime ?? '')
  if (Number.isNaN(base)) {
    return null
  }

  return Math.floor(base / 1000) + Math.floor(offsetSeconds)
}

function toIsoFromEpochSeconds(value?: number | null): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return new Date(value * 1000).toISOString()
}

function toIsoFromJwtExp(token?: string): string | undefined {
  const payload = decodeJwtPayload(token)
  return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : undefined
}

function normalizeWindowDuration(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function normalizeUsedPercent(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function toSecondsUntilIso(value?: string): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return undefined
  }

  return Math.max(0, Math.floor(parsed / 1000 - Date.now() / 1000))
}

function resolveWindowResetAt(
  resetAt?: string,
  resetAfterSeconds?: number,
  exportedAt?: string
): number | null {
  return toEpochSeconds(resetAt) ?? toEpochSecondsFromRelative(resetAfterSeconds, exportedAt)
}

function buildRateLimitWindow(
  usedPercent: number | undefined,
  windowMinutes: number | null | undefined,
  resetsAt: number | null,
  hasData: boolean
): RateLimitWindow | null {
  if (!hasData) {
    return null
  }

  return {
    usedPercent: normalizeUsedPercent(usedPercent),
    windowDurationMins: normalizeWindowDuration(windowMinutes),
    resetsAt
  }
}

function resolveOpenAiAuthStringClaimFromTokens(
  idToken: string | undefined,
  accessToken: string | undefined,
  key: string
): string | undefined {
  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]

  for (const payload of claims) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    const resolved = readOptionalString(authClaim[key])
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function hasTopLevelTokens(record: JsonRecord): boolean {
  return Boolean(
    readOptionalString(record['id_token']) && readOptionalString(record['access_token'])
  )
}

function hasNestedTokens(record: JsonRecord): boolean {
  const tokens = asRecord(record['tokens'])
  return Boolean(tokens && hasTopLevelTokens(tokens))
}

function hasCredentialsRecord(record: JsonRecord): boolean {
  const credentials = asRecord(record['credentials'])
  return Boolean(
    credentials &&
    (readOptionalString(credentials['access_token']) || readOptionalString(credentials['id_token']))
  )
}

function buildQuotaExtraFromCockpit(
  value: unknown,
  exportedAt: string,
  email?: string
): TemplateExtraRecord | undefined {
  const quota = asRecord(value)
  if (!quota) {
    return undefined
  }

  const primaryUsedPercent = readOptionalNumber(quota['hourly_percentage'])
  const primaryResetAt = normalizeIsoTimestamp(quota['hourly_reset_time'])
  const primaryWindowMinutes = readOptionalNumber(quota['hourly_window_minutes'])
  const secondaryUsedPercent = readOptionalNumber(quota['weekly_percentage'])
  const secondaryResetAt = normalizeIsoTimestamp(quota['weekly_reset_time'])
  const secondaryWindowMinutes = readOptionalNumber(quota['weekly_window_minutes'])
  const hasPrimary =
    readOptionalBoolean(quota['hourly_window_present']) ??
    (primaryUsedPercent != null || primaryResetAt != null || primaryWindowMinutes != null)
  const hasSecondary =
    readOptionalBoolean(quota['weekly_window_present']) ??
    (secondaryUsedPercent != null || secondaryResetAt != null || secondaryWindowMinutes != null)

  if (!hasPrimary && !hasSecondary) {
    return undefined
  }

  const extra: TemplateExtraRecord = {
    codex_primary_over_secondary_percent: (primaryUsedPercent ?? 0) - (secondaryUsedPercent ?? 0),
    codex_usage_updated_at: exportedAt,
    privacy_mode: DEFAULT_PRIVACY_MODE
  }

  if (email) {
    extra.email = email
  }

  if (hasPrimary) {
    extra.codex_5h_reset_at = primaryResetAt
    extra.codex_5h_used_percent = primaryUsedPercent
    extra.codex_5h_window_minutes = primaryWindowMinutes
    extra.codex_primary_reset_at = primaryResetAt
    extra.codex_primary_used_percent = primaryUsedPercent
    extra.codex_primary_window_minutes = primaryWindowMinutes
  }

  if (hasSecondary) {
    extra.codex_7d_reset_at = secondaryResetAt
    extra.codex_7d_used_percent = secondaryUsedPercent
    extra.codex_7d_window_minutes = secondaryWindowMinutes
    extra.codex_secondary_reset_at = secondaryResetAt
    extra.codex_secondary_used_percent = secondaryUsedPercent
    extra.codex_secondary_window_minutes = secondaryWindowMinutes
  }

  return extra
}

function parseTemplateCredentials(
  value: unknown,
  accountIndex: number,
  options: {
    parent?: JsonRecord
    fieldPrefix?: string
  } = {}
): TemplateCredentialsRecord | undefined {
  if (value == null) {
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    throw new Error(
      `Template account #${accountIndex + 1} has invalid field: ${options.fieldPrefix ?? 'credentials'}.`
    )
  }

  const label = (field: string): string =>
    options.fieldPrefix ? `${options.fieldPrefix}.${field}` : field
  const accessToken = readRequiredString(
    record['access_token'],
    label('access_token'),
    accountIndex
  )
  const idToken = readRequiredString(record['id_token'], label('id_token'), accountIndex)
  const parent = options.parent
  const idPayload = decodeJwtPayload(idToken)
  const accessPayload = decodeJwtPayload(accessToken)
  const chatgptAccountId = firstOptionalString(
    record['chatgpt_account_id'],
    record['account_id'],
    parent?.['chatgpt_account_id'],
    parent?.['account_id'],
    resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'chatgpt_account_id'),
    resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'account_id'),
    resolveChatGptAccountIdFromTokens(idToken, accessToken)
  )

  if (!chatgptAccountId) {
    throw new Error(
      `Template account #${accountIndex + 1} is missing required field: ${label('chatgpt_account_id')}.`
    )
  }

  const expiresAt = firstOptionalString(
    normalizeIsoTimestamp(record['expires_at']),
    normalizeIsoTimestamp(record['expired']),
    normalizeIsoTimestamp(parent?.['expires_at']),
    normalizeIsoTimestamp(parent?.['expired']),
    toIsoFromJwtExp(accessToken),
    toIsoFromJwtExp(idToken)
  )

  return {
    _token_version:
      readOptionalNumber(record['_token_version']) ??
      readOptionalNumber(parent?.['_token_version']),
    access_token: accessToken,
    refresh_token: firstOptionalString(record['refresh_token'], parent?.['refresh_token']),
    id_token: idToken,
    chatgpt_account_id: chatgptAccountId,
    chatgpt_user_id: firstOptionalString(
      record['chatgpt_user_id'],
      record['user_id'],
      parent?.['chatgpt_user_id'],
      parent?.['user_id'],
      resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'chatgpt_user_id'),
      resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'user_id'),
      resolveJwtStringClaim(idPayload, 'sub'),
      resolveJwtStringClaim(accessPayload, 'sub')
    ),
    client_id:
      firstOptionalNullableString(record['client_id'], parent?.['client_id']) ??
      OPENAI_OAUTH_CLIENT_ID,
    email: firstOptionalString(
      record['email'],
      parent?.['email'],
      resolveJwtStringClaim(idPayload, 'email')
    ),
    expires_at: expiresAt,
    expires_in:
      readOptionalNumber(record['expires_in']) ??
      readOptionalNumber(parent?.['expires_in']) ??
      toSecondsUntilIso(expiresAt),
    subscription_expires_at: firstOptionalString(
      normalizeIsoTimestamp(record['subscription_expires_at']),
      normalizeIsoTimestamp(parent?.['subscription_expires_at']),
      normalizeIsoTimestamp(
        resolveOpenAiAuthStringClaimFromTokens(
          idToken,
          accessToken,
          'chatgpt_subscription_active_until'
        )
      )
    ),
    organization_id: firstOptionalString(
      record['organization_id'],
      parent?.['organization_id'],
      resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'organization_id')
    ),
    plan_type: firstOptionalNullableString(
      record['plan_type'],
      parent?.['plan_type'],
      resolveOpenAiAuthStringClaimFromTokens(idToken, accessToken, 'chatgpt_plan_type')
    ),
    scope: firstOptionalNullableString(record['scope'], parent?.['scope']),
    token_type: firstOptionalNullableString(record['token_type'], parent?.['token_type'])
  }
}

function parseTemplateExtra(value: unknown, accountIndex: number): TemplateExtraRecord | undefined {
  if (value == null) {
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    throw new Error(`Template account #${accountIndex + 1} has invalid field: extra.`)
  }

  return {
    codex_5h_reset_after_seconds: readOptionalNumber(record['codex_5h_reset_after_seconds']),
    codex_5h_reset_at: normalizeIsoTimestamp(record['codex_5h_reset_at']),
    codex_5h_used_percent: readOptionalNumber(record['codex_5h_used_percent']),
    codex_5h_window_minutes: readOptionalNumber(record['codex_5h_window_minutes']),
    codex_7d_reset_after_seconds: readOptionalNumber(record['codex_7d_reset_after_seconds']),
    codex_7d_reset_at: normalizeIsoTimestamp(record['codex_7d_reset_at']),
    codex_7d_used_percent: readOptionalNumber(record['codex_7d_used_percent']),
    codex_7d_window_minutes: readOptionalNumber(record['codex_7d_window_minutes']),
    codex_primary_over_secondary_percent: readOptionalNumber(
      record['codex_primary_over_secondary_percent']
    ),
    codex_primary_reset_after_seconds: readOptionalNumber(
      record['codex_primary_reset_after_seconds']
    ),
    codex_primary_reset_at: normalizeIsoTimestamp(record['codex_primary_reset_at']),
    codex_primary_used_percent: readOptionalNumber(record['codex_primary_used_percent']),
    codex_primary_window_minutes: readOptionalNumber(record['codex_primary_window_minutes']),
    codex_secondary_reset_after_seconds: readOptionalNumber(
      record['codex_secondary_reset_after_seconds']
    ),
    codex_secondary_reset_at: normalizeIsoTimestamp(record['codex_secondary_reset_at']),
    codex_secondary_used_percent: readOptionalNumber(record['codex_secondary_used_percent']),
    codex_secondary_window_minutes: readOptionalNumber(record['codex_secondary_window_minutes']),
    codex_usage_updated_at: normalizeIsoTimestamp(record['codex_usage_updated_at']),
    email: readOptionalString(record['email']),
    privacy_mode: readOptionalString(record['privacy_mode'])
  }
}

function parseImportAccountRecord(
  value: unknown,
  index: number,
  exportedAt: string
): TemplateAccountRecord {
  const account = asRecord(value)
  if (!account) {
    throw new Error(`Template account #${index + 1} is invalid.`)
  }

  let credentials: TemplateCredentialsRecord | undefined
  if (account['credentials'] != null) {
    credentials = parseTemplateCredentials(account['credentials'], index, {
      parent: account,
      fieldPrefix: 'credentials'
    })
  } else if (account['tokens'] != null) {
    credentials = parseTemplateCredentials(account['tokens'], index, {
      parent: account,
      fieldPrefix: 'tokens'
    })
  } else if (hasTopLevelTokens(account)) {
    credentials = parseTemplateCredentials(account, index)
  }

  if (!credentials) {
    throw new Error(`Template account #${index + 1} is missing required field: credentials.`)
  }

  const extra =
    parseTemplateExtra(account['extra'], index) ??
    buildQuotaExtraFromCockpit(account['quota'], exportedAt, credentials.email)

  return {
    name:
      readOptionalString(account['name']) ??
      readOptionalString(account['account_name']) ??
      credentials.email,
    notes: readOptionalString(account['notes']) ?? DEFAULT_ACCOUNT_NOTES,
    platform: readOptionalString(account['platform']) ?? DEFAULT_ACCOUNT_PLATFORM,
    type: readOptionalString(account['type']) ?? DEFAULT_ACCOUNT_TYPE,
    credentials,
    extra,
    concurrency: readOptionalNumber(account['concurrency']) ?? DEFAULT_ACCOUNT_CONCURRENCY,
    priority: readOptionalNumber(account['priority']) ?? DEFAULT_ACCOUNT_PRIORITY,
    rate_multiplier:
      readOptionalNumber(account['rate_multiplier']) ?? DEFAULT_ACCOUNT_RATE_MULTIPLIER,
    auto_pause_on_expired:
      readOptionalBoolean(account['auto_pause_on_expired']) ??
      DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED,
    last_refresh:
      normalizeIsoTimestamp(account['last_refresh']) ??
      normalizeIsoTimestamp(account['exported_at']) ??
      undefined
  } satisfies TemplateAccountRecord
}

function parseGroupedImportRecord(record: JsonRecord): TemplateFileRecord {
  const exportedAt = normalizeIsoTimestamp(record['exported_at']) ?? new Date().toISOString()
  const accountsValue = record['accounts']
  if (!Array.isArray(accountsValue) || accountsValue.length === 0) {
    throw new Error('Template file does not contain any accounts.')
  }

  return {
    exported_at: exportedAt,
    proxies: Array.isArray(record['proxies']) ? record['proxies'] : [],
    accounts: accountsValue.map((value, index) =>
      parseImportAccountRecord(value, index, exportedAt)
    )
  }
}

function parseFlatImportRecord(value: unknown): TemplateFileRecord | null {
  if (Array.isArray(value)) {
    if (!value.length) {
      throw new Error('Template file does not contain any accounts.')
    }

    const exportedAt = new Date().toISOString()
    return {
      exported_at: exportedAt,
      proxies: [],
      accounts: value.map((item, index) => parseImportAccountRecord(item, index, exportedAt))
    }
  }

  const record = asRecord(value)
  if (!record) {
    return null
  }

  if (!hasCredentialsRecord(record) && !hasNestedTokens(record) && !hasTopLevelTokens(record)) {
    return null
  }

  const exportedAt =
    normalizeIsoTimestamp(record['exported_at']) ??
    normalizeIsoTimestamp(record['last_refresh']) ??
    new Date().toISOString()

  return {
    exported_at: exportedAt,
    proxies: [],
    accounts: [parseImportAccountRecord(record, 0, exportedAt)]
  }
}

export function parseTemplateFileRecord(raw: string): TemplateFileRecord {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid account template file.')
  }

  const record = asRecord(parsed)
  if (record?.['accounts'] != null) {
    return parseGroupedImportRecord(record)
  }

  const flatRecord = parseFlatImportRecord(parsed)
  if (flatRecord) {
    return flatRecord
  }

  throw new Error('Invalid account template file.')
}

export function buildTemplateRateLimits(
  account: TemplateAccountRecord,
  exportedAt: string
): AccountRateLimits | null {
  const extra = account.extra
  if (!extra) {
    return null
  }

  const primaryUsedPercent = extra.codex_primary_used_percent ?? extra.codex_5h_used_percent
  const secondaryUsedPercent = extra.codex_secondary_used_percent ?? extra.codex_7d_used_percent
  const primaryWindowMinutes = extra.codex_primary_window_minutes ?? extra.codex_5h_window_minutes
  const secondaryWindowMinutes =
    extra.codex_secondary_window_minutes ?? extra.codex_7d_window_minutes
  const primaryResetsAt = resolveWindowResetAt(
    extra.codex_primary_reset_at ?? extra.codex_5h_reset_at,
    extra.codex_primary_reset_after_seconds ?? extra.codex_5h_reset_after_seconds,
    exportedAt
  )
  const secondaryResetsAt = resolveWindowResetAt(
    extra.codex_secondary_reset_at ?? extra.codex_7d_reset_at,
    extra.codex_secondary_reset_after_seconds ?? extra.codex_7d_reset_after_seconds,
    exportedAt
  )
  const hasPrimary =
    primaryUsedPercent != null || primaryWindowMinutes != null || primaryResetsAt != null
  const hasSecondary =
    secondaryUsedPercent != null || secondaryWindowMinutes != null || secondaryResetsAt != null

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  const primary = buildRateLimitWindow(
    primaryUsedPercent,
    primaryWindowMinutes,
    primaryResetsAt,
    hasPrimary
  )
  const secondary = buildRateLimitWindow(
    secondaryUsedPercent,
    secondaryWindowMinutes,
    secondaryResetsAt,
    hasSecondary
  )
  const planType = account.credentials.plan_type ?? null
  const fetchedAt = extra.codex_usage_updated_at ?? exportedAt

  return {
    limitId: 'codex',
    limitName: null,
    planType,
    primary,
    secondary,
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: null
    },
    limits: [
      {
        limitId: 'codex',
        limitName: null,
        planType,
        primary,
        secondary
      }
    ],
    fetchedAt
  }
}

export function buildAuthPayloadFromTemplate(
  account: TemplateAccountRecord,
  exportedAt: string
): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: account.last_refresh ?? exportedAt,
    tokens: {
      access_token: readRequiredString(
        account.credentials?.access_token,
        'credentials.access_token'
      ),
      refresh_token: readOptionalString(account.credentials?.refresh_token),
      id_token: readRequiredString(account.credentials?.id_token, 'credentials.id_token'),
      account_id: readRequiredString(
        account.credentials?.chatgpt_account_id,
        'credentials.chatgpt_account_id'
      )
    }
  }
}

export {
  type JsonRecord,
  type ResolvedExportAccount,
  normalizeIsoTimestamp,
  readRequiredString,
  readOptionalString,
  toEpochSeconds,
  toIsoFromEpochSeconds,
  toIsoFromJwtExp,
  resolveOpenAiAuthStringClaimFromTokens,
  OPENAI_OAUTH_CLIENT_ID,
  DEFAULT_ACCOUNT_NOTES,
  DEFAULT_ACCOUNT_PLATFORM,
  DEFAULT_ACCOUNT_TYPE,
  DEFAULT_ACCOUNT_CONCURRENCY,
  DEFAULT_ACCOUNT_PRIORITY,
  DEFAULT_ACCOUNT_RATE_MULTIPLIER,
  DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED,
  DEFAULT_PRIVACY_MODE,
  SUB2API_DATA_TYPE,
  SUB2API_DATA_VERSION
}
