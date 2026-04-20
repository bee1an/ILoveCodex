import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createUsagePollingController } from '../usage-poller'
import type { AccountRateLimits, AccountSummary, AppSnapshot } from '../../shared/codex'

function createAccount(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    tagIds: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides
  }
}

function createUsage(fetchedAt: string): AccountRateLimits {
  return {
    limitId: 'codex',
    limitName: 'Codex',
    planType: 'plus',
    primary: {
      usedPercent: 30,
      windowDurationMins: 300,
      resetsAt: Date.parse('2026-03-08T10:00:00.000Z')
    },
    secondary: {
      usedPercent: 40,
      windowDurationMins: 10080,
      resetsAt: Date.parse('2026-03-15T10:00:00.000Z')
    },
    credits: null,
    limits: [],
    fetchedAt
  }
}

function createSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    accounts: [createAccount('a', { email: 'a@example.com' })],
    providers: [],
    tags: [],
    codexInstances: [],
    codexInstanceDefaults: {
      rootDir: '/tmp/codex-instance-homes',
      defaultCodexHome: '/Users/test/.codex'
    },
    activeAccountId: 'a',
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light',
      checkForUpdatesOnStartup: true,
      codexDesktopExecutablePath: ''
    },
    usageByAccountId: {},
    usageErrorByAccountId: {},
    ...overrides
  }
}

describe('usage polling controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T00:00:00.000Z'))
  })

  it('polls immediately when usage is missing and then waits for the configured interval', async () => {
    let snapshot = createSnapshot()
    const getSnapshot = vi.fn(async () => snapshot)
    const readAccountRateLimits = vi.fn(async (accountId: string) => {
      snapshot = {
        ...snapshot,
        usageByAccountId: {
          ...snapshot.usageByAccountId,
          [accountId]: createUsage(new Date().toISOString())
        }
      }
    })
    const onSnapshotChanged = vi.fn(async () => undefined)

    const controller = createUsagePollingController({
      getSnapshot,
      readAccountRateLimits,
      onSnapshotChanged
    })

    controller.start()
    await vi.runOnlyPendingTimersAsync()

    expect(readAccountRateLimits).toHaveBeenCalledTimes(1)
    expect(onSnapshotChanged).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(readAccountRateLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(readAccountRateLimits).toHaveBeenCalledTimes(2)
  })

  it('backs off for one polling interval after a read failure', async () => {
    const getSnapshot = vi.fn(async () => createSnapshot())
    const readAccountRateLimits = vi.fn(async () => {
      throw new Error('boom')
    })
    const onReadError = vi.fn()

    const controller = createUsagePollingController({
      getSnapshot,
      readAccountRateLimits,
      onSnapshotChanged: vi.fn(),
      onReadError
    })

    controller.start()
    await vi.runOnlyPendingTimersAsync()

    expect(readAccountRateLimits).toHaveBeenCalledTimes(1)
    expect(onReadError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(readAccountRateLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(readAccountRateLimits).toHaveBeenCalledTimes(2)
  })

  it('reschedules when the polling interval changes', async () => {
    const baseFetchedAt = '2026-03-08T00:00:00.000Z'
    let snapshot = createSnapshot({
      usageByAccountId: {
        a: createUsage(baseFetchedAt)
      }
    })
    const readAccountRateLimits = vi.fn(async () => undefined)

    const controller = createUsagePollingController({
      getSnapshot: vi.fn(async () => snapshot),
      readAccountRateLimits,
      onSnapshotChanged: vi.fn()
    })

    controller.start()
    snapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        usagePollingMinutes: 5
      }
    }
    controller.sync(snapshot)

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(readAccountRateLimits).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(readAccountRateLimits).toHaveBeenCalledTimes(1)
  })
})
