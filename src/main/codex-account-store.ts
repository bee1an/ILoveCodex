import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  AccountRateLimits,
  AccountSummary,
  AccountTag,
  AccountWakeSchedule,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  UpdateAccountWakeScheduleInput
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'
import { normalizeStatsDisplaySettings } from '../shared/codex'
import {
  type CodexAuthPayload,
  type LegacyPersistedState,
  type PersistedState,
  defaultState,
  dedupeAccountTagIds,
  describeError,
  findMatchingAccount,
  normalizePersistedState,
  normalizeTagName,
  normalizeWakeSchedule,
  resolveAccountId,
  summarizeAuth,
  toAccountSummary
} from './codex-auth-shared'

export class CodexAccountStore {
  private readonly stateFile: string
  private readonly stateBackupFile: string
  private readonly codexAuthFile: string
  private stateQueue: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    private readonly platform: CodexPlatformAdapter,
    private readonly defaultCodexHome = join(process.env.HOME ?? '', '.codex')
  ) {
    this.stateFile = join(userDataPath, 'codex-accounts.json')
    this.stateBackupFile = `${this.stateFile}.bak`
    this.codexAuthFile = join(this.defaultCodexHome, 'auth.json')
  }

  async getSnapshot(loginInProgress: boolean): Promise<AppSnapshot> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const currentSession = await this.getCurrentSession(state)
      const resolvedActiveAccountId = currentSession?.storedAccountId

      if (state.activeAccountId !== resolvedActiveAccountId) {
        state.activeAccountId = resolvedActiveAccountId
        await this.writeState(state)
      }

      return {
        accounts: state.accounts.map(toAccountSummary),
        providers: [],
        tags: state.tags,
        codexInstances: [],
        codexInstanceDefaults: {
          rootDir: '',
          defaultCodexHome: this.defaultCodexHome
        },
        activeAccountId: resolvedActiveAccountId,
        currentSession,
        loginInProgress,
        settings: state.settings,
        usageByAccountId: state.usageByAccountId,
        usageErrorByAccountId: state.usageErrorByAccountId,
        wakeSchedulesByAccountId: state.wakeSchedulesByAccountId,
        tokenCostByInstanceId: {},
        tokenCostErrorByInstanceId: {},
        runningTokenCostSummary: null,
        runningTokenCostInstanceIds: []
      }
    })
  }

  async updateSettings(nextSettings: Partial<AppSettings>): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      state.settings = {
        ...state.settings,
        ...nextSettings,
        statsDisplay: normalizeStatsDisplaySettings(
          nextSettings.statsDisplay ?? state.settings.statsDisplay
        ),
        statusBarAccountIds: (
          nextSettings.statusBarAccountIds ?? state.settings.statusBarAccountIds
        ).slice(0, 5)
      }
      await this.writeState(state)
    })
  }

  async saveAccountRateLimits(accountId: string, rateLimits: AccountRateLimits): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      state.usageByAccountId = {
        ...state.usageByAccountId,
        [accountId]: rateLimits
      }
      await this.writeState(state)
    })
  }

  async clearAccountRateLimits(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.usageByAccountId)) {
        return
      }

      const nextUsageByAccountId = { ...state.usageByAccountId }
      delete nextUsageByAccountId[accountId]
      state.usageByAccountId = nextUsageByAccountId
      await this.writeState(state)
    })
  }

  async saveAccountUsageError(accountId: string, message: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      state.usageErrorByAccountId = {
        ...state.usageErrorByAccountId,
        [accountId]: message
      }
      await this.writeState(state)
    })
  }

  async clearAccountUsageError(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.usageErrorByAccountId)) {
        return
      }

      const nextUsageErrorByAccountId = { ...state.usageErrorByAccountId }
      delete nextUsageErrorByAccountId[accountId]
      state.usageErrorByAccountId = nextUsageErrorByAccountId
      await this.writeState(state)
    })
  }

  async getAccountWakeSchedule(accountId: string): Promise<AccountWakeSchedule | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      return state.wakeSchedulesByAccountId[accountId] ?? null
    })
  }

  async updateAccountWakeSchedule(
    accountId: string,
    input: UpdateAccountWakeScheduleInput
  ): Promise<AccountWakeSchedule> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      const current = state.wakeSchedulesByAccountId[accountId]
      const next = normalizeWakeSchedule({
        ...current,
        ...input,
        model: input.model ?? current?.model ?? 'gpt-5.4',
        prompt: input.prompt ?? current?.prompt ?? 'ping'
      })

      if (!next) {
        throw new Error('Invalid wake schedule.')
      }

      state.wakeSchedulesByAccountId = {
        ...state.wakeSchedulesByAccountId,
        [accountId]: next
      }
      await this.writeState(state)
      return next
    })
  }

  async patchAccountWakeSchedule(
    accountId: string,
    patch: Partial<AccountWakeSchedule>
  ): Promise<AccountWakeSchedule | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      const current = state.wakeSchedulesByAccountId[accountId]
      if (!current) {
        return null
      }

      const next = normalizeWakeSchedule({
        ...current,
        ...patch,
        times: patch.times ?? current.times,
        enabled: patch.enabled ?? current.enabled,
        model: patch.model ?? current.model,
        prompt: patch.prompt ?? current.prompt,
        lastTriggeredAt: patch.lastTriggeredAt ?? current.lastTriggeredAt,
        lastSucceededAt: patch.lastSucceededAt ?? current.lastSucceededAt,
        lastStatus: patch.lastStatus ?? current.lastStatus,
        lastMessage: patch.lastMessage ?? current.lastMessage
      })

      if (!next) {
        return null
      }

      state.wakeSchedulesByAccountId = {
        ...state.wakeSchedulesByAccountId,
        [accountId]: next
      }
      await this.writeState(state)
      return next
    })
  }

  async deleteAccountWakeSchedule(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.wakeSchedulesByAccountId)) {
        return
      }

      const nextWakeSchedulesByAccountId = { ...state.wakeSchedulesByAccountId }
      delete nextWakeSchedulesByAccountId[accountId]
      state.wakeSchedulesByAccountId = nextWakeSchedulesByAccountId
      await this.writeState(state)
    })
  }

  async createTag(name: string): Promise<AccountTag> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const normalizedName = normalizeTagName(name)

      if (!normalizedName) {
        throw new Error('Tag name is required.')
      }

      if (
        state.tags.some(
          (tag) =>
            tag.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
        )
      ) {
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
    })
  }

  async updateTag(tagId: string, name: string): Promise<AccountTag> {
    return this.runStateTask(async () => {
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
    })
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.runStateTask(async () => {
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
    })
  }

  async importCurrentAuth(): Promise<void> {
    await this.runStateTask(async () => {
      const auth = await this.readCodexAuthFile()
      await this.upsertAccount(auth, true)
    })
  }

  async importAuthFile(authFile: string, makeActive = true): Promise<void> {
    await this.runStateTask(async () => {
      const raw = await fs.readFile(authFile, 'utf8')
      const auth = JSON.parse(raw) as CodexAuthPayload
      await this.upsertAccount(auth, makeActive)
    })
  }

  async importAccountsFromStateFile(stateFile: string): Promise<number> {
    let importedCount = 0
    const raw = await fs.readFile(stateFile, 'utf8')
    const externalState = normalizePersistedState(
      JSON.parse(raw) as PersistedState | LegacyPersistedState
    )

    for (const account of externalState.accounts) {
      let imported: AccountSummary

      try {
        const auth = JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
        imported = await this.importAuthPayload(auth)
      } catch {
        // Skip accounts that cannot be read from another profile, for example legacy safeStorage rows.
        continue
      }

      try {
        const usage = externalState.usageByAccountId[account.id]
        if (usage) {
          await this.saveAccountRateLimits(imported.id, usage)
        }
      } catch {
        // Keep importing account metadata even if the cached usage snapshot is stale or invalid.
      }

      try {
        const wakeSchedule = externalState.wakeSchedulesByAccountId[account.id]
        if (wakeSchedule) {
          await this.updateAccountWakeSchedule(imported.id, {
            enabled: wakeSchedule.enabled,
            times: wakeSchedule.times,
            model: wakeSchedule.model,
            prompt: wakeSchedule.prompt
          })
          await this.patchAccountWakeSchedule(imported.id, {
            lastTriggeredAt: wakeSchedule.lastTriggeredAt,
            lastSucceededAt: wakeSchedule.lastSucceededAt,
            lastStatus: wakeSchedule.lastStatus,
            lastMessage: wakeSchedule.lastMessage
          })
        }
      } catch {
        // Keep importing account metadata even if the wake schedule cannot be copied.
      }

      importedCount += 1
    }

    return importedCount
  }

  async importAuthPayload(auth: CodexAuthPayload): Promise<AccountSummary> {
    return this.runStateTask(() => this.upsertAccount(auth, false))
  }

  async activateAccount(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
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
    })
  }

  async getStoredAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    return this.runStateTask(() => this.getStoredAuth(accountId))
  }

  async syncCurrentAuthPayload(accountId: string, auth: CodexAuthPayload): Promise<boolean> {
    return this.runStateTask(async () => {
      const state = await this.readState()

      try {
        const currentAuth = await this.readCodexAuthFile()
        const matched = findMatchingAccount(state.accounts, currentAuth)
        if (!matched || matched.id !== accountId) {
          return false
        }

        await this.writeCodexAuthFile(auth)
        return true
      } catch {
        return false
      }
    })
  }

  async importCurrentAuthPayloadForAccount(accountId: string): Promise<{
    account: AccountSummary
    auth: CodexAuthPayload
    changed: boolean
  } | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()

      let currentAuth: CodexAuthPayload
      try {
        currentAuth = await this.readCodexAuthFile()
      } catch {
        return null
      }

      const existing = findMatchingAccount(state.accounts, currentAuth)
      if (!existing || existing.id !== accountId) {
        return null
      }

      const rawAuth = JSON.stringify(currentAuth)
      if (this.unprotect(existing.authPayload) === rawAuth) {
        return {
          account: toAccountSummary(existing),
          auth: currentAuth,
          changed: false
        }
      }

      const previousId = existing.id
      const identity = resolveAccountId(currentAuth)
      const summary = summarizeAuth(currentAuth)
      const now = new Date().toISOString()

      if (previousId !== identity) {
        if (state.activeAccountId === previousId) {
          state.activeAccountId = identity
        }

        state.settings.statusBarAccountIds = state.settings.statusBarAccountIds.map((storedId) =>
          storedId === previousId ? identity : storedId
        )

        if (state.usageByAccountId[previousId]) {
          state.usageByAccountId = {
            ...state.usageByAccountId,
            [identity]: state.usageByAccountId[previousId]
          }
          delete state.usageByAccountId[previousId]
        }

        if (state.usageErrorByAccountId[previousId]) {
          state.usageErrorByAccountId = {
            ...state.usageErrorByAccountId,
            [identity]: state.usageErrorByAccountId[previousId]
          }
          delete state.usageErrorByAccountId[previousId]
        }

        if (state.wakeSchedulesByAccountId[previousId]) {
          state.wakeSchedulesByAccountId = {
            ...state.wakeSchedulesByAccountId,
            [identity]: state.wakeSchedulesByAccountId[previousId]
          }
          delete state.wakeSchedulesByAccountId[previousId]
        }
      }

      existing.id = identity
      existing.email = summary.email
      existing.name = summary.name
      existing.accountId = summary.accountId
      existing.tagIds = dedupeAccountTagIds(existing.tagIds ?? [])
      existing.updatedAt = now
      existing.authPayload = this.protect(rawAuth)
      state.activeAccountId = identity

      if (state.usageErrorByAccountId[identity]) {
        delete state.usageErrorByAccountId[identity]
      }

      await this.writeState(state)

      return {
        account: toAccountSummary(existing),
        auth: currentAuth,
        changed: true
      }
    })
  }

  async getAccountSummary(accountId: string): Promise<AccountSummary> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const account = state.accounts.find((item) => item.id === accountId)

      if (!account) {
        throw new Error('Account not found.')
      }

      return toAccountSummary(account)
    })
  }

  async updateAccountTags(accountId: string, tagIds: string[]): Promise<void> {
    await this.runStateTask(async () => {
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
    })
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      state.accounts = state.accounts.filter((item) => item.id !== accountId)

      if (state.activeAccountId === accountId) {
        state.activeAccountId = undefined
      }

      if (state.usageByAccountId[accountId]) {
        delete state.usageByAccountId[accountId]
      }

      if (state.usageErrorByAccountId[accountId]) {
        delete state.usageErrorByAccountId[accountId]
      }

      if (state.wakeSchedulesByAccountId[accountId]) {
        delete state.wakeSchedulesByAccountId[accountId]
      }

      await this.writeState(state)
    })
  }

  async reorderAccounts(accountIds: string[]): Promise<void> {
    await this.runStateTask(async () => {
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
    })
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

        if (state.usageErrorByAccountId[previousId]) {
          state.usageErrorByAccountId = {
            ...state.usageErrorByAccountId,
            [identity]: state.usageErrorByAccountId[previousId]
          }
          delete state.usageErrorByAccountId[previousId]
        }

        if (state.wakeSchedulesByAccountId[previousId]) {
          state.wakeSchedulesByAccountId = {
            ...state.wakeSchedulesByAccountId,
            [identity]: state.wakeSchedulesByAccountId[previousId]
          }
          delete state.wakeSchedulesByAccountId[previousId]
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

    if (state.usageErrorByAccountId[identity]) {
      delete state.usageErrorByAccountId[identity]
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
    if (payload.mode === 'safeStorage') {
      throw new Error(
        'This account was saved with macOS Keychain protection in an older version. Re-import it to use it without Keychain prompts.'
      )
    }

    return this.platform.unprotect(payload)
  }

  private async readCodexAuthFile(): Promise<CodexAuthPayload> {
    const raw = await fs.readFile(this.codexAuthFile, 'utf8')
    return JSON.parse(raw) as CodexAuthPayload
  }

  private runStateTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.stateQueue.then(task, task)
    this.stateQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
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
    const primaryState = await this.readStateFile(this.stateFile)
    if (primaryState) {
      return primaryState
    }

    const backupState = await this.readStateFile(this.stateBackupFile)
    if (backupState) {
      console.warn(`Recovered account state from backup: ${this.stateBackupFile}`)
      return backupState
    }

    return defaultState()
  }

  private async readStateFile(path: string): Promise<PersistedState | null> {
    try {
      const raw = await fs.readFile(path, 'utf8')
      return normalizePersistedState(JSON.parse(raw) as PersistedState | LegacyPersistedState)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      console.warn(`Failed to read account state from ${path}: ${describeError(error)}`)
      return null
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    await fs.mkdir(dirname(this.stateFile), { recursive: true })
    const raw = `${JSON.stringify(state, null, 2)}\n`
    const tempFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`

    try {
      await fs.writeFile(tempFile, raw, 'utf8')
      await fs.rename(tempFile, this.stateFile)
      await fs.copyFile(this.stateFile, this.stateBackupFile)
    } finally {
      await fs.rm(tempFile, { force: true })
    }
  }

  private async writeCodexAuthFile(auth: CodexAuthPayload): Promise<void> {
    await fs.mkdir(this.defaultCodexHome, { recursive: true })
    await fs.writeFile(this.codexAuthFile, `${JSON.stringify(auth, null, 2)}\n`, 'utf8')
  }
}
