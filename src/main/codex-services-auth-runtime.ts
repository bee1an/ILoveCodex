import { refreshCodexAuthPayload, type CodexAuthPayload } from './codex-auth'
import { readAccountRateLimits, wakeAccountRateLimits } from './codex-app-server'
import {
  canRunWakeRequest,
  defaultWakeModel,
  type AccountRateLimits,
  type AccountSummary,
  type WakeAccountRateLimitsInput,
  type WakeAccountRateLimitsResult
} from '../shared/codex'
import {
  LOCAL_MOCK_MISSING_USAGE_ERROR,
  LOCAL_MOCK_WAKE_RESPONSE_BODY,
  accessTokenExpiresSoon,
  accountErrorLabel,
  authPayloadsEqualForRefresh,
  authRefreshReason,
  localMockUsageError,
  shouldClearStoredUsage,
  shouldRefreshStoredAuth,
  type CodexServicesRuntimeContext,
  type StoredAuthRefreshResult,
  type StoredUsageReadResult,
  type StoredWakeReadResult
} from './codex-services-shared'

export interface CodexServicesAuthRuntime {
  refreshStoredAuthGuarded(
    accountId: string,
    expectedAuth: CodexAuthPayload
  ): Promise<StoredAuthRefreshResult>
  refreshAuthForUse(
    accountId: string,
    auth: CodexAuthPayload,
    options?: { skewMs?: number; allowStaleFallback?: boolean }
  ): Promise<StoredAuthRefreshResult>
  readUsageForAuthResult(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<StoredUsageReadResult>
  readUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<AccountRateLimits>
  wakeUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload,
    input?: WakeAccountRateLimitsInput
  ): Promise<StoredWakeReadResult>
  wakeUsageGuarded(
    accountId: string,
    task: () => Promise<WakeAccountRateLimitsResult>
  ): Promise<WakeAccountRateLimitsResult | null>
  readStoredMockUsage(accountId: string): Promise<AccountRateLimits>
  wakeMockUsage(
    accountId: string,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRateLimitsResult>
}

export function createCodexServicesAuthRuntime(
  context: CodexServicesRuntimeContext
): CodexServicesAuthRuntime {
  const { store, loginCoordinator, options, authRefreshTasksByAccountId, wakeTasksByAccountId } =
    context

  async function persistRefreshedAuth(
    accountId: string,
    refreshedAuth: CodexAuthPayload
  ): Promise<{ accountId: string; auth: CodexAuthPayload }> {
    await store.syncCurrentAuthPayload(accountId, refreshedAuth)
    const refreshedAccount = await store.importAuthPayload(refreshedAuth)
    return {
      accountId: refreshedAccount.id,
      auth: refreshedAuth
    }
  }

  async function refreshStoredAuthGuarded(
    accountId: string,
    expectedAuth: CodexAuthPayload
  ): Promise<StoredAuthRefreshResult> {
    const existingTask = authRefreshTasksByAccountId.get(accountId)
    if (existingTask) {
      return existingTask
    }

    const task = (async (): Promise<StoredAuthRefreshResult> => {
      const currentAuth = await store.importCurrentAuthPayloadForAccount(accountId)
      if (currentAuth?.changed) {
        return {
          accountId: currentAuth.account.id,
          auth: currentAuth.auth,
          refreshed: false
        }
      }

      const latestAuth = await store.getStoredAuthPayload(accountId)
      if (!authPayloadsEqualForRefresh(latestAuth, expectedAuth)) {
        return {
          accountId,
          auth: latestAuth,
          refreshed: false
        }
      }

      const refreshedAuth = await refreshCodexAuthPayload(latestAuth, options.platform)
      const persisted = await persistRefreshedAuth(accountId, refreshedAuth)
      return {
        ...persisted,
        refreshed: true
      }
    })()

    authRefreshTasksByAccountId.set(accountId, task)
    try {
      return await task
    } finally {
      if (authRefreshTasksByAccountId.get(accountId) === task) {
        authRefreshTasksByAccountId.delete(accountId)
      }
    }
  }

  async function refreshAuthForUse(
    accountId: string,
    auth: CodexAuthPayload,
    options?: { skewMs?: number; allowStaleFallback?: boolean }
  ): Promise<StoredAuthRefreshResult> {
    const skewMs = options?.skewMs ?? 60_000
    const reason = authRefreshReason(auth, skewMs)
    if (!reason) {
      return {
        accountId,
        auth,
        refreshed: false
      }
    }

    try {
      return await refreshStoredAuthGuarded(accountId, auth)
    } catch (error) {
      if (
        options?.allowStaleFallback &&
        reason === 'stale' &&
        !accessTokenExpiresSoon(auth.tokens?.access_token, skewMs)
      ) {
        return {
          accountId,
          auth,
          refreshed: false
        }
      }

      throw error
    }
  }

  async function readUsageForAuthResult(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<StoredUsageReadResult> {
    let targetAccountId = accountId
    let targetAuth = auth

    try {
      const prepared = await refreshAuthForUse(targetAccountId, targetAuth, {
        allowStaleFallback: true
      })
      targetAccountId = prepared.accountId
      targetAuth = prepared.auth

      let rateLimits: AccountRateLimits

      try {
        rateLimits = await readAccountRateLimits(targetAuth, options.platform)
      } catch (error) {
        if (!shouldRefreshStoredAuth(error, targetAuth.tokens?.refresh_token)) {
          throw error
        }

        const refreshed = await refreshStoredAuthGuarded(targetAccountId, targetAuth)
        targetAccountId = refreshed.accountId
        targetAuth = refreshed.auth
        rateLimits = await readAccountRateLimits(targetAuth, options.platform)
      }

      await Promise.all([
        store.saveAccountRateLimits(targetAccountId, rateLimits),
        store.clearAccountUsageError(targetAccountId)
      ])
      return {
        accountId: targetAccountId,
        rateLimits
      }
    } catch (error) {
      if (shouldClearStoredUsage(error)) {
        await store.clearAccountRateLimits(targetAccountId)
      }

      const detail = error instanceof Error ? error.message : 'Failed to read account limits.'
      await store.saveAccountUsageError(targetAccountId, detail)
      throw new Error(`${accountErrorLabel(account)}: ${detail}`)
    }
  }

  async function readUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<AccountRateLimits> {
    return (await readUsageForAuthResult(accountId, account, auth)).rateLimits
  }

  async function wakeUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload,
    input?: WakeAccountRateLimitsInput
  ): Promise<StoredWakeReadResult> {
    let targetAccountId = accountId
    let targetAuth = auth

    try {
      const prepared = await refreshAuthForUse(targetAccountId, targetAuth, {
        allowStaleFallback: true
      })
      targetAccountId = prepared.accountId
      targetAuth = prepared.auth

      try {
        const result = await wakeAccountRateLimits(targetAuth, options.platform, input)
        await store.clearAccountUsageError(targetAccountId)
        return {
          accountId: targetAccountId,
          requestResult: result
        }
      } catch (error) {
        if (!shouldRefreshStoredAuth(error, targetAuth.tokens?.refresh_token)) {
          throw error
        }

        const refreshed = await refreshStoredAuthGuarded(targetAccountId, targetAuth)
        targetAccountId = refreshed.accountId
        targetAuth = refreshed.auth
        const result = await wakeAccountRateLimits(targetAuth, options.platform, input)
        await store.clearAccountUsageError(targetAccountId)
        return {
          accountId: targetAccountId,
          requestResult: result
        }
      }
    } catch (error) {
      if (shouldClearStoredUsage(error)) {
        await store.clearAccountRateLimits(targetAccountId)
      }

      const detail = error instanceof Error ? error.message : 'Failed to wake account limits.'
      await store.saveAccountUsageError(targetAccountId, detail)
      throw new Error(`${accountErrorLabel(account)}: ${detail}`)
    }
  }

  async function wakeUsageGuarded(
    accountId: string,
    task: () => Promise<WakeAccountRateLimitsResult>
  ): Promise<WakeAccountRateLimitsResult | null> {
    const existingTask = wakeTasksByAccountId.get(accountId)
    if (existingTask) {
      return null
    }

    const nextTask = task()
    wakeTasksByAccountId.set(accountId, nextTask)

    try {
      return await nextTask
    } finally {
      if (wakeTasksByAccountId.get(accountId) === nextTask) {
        wakeTasksByAccountId.delete(accountId)
      }
    }
  }

  async function readStoredMockUsage(accountId: string): Promise<AccountRateLimits> {
    const demoError = localMockUsageError(accountId)
    if (demoError) {
      await store.saveAccountUsageError(accountId, demoError)
      throw new Error(demoError)
    }

    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    const storedRateLimits = snapshot.usageByAccountId[accountId]
    if (!storedRateLimits) {
      throw new Error(LOCAL_MOCK_MISSING_USAGE_ERROR)
    }

    const touchedRateLimits: AccountRateLimits = {
      ...storedRateLimits,
      fetchedAt: new Date().toISOString()
    }

    await Promise.all([
      store.saveAccountRateLimits(accountId, touchedRateLimits),
      store.clearAccountUsageError(accountId)
    ])

    return touchedRateLimits
  }

  async function wakeMockUsage(
    accountId: string,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRateLimitsResult> {
    const rateLimits = await readStoredMockUsage(accountId)

    if (!canRunWakeRequest(rateLimits)) {
      return {
        rateLimits,
        requestResult: null
      }
    }

    return {
      rateLimits,
      requestResult: {
        status: 200,
        accepted: true,
        model: input?.model?.trim() || defaultWakeModel,
        prompt: input?.prompt?.trim() || 'ping',
        body: LOCAL_MOCK_WAKE_RESPONSE_BODY
      }
    }
  }

  return {
    refreshStoredAuthGuarded,
    refreshAuthForUse,
    readUsageForAuthResult,
    readUsageForAuth,
    wakeUsageForAuth,
    wakeUsageGuarded,
    readStoredMockUsage,
    wakeMockUsage
  }
}
