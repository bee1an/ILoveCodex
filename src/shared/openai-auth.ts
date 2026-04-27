export function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) {
    return {}
  }

  const parts = token.split('.')
  if (parts.length < 2) {
    return {}
  }

  const payload = parts[1]
  const padding = '='.repeat((4 - (payload.length % 4)) % 4)
  const normalized = `${payload}${padding}`.replaceAll('-', '+').replaceAll('_', '/')

  try {
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function resolveJwtStringClaim(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function resolveOpenAiAuthClaim(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload['https://api.openai.com/auth']
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function normalizeOpenAiTimestampClaim(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return normalizeOpenAiTimestampClaim(Number(trimmed))
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

export function resolveOpenAiAuthStringClaimFromTokens(
  idToken: string | undefined,
  accessToken: string | undefined,
  key: string
): string | undefined {
  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]

  for (const payload of claims) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    const resolved = resolveJwtStringClaim(authClaim, key)
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

export function resolveChatGptSubscriptionExpiresAtFromTokens(
  idToken?: string,
  accessToken?: string
): string | undefined {
  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]

  for (const payload of claims) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    const resolved = normalizeOpenAiTimestampClaim(authClaim.chatgpt_subscription_active_until)
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

export function resolveChatGptAccountIdFromTokens(
  idToken?: string,
  accessToken?: string,
  fallbackAccountId?: string
): string | undefined {
  if (fallbackAccountId) {
    return fallbackAccountId
  }

  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]
  for (const payload of claims) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    if (typeof authClaim.chatgpt_account_id === 'string') {
      return authClaim.chatgpt_account_id
    }
  }

  return undefined
}
