import { join, resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { parse as parseToml } from '@iarna/toml'

import type { CodexAuthPayload } from './codex-auth'
import type { PersistedCodexInstance, PersistedDefaultCodexInstance } from './codex-instances'
import {
  launchCodexDesktop,
  revealCodexDesktop,
  resolveAnyCodexDesktopPid,
  resolveManagedCodexPid,
  stopCodexProcess,
  writeAuthPayloadToCodexHome,
  writeProviderApiKeyToCodexHome,
  writeProviderConfigToCodexHome
} from './codex-launcher'
import {
  isLocalMockAccount,
  type AccountSummary,
  type AppSnapshot,
  type CodexInstanceSummary,
  type CustomProviderSummary
} from '../shared/codex'
import {
  BACKGROUND_AUTH_REFRESH_SKEW_MS,
  DEFAULT_CODEX_INSTANCE_ID,
  LOCAL_MOCK_OPEN_ERROR,
  LOCAL_MOCK_OPEN_ISOLATED_ERROR,
  accountInstanceLabel,
  authRefreshReason,
  customProviderLabel,
  resolveOptionalAccountId,
  type CodexServicesRuntimeContext
} from './codex-services-shared'
import type { CodexServicesAuthRuntime } from './codex-services-auth-runtime'

export interface CodexServicesInstanceRuntime {
  prepareLaunchAuthPayload(accountId: string): Promise<CodexAuthPayload>
  refreshExpiringAccountSession(accountId: string): Promise<boolean>
  resolveAccountIdOrThrow(explicitAccountId?: string): Promise<string>
  resolveAccountsForExport(accountIds?: string[]): Promise<AccountSummary[]>
  toInstanceSummary(instance: PersistedCodexInstance): Promise<CodexInstanceSummary>
  toDefaultInstanceSummary(instance: PersistedDefaultCodexInstance): Promise<CodexInstanceSummary>
  listCodexInstances(): Promise<CodexInstanceSummary[]>
  getSnapshot(): Promise<AppSnapshot>
  getDesktopExecutablePathOverride(): Promise<string | undefined>
  startDefaultInstance(workspacePath: string, accountId?: string): Promise<CodexInstanceSummary>
  revealRunningCodex(): Promise<void>
  showDefaultCodex(workspacePath: string): Promise<CodexInstanceSummary>
  startNamedInstance(instanceId: string, workspacePath: string): Promise<CodexInstanceSummary>
  startAccountInstance(accountId: string, workspacePath: string): Promise<CodexInstanceSummary>
  startProviderInstance(providerId: string, workspacePath: string): Promise<CustomProviderSummary>
  stopInstance(instanceId: string): Promise<CodexInstanceSummary>
}

export function createCodexServicesInstanceRuntime(
  context: CodexServicesRuntimeContext,
  authRuntime: CodexServicesAuthRuntime
): CodexServicesInstanceRuntime {
  const { store, instanceStore, providerStore, loginCoordinator } = context
  const { refreshAuthForUse, refreshStoredAuthGuarded } = authRuntime

  function normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/u, '').toLowerCase()
  }

  function addUniqueProviderId(ids: string[], providerId: string): void {
    if (!ids.includes(providerId)) {
      ids.push(providerId)
    }
  }

  function collectProviderIdsFromConfig(
    config: Record<string, unknown>,
    providers: CustomProviderSummary[]
  ): string[] {
    const ids: string[] = []
    const modelProviders =
      config.model_providers && typeof config.model_providers === 'object'
        ? (config.model_providers as Record<string, unknown>)
        : {}

    for (const rawProvider of Object.values(modelProviders)) {
      if (!rawProvider || typeof rawProvider !== 'object') {
        continue
      }

      const providerConfig = rawProvider as Record<string, unknown>
      const baseUrl = typeof providerConfig.base_url === 'string' ? providerConfig.base_url : ''
      const name = typeof providerConfig.name === 'string' ? providerConfig.name.trim() : ''
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
      const matched = providers.find((provider) => {
        if (normalizedBaseUrl && normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl) {
          return true
        }

        return Boolean(name && provider.name?.trim() === name)
      })

      if (matched) {
        addUniqueProviderId(ids, matched.id)
      }
    }

    return ids
  }

  async function resolveInstanceProviderIds(codexHome: string): Promise<string[]> {
    const providers = await providerStore.list()
    const ids: string[] = []
    const normalizedCodexHome = resolve(codexHome).replace(/\\/gu, '/')

    for (const provider of providers) {
      if (normalizedCodexHome.endsWith(`/provider-${provider.id}`)) {
        addUniqueProviderId(ids, provider.id)
      }
    }

    try {
      const raw = await fs.readFile(join(codexHome, 'config.toml'), 'utf8')
      const config = raw.trim() ? (parseToml(raw) as Record<string, unknown>) : {}
      for (const providerId of collectProviderIdsFromConfig(config, providers)) {
        addUniqueProviderId(ids, providerId)
      }
    } catch {
      // Missing or invalid config should not block instance listing.
    }

    return ids
  }

  async function assertDefaultCodexLaunchAllowed(explicitAccountId?: string): Promise<void> {
    if (explicitAccountId) {
      if (isLocalMockAccount(await store.getAccountSummary(explicitAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ERROR)
      }
      return
    }

    const defaultInstance = await instanceStore.getDefaultInstance()
    if (defaultInstance.bindAccountId) {
      if (isLocalMockAccount(await store.getAccountSummary(defaultInstance.bindAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ERROR)
      }
      return
    }

    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    if (isLocalMockAccount(snapshot.currentSession)) {
      throw new Error(LOCAL_MOCK_OPEN_ERROR)
    }
  }

  async function assertIsolatedCodexLaunchAllowed(bindAccountId?: string): Promise<void> {
    if (bindAccountId) {
      if (isLocalMockAccount(await store.getAccountSummary(bindAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
      }
      return
    }

    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    if (isLocalMockAccount(snapshot.currentSession)) {
      throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
    }
  }

  async function prepareLaunchAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    const storedAuth = await store.getStoredAuthPayload(accountId)

    return (
      await refreshAuthForUse(accountId, storedAuth, {
        allowStaleFallback: true
      })
    ).auth
  }

  async function refreshExpiringAccountSession(accountId: string): Promise<boolean> {
    const account = await store.getAccountSummary(accountId)
    if (isLocalMockAccount(account)) {
      return false
    }

    const storedAuth = await store.getStoredAuthPayload(accountId)

    if (!authRefreshReason(storedAuth, BACKGROUND_AUTH_REFRESH_SKEW_MS)) {
      return false
    }

    try {
      const refreshed = await refreshStoredAuthGuarded(accountId, storedAuth)
      if (refreshed.refreshed) {
        await store.clearAccountUsageError(refreshed.accountId)
      }
      return refreshed.refreshed
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to refresh account session.'
      await store.saveAccountUsageError(accountId, detail)
      throw error
    }
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

  async function resolveAccountsForExport(accountIds?: string[]): Promise<AccountSummary[]> {
    const snapshot = await getSnapshot()
    if (!accountIds?.length) {
      return snapshot.accounts
    }

    const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]))
    return accountIds.map((accountId) => {
      const account = accountsById.get(accountId)
      if (!account) {
        throw new Error(`Account not found: ${accountId}`)
      }

      return account
    })
  }

  async function toInstanceSummary(
    instance: PersistedCodexInstance
  ): Promise<CodexInstanceSummary> {
    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid !== instance.lastPid) {
      await instanceStore.setInstancePid(instance.id, runningPid ?? null)
      instance = {
        ...instance,
        lastPid: runningPid
      }
    }

    return {
      id: instance.id,
      name: instance.name,
      codexHome: instance.codexHome,
      bindAccountId: instance.bindAccountId,
      extraArgs: instance.extraArgs,
      isDefault: false,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      lastLaunchedAt: instance.lastLaunchedAt,
      lastPid: runningPid,
      running: Boolean(runningPid),
      initialized: await instanceStore.isInitialized(instance.codexHome),
      providerIds: await resolveInstanceProviderIds(instance.codexHome)
    }
  }

  async function toDefaultInstanceSummary(
    instance: PersistedDefaultCodexInstance
  ): Promise<CodexInstanceSummary> {
    const { defaultCodexHome } = instanceStore.getDefaults()
    const runningPid = await resolveManagedCodexPid(defaultCodexHome, instance.lastPid)
    if (runningPid !== instance.lastPid) {
      instance = await instanceStore.updateDefaultInstance({
        lastPid: runningPid ?? null
      })
    }

    return {
      id: DEFAULT_CODEX_INSTANCE_ID,
      name: '',
      codexHome: defaultCodexHome,
      bindAccountId: instance.bindAccountId,
      extraArgs: instance.extraArgs,
      isDefault: true,
      createdAt: instance.updatedAt,
      updatedAt: instance.updatedAt,
      lastLaunchedAt: instance.lastLaunchedAt,
      lastPid: runningPid,
      running: Boolean(runningPid),
      initialized: await instanceStore.isInitialized(defaultCodexHome),
      providerIds: await resolveInstanceProviderIds(defaultCodexHome)
    }
  }

  async function listCodexInstances(): Promise<CodexInstanceSummary[]> {
    const defaultInstance = await instanceStore.getDefaultInstance()
    const instances = await instanceStore.list()
    return Promise.all([
      toDefaultInstanceSummary(defaultInstance),
      ...instances.map((instance) => toInstanceSummary(instance))
    ])
  }

  async function getSnapshot(): Promise<AppSnapshot> {
    const [snapshot, providers, codexInstances] = await Promise.all([
      store.getSnapshot(loginCoordinator.isRunning()),
      providerStore.list(),
      listCodexInstances()
    ])

    return {
      ...snapshot,
      providers,
      codexInstances,
      codexInstanceDefaults: instanceStore.getDefaults()
    }
  }

  async function getDesktopExecutablePathOverride(): Promise<string | undefined> {
    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    const value = snapshot.settings.codexDesktopExecutablePath.trim()
    return value || undefined
  }

  async function startDefaultInstance(
    workspacePath: string,
    accountId?: string
  ): Promise<CodexInstanceSummary> {
    await assertDefaultCodexLaunchAllowed(accountId)

    const defaultInstance = await instanceStore.getDefaultInstance()
    const targetAccountId = accountId ?? defaultInstance.bindAccountId

    if (targetAccountId) {
      await prepareLaunchAuthPayload(targetAccountId)
      await store.activateAccount(targetAccountId)
    }

    const { defaultCodexHome } = instanceStore.getDefaults()
    const runningPid = await resolveManagedCodexPid(defaultCodexHome, defaultInstance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: defaultCodexHome,
      extraArgs: defaultInstance.extraArgs,
      preferAppBundle: false,
      requireDesktopExecutable: false,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    const updated = await instanceStore.updateDefaultInstance({
      lastPid: pid,
      touchLaunch: true
    })

    return toDefaultInstanceSummary(updated)
  }

  async function revealRunningCodex(): Promise<void> {
    await revealCodexDesktop({
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })
  }

  async function showDefaultCodex(workspacePath: string): Promise<CodexInstanceSummary> {
    await assertDefaultCodexLaunchAllowed()

    const defaultInstance = await instanceStore.getDefaultInstance()
    const { defaultCodexHome } = instanceStore.getDefaults()

    const defaultRunningPid = await resolveManagedCodexPid(
      defaultCodexHome,
      defaultInstance.lastPid
    )
    if (defaultRunningPid) {
      await revealRunningCodex()
      return toDefaultInstanceSummary(defaultInstance)
    }

    for (const instance of await instanceStore.list()) {
      if (resolve(instance.codexHome) === resolve(defaultCodexHome)) {
        continue
      }

      const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
      if (runningPid) {
        await revealRunningCodex()
        return toDefaultInstanceSummary(defaultInstance)
      }
    }

    const anyRunningPid = await resolveAnyCodexDesktopPid()
    if (anyRunningPid) {
      await revealRunningCodex()
      return toDefaultInstanceSummary(defaultInstance)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: defaultCodexHome,
      extraArgs: defaultInstance.extraArgs,
      preferAppBundle: false,
      requireDesktopExecutable: false,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    const updated = await instanceStore.updateDefaultInstance({
      lastPid: pid,
      touchLaunch: true
    })

    return toDefaultInstanceSummary(updated)
  }

  async function startNamedInstance(
    instanceId: string,
    workspacePath: string
  ): Promise<CodexInstanceSummary> {
    const instance = await instanceStore.getInstance(instanceId)
    await assertIsolatedCodexLaunchAllowed(instance.bindAccountId)
    await instanceStore.ensureInitialized(instance.codexHome)
    await instanceStore.syncConfigFromDefault(instance.codexHome)

    if (instance.bindAccountId) {
      const authPayload = await prepareLaunchAuthPayload(instance.bindAccountId)
      await writeAuthPayloadToCodexHome(instance.codexHome, authPayload)
    }

    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: instance.codexHome,
      extraArgs: instance.extraArgs,
      preferAppBundle: true,
      requireDesktopExecutable: true,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    return toInstanceSummary(await instanceStore.markLaunched(instance.id, pid))
  }

  async function startAccountInstance(
    accountId: string,
    workspacePath: string
  ): Promise<CodexInstanceSummary> {
    const account = await store.getAccountSummary(accountId)
    if (isLocalMockAccount(account)) {
      throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
    }

    const instance = await instanceStore.ensureAccountInstance({
      accountId,
      label: accountInstanceLabel(account)
    })

    return startNamedInstance(instance.id, workspacePath)
  }

  async function ensureProviderInstance(
    providerId: string,
    label: string
  ): Promise<PersistedCodexInstance> {
    const { rootDir } = instanceStore.getDefaults()
    const providerCodexHome = join(rootDir, `provider-${providerId}`)
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(providerCodexHome)
    )
    if (existing) {
      return existing
    }

    return instanceStore.create({
      name: `Provider ${label}`,
      codexHome: providerCodexHome
    })
  }

  async function startProviderInstance(
    providerId: string,
    workspacePath: string
  ): Promise<CustomProviderSummary> {
    const provider = await providerStore.getResolvedProvider(providerId)
    const instance = await ensureProviderInstance(providerId, customProviderLabel(provider.summary))
    await instanceStore.ensureInitialized(instance.codexHome)
    await instanceStore.syncConfigFromDefault(instance.codexHome)
    await writeProviderApiKeyToCodexHome(instance.codexHome, provider.apiKey)
    await writeProviderConfigToCodexHome(instance.codexHome, provider.summary)

    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: instance.codexHome,
      extraArgs: instance.extraArgs,
      preferAppBundle: true,
      requireDesktopExecutable: true,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    await instanceStore.markLaunched(instance.id, pid)
    return providerStore.markUsed(providerId)
  }

  async function stopInstance(instanceId: string): Promise<CodexInstanceSummary> {
    if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
      const defaultInstance = await instanceStore.getDefaultInstance()
      const { defaultCodexHome } = instanceStore.getDefaults()
      const pid = await resolveManagedCodexPid(defaultCodexHome, defaultInstance.lastPid)
      if (pid) {
        await stopCodexProcess(pid)
      }

      return toDefaultInstanceSummary(
        await instanceStore.updateDefaultInstance({
          lastPid: null
        })
      )
    }

    const instance = await instanceStore.getInstance(instanceId)
    const pid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (pid) {
      await stopCodexProcess(pid)
    }

    return toInstanceSummary(await instanceStore.setInstancePid(instance.id, null))
  }

  return {
    prepareLaunchAuthPayload,
    refreshExpiringAccountSession,
    resolveAccountIdOrThrow,
    resolveAccountsForExport,
    toInstanceSummary,
    toDefaultInstanceSummary,
    listCodexInstances,
    getSnapshot,
    getDesktopExecutablePathOverride,
    startDefaultInstance,
    revealRunningCodex,
    showDefaultCodex,
    startNamedInstance,
    startAccountInstance,
    startProviderInstance,
    stopInstance
  }
}
