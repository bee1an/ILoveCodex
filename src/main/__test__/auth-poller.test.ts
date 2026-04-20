import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthRefreshController } from '../auth-poller'
import type { AccountSummary, AppSnapshot } from '../../shared/codex'

function createAccount(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    tagIds: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides
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

describe('auth refresh controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T00:00:00.000Z'))
  })

  it('polls immediately and emits snapshot updates when a session refreshes', async () => {
    const getSnapshot = vi.fn(async () => createSnapshot())
    const refreshExpiringSession = vi.fn(async () => true)
    const onSnapshotChanged = vi.fn(async () => undefined)

    const controller = createAuthRefreshController({
      getSnapshot,
      refreshExpiringSession,
      onSnapshotChanged
    })

    controller.start()
    await vi.runAllTicks()
    await Promise.resolve()

    expect(refreshExpiringSession).toHaveBeenCalledTimes(1)
    expect(onSnapshotChanged).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(refreshExpiringSession).toHaveBeenCalledTimes(2)
  })

  it('backs off after a refresh failure', async () => {
    const getSnapshot = vi.fn(async () => createSnapshot())
    const refreshExpiringSession = vi.fn(async () => {
      throw new Error('boom')
    })
    const onRefreshError = vi.fn()

    const controller = createAuthRefreshController({
      getSnapshot,
      refreshExpiringSession,
      onSnapshotChanged: vi.fn(),
      onRefreshError
    })

    controller.start()
    await vi.runAllTicks()
    await Promise.resolve()

    expect(refreshExpiringSession).toHaveBeenCalledTimes(1)
    expect(onRefreshError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(refreshExpiringSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(refreshExpiringSession).toHaveBeenCalledTimes(2)
  })
})
