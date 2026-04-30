import { join, resolve } from 'node:path'

import {
  CodexAccountStore,
  CodexLoginCoordinator,
  getOpenAiCallbackPortOccupant,
  killOpenAiCallbackPortOccupant
} from './codex-auth'
import {
  CodexInstanceStore,
  type PersistedCodexInstance,
  type PersistedDefaultCodexInstance
} from './codex-instances'
import {
  buildAuthPayloadFromTemplate,
  buildTemplateRateLimits,
  parseTemplateFileRecord,
  serializeAccountExport,
  type TemplateFileRecord
} from './codex-account-template'
import { CodexProviderStore } from './codex-providers'
import {
  type AppSnapshot,
  type CodexInstanceSummary,
  canRunWakeRequest,
  isLocalMockAccount,
  resolveBestAccount,
  type WakeAccountRateLimitsResult
} from '../shared/codex'
import type {
  CodexServices,
  CreateCodexServicesOptions,
  StoredAuthRefreshResult
} from './codex-services-shared'
import { DEFAULT_CODEX_INSTANCE_ID, customProviderLabel } from './codex-services-shared'
import { createCodexServicesAuthRuntime } from './codex-services-auth-runtime'
import { createCodexCostUsageService } from './codex-cost-usage'
import { createCodexServicesDiagnosticsRuntime } from './codex-services-diagnostics-runtime'
import { createCodexServicesInstanceRuntime } from './codex-services-instance-runtime'
import {
  copyCodexSessionToProvider,
  listCodexSessionProjects,
  listCodexSessions,
  readCodexSessionDetail
} from './codex-sessions'
import { createCodexSkillService } from './codex-skills'
import { CodexLocalGatewayService } from './local-gateway'

export type { CodexServices, CreateCodexServicesOptions } from './codex-services-shared'
export { resolveWindowsCodexDesktopExecutable } from './codex-launcher'

export function createCodexServices(options: CreateCodexServicesOptions): CodexServices {
  const store = new CodexAccountStore(
    options.userDataPath,
    options.platform,
    options.defaultCodexHome
  )
  const instanceStore = new CodexInstanceStore(options.userDataPath, options.defaultCodexHome)
  const providerStore = new CodexProviderStore(options.userDataPath, options.platform)
  const loadImmediateSnapshotForLoginEvent = async (): Promise<AppSnapshot | undefined> => {
    try {
      return await getBaseSnapshot()
    } catch {
      return getFallbackSnapshotForLoginEvent(false)
    }
  }
  const loadHydratedSnapshotForLoginEvent = async (): Promise<AppSnapshot | undefined> => {
    try {
      return await getSnapshot()
    } catch {
      return getFallbackSnapshotForLoginEvent(true)
    }
  }
  const loginCoordinator = new CodexLoginCoordinator(
    store,
    options.emitLoginEvent ?? (() => undefined),
    options.platform,
    loadImmediateSnapshotForLoginEvent,
    loadHydratedSnapshotForLoginEvent
  )
  const authRefreshTasksByAccountId = new Map<string, Promise<StoredAuthRefreshResult>>()
  const wakeTasksByAccountId = new Map<string, Promise<WakeAccountRateLimitsResult>>()
  const context = {
    store,
    instanceStore,
    providerStore,
    loginCoordinator,
    options,
    authRefreshTasksByAccountId,
    wakeTasksByAccountId
  }

  const authRuntime = createCodexServicesAuthRuntime(context)
  const instanceRuntime = createCodexServicesInstanceRuntime(context, authRuntime)
  const costUsageService = createCodexCostUsageService({
    userDataPath: options.userDataPath,
    listInstances: () => instanceRuntime.listCodexInstances()
  })
  const diagnosticsRuntime = createCodexServicesDiagnosticsRuntime(context, instanceRuntime)
  const skillService = createCodexSkillService()

  const localGatewayService = new CodexLocalGatewayService({
    store,
    providerStore,
    platform: options.platform,
    refreshAuthForUse: authRuntime.refreshAuthForUse,
    refreshStoredAuthGuarded: authRuntime.refreshStoredAuthGuarded
  })

  const {
    readStoredMockUsage,
    readUsageForAuth,
    readUsageForAuthResult,
    wakeMockUsage,
    wakeUsageForAuth,
    wakeUsageGuarded
  } = authRuntime
  const {
    getSnapshot: getBaseSnapshot,
    listCodexInstances,
    refreshExpiringAccountSession,
    resolveAccountIdOrThrow,
    resolveAccountsForExport,
    showDefaultCodex,
    startAccountInstance,
    startDefaultInstance,
    startNamedInstance,
    startProviderInstance,
    stopInstance,
    toDefaultInstanceSummary,
    toInstanceSummary
  } = instanceRuntime
  const { checkProvider, runDoctor } = diagnosticsRuntime

  const getSnapshot = async (): Promise<AppSnapshot> => {
    const snapshot = await getBaseSnapshot()
    const costSnapshot = await costUsageService.readSnapshotSummaries(snapshot.codexInstances)
    const localGatewayStatus = await localGatewayService.status()
    return {
      ...snapshot,
      ...costSnapshot,
      localGatewayStatus
    }
  }

  async function fallbackNamedInstanceSummary(
    instance: PersistedCodexInstance
  ): Promise<CodexInstanceSummary> {
    try {
      return await toInstanceSummary(instance)
    } catch {
      const persistedInstance =
        (await instanceStore
          .list()
          .then((instances) => instances.find((item) => item.id === instance.id))
          .catch(() => undefined)) ?? instance
      return {
        id: persistedInstance.id,
        name: persistedInstance.name,
        codexHome: persistedInstance.codexHome,
        bindAccountId: persistedInstance.bindAccountId,
        extraArgs: persistedInstance.extraArgs,
        isDefault: false,
        createdAt: persistedInstance.createdAt,
        updatedAt: persistedInstance.updatedAt,
        lastLaunchedAt: persistedInstance.lastLaunchedAt,
        lastPid: persistedInstance.lastPid,
        running: Boolean(persistedInstance.lastPid),
        initialized: false
      }
    }
  }

  async function fallbackDefaultInstanceSummary(
    instance: PersistedDefaultCodexInstance
  ): Promise<CodexInstanceSummary> {
    try {
      return await toDefaultInstanceSummary(instance)
    } catch {
      const persistedInstance = await instanceStore.getDefaultInstance().catch(() => instance)
      const { defaultCodexHome } = instanceStore.getDefaults()
      return {
        id: DEFAULT_CODEX_INSTANCE_ID,
        name: '',
        codexHome: defaultCodexHome,
        bindAccountId: persistedInstance.bindAccountId,
        extraArgs: persistedInstance.extraArgs,
        isDefault: true,
        createdAt: persistedInstance.updatedAt,
        updatedAt: persistedInstance.updatedAt,
        lastLaunchedAt: persistedInstance.lastLaunchedAt,
        lastPid: persistedInstance.lastPid,
        running: Boolean(persistedInstance.lastPid),
        initialized: false
      }
    }
  }

  async function ensureProviderInstanceSummary(providerId: string): Promise<CodexInstanceSummary> {
    const provider = await providerStore.get(providerId)
    const { rootDir } = instanceStore.getDefaults()
    const providerCodexHome = join(rootDir, `provider-${providerId}`)
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(providerCodexHome)
    )
    const instance =
      existing ??
      (await instanceStore.create({
        name: `Provider ${customProviderLabel(provider)}`,
        codexHome: providerCodexHome
      }))

    return fallbackNamedInstanceSummary(instance)
  }

  async function getFallbackSnapshotForLoginEvent(
    includeTokenCost: boolean
  ): Promise<AppSnapshot | undefined> {
    try {
      const [snapshot, providers, defaultInstance, namedInstances] = await Promise.all([
        store.getSnapshot(false),
        providerStore.list(),
        instanceStore.getDefaultInstance(),
        instanceStore.list()
      ])
      const codexInstances = await Promise.all([
        fallbackDefaultInstanceSummary(defaultInstance),
        ...namedInstances.map((instance) => fallbackNamedInstanceSummary(instance))
      ])
      const costSnapshot = includeTokenCost
        ? await costUsageService.readSnapshotSummaries(codexInstances)
        : {
            tokenCostByInstanceId: {},
            tokenCostErrorByInstanceId: {},
            runningTokenCostSummary: null,
            runningTokenCostInstanceIds: []
          }

      return {
        ...snapshot,
        providers,
        codexInstances,
        codexInstanceDefaults: instanceStore.getDefaults(),
        ...costSnapshot,
        localGatewayStatus: await localGatewayService.status()
      }
    } catch {
      return undefined
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
      importFromAuthFile: async (authFile) => {
        await store.importAuthFile(authFile)
        return getSnapshot()
      },
      importFromStateFile: async (stateFile) => {
        await store.importAccountsFromStateFile(stateFile)
        return getSnapshot()
      },
      importFromTemplate: async (raw) => {
        const parsed: TemplateFileRecord = parseTemplateFileRecord(raw)
        const accounts = parsed.accounts
        const exportedAt = parsed.exported_at ?? new Date().toISOString()

        for (const account of accounts) {
          const authPayload = buildAuthPayloadFromTemplate(account, exportedAt)
          const imported = await store.importAuthPayload(authPayload, {
            subscriptionExpiresAt: account.credentials.subscription_expires_at
          })
          const rateLimits = buildTemplateRateLimits(account, exportedAt)
          if (rateLimits) {
            await store.saveAccountRateLimits(imported.id, rateLimits)
          }
        }

        return getSnapshot()
      },
      exportToTemplate: async (accountIds, format = 'codexdock') => {
        const accountsToExport = await resolveAccountsForExport(accountIds)
        const snapshot = await getSnapshot()
        const exportedAt = new Date().toISOString()
        const sources = await Promise.all(
          accountsToExport.map(async (account) => ({
            account,
            auth: await store.getStoredAuthPayload(account.id),
            rateLimits: snapshot.usageByAccountId[account.id]
          }))
        )

        return serializeAccountExport(sources, exportedAt, format)
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
      refreshExpiringSession: refreshExpiringAccountSession,
      remove: async (accountId) => {
        await store.removeAccount(accountId)
        return getSnapshot()
      },
      removeMany: async (accountIds) => {
        for (const accountId of [...new Set(accountIds)]) {
          await store.removeAccount(accountId)
        }
        return getSnapshot()
      },
      updateTags: async (accountId, tagIds) => {
        await store.updateAccountTags(accountId, tagIds)
        return getSnapshot()
      },
      getWakeSchedule: (accountId) => store.getAccountWakeSchedule(accountId),
      updateWakeSchedule: async (accountId, input) => {
        await store.updateAccountWakeSchedule(accountId, input)
        return getSnapshot()
      },
      deleteWakeSchedule: async (accountId) => {
        await store.deleteAccountWakeSchedule(accountId)
        return getSnapshot()
      },
      updateWakeScheduleRuntime: async (accountId, patch) => {
        await store.patchAccountWakeSchedule(accountId, patch)
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
    providers: {
      list: () => providerStore.list(),
      create: async (input) => {
        await providerStore.create(input)
        return getSnapshot()
      },
      reorder: async (providerIds) => {
        await providerStore.reorder(providerIds)
        return getSnapshot()
      },
      update: async (providerId, input) => {
        await providerStore.update(providerId, input)
        return getSnapshot()
      },
      remove: async (providerId) => {
        const { rootDir } = instanceStore.getDefaults()
        const providerCodexHome = join(rootDir, `provider-${providerId}`)
        const instance = (await instanceStore.list()).find(
          (item) => resolve(item.codexHome) === resolve(providerCodexHome)
        )
        if (instance) {
          await stopInstance(instance.id)
          await instanceStore.remove(instance.id)
        }

        await providerStore.remove(providerId)
        return getSnapshot()
      },
      get: async (providerId) => {
        const provider = await providerStore.getResolvedProvider(providerId)
        return {
          ...provider.summary,
          apiKey: provider.apiKey
        }
      },
      check: checkProvider,
      open: async (providerId, workspacePath = options.defaultWorkspacePath) => {
        await startProviderInstance(providerId, workspacePath)
        return getSnapshot()
      }
    },
    doctor: {
      run: runDoctor
    },
    session: {
      current: async () => (await getSnapshot()).currentSession,
      projects: async (input) => listCodexSessionProjects(await listCodexInstances(), input),
      list: async (input) => listCodexSessions(await listCodexInstances(), input),
      detail: async (input) => readCodexSessionDetail(await listCodexInstances(), input),
      copyToProvider: async (input) => {
        const [instances, targetProvider] = await Promise.all([
          listCodexInstances(),
          input.targetProviderId
            ? providerStore.get(input.targetProviderId)
            : Promise.resolve(undefined)
        ])
        const targetInstance = input.targetInstanceId
          ? instances.find((instance) => instance.id === input.targetInstanceId)
          : input.targetProviderId
            ? await ensureProviderInstanceSummary(input.targetProviderId)
            : undefined

        if (!targetInstance) {
          throw new Error('Target instance not found.')
        }

        return copyCodexSessionToProvider(instances, input, targetInstance, targetProvider)
      }
    },
    settings: {
      get: async () => store.getSettings(),
      update: async (nextSettings) => {
        await store.updateSettings(nextSettings)
        return getSnapshot()
      }
    },
    usage: {
      read: async (accountId) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        if (isLocalMockAccount(account)) {
          return readStoredMockUsage(resolvedAccountId)
        }

        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        return readUsageForAuth(resolvedAccountId, account, auth)
      },
      wake: async (accountId, input) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        if (isLocalMockAccount(account)) {
          return wakeMockUsage(resolvedAccountId, input)
        }

        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        const currentUsage = await readUsageForAuthResult(resolvedAccountId, account, auth)
        const currentAccountId = currentUsage.accountId
        const currentRateLimits = currentUsage.rateLimits

        if (!canRunWakeRequest(currentRateLimits)) {
          return {
            rateLimits: currentRateLimits,
            requestResult: null
          }
        }

        const wakeResult = await wakeUsageGuarded(currentAccountId, async () => {
          const currentAccount = await store.getAccountSummary(currentAccountId)
          const latestAuth = await store.getStoredAuthPayload(currentAccountId)
          const wakeUsage = await wakeUsageForAuth(
            currentAccountId,
            currentAccount,
            latestAuth,
            input
          )
          const finalAccount = await store.getAccountSummary(wakeUsage.accountId)
          const finalAuth = await store.getStoredAuthPayload(wakeUsage.accountId)

          return {
            rateLimits: await readUsageForAuth(wakeUsage.accountId, finalAccount, finalAuth),
            requestResult: wakeUsage.requestResult
          }
        })

        if (!wakeResult) {
          return {
            rateLimits: await readUsageForAuth(
              currentAccountId,
              await store.getAccountSummary(currentAccountId),
              await store.getStoredAuthPayload(currentAccountId)
            ),
            requestResult: null
          }
        }

        return wakeResult
      }
    },
    cost: {
      read: (input) => costUsageService.read(input)
    },
    gateway: {
      start: async () => {
        await localGatewayService.start()
        return getSnapshot()
      },
      stop: async () => {
        await localGatewayService.stop()
        return getSnapshot()
      },
      status: () => localGatewayService.status(),
      rotateKey: () => localGatewayService.rotateKey()
    },
    login: {
      start: (method) => loginCoordinator.start(method),
      isRunning: () => loginCoordinator.isRunning(),
      getPortOccupant: getOpenAiCallbackPortOccupant,
      killPortOccupant: killOpenAiCallbackPortOccupant
    },
    codex: {
      show: async (workspacePath = options.defaultWorkspacePath) => {
        await showDefaultCodex(workspacePath)
        return getSnapshot()
      },
      open: async (accountId, workspacePath = options.defaultWorkspacePath) => {
        const resolvedAccountId = accountId ? await resolveAccountIdOrThrow(accountId) : undefined
        await startDefaultInstance(workspacePath, resolvedAccountId)
        return getSnapshot()
      },
      openIsolated: async (accountId, workspacePath = options.defaultWorkspacePath) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        await startAccountInstance(resolvedAccountId, workspacePath)
        return getSnapshot()
      },
      instances: {
        list: listCodexInstances,
        getDefaults: async () => instanceStore.getDefaults(),
        create: async (input) =>
          toInstanceSummary(
            await instanceStore.create({
              name: input.name,
              codexHome: input.codexHome,
              bindAccountId: input.bindAccountId,
              extraArgs: input.extraArgs
            })
          ),
        update: async (instanceId, input) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            if (input.name) {
              throw new Error('Default instance name cannot be changed.')
            }

            return toDefaultInstanceSummary(
              await instanceStore.updateDefaultInstance({
                bindAccountId: input.bindAccountId,
                extraArgs: input.extraArgs
              })
            )
          }

          return toInstanceSummary(
            await instanceStore.update(instanceId, {
              name: input.name,
              bindAccountId: input.bindAccountId,
              extraArgs: input.extraArgs
            })
          )
        },
        remove: async (instanceId) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            throw new Error('Default instance cannot be removed.')
          }

          await stopInstance(instanceId)
          await instanceStore.remove(instanceId)
        },
        start: async (instanceId, workspacePath = options.defaultWorkspacePath) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            return startDefaultInstance(workspacePath)
          }

          return startNamedInstance(instanceId, workspacePath)
        },
        stop: stopInstance
      }
    },
    skill: {
      list: async () => skillService.list(await listCodexInstances()),
      detail: async (instanceId, skillDirName) =>
        skillService.detail(await listCodexInstances(), instanceId, skillDirName),
      copy: async (input) => skillService.copy(await listCodexInstances(), input)
    }
  }
}
