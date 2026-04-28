import type { CodexAuthPayload } from './codex-auth'
import type {
  AccountRateLimitEntry,
  AccountRateLimits,
  CreditsSnapshot,
  WakeAccountRequestResult,
  WakeAccountRateLimitsInput
} from '../shared/codex'
import { defaultWakeModel } from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { resolveChatGptAccountIdFromTokens } from '../shared/openai-auth'

interface RateLimitWindowApiPayload {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
  reset_at: number
}

interface RateLimitStatusApiPayload {
  allowed: boolean
  limit_reached: boolean
  primary_window?: RateLimitWindowApiPayload | null
  secondary_window?: RateLimitWindowApiPayload | null
}

interface AdditionalRateLimitApiPayload {
  limit_name: string
  metered_feature: string
  rate_limit?: RateLimitStatusApiPayload | null
}

interface CreditsApiPayload {
  has_credits: boolean
  unlimited: boolean
  balance?: string | null
  approx_local_messages?: number | null
  approx_cloud_messages?: number | null
}

interface RateLimitStatusPayload {
  user_id?: string | null
  account_id?: string | null
  email?: string | null
  plan_type?: string | null
  rate_limit?: RateLimitStatusApiPayload | null
  code_review_rate_limit?: RateLimitStatusApiPayload | null
  credits?: CreditsApiPayload | null
  additional_rate_limits?: AdditionalRateLimitApiPayload[] | null
  promo?: unknown | null
}

interface RateLimitWindowPayload {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

interface RateLimitSnapshotPayload {
  limitId: string | null
  limitName: string | null
  planType: string | null
  primary: RateLimitWindowPayload | null
  secondary: RateLimitWindowPayload | null
  credits: CreditsSnapshot | null
}

export class AccountRateLimitLookupError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AccountRateLimitLookupError'
  }
}

const DEFAULT_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api'
const CHATGPT_HOSTS = ['https://chatgpt.com', 'https://chat.openai.com'] as const
const CODEX_WAKE_MODEL = defaultWakeModel
const CODEX_WAKE_PROMPT = 'ping'
const CODEX_WAKE_INSTRUCTIONS = 'Start or refresh this Codex session timer. Reply briefly.'

function extractErrorDetail(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  if (Array.isArray(value)) {
    const details = value
      .map((entry) => extractErrorDetail(entry))
      .filter((entry): entry is string => Boolean(entry))
    return details.length ? details.join(', ') : null
  }

  const detail = extractErrorDetail((value as { detail?: unknown }).detail)
  if (detail) {
    return detail
  }

  const error = extractErrorDetail((value as { error?: unknown }).error)
  if (error) {
    return error
  }

  const message = extractErrorDetail((value as { message?: unknown }).message)
  if (message) {
    return message
  }

  const code = extractErrorDetail((value as { code?: unknown }).code)
  if (code) {
    return code
  }

  return null
}

function extractResponseErrorDetail(body: string, contentType: string): string | null {
  const normalized = body.trim()
  if (!normalized) {
    return null
  }

  const looksLikeJson =
    contentType.toLowerCase().includes('application/json') ||
    normalized.startsWith('{') ||
    normalized.startsWith('[')

  if (!looksLikeJson) {
    return normalized
  }

  try {
    return extractErrorDetail(JSON.parse(normalized)) ?? normalized
  } catch {
    return normalized
  }
}

function formatWakeResponseBody(body: string, contentType: string): string {
  const normalized = body.trim()
  if (!normalized) {
    return ''
  }

  const looksLikeSse =
    contentType.toLowerCase().includes('text/event-stream') ||
    normalized.startsWith('event:') ||
    normalized.includes('\nevent:')

  if (looksLikeSse) {
    const summary = summarizeWakeSseBody(normalized)
    if (summary) {
      return summary
    }
  }

  const looksLikeJson =
    contentType.toLowerCase().includes('application/json') ||
    normalized.startsWith('{') ||
    normalized.startsWith('[')

  if (!looksLikeJson) {
    return normalized
  }

  try {
    return JSON.stringify(JSON.parse(normalized), null, 2)
  } catch {
    return normalized
  }
}

function summarizeWakeSseBody(body: string): string {
  const eventNames: string[] = []
  const outputChunks: string[] = []
  let completedText = ''
  let responseStatus = ''
  let totalTokens: number | null = null

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('data: ')) {
      continue
    }

    try {
      const payload = JSON.parse(line.slice(6)) as {
        type?: string
        delta?: string
        text?: string
        response?: { status?: string; usage?: { total_tokens?: number | null } | null }
      }

      if (payload.type && !eventNames.includes(payload.type)) {
        eventNames.push(payload.type)
      }

      if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
        outputChunks.push(payload.delta)
      }

      if (payload.type === 'response.output_text.done' && typeof payload.text === 'string') {
        completedText = payload.text.trim()
      }

      if (payload.type === 'response.completed') {
        responseStatus = payload.response?.status ?? responseStatus
        totalTokens =
          typeof payload.response?.usage?.total_tokens === 'number'
            ? payload.response.usage.total_tokens
            : totalTokens
      }
    } catch {
      continue
    }
  }

  const message = completedText || outputChunks.join('').trim()
  const summary: string[] = []

  if (message) {
    summary.push(message)
  }

  if (responseStatus) {
    summary.push(`status: ${responseStatus}`)
  }

  if (typeof totalTokens === 'number') {
    summary.push(`tokens: ${totalTokens}`)
  }

  if (!summary.length && eventNames.length) {
    summary.push(`events: ${eventNames.join(', ')}`)
  }

  return summary.join('\n')
}

function mapRateLimitEntry(payload: RateLimitSnapshotPayload): AccountRateLimitEntry {
  return {
    limitId: payload.limitId,
    limitName: payload.limitName,
    planType: payload.planType,
    primary: payload.primary,
    secondary: payload.secondary
  }
}

function windowMinutesFromSeconds(seconds?: number | null): number | null {
  if (!seconds || seconds <= 0) {
    return null
  }

  return Math.ceil(seconds / 60)
}

function mapRateLimitWindow(
  window?: RateLimitWindowApiPayload | null
): RateLimitWindowPayload | null {
  if (!window) {
    return null
  }

  return {
    usedPercent: window.used_percent,
    windowDurationMins: windowMinutesFromSeconds(window.limit_window_seconds),
    resetsAt: window.reset_at ?? null
  }
}

function mapCredits(credits?: CreditsApiPayload | null): CreditsSnapshot | null {
  if (!credits) {
    return null
  }

  const balance = credits.balance == null ? null : Number(credits.balance)

  return {
    hasCredits: credits.has_credits,
    unlimited: credits.unlimited,
    balance: Number.isFinite(balance) ? balance : null,
    approxLocalMessages:
      typeof credits.approx_local_messages === 'number' ? credits.approx_local_messages : null,
    approxCloudMessages:
      typeof credits.approx_cloud_messages === 'number' ? credits.approx_cloud_messages : null
  }
}

function normalizePlanType(planType?: string | null): string | null {
  switch ((planType ?? '').toLowerCase()) {
    case 'education':
      return 'edu'
    case 'guest':
    case 'free_workspace':
    case 'quorum':
    case 'k12':
      return 'unknown'
    default:
      return planType ?? null
  }
}

function mapSnapshot(
  limitId: string | null,
  limitName: string | null,
  planType: string | null,
  rateLimit?: RateLimitStatusApiPayload | null,
  credits?: CreditsApiPayload | null
): RateLimitSnapshotPayload {
  return {
    limitId,
    limitName,
    planType,
    primary: mapRateLimitWindow(rateLimit?.primary_window),
    secondary: mapRateLimitWindow(rateLimit?.secondary_window),
    credits: mapCredits(credits)
  }
}

function mapRateLimits(payload: RateLimitStatusPayload): AccountRateLimits {
  const planType = normalizePlanType(payload.plan_type)
  const primary = mapSnapshot('codex', null, planType, payload.rate_limit, payload.credits)
  const limits = [
    primary,
    mapSnapshot('code-review', 'Code Review', planType, payload.code_review_rate_limit),
    ...(payload.additional_rate_limits ?? []).map((limit) =>
      mapSnapshot(
        limit.metered_feature ?? null,
        limit.limit_name ?? null,
        planType,
        limit.rate_limit
      )
    )
  ]
    .filter((limit) => limit.primary || limit.secondary || limit.credits)
    .map(mapRateLimitEntry)

  return {
    limitId: primary.limitId,
    limitName: primary.limitName,
    planType: primary.planType,
    primary: primary.primary,
    secondary: primary.secondary,
    credits: primary.credits,
    limits,
    fetchedAt: new Date().toISOString()
  }
}

function extractChatGptAccountId(auth: CodexAuthPayload): string | undefined {
  return resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id
  )
}

function normalizeChatGptBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim()
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  if (
    CHATGPT_HOSTS.some((host) => normalized.startsWith(host)) &&
    !normalized.includes('/backend-api')
  ) {
    normalized = `${normalized}/backend-api`
  }

  return normalized
}

function resolveUsageUrl(): string {
  const configuredBaseUrl = process.env['ILOVECODEX_CHATGPT_BASE_URL'] ?? DEFAULT_CHATGPT_BASE_URL
  const baseUrl = normalizeChatGptBaseUrl(configuredBaseUrl)

  if (baseUrl.includes('/backend-api')) {
    return `${baseUrl}/wham/usage`
  }

  return `${baseUrl}/api/codex/usage`
}

function resolveResponsesUrl(): string {
  const configuredBaseUrl = process.env['ILOVECODEX_CHATGPT_BASE_URL'] ?? DEFAULT_CHATGPT_BASE_URL
  const baseUrl = normalizeChatGptBaseUrl(configuredBaseUrl)

  if (baseUrl.includes('/backend-api')) {
    return `${baseUrl}/codex/responses`
  }

  return `${baseUrl}/api/codex/responses`
}

function buildCodexAuthHeaders(
  accessToken: string,
  chatgptAccountId: string
): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'chatgpt-account-id': chatgptAccountId,
    'user-agent': 'codexdock',
    originator: 'codex_cli_rs'
  }
}

function isRateLimitStatusPayload(value: unknown): value is RateLimitStatusPayload {
  return Boolean(value && typeof value === 'object')
}

export async function readAccountRateLimits(
  auth: CodexAuthPayload,
  platform: Pick<CodexPlatformAdapter, 'fetch'>
): Promise<AccountRateLimits> {
  const accessToken = auth.tokens?.access_token
  const chatgptAccountId = extractChatGptAccountId(auth)

  if (!accessToken) {
    throw new Error('Missing access token required for rate-limit lookup.')
  }

  if (!chatgptAccountId) {
    throw new Error('Missing ChatGPT account id required for rate-limit lookup.')
  }

  const url = resolveUsageUrl()
  const response = await platform.fetch(url, {
    method: 'GET',
    headers: buildCodexAuthHeaders(accessToken, chatgptAccountId),
    signal: AbortSignal.timeout(15000)
  })

  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()

  if (!response.ok) {
    const detail = extractResponseErrorDetail(body, contentType)
    throw new AccountRateLimitLookupError(
      detail ?? `GET ${url} failed (${response.status})`,
      response.status
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Decode error for ${url}: ${error.message}; content-type=${contentType}; body=${body}`
        : `Decode error for ${url}; content-type=${contentType}; body=${body}`
    )
  }

  if (!isRateLimitStatusPayload(payload)) {
    throw new Error(`Unexpected rate-limit payload from ${url}.`)
  }

  return mapRateLimits(payload)
}

export async function wakeAccountRateLimits(
  auth: CodexAuthPayload,
  platform: Pick<CodexPlatformAdapter, 'fetch'>,
  input?: WakeAccountRateLimitsInput
): Promise<WakeAccountRequestResult> {
  const accessToken = auth.tokens?.access_token
  const chatgptAccountId = extractChatGptAccountId(auth)

  if (!accessToken) {
    throw new Error('Missing access token required for rate-limit wake-up.')
  }

  if (!chatgptAccountId) {
    throw new Error('Missing ChatGPT account id required for rate-limit wake-up.')
  }

  const url = resolveResponsesUrl()
  const model = input?.model?.trim() || CODEX_WAKE_MODEL
  const prompt = input?.prompt?.trim() || CODEX_WAKE_PROMPT
  const response = await platform.fetch(url, {
    method: 'POST',
    headers: {
      ...buildCodexAuthHeaders(accessToken, chatgptAccountId),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: CODEX_WAKE_INSTRUCTIONS,
      store: false,
      stream: true,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(15000)
  })

  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()

  if (response.ok || response.status === 429) {
    return {
      status: response.status,
      accepted: true,
      model,
      prompt,
      body: formatWakeResponseBody(body, contentType)
    }
  }

  const detail = extractResponseErrorDetail(body, contentType)
  throw new AccountRateLimitLookupError(
    detail ?? `POST ${url} failed (${response.status})`,
    response.status
  )
}
