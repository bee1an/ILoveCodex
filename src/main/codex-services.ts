import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { promisify } from 'node:util'

import {
  CodexAccountStore,
  CodexLoginCoordinator,
  getOpenAiCallbackPortOccupant,
  killOpenAiCallbackPortOccupant,
  refreshCodexAuthPayload,
  type CodexAuthPayload
} from './codex-auth'
import { AccountRateLimitLookupError, readAccountRateLimits } from './codex-app-server'
import {
  resolveBestAccount,
  type AccountTag,
  type AccountRateLimits,
  type AccountSummary,
  type AppSettings,
  type AppSnapshot,
  type CurrentSessionSummary,
  type LoginEvent
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'

const execFile = promisify(execFileCallback)
const codexDesktopProcessPattern = '^/Applications/Codex\\.app/'
const macosCodexAppBundle = '/Applications/Codex.app'
const macosCodexAppBinary = '/Applications/Codex.app/Contents/MacOS/Codex'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function listCodexDesktopProcessIds(): Promise<number[]> {
  try {
    const { stdout } = await execFile('pgrep', ['-f', codexDesktopProcessPattern])
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

async function stopCodexDesktop(): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await execFile('osascript', ['-e', 'tell application "Codex" to quit'])
    } catch {
      // Codex may not be running, or AppleScript may not be available.
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await listCodexDesktopProcessIds()).length) {
      return
    }
    await sleep(300)
  }

  const remaining = await listCodexDesktopProcessIds()
  for (const pid of remaining) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process may already be gone.
    }
  }

  await sleep(500)

  const stubborn = await listCodexDesktopProcessIds()
  for (const pid of stubborn) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may already be gone.
    }
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

async function resolveCodexExecutable(): Promise<string> {
  const explicitPath = process.env['ILOVECODEX_CODEX_BIN']?.trim()
  if (explicitPath) {
    return explicitPath
  }

  if (process.platform === 'darwin' && (await pathExists(macosCodexAppBinary))) {
    return macosCodexAppBinary
  }

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFile(locator, ['codex'])
    const resolved = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (resolved) {
      return resolved
    }
  } catch {
    // Fall through to the final explicit error below.
  }

  throw new Error(
    'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
  )
}

async function launchCodexDesktop(workspacePath: string): Promise<void> {
  await stopCodexDesktop()

  if (process.platform === 'darwin' && (await pathExists(macosCodexAppBundle))) {
    try {
      await execFile('open', ['-a', macosCodexAppBundle, '--args', 'app', workspacePath])
      return
    } catch (error) {
      throw new Error(
        `Failed to open Codex.app: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    }
  }

  const codexExecutable = await resolveCodexExecutable()

  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexExecutable, ['app', workspacePath], {
      cwd: workspacePath,
      env: process.env,
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', (error) => {
      reject(error)
    })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
      )
    }

    if (error?.code === 'EACCES') {
      throw new Error(`Codex executable is not runnable: ${codexExecutable}`)
    }

    throw error
  })
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

function accountErrorLabel(account: AccountSummary): string {
  return account.email ?? account.name ?? account.accountId ?? account.id
}

function resolveOptionalAccountId(snapshot: AppSnapshot): string | null {
  return snapshot.activeAccountId ?? snapshot.accounts[0]?.id ?? null
}

export interface CodexServices {
  getSnapshot(): Promise<AppSnapshot>
  accounts: {
    list(): Promise<AppSnapshot>
    importCurrent(): Promise<AppSnapshot>
    activate(accountId: string): Promise<AppSnapshot>
    activateBest(): Promise<AppSnapshot>
    reorder(accountIds: string[]): Promise<AppSnapshot>
    remove(accountId: string): Promise<AppSnapshot>
    updateTags(accountId: string, tagIds: string[]): Promise<AppSnapshot>
    get(accountId: string): Promise<AccountSummary>
  }
  tags: {
    create(name: string): Promise<AppSnapshot>
    update(tagId: string, name: string): Promise<AppSnapshot>
    remove(tagId: string): Promise<AppSnapshot>
    getAll(): Promise<AccountTag[]>
  }
  session: {
    current(): Promise<CurrentSessionSummary | null>
  }
  settings: {
    get(): Promise<AppSettings>
    update(nextSettings: Partial<AppSettings>): Promise<AppSnapshot>
  }
  usage: {
    read(accountId?: string): Promise<AccountRateLimits>
  }
  login: {
    start(method: 'browser' | 'device'): Promise<{ attemptId: string; method: 'browser' | 'device' }>
    isRunning(): boolean
    getPortOccupant: typeof getOpenAiCallbackPortOccupant
    killPortOccupant: typeof killOpenAiCallbackPortOccupant
  }
  codex: {
    open(accountId?: string, workspacePath?: string): Promise<AppSnapshot>
  }
}

export interface CreateCodexServicesOptions {
  userDataPath: string
  defaultWorkspacePath: string
  platform: CodexPlatformAdapter
  emitLoginEvent?: (event: LoginEvent) => void
}

export function createCodexServices(options: CreateCodexServicesOptions): CodexServices {
  const store = new CodexAccountStore(options.userDataPath, options.platform)
  const loginCoordinator = new CodexLoginCoordinator(
    store,
    options.emitLoginEvent ?? (() => undefined),
    options.platform
  )

  async function getSnapshot(): Promise<AppSnapshot> {
    return store.getSnapshot(loginCoordinator.isRunning())
  }

  async function resolveAccountIdOrThrow(explicitAccountId?: string): Promise<string> {
    if (explicitAccountId) {
      return explicitAccountId
    }

    const snapshot = await getSnapshot()
    const resolved = resolveOptionalAccountId(snapshot)
    if (!resolved) {
      throw new Error('Account not found.')
    }

    return resolved
  }

  async function readUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<AccountRateLimits> {
    let targetAccountId = accountId

    try {
      let rateLimits: AccountRateLimits

      try {
        rateLimits = await readAccountRateLimits(auth, options.platform)
      } catch (error) {
        if (!shouldRefreshStoredAuth(error, auth.tokens?.refresh_token)) {
          throw error
        }

        const refreshedAuth = await refreshCodexAuthPayload(auth, options.platform)
        const refreshedAccount = await store.importAuthPayload(refreshedAuth)
        targetAccountId = refreshedAccount.id
        rateLimits = await readAccountRateLimits(refreshedAuth, options.platform)
      }

      await store.saveAccountRateLimits(targetAccountId, rateLimits)
      return rateLimits
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to read account limits.'
      throw new Error(`${accountErrorLabel(account)}: ${detail}`)
    }
  }

  return {
    getSnapshot,
    accounts: {
      list: getSnapshot,
      importCurrent: async () => {
        await store.importCurrentAuth()
        return getSnapshot()
      },
      activate: async (accountId) => {
        await store.activateAccount(accountId)
        return getSnapshot()
      },
      activateBest: async () => {
        const snapshot = await getSnapshot()
        const bestAccount = resolveBestAccount(
          snapshot.accounts,
          snapshot.usageByAccountId,
          snapshot.activeAccountId
        )

        if (!bestAccount || bestAccount.id === snapshot.activeAccountId) {
          return getSnapshot()
        }

        await store.activateAccount(bestAccount.id)
        return getSnapshot()
      },
      reorder: async (accountIds) => {
        await store.reorderAccounts(accountIds)
        return getSnapshot()
      },
      remove: async (accountId) => {
        await store.removeAccount(accountId)
        return getSnapshot()
      },
      updateTags: async (accountId, tagIds) => {
        await store.updateAccountTags(accountId, tagIds)
        return getSnapshot()
      },
      get: (accountId) => store.getAccountSummary(accountId)
    },
    tags: {
      create: async (name) => {
        await store.createTag(name)
        return getSnapshot()
      },
      update: async (tagId, name) => {
        await store.updateTag(tagId, name)
        return getSnapshot()
      },
      remove: async (tagId) => {
        await store.deleteTag(tagId)
        return getSnapshot()
      },
      getAll: async () => (await getSnapshot()).tags
    },
    session: {
      current: async () => (await getSnapshot()).currentSession
    },
    settings: {
      get: async () => (await getSnapshot()).settings,
      update: async (nextSettings) => {
        await store.updateSettings(nextSettings)
        return getSnapshot()
      }
    },
    usage: {
      read: async (accountId) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        return readUsageForAuth(resolvedAccountId, account, auth)
      }
    },
    login: {
      start: (method) => loginCoordinator.start(method),
      isRunning: () => loginCoordinator.isRunning(),
      getPortOccupant: getOpenAiCallbackPortOccupant,
      killPortOccupant: killOpenAiCallbackPortOccupant
    },
    codex: {
      open: async (accountId, workspacePath = options.defaultWorkspacePath) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        await store.activateAccount(resolvedAccountId)
        await launchCodexDesktop(workspacePath)
        return getSnapshot()
      }
    }
  }
}
