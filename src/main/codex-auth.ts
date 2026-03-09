import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  AccountTag,
  AccountRateLimits,
  AccountSummary,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  LoginAttempt,
  LoginEvent,
  LoginMethod,
  PortOccupant
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'

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
}

interface LegacyPersistedState {
  version?: 1 | 2
  activeAccountId?: string
  accounts?: PersistedAccount[]
  tags?: AccountTag[]
  settings?: AppSettings
  usageByAccountId?: Record<string, AccountRateLimits>
}

function defaultSettings(): AppSettings {
  return {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light'
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
    usageByAccountId: {}
  }
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

function decodeJwtPayload(token?: string): Record<string, unknown> {
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

function extractChatGptAccountIdFromTokens(idToken?: string, accessToken?: string): string | undefined {
  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]
  for (const payload of claims) {
    const authClaim = payload['https://api.openai.com/auth']
    if (
      authClaim &&
      typeof authClaim === 'object' &&
      'chatgpt_account_id' in authClaim &&
      typeof authClaim.chatgpt_account_id === 'string'
    ) {
      return authClaim.chatgpt_account_id
    }
  }

  return undefined
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
      account_id: extractChatGptAccountIdFromTokens(tokens.id_token, tokens.access_token)
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
  const identityPayloads = [decodeJwtPayload(auth.tokens?.id_token), decodeJwtPayload(auth.tokens?.access_token)]
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
  if (auth.tokens?.account_id) {
    return auth.tokens.account_id
  }

  return extractChatGptAccountIdFromTokens(auth.tokens?.id_token, auth.tokens?.access_token)
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

export class CodexAccountStore {
  private readonly stateFile: string
  private readonly codexAuthFile: string

  constructor(
    userDataPath: string,
    private readonly platform: CodexPlatformAdapter
  ) {
    this.stateFile = join(userDataPath, 'codex-accounts.json')
    this.codexAuthFile = join(homedir(), '.codex', 'auth.json')
  }

  async getSnapshot(loginInProgress: boolean): Promise<AppSnapshot> {
    const state = await this.readState()
    const currentSession = await this.getCurrentSession(state)
    const resolvedActiveAccountId = currentSession?.storedAccountId

    if (state.activeAccountId !== resolvedActiveAccountId) {
      state.activeAccountId = resolvedActiveAccountId
      await this.writeState(state)
    }

    return {
      accounts: state.accounts.map(toAccountSummary),
      tags: state.tags,
      activeAccountId: resolvedActiveAccountId,
      currentSession,
      loginInProgress,
      settings: state.settings,
      usageByAccountId: state.usageByAccountId
    }
  }

  async updateSettings(nextSettings: Partial<AppSettings>): Promise<void> {
    const state = await this.readState()
    state.settings = {
      ...state.settings,
      ...nextSettings,
      statusBarAccountIds: (
        nextSettings.statusBarAccountIds ?? state.settings.statusBarAccountIds
      ).slice(0, 5)
    }
    await this.writeState(state)
  }

  async saveAccountRateLimits(accountId: string, rateLimits: AccountRateLimits): Promise<void> {
    const state = await this.readState()

    if (!state.accounts.some((account) => account.id === accountId)) {
      throw new Error('Account not found.')
    }

    state.usageByAccountId = {
      ...state.usageByAccountId,
      [accountId]: rateLimits
    }
    await this.writeState(state)
  }

  async createTag(name: string): Promise<AccountTag> {
    const state = await this.readState()
    const normalizedName = normalizeTagName(name)

    if (!normalizedName) {
      throw new Error('Tag name is required.')
    }

    if (state.tags.some((tag) => tag.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
      throw new Error('Tag name already exists.')
    }

    const now = new Date().toISOString()
    const tag: AccountTag = {
      id: randomUUID(),
      name: normalizedName,
      createdAt: now,
      updatedAt: now
    }

    state.tags = [...state.tags, tag]
    await this.writeState(state)
    return tag
  }

  async updateTag(tagId: string, name: string): Promise<AccountTag> {
    const state = await this.readState()
    const tag = state.tags.find((item) => item.id === tagId)
    const normalizedName = normalizeTagName(name)

    if (!tag) {
      throw new Error('Tag not found.')
    }

    if (!normalizedName) {
      throw new Error('Tag name is required.')
    }

    if (
      state.tags.some(
        (item) =>
          item.id !== tagId &&
          item.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
      )
    ) {
      throw new Error('Tag name already exists.')
    }

    tag.name = normalizedName
    tag.updatedAt = new Date().toISOString()
    await this.writeState(state)
    return tag
  }

  async deleteTag(tagId: string): Promise<void> {
    const state = await this.readState()

    if (!state.tags.some((tag) => tag.id === tagId)) {
      throw new Error('Tag not found.')
    }

    state.tags = state.tags.filter((tag) => tag.id !== tagId)
    state.accounts = state.accounts.map((account) => ({
      ...account,
      tagIds: account.tagIds.filter((item) => item !== tagId)
    }))

    await this.writeState(state)
  }

  async importCurrentAuth(): Promise<void> {
    const auth = await this.readCodexAuthFile()
    await this.upsertAccount(auth, true)
  }

  async importAuthPayload(auth: CodexAuthPayload): Promise<AccountSummary> {
    return this.upsertAccount(auth, false)
  }

  async activateAccount(accountId: string): Promise<void> {
    const state = await this.readState()
    const account = state.accounts.find((item) => item.id === accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    const rawAuth = this.unprotect(account.authPayload)
    const parsed = JSON.parse(rawAuth) as CodexAuthPayload

    await this.writeCodexAuthFile(parsed)

    const now = new Date().toISOString()
    state.activeAccountId = accountId
    state.accounts = state.accounts.map((item) =>
      item.id === accountId
        ? {
            ...item,
            lastUsedAt: now,
            updatedAt: now
          }
        : item
    )

    await this.writeState(state)
  }

  async getStoredAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    return this.getStoredAuth(accountId)
  }

  async getAccountSummary(accountId: string): Promise<AccountSummary> {
    const state = await this.readState()
    const account = state.accounts.find((item) => item.id === accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    return toAccountSummary(account)
  }

  async updateAccountTags(accountId: string, tagIds: string[]): Promise<void> {
    const state = await this.readState()
    const account = state.accounts.find((item) => item.id === accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    const nextTagIds = dedupeAccountTagIds(tagIds)
    if (!nextTagIds.every((tagId) => state.tags.some((tag) => tag.id === tagId))) {
      throw new Error('One or more tags do not exist.')
    }

    account.tagIds = nextTagIds
    account.updatedAt = new Date().toISOString()
    await this.writeState(state)
  }

  async removeAccount(accountId: string): Promise<void> {
    const state = await this.readState()
    state.accounts = state.accounts.filter((item) => item.id !== accountId)

    if (state.activeAccountId === accountId) {
      state.activeAccountId = undefined
    }

    await this.writeState(state)
  }

  async reorderAccounts(accountIds: string[]): Promise<void> {
    const state = await this.readState()

    if (accountIds.length !== state.accounts.length) {
      throw new Error('Account reorder payload does not match saved accounts.')
    }

    const accountsById = new Map(state.accounts.map((account) => [account.id, account]))
    const reorderedAccounts = accountIds.map((accountId) => {
      const account = accountsById.get(accountId)
      if (!account) {
        throw new Error(`Account not found: ${accountId}`)
      }

      accountsById.delete(accountId)
      return account
    })

    if (accountsById.size) {
      throw new Error('Account reorder payload is missing saved accounts.')
    }

    state.accounts = reorderedAccounts
    await this.writeState(state)
  }

  private async getCurrentSession(state: PersistedState): Promise<CurrentSessionSummary | null> {
    try {
      const auth = await this.readCodexAuthFile()
      const summary = summarizeAuth(auth)
      const storedAccountId = findMatchingAccount(state.accounts, auth)?.id

      return {
        email: summary.email,
        name: summary.name,
        accountId: summary.accountId,
        lastRefresh: auth.last_refresh,
        storedAccountId
      }
    } catch {
      return null
    }
  }

  private async upsertAccount(
    auth: CodexAuthPayload,
    makeActive: boolean
  ): Promise<AccountSummary> {
    const state = await this.readState()
    const identity = resolveAccountId(auth)
    const summary = summarizeAuth(auth)
    const now = new Date().toISOString()
    const payload = this.protect(JSON.stringify(auth))
    const existing = findMatchingAccount(state.accounts, auth)

    if (existing) {
      const previousId = existing.id
      if (previousId !== identity) {
        if (state.activeAccountId === previousId) {
          state.activeAccountId = identity
        }

        state.settings.statusBarAccountIds = state.settings.statusBarAccountIds.map((accountId) =>
          accountId === previousId ? identity : accountId
        )

        if (state.usageByAccountId[previousId]) {
          state.usageByAccountId = {
            ...state.usageByAccountId,
            [identity]: state.usageByAccountId[previousId]
          }
          delete state.usageByAccountId[previousId]
        }
      }

      existing.id = identity
      existing.email = summary.email
      existing.name = summary.name
      existing.accountId = summary.accountId
      existing.tagIds = dedupeAccountTagIds(existing.tagIds ?? [])
      existing.updatedAt = now
      existing.authPayload = payload
      if (makeActive) {
        existing.lastUsedAt = now
      }
    } else {
      state.accounts.unshift({
        id: identity,
        email: summary.email,
        name: summary.name,
        accountId: summary.accountId,
        tagIds: [],
        createdAt: now,
        updatedAt: now,
        lastUsedAt: makeActive ? now : undefined,
        authPayload: payload
      })
    }

    if (makeActive) {
      state.activeAccountId = identity
    }

    await this.writeState(state)
    const persistedAccount =
      existing ?? state.accounts.find((account) => account.id === identity) ?? null
    if (!persistedAccount) {
      throw new Error('Failed to persist account.')
    }

    return toAccountSummary(persistedAccount)
  }

  private protect(value: string): ProtectedPayload {
    return this.platform.protect(value)
  }

  private unprotect(payload: ProtectedPayload): string {
    return this.platform.unprotect(payload)
  }

  private async readCodexAuthFile(): Promise<CodexAuthPayload> {
    const raw = await fs.readFile(this.codexAuthFile, 'utf8')
    return JSON.parse(raw) as CodexAuthPayload
  }

  private async getStoredAuth(accountId: string): Promise<CodexAuthPayload> {
    const state = await this.readState()
    const account = state.accounts.find((item) => item.id === accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    return JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
  }

  private async readState(): Promise<PersistedState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8')
      const parsed = JSON.parse(raw) as PersistedState | LegacyPersistedState

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
          ...('settings' in parsed ? parsed.settings : {})
        },
        usageByAccountId: parsed.usageByAccountId ?? {}
      }
    } catch {
      return defaultState()
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    await fs.mkdir(dirname(this.stateFile), { recursive: true })
    await fs.writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  private async writeCodexAuthFile(auth: CodexAuthPayload): Promise<void> {
    await fs.mkdir(join(homedir(), '.codex'), { recursive: true })
    await fs.writeFile(this.codexAuthFile, `${JSON.stringify(auth, null, 2)}\n`, 'utf8')
  }
}

export class CodexLoginCoordinator {
  private currentSession?: LoginSession

  constructor(
    private readonly store: CodexAccountStore,
    private readonly emit: (event: LoginEvent) => void,
    private readonly platform: CodexPlatformAdapter
  ) {}

  isRunning(): boolean {
    return Boolean(this.currentSession)
  }

  async start(method: LoginMethod): Promise<LoginAttempt> {
    if (this.currentSession) {
      if (this.currentSession.method === method) {
        this.emitCurrentSession(this.currentSession)
        return {
          attemptId: this.currentSession.attemptId,
          method
        }
      }

      await this.cancelAndWait()
    }

    return method === 'device' ? this.startDeviceLogin() : this.startBrowserLogin()
  }

  async cancel(): Promise<void> {
    if (!this.currentSession) {
      return
    }

    const session = this.currentSession
    session.cancelled = true
    session.abortController?.abort()

    if (session.server) {
      await this.closeServer(session.server)
    }

    this.currentSession = undefined
  }

  private emitCurrentSession(session: LoginSession): void {
    const phase =
      session.authUrl || session.redirectUri || session.verificationUrl || session.userCode
        ? 'waiting'
        : 'starting'

    this.emit({
      attemptId: session.attemptId,
      method: session.method,
      phase,
      message:
        phase === 'waiting'
          ? session.method === 'device'
            ? 'Open the verification page and enter the device code.'
            : 'Browser login is waiting for the OpenAI callback.'
          : session.method === 'device'
            ? 'Started device code login.'
            : 'Started browser callback login.',
      authUrl: session.authUrl,
      localCallbackUrl: session.redirectUri,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      rawOutput: session.rawOutput
    })
  }

  private async startBrowserLogin(): Promise<LoginAttempt> {
    const attemptId = randomUUID()
    const state = base64UrlEncode(randomBytes(24))
    const codeVerifier = createPkceVerifier()
    const codeChallenge = createPkceChallenge(codeVerifier)
    const abortController = new AbortController()
    const server = createServer()
    const session: LoginSession = {
      attemptId,
      method: 'browser',
      server,
      abortController,
      rawOutput: '',
      cancelled: false
    }

    this.currentSession = session
    this.emit({
      attemptId,
      method: 'browser',
      phase: 'starting',
      message: 'Started browser callback login.'
    })

    const authCompletion = new Promise<void>((resolve, reject) => {
      server.on('request', (request, response) => {
        if (!request.url) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Missing request URL.')
          return
        }

        const callbackUrl = new URL(request.url, 'http://localhost')
        if (callbackUrl.pathname !== '/auth/callback') {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Not found.')
          return
        }

        if (callbackUrl.searchParams.get('state') !== state) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Invalid OAuth state.')
          reject(new Error('Invalid OAuth state returned from OpenAI.'))
          return
        }

        const code = callbackUrl.searchParams.get('code')
        const error = callbackUrl.searchParams.get('error')
        if (error) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          response.end(
            '<h1>Login failed</h1><p>You can close this window and return to Ilovecodex.</p>'
          )
          reject(new Error(`OpenAI login failed: ${error}`))
          return
        }

        if (!code) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Missing authorization code.')
          reject(new Error('OpenAI did not return an authorization code.'))
          return
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(
          '<h1>Login complete</h1><p>You can close this tab and return to Ilovecodex.</p>'
        )

        void this.finishBrowserLogin(attemptId, code, codeVerifier, abortController.signal)
          .then(resolve)
          .catch(reject)
      })
    })
    void authCompletion.catch(() => undefined)

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(OPENAI_CALLBACK_PORT, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Failed to start the local OAuth callback server.')
      }

      const localCallbackUrl = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`
      const authUrl = buildAuthorizeUrl(localCallbackUrl, codeChallenge, state)
      session.authUrl = authUrl
      session.redirectUri = localCallbackUrl

      session.rawOutput = `${authUrl}\n${localCallbackUrl}\n`
      this.emit({
        attemptId,
        method: 'browser',
        phase: 'waiting',
        message: 'Browser login is waiting for the OpenAI callback.',
        authUrl,
        localCallbackUrl,
        rawOutput: session.rawOutput
      })
    } catch (error) {
      if (this.currentSession?.attemptId === attemptId) {
        this.currentSession = undefined
      }
      if (server.listening) {
        await this.closeServer(server)
      }
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') {
        const occupant = await getOpenAiCallbackPortOccupant()
        if (occupant) {
          throw new Error(
            `1455 端口已被 ${occupant.command} (${occupant.pid}) 占用，请先结束该进程。`
          )
        }

        throw new Error('1455 端口已被占用，请先释放后再发起浏览器登录。')
      }
      throw error
    }

    void authCompletion.catch(async (error) => {
      if (this.currentSession?.attemptId !== attemptId) {
        return
      }

      this.currentSession = undefined
      await this.closeServer(server)
      this.emit({
        attemptId,
        method: 'browser',
        phase: session.cancelled ? 'cancelled' : 'error',
        message: session.cancelled
          ? 'Cancelled login flow.'
          : error instanceof Error
            ? error.message
            : 'Browser login failed.',
        rawOutput: session.rawOutput,
        snapshot: await this.store.getSnapshot(false)
      })
    })

    return { attemptId, method: 'browser' }
  }

  private async startDeviceLogin(): Promise<LoginAttempt> {
    const attemptId = randomUUID()
    const abortController = new AbortController()
    const session: LoginSession = {
      attemptId,
      method: 'device',
      abortController,
      rawOutput: '',
      cancelled: false
    }

    this.currentSession = session
    this.emit({
      attemptId,
      method: 'device',
      phase: 'starting',
      message: 'Started device code login.'
    })

    try {
      const challenge = await this.requestDeviceCode(abortController.signal)
      if (this.currentSession?.attemptId !== attemptId) {
        return { attemptId, method: 'device' }
      }

      session.verificationUrl = challenge.verificationUrl
      session.userCode = challenge.userCode
      session.rawOutput = `${challenge.verificationUrl}\n${challenge.userCode}\n`

      this.emit({
        attemptId,
        method: 'device',
        phase: 'waiting',
        message: 'Open the verification page and enter the device code.',
        verificationUrl: challenge.verificationUrl,
        userCode: challenge.userCode,
        rawOutput: session.rawOutput
      })

      void this.finishDeviceLogin(attemptId, challenge, abortController.signal).catch(async (error) => {
        if (this.currentSession?.attemptId !== attemptId) {
          return
        }

        this.currentSession = undefined
        this.emit({
          attemptId,
          method: 'device',
          phase: session.cancelled ? 'cancelled' : 'error',
          message: session.cancelled
            ? 'Cancelled login flow.'
            : error instanceof Error
              ? error.message
              : 'Device code login failed.',
          verificationUrl: session.verificationUrl,
          userCode: session.userCode,
          rawOutput: session.rawOutput,
          snapshot: await this.store.getSnapshot(false)
        })
      })
    } catch (error) {
      if (this.currentSession?.attemptId === attemptId) {
        this.currentSession = undefined
      }
      throw error
    }

    return { attemptId, method: 'device' }
  }

  private async cancelAndWait(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      return
    }

    session.cancelled = true
    session.abortController?.abort()

    if (session.server) {
      await this.closeServer(session.server)
    }

    this.currentSession = undefined
  }

  private async finishBrowserLogin(
    attemptId: string,
    code: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<void> {
    const session = this.currentSession
    if (!session || session.attemptId !== attemptId) {
      return
    }

    const server = session.server
    if (!server || !session.redirectUri) {
      throw new Error('The local OAuth callback server is unavailable.')
    }

    const auth = await this.exchangeBrowserCode(code, codeVerifier, session.redirectUri, signal)
    await this.store.importAuthPayload(auth)

    this.currentSession = undefined
    await this.closeServer(server)
    this.emit({
      attemptId,
      method: 'browser',
      phase: 'success',
      message: 'Saved the new browser login to the local account vault.',
      rawOutput: session.rawOutput,
      snapshot: await this.store.getSnapshot(false)
    })
  }

  private async exchangeBrowserCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    signal: AbortSignal
  ): Promise<CodexAuthPayload> {
    const body = [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', redirectUri],
      ['client_id', OPENAI_OAUTH_CLIENT_ID],
      ['code_verifier', codeVerifier]
    ]
      .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
      .join('&')

    const response = await this.platform.fetch(OPENAI_TOKEN_URL, {
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
      throw new Error(`OpenAI token exchange failed (${response.status}): ${detail}`)
    }

    return buildAuthPayloadFromTokenResponse(JSON.parse(raw) as TokenEndpointPayload)
  }

  private async requestDeviceCode(
    signal: AbortSignal
  ): Promise<{
    deviceAuthId: string
    userCode: string
    verificationUrl: string
    intervalSeconds: number
  }> {
    const response = await this.platform.fetch(OPENAI_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: OPENAI_OAUTH_CLIENT_ID
      }),
      signal
    })
    const raw = await response.text()

    if (!response.ok) {
      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI device code request failed (${response.status}): ${detail}`)
    }

    const parsed = JSON.parse(raw) as {
      device_auth_id?: string
      user_code?: string
      interval?: number
    }

    if (!parsed.device_auth_id || !parsed.user_code) {
      throw new Error('OpenAI device code response is missing required fields.')
    }

    return {
      deviceAuthId: parsed.device_auth_id,
      userCode: parsed.user_code,
      verificationUrl: OPENAI_DEVICE_VERIFICATION_URL,
      intervalSeconds: Math.max(1, parsed.interval ?? 5)
    }
  }

  private async finishDeviceLogin(
    attemptId: string,
    challenge: {
      deviceAuthId: string
      userCode: string
      verificationUrl: string
      intervalSeconds: number
    },
    signal: AbortSignal
  ): Promise<void> {
    const session = this.currentSession
    if (!session || session.attemptId !== attemptId) {
      return
    }

    const tokenExchange = await this.pollDeviceAuthorization(challenge, signal)
    const auth = await this.exchangeDeviceCode(
      tokenExchange.authorizationCode,
      tokenExchange.codeVerifier,
      signal
    )
    await this.store.importAuthPayload(auth)

    this.currentSession = undefined
    this.emit({
      attemptId,
      method: 'device',
      phase: 'success',
      message: 'Saved the new device code login to the local account vault.',
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      rawOutput: session.rawOutput,
      snapshot: await this.store.getSnapshot(false)
    })
  }

  private async pollDeviceAuthorization(
    challenge: {
      deviceAuthId: string
      userCode: string
      intervalSeconds: number
    },
    signal: AbortSignal
  ): Promise<{ authorizationCode: string; codeVerifier: string }> {
    while (!signal.aborted) {
      const response = await this.platform.fetch(OPENAI_DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          device_auth_id: challenge.deviceAuthId,
          user_code: challenge.userCode
        }),
        signal
      })
      const raw = await response.text()

      if (response.ok) {
        const parsed = JSON.parse(raw) as {
          authorization_code?: string
          code_verifier?: string
        }

        if (!parsed.authorization_code || !parsed.code_verifier) {
          throw new Error('OpenAI device token response is missing required fields.')
        }

        return {
          authorizationCode: parsed.authorization_code,
          codeVerifier: parsed.code_verifier
        }
      }

      if ([400, 403, 404, 428].includes(response.status)) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, challenge.intervalSeconds * 1000)
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout)
              reject(new Error('Cancelled login flow.'))
            },
            { once: true }
          )
        })
        continue
      }

      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI device token polling failed (${response.status}): ${detail}`)
    }

    throw new Error('Cancelled login flow.')
  }

  private async exchangeDeviceCode(
    code: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<CodexAuthPayload> {
    const body = [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', OPENAI_DEVICE_REDIRECT_URI],
      ['client_id', OPENAI_OAUTH_CLIENT_ID],
      ['code_verifier', codeVerifier]
    ]
      .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
      .join('&')

    const response = await this.platform.fetch(OPENAI_TOKEN_URL, {
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
      throw new Error(`OpenAI token exchange failed (${response.status}): ${detail}`)
    }

    return buildAuthPayloadFromTokenResponse(JSON.parse(raw) as TokenEndpointPayload)
  }

  private async closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
