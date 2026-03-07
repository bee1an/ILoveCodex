import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
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
    statusBarAccountIds: []
  }
}

interface LoginSession {
  attemptId: string
  method: LoginMethod
  child: ChildProcessByStdio<null, Readable, Readable>
  rawOutput: string
  cancelled: boolean
  lastProgressKey?: string
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const BROWSER_AUTH_URL_PATTERN = /https:\/\/auth\.openai\.com\/oauth\/authorize\S+/g
const LOCAL_CALLBACK_PATTERN = /http:\/\/localhost:\d+\/[^\s]+/g
const DEVICE_VERIFICATION_URL_PATTERN = /https:\/\/auth\.openai\.com\/codex\/device/g
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/g

function defaultState(): PersistedState {
  return {
    version: 2,
    accounts: [],
    settings: defaultSettings(),
    usageByAccountId: {}
  }
}

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_PATTERN, '')
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

  async start(method: LoginMethod): Promise<LoginAttempt> {
    if (this.currentSession) {
      if (this.currentSession.method === method) {
        return {
          attemptId: this.currentSession.attemptId,
          method
        }
      }

      await this.cancelAndWait()
    }

    const attemptId = randomUUID()
    const args = method === 'device' ? ['login', '--device-auth'] : ['login']
    const child = spawn('codex', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(method === 'browser' ? { BROWSER: 'false' } : {})
      }
    })

    const session: LoginSession = {
      attemptId,
      method,
      child,
      rawOutput: '',
      cancelled: false
    }

    this.currentSession = session
    this.emit({
      attemptId,
      method,
      phase: 'starting',
      message:
        method === 'device' ? 'Started device code login.' : 'Started browser callback login.'
    })

    const handleChunk = (chunk: Buffer): void => {
      session.rawOutput += stripAnsi(chunk.toString('utf8'))
      const progress = this.buildProgressEvent(session)

      if (!progress) {
        return
      }

      const progressKey = JSON.stringify(progress)
      if (session.lastProgressKey === progressKey) {
        return
      }

      session.lastProgressKey = progressKey
      this.emit(progress)
    }

    child.stdout.on('data', handleChunk)
    child.stderr.on('data', handleChunk)

    child.on('error', async (error) => {
      if (this.currentSession?.attemptId !== attemptId) {
        return
      }

      this.currentSession = undefined
      this.emit({
        attemptId,
        method,
        phase: 'error',
        message: error.message,
        rawOutput: session.rawOutput,
        snapshot: await this.store.getSnapshot(false)
      })
    })

    child.on('exit', async (code) => {
      if (this.currentSession?.attemptId !== attemptId) {
        return
      }

      this.currentSession = undefined

      if (session.cancelled) {
        this.emit({
          attemptId,
          method,
          phase: 'cancelled',
          message: 'Cancelled login flow.',
          rawOutput: session.rawOutput,
          snapshot: await this.store.getSnapshot(false)
        })
        return
      }

      if (code !== 0) {
        this.emit({
          attemptId,
          method,
          phase: 'error',
          message: `Codex login exited with code ${code}.`,
          rawOutput: session.rawOutput,
          snapshot: await this.store.getSnapshot(false)
        })
        return
      }

      try {
        await this.store.importCurrentAuth()
        this.emit({
          attemptId,
          method,
          phase: 'success',
          message: 'Imported the new Codex login into the local account vault.',
          rawOutput: session.rawOutput,
          snapshot: await this.store.getSnapshot(false)
        })
      } catch (error) {
        this.emit({
          attemptId,
          method,
          phase: 'error',
          message: error instanceof Error ? error.message : 'Failed to import the new login state.',
          rawOutput: session.rawOutput,
          snapshot: await this.store.getSnapshot(false)
        })
      }
    })

    return { attemptId, method }
  }

  async cancel(): Promise<void> {
    if (!this.currentSession) {
      return
    }

    this.currentSession.cancelled = true
    this.currentSession.child.kill('SIGTERM')
  }

  private async cancelAndWait(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      return
    }

    session.cancelled = true
    session.child.kill('SIGTERM')

    try {
      await once(session.child, 'exit')
    } catch {
      // Ignore exit race and let the normal exit handler clear session state.
    }
  }

  private buildProgressEvent(session: LoginSession): LoginEvent | null {
    const authUrl = session.rawOutput.match(BROWSER_AUTH_URL_PATTERN)?.at(-1)
    const localCallbackUrl = session.rawOutput.match(LOCAL_CALLBACK_PATTERN)?.at(-1)
    const verificationUrl = session.rawOutput.match(DEVICE_VERIFICATION_URL_PATTERN)?.at(-1)
    const deviceCode = session.rawOutput.match(DEVICE_CODE_PATTERN)?.at(-1)

    if (session.method === 'browser' && (authUrl || localCallbackUrl)) {
      return {
        attemptId: session.attemptId,
        method: session.method,
        phase: 'waiting',
        message: 'Browser login is waiting for the OpenAI callback.',
        authUrl,
        localCallbackUrl,
        rawOutput: session.rawOutput
      }
    }

    if (session.method === 'device' && (verificationUrl || deviceCode)) {
      return {
        attemptId: session.attemptId,
        method: session.method,
        phase: 'waiting',
        message: 'Device code login is waiting for approval in your browser.',
        verificationUrl,
        deviceCode,
        rawOutput: session.rawOutput
      }
    }

    if (!session.rawOutput.trim()) {
      return null
    }

    return {
      attemptId: session.attemptId,
      method: session.method,
      phase: 'waiting',
      message: 'Waiting for Codex to finish the login flow.',
      rawOutput: session.rawOutput
    }
  }
}
