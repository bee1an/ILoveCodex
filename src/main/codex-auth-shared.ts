import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import type { Server } from 'node:http'
import { promisify } from 'node:util'

import type {
  AccountTag,
  AccountRateLimits,
  AccountWakeSchedule,
  AccountSummary,
  AppSettings,
  LoginMethod,
  PortOccupant
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'
import {
  decodeJwtPayload,
  resolveChatGptAccountIdFromTokens
} from '../shared/openai-auth'
import { defaultStatsDisplaySettings, normalizeStatsDisplaySettings } from '../shared/codex'

export interface CodexAuthPayload {
  auth_mode?: string
  OPENAI_API_KEY?: string | null
  last_refresh?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    account_id?: string
  }
}

interface PersistedAccount extends AccountSummary {
  authPayload: ProtectedPayload
}

interface PersistedState {
  version: 3
  activeAccountId?: string
  accounts: PersistedAccount[]
  tags: AccountTag[]
  settings: AppSettings
  usageByAccountId: Record<string, AccountRateLimits>
  usageErrorByAccountId: Record<string, string>
  wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
}

interface LegacyPersistedState {
  version?: 1 | 2
  activeAccountId?: string
  accounts?: PersistedAccount[]
  tags?: AccountTag[]
  settings?: AppSettings
  usageByAccountId?: Record<string, AccountRateLimits>
  usageErrorByAccountId?: Record<string, string>
  wakeSchedulesByAccountId?: Record<string, AccountWakeSchedule>
}

function defaultSettings(): AppSettings {
  return {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light',
    checkForUpdatesOnStartup: true,
    codexDesktopExecutablePath: '',
    showLocalMockData: true,
    statsDisplay: defaultStatsDisplaySettings()
  }
}

interface LoginSession {
  attemptId: string
  method: LoginMethod
  server?: Server
  abortController?: AbortController
  rawOutput: string
  cancelled: boolean
  authUrl?: string
  redirectUri?: string
  verificationUrl?: string
  userCode?: string
}

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com'
const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const OPENAI_AUTHORIZE_URL = `${OPENAI_AUTH_ISSUER}/oauth/authorize`
const OPENAI_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/oauth/token`
const OPENAI_DEVICE_CODE_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`
const OPENAI_DEVICE_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_AUTH_ISSUER}/deviceauth/callback`
const OPENAI_CALLBACK_PORT = 1455
const execFile = promisify(execFileCallback)

function defaultState(): PersistedState {
  return {
    version: 3,
    accounts: [],
    tags: [],
    settings: defaultSettings(),
    usageByAccountId: {},
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {}
  }
}

function normalizeWakeSchedule(
  schedule?: Partial<AccountWakeSchedule> | null
): AccountWakeSchedule | null {
  if (!schedule) {
    return null
  }

  const times = [...new Set((schedule.times ?? []).map((value) => value.trim()).filter(Boolean))]
    .filter((value) => /^\d{2}:\d{2}$/.test(value))
    .sort()

  return {
    enabled: Boolean(schedule.enabled),
    times,
    model: schedule.model?.trim() || 'gpt-5.4',
    prompt: schedule.prompt?.trim() || 'ping',
    lastTriggeredAt: schedule.lastTriggeredAt,
    lastSucceededAt: schedule.lastSucceededAt,
    lastStatus: schedule.lastStatus ?? 'idle',
    lastMessage: schedule.lastMessage?.trim() || undefined
  }
}

function normalizePersistedState(parsed: PersistedState | LegacyPersistedState): PersistedState {
  return {
    ...defaultState(),
    ...parsed,
    version: 3,
    accounts: (parsed.accounts ?? []).map((account) => ({
      ...account,
      tagIds: dedupeAccountTagIds(account.tagIds ?? [])
    })),
    tags: parsed.tags ?? [],
    settings: {
      ...defaultSettings(),
      ...('settings' in parsed ? parsed.settings : {}),
      statsDisplay: normalizeStatsDisplaySettings(parsed.settings?.statsDisplay)
    },
    usageByAccountId: parsed.usageByAccountId ?? {},
    usageErrorByAccountId: parsed.usageErrorByAccountId ?? {},
    wakeSchedulesByAccountId: Object.fromEntries(
      Object.entries(parsed.wakeSchedulesByAccountId ?? {})
        .map(([accountId, schedule]) => [accountId, normalizeWakeSchedule(schedule)])
        .filter((entry): entry is [string, AccountWakeSchedule] => Boolean(entry[1]))
    )
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function dedupeAccountTagIds(tagIds: string[]): string[] {
  return [...new Set(tagIds)]
}

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url')
}

function createPkceVerifier(): string {
  return base64UrlEncode(randomBytes(48))
}

function createPkceChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest())
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
}

function buildAuthorizeUrl(redirectUri: string, codeChallenge: string, state: string): string {
  const query = [
    ['response_type', 'code'],
    ['client_id', OPENAI_OAUTH_CLIENT_ID],
    ['redirect_uri', redirectUri],
    ['scope', OPENAI_OAUTH_SCOPE],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
    ['id_token_add_organizations', 'true'],
    ['codex_cli_simplified_flow', 'true'],
    ['state', state],
    ['originator', 'Codex Desktop']
  ]
    .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
    .join('&')

  return `${OPENAI_AUTHORIZE_URL}?${query}`
}

function parseTokenEndpointError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: string
      error_description?: string
      message?: string
    }
    return parsed.error_description ?? parsed.message ?? parsed.error ?? raw.trim()
  } catch {
    return raw.trim()
  }
}

interface TokenEndpointPayload {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

export async function getOpenAiCallbackPortOccupant(): Promise<PortOccupant | null> {
  try {
    const { stdout } = await execFile('lsof', [
      '-nP',
      `-iTCP:${OPENAI_CALLBACK_PORT}`,
      '-sTCP:LISTEN'
    ])
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length < 2) {
      return null
    }

    const columns = lines[1].split(/\s+/)
    const command = columns[0]
    const pid = Number(columns[1])
    if (!command || Number.isNaN(pid)) {
      return null
    }

    return { pid, command }
  } catch {
    return null
  }
}

export async function killOpenAiCallbackPortOccupant(): Promise<PortOccupant | null> {
  const occupant = await getOpenAiCallbackPortOccupant()
  if (!occupant) {
    return null
  }

  process.kill(occupant.pid, 'SIGTERM')
  return occupant
}

function buildAuthPayloadFromTokenResponse(tokens: TokenEndpointPayload): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      account_id: resolveChatGptAccountIdFromTokens(tokens.id_token, tokens.access_token)
    }
  }
}

export async function refreshCodexAuthPayload(
  auth: CodexAuthPayload,
  platform: CodexPlatformAdapter,
  signal?: AbortSignal
): Promise<CodexAuthPayload> {
  const refreshToken = auth.tokens?.refresh_token
  if (!refreshToken) {
    throw new Error('Missing refresh token required for token refresh.')
  }

  const body = [
    ['grant_type', 'refresh_token'],
    ['refresh_token', refreshToken],
    ['client_id', OPENAI_OAUTH_CLIENT_ID]
  ]
    .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
    .join('&')

  const response = await platform.fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal
  })
  const raw = await response.text()

  if (!response.ok) {
    const detail = parseTokenEndpointError(raw)
    throw new Error(`OpenAI token refresh failed (${response.status}): ${detail}`)
  }

  const parsed = JSON.parse(raw) as TokenEndpointPayload

  return buildAuthPayloadFromTokenResponse({
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token ?? refreshToken,
    id_token: parsed.id_token
  })
}

function summarizeAuth(
  auth: CodexAuthPayload
): Pick<AccountSummary, 'email' | 'name' | 'accountId'> {
  const payload = decodeJwtPayload(auth.tokens?.id_token)
  const email = typeof payload.email === 'string' ? payload.email : undefined
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const accountId = extractChatGptAccountId(auth)

  return {
    email,
    name,
    accountId
  }
}

function authIdentityFingerprint(auth: CodexAuthPayload): string | undefined {
  const source =
    auth.tokens?.refresh_token ?? auth.tokens?.id_token ?? auth.tokens?.access_token ?? undefined

  if (!source) {
    return undefined
  }

  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}

function resolveSubject(auth: CodexAuthPayload): string | undefined {
  const identityPayloads = [
    decodeJwtPayload(auth.tokens?.id_token),
    decodeJwtPayload(auth.tokens?.access_token)
  ]
  return identityPayloads
    .map((payload) => (typeof payload.sub === 'string' ? payload.sub : undefined))
    .find(Boolean)
}

function resolveAccountId(auth: CodexAuthPayload): string {
  const summary = summarizeAuth(auth)
  const subject = resolveSubject(auth)
  const fingerprint = authIdentityFingerprint(auth)

  if (subject && summary.accountId) {
    return `${subject}:${summary.accountId}`
  }

  return summary.accountId ?? subject ?? fingerprint ?? randomUUID()
}

function extractChatGptAccountId(auth: CodexAuthPayload): string | undefined {
  return resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id
  )
}

function findMatchingAccount(
  accounts: PersistedAccount[],
  auth: CodexAuthPayload
): PersistedAccount | undefined {
  const summary = summarizeAuth(auth)
  const identity = resolveAccountId(auth)
  const subject = resolveSubject(auth)

  return accounts.find((account) => {
    if (account.id === identity) {
      return true
    }

    // Legacy compatibility: older entries may have used account_id or sub alone.
    if (summary.email && summary.accountId) {
      return (
        account.id === summary.accountId &&
        account.accountId === summary.accountId &&
        account.email === summary.email
      )
    }

    if (summary.email && subject) {
      return account.id === subject && account.email === summary.email
    }

    return false
  })
}

function toAccountSummary(account: PersistedAccount): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    accountId: account.accountId,
    tagIds: account.tagIds,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastUsedAt: account.lastUsedAt
  }
}

export type {
  LegacyPersistedState,
  LoginSession,
  PersistedAccount,
  PersistedState,
  TokenEndpointPayload
}
export {
  buildAuthPayloadFromTokenResponse,
  buildAuthorizeUrl,
  defaultSettings,
  defaultState,
  dedupeAccountTagIds,
  describeError,
  encodeFormComponent,
  extractChatGptAccountId,
  findMatchingAccount,
  normalizePersistedState,
  normalizeTagName,
  normalizeWakeSchedule,
  parseTokenEndpointError,
  resolveAccountId,
  resolveSubject,
  summarizeAuth,
  toAccountSummary,
  authIdentityFingerprint,
  createPkceChallenge,
  createPkceVerifier,
  base64UrlEncode,
  OPENAI_AUTH_ISSUER,
  OPENAI_AUTHORIZE_URL,
  OPENAI_CALLBACK_PORT,
  OPENAI_DEVICE_CODE_URL,
  OPENAI_DEVICE_REDIRECT_URI,
  OPENAI_DEVICE_TOKEN_URL,
  OPENAI_DEVICE_VERIFICATION_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_SCOPE,
  OPENAI_TOKEN_URL
}
