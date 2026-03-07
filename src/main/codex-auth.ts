import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AddressInfo } from 'node:net'
import { safeStorage } from 'electron'

import type {
  AccountRateLimits,
  AccountSummary,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  LoginAttempt,
  LoginEvent,
  LoginMethod
} from '../shared/codex'

interface CodexAuthPayload {
  OPENAI_API_KEY?: string | null
  last_refresh?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    account_id?: string
  }
}

interface ProtectedPayload {
  mode: 'safeStorage' | 'plain'
  value: string
}

interface PersistedAccount extends AccountSummary {
  authPayload: ProtectedPayload
}

interface PersistedState {
  version: 2
  activeAccountId?: string
  accounts: PersistedAccount[]
  settings: AppSettings
  usageByAccountId: Record<string, AccountRateLimits>
}

interface LegacyPersistedState {
  version?: 1
  activeAccountId?: string
  accounts?: PersistedAccount[]
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
}

const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'

function defaultState(): PersistedState {
  return {
    version: 2,
    accounts: [],
    settings: defaultSettings(),
    usageByAccountId: {}
  }
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

function summarizeAuth(
  auth: CodexAuthPayload
): Pick<AccountSummary, 'email' | 'name' | 'accountId'> {
  const payload = decodeJwtPayload(auth.tokens?.id_token)
  const email = typeof payload.email === 'string' ? payload.email : undefined
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const accountId = auth.tokens?.account_id

  return {
    email,
    name,
    accountId
  }
}

function resolveAccountId(auth: CodexAuthPayload): string {
  const summary = summarizeAuth(auth)
  const payload = decodeJwtPayload(auth.tokens?.id_token)
  const subject = typeof payload.sub === 'string' ? payload.sub : undefined

  return summary.accountId ?? summary.email ?? subject ?? randomUUID()
}

function toAccountSummary(account: PersistedAccount): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    accountId: account.accountId,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastUsedAt: account.lastUsedAt
  }
}

export class CodexAccountStore {
  private readonly stateFile: string
  private readonly codexAuthFile: string
  private authFileQueue: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
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

  async importCurrentAuth(): Promise<void> {
    const auth = await this.readCodexAuthFile()
    await this.upsertAccount(auth, true)
  }

  async importAuthPayload(auth: CodexAuthPayload): Promise<void> {
    await this.upsertAccount(auth, true)
    await this.writeCodexAuthFile(auth)
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

  async removeAccount(accountId: string): Promise<void> {
    const state = await this.readState()
    state.accounts = state.accounts.filter((item) => item.id !== accountId)

    if (state.activeAccountId === accountId) {
      state.activeAccountId = undefined
    }

    await this.writeState(state)
  }

  async queryAccount<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    return this.withAuthFileLock(async () => {
      const previousRawAuth = await this.readRawCodexAuthFile()
      const nextAuth = await this.getStoredAuth(accountId)

      await this.writeCodexAuthFile(nextAuth)

      try {
        const result = await task()
        const refreshedAuth = await this.readCodexAuthFile()
        await this.upsertAccount(refreshedAuth, false)
        return result
      } finally {
        await this.restoreRawCodexAuth(previousRawAuth)
      }
    })
  }

  private async getCurrentSession(state: PersistedState): Promise<CurrentSessionSummary | null> {
    try {
      const auth = await this.readCodexAuthFile()
      const summary = summarizeAuth(auth)
      const accountId = resolveAccountId(auth)
      const storedAccountId = state.accounts.find((item) => item.id === accountId)?.id

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

  private async upsertAccount(auth: CodexAuthPayload, makeActive: boolean): Promise<void> {
    const state = await this.readState()
    const identity = resolveAccountId(auth)
    const summary = summarizeAuth(auth)
    const now = new Date().toISOString()
    const payload = this.protect(JSON.stringify(auth))
    const existing = state.accounts.find((item) => item.id === identity)

    if (existing) {
      existing.email = summary.email
      existing.name = summary.name
      existing.accountId = summary.accountId
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
  }

  private protect(value: string): ProtectedPayload {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        mode: 'safeStorage',
        value: safeStorage.encryptString(value).toString('base64')
      }
    }

    return {
      mode: 'plain',
      value: Buffer.from(value, 'utf8').toString('base64')
    }
  }

  private unprotect(payload: ProtectedPayload): string {
    if (payload.mode === 'safeStorage') {
      return safeStorage.decryptString(Buffer.from(payload.value, 'base64'))
    }

    return Buffer.from(payload.value, 'base64').toString('utf8')
  }

  private async readCodexAuthFile(): Promise<CodexAuthPayload> {
    const raw = await fs.readFile(this.codexAuthFile, 'utf8')
    return JSON.parse(raw) as CodexAuthPayload
  }

  private async readRawCodexAuthFile(): Promise<string | null> {
    try {
      return await fs.readFile(this.codexAuthFile, 'utf8')
    } catch {
      return null
    }
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
        version: 2,
        accounts: parsed.accounts ?? [],
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

  private async restoreRawCodexAuth(rawAuth: string | null): Promise<void> {
    if (rawAuth === null) {
      await fs.rm(this.codexAuthFile, { force: true })
      return
    }

    await fs.mkdir(join(homedir(), '.codex'), { recursive: true })
    await fs.writeFile(this.codexAuthFile, rawAuth, 'utf8')
  }

  private async withAuthFileLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.authFileQueue
    let release: (() => void) | undefined
    this.authFileQueue = new Promise((resolve) => {
      release = resolve
    })

    await previous.catch(() => undefined)

    try {
      return await task()
    } finally {
      release?.()
    }
  }
}

export class CodexLoginCoordinator {
  private currentSession?: LoginSession

  constructor(
    private readonly store: CodexAccountStore,
    private readonly emit: (event: LoginEvent) => void
  ) {}

  isRunning(): boolean {
    return Boolean(this.currentSession)
  }

  async start(_method: LoginMethod): Promise<LoginAttempt> {
    void _method

    if (this.currentSession) {
      if (this.currentSession.method === 'browser') {
        return {
          attemptId: this.currentSession.attemptId,
          method: 'browser'
        }
      }

      await this.cancelAndWait()
    }

    return this.startBrowserLogin()
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
      this.currentSession = undefined
    }
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

        const callbackUrl = new URL(request.url, 'http://127.0.0.1')
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
        server.listen(0, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Failed to start the local OAuth callback server.')
      }

      const localCallbackUrl = `http://127.0.0.1:${(address as AddressInfo).port}/auth/callback`
      const authUrl = new URL(OPENAI_AUTHORIZE_URL)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', OPENAI_OAUTH_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', localCallbackUrl)
      authUrl.searchParams.set('scope', OPENAI_OAUTH_SCOPE)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('id_token_add_organizations', 'true')
      authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('originator', 'Ilovecodex')

      session.rawOutput = `${authUrl.toString()}\n${localCallbackUrl}\n`
      this.emit({
        attemptId,
        method: 'browser',
        phase: 'waiting',
        message: 'Browser login is waiting for the OpenAI callback.',
        authUrl: authUrl.toString(),
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
  private async cancelAndWait(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      return
    }

    session.cancelled = true
    session.abortController?.abort()

    if (session.server) {
      await this.closeServer(session.server)
      this.currentSession = undefined
    }
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
    const address = server?.address()
    if (!server || !address || typeof address === 'string') {
      throw new Error('The local OAuth callback server is unavailable.')
    }

    const redirectUri = `http://127.0.0.1:${(address as AddressInfo).port}/auth/callback`
    const auth = await this.exchangeBrowserCode(code, codeVerifier, redirectUri, signal)
    await this.store.importAuthPayload(auth)

    this.currentSession = undefined
    await this.closeServer(server)
    this.emit({
      attemptId,
      method: 'browser',
      phase: 'success',
      message: 'Imported the new browser login into the local account vault.',
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
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
    const response = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal
    })
    const raw = await response.text()

    if (!response.ok) {
      throw new Error(`OpenAI token exchange failed (${response.status}).`)
    }

    const parsed = JSON.parse(raw) as {
      access_token?: string
      refresh_token?: string
      id_token?: string
    }

    return {
      OPENAI_API_KEY: null,
      last_refresh: new Date().toISOString(),
      tokens: {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        id_token: parsed.id_token,
        account_id: this.extractChatGptAccountId(parsed.id_token, parsed.access_token)
      }
    }
  }

  private extractChatGptAccountId(idToken?: string, accessToken?: string): string | undefined {
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

  private async closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
