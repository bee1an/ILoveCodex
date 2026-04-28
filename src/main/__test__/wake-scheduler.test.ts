import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWakeSchedulerController } from '../wake-scheduler'
import type {
  AccountRateLimits,
  AccountSummary,
  AccountWakeSchedule,
  AppSnapshot,
  WakeAccountRateLimitsResult
} from '../../shared/codex'

function createAccount(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    tagIds: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides
  }
}

function createUsage(planType = 'plus'): AccountRateLimits {
  return {
    limitId: 'codex',
    limitName: 'Codex',
    planType,
    primary: {
      usedPercent: 30,
      windowDurationMins: 300,
      resetsAt: Date.parse('2026-03-08T10:00:00.000Z')
    },
    secondary:
      planType === 'free'
        ? null
        : {
            usedPercent: 40,
            windowDurationMins: 10080,
            resetsAt: Date.parse('2026-03-15T10:00:00.000Z')
          },
    credits: null,
    limits: [],
    fetchedAt: '2026-03-08T00:00:00.000Z'
  }
}

function createSchedule(overrides: Partial<AccountWakeSchedule> = {}): AccountWakeSchedule {
  return {
    enabled: true,
    times: ['09:00'],
    model: 'gpt-5.4-mini',
    prompt: 'ping',
    lastStatus: 'idle',
    ...overrides
  }
}

function createWakeResult(body = 'wake ok'): WakeAccountRateLimitsResult {
  return {
    rateLimits: createUsage(),
    requestResult: {
      status: 200,
      accepted: true,
      model: 'gpt-5.4-mini',
      prompt: 'ping',
      body
    }
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
    usageByAccountId: {
      a: createUsage()
    },
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: [],
    ...overrides
  }
}

async function flushAsync(): Promise<void> {
  await vi.runAllTicks()
  await Promise.resolve()
}

describe('wake scheduler controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('补跑当天最近一个错过的时点', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 15, 30, 0, 0))

    let snapshot = createSnapshot({
      wakeSchedulesByAccountId: {
        a: createSchedule({
          times: ['09:00', '14:00', '19:00']
        })
      }
    })

    const wakeAccount = vi.fn(async () => createWakeResult())
    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount,
      updateWakeScheduleRuntime: async (accountId, patch) => {
        snapshot = {
          ...snapshot,
          wakeSchedulesByAccountId: {
            ...snapshot.wakeSchedulesByAccountId,
            [accountId]: {
              ...snapshot.wakeSchedulesByAccountId[accountId],
              ...patch
            }
          }
        }
      },
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()

    expect(wakeAccount).toHaveBeenCalledTimes(1)
    expect(wakeAccount).toHaveBeenCalledWith('a', { model: 'gpt-5.4-mini', prompt: 'ping' })
    expect(snapshot.wakeSchedulesByAccountId.a.lastStatus).toBe('success')
    expect(snapshot.wakeSchedulesByAccountId.a.lastTriggeredAt).toBeTruthy()
  })

  it('按全局最近时刻调度多个账号', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 8, 50, 0, 0))

    const wakeCallOrder: string[] = []
    let snapshot = createSnapshot({
      accounts: [
        createAccount('a', { email: 'a@example.com' }),
        createAccount('b', { email: 'b@example.com' })
      ],
      usageByAccountId: {
        a: createUsage(),
        b: createUsage()
      },
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['09:00'] }),
        b: createSchedule({ times: ['08:55'] })
      }
    })

    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount: async (accountId) => {
        wakeCallOrder.push(accountId)
        return createWakeResult(accountId)
      },
      updateWakeScheduleRuntime: async (accountId, patch) => {
        snapshot = {
          ...snapshot,
          wakeSchedulesByAccountId: {
            ...snapshot.wakeSchedulesByAccountId,
            [accountId]: {
              ...snapshot.wakeSchedulesByAccountId[accountId],
              ...patch
            }
          }
        }
      },
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()
    expect(wakeCallOrder).toEqual([])

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(wakeCallOrder).toEqual(['b'])

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(wakeCallOrder).toEqual(['b', 'a'])
  })

  it('忽略 free 账号和 disabled 配置', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 10, 1, 0, 0))

    const snapshot = createSnapshot({
      accounts: [
        createAccount('a', { email: 'a@example.com' }),
        createAccount('b', { email: 'b@example.com' })
      ],
      usageByAccountId: {
        a: createUsage('free'),
        b: createUsage()
      },
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['10:00'] }),
        b: createSchedule({ enabled: false, times: ['10:00'] })
      }
    })

    const wakeAccount = vi.fn(async () => createWakeResult())
    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount,
      updateWakeScheduleRuntime: vi.fn(async () => undefined),
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(wakeAccount).not.toHaveBeenCalled()
  })

  it('周额度剩余为 0 时不触发定时唤醒', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 10, 1, 0, 0))
    const depletedUsage = createUsage('plus')

    const snapshot = createSnapshot({
      usageByAccountId: {
        a: {
          ...depletedUsage,
          secondary: {
            usedPercent: 100,
            windowDurationMins: 10080,
            resetsAt: Date.parse('2026-03-15T10:00:00.000Z')
          }
        }
      },
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['10:00'] })
      }
    })

    const wakeAccount = vi.fn(async () => createWakeResult())
    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount,
      updateWakeScheduleRuntime: vi.fn(async () => undefined),
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(wakeAccount).not.toHaveBeenCalled()
  })

  it('等待额度信息加载完成后才会触发定时唤醒', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 9, 1, 0, 0))

    let snapshot = createSnapshot({
      usageByAccountId: {},
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['09:00'] })
      }
    })

    const wakeAccount = vi.fn(async () => createWakeResult())
    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount,
      updateWakeScheduleRuntime: vi.fn(async () => undefined),
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()

    expect(wakeAccount).not.toHaveBeenCalled()

    snapshot = {
      ...snapshot,
      usageByAccountId: {
        a: createUsage()
      }
    }

    controller.sync(snapshot)
    await vi.advanceTimersByTimeAsync(0)

    expect(wakeAccount).toHaveBeenCalledTimes(1)
  })

  it('失败后 5 分钟只重试一次', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 9, 1, 0, 0))

    let snapshot = createSnapshot({
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['09:00'] })
      }
    })

    const wakeAccount = vi
      .fn(async (...args: [string, unknown]) => {
        void args
        return createWakeResult('retry ok')
      })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(createWakeResult('retry ok'))

    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount: async (accountId, input) => wakeAccount(accountId, input),
      updateWakeScheduleRuntime: async (accountId, patch) => {
        snapshot = {
          ...snapshot,
          wakeSchedulesByAccountId: {
            ...snapshot.wakeSchedulesByAccountId,
            [accountId]: {
              ...snapshot.wakeSchedulesByAccountId[accountId],
              ...patch
            }
          }
        }
      },
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()
    await flushAsync()

    expect(wakeAccount).toHaveBeenCalledTimes(1)
    expect(snapshot.wakeSchedulesByAccountId.a.lastStatus).toBe('error')
    expect(snapshot.wakeSchedulesByAccountId.a.lastTriggeredAt).toBeUndefined()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(wakeAccount).toHaveBeenCalledTimes(2)
    expect(snapshot.wakeSchedulesByAccountId.a.lastStatus).toBe('success')
    expect(snapshot.wakeSchedulesByAccountId.a.lastTriggeredAt).toBeTruthy()
  })

  it('重试仍失败后推进触发时间并等待下一个时点', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 9, 1, 0, 0))

    let snapshot = createSnapshot({
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['09:00'] })
      }
    })

    const wakeAccount = vi.fn(async () => {
      throw new Error('boom')
    })

    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount,
      updateWakeScheduleRuntime: async (accountId, patch) => {
        snapshot = {
          ...snapshot,
          wakeSchedulesByAccountId: {
            ...snapshot.wakeSchedulesByAccountId,
            [accountId]: {
              ...snapshot.wakeSchedulesByAccountId[accountId],
              ...patch
            }
          }
        }
      },
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()
    expect(wakeAccount).toHaveBeenCalledTimes(1)
    expect(snapshot.wakeSchedulesByAccountId.a.lastTriggeredAt).toBeUndefined()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(wakeAccount).toHaveBeenCalledTimes(2)
    expect(snapshot.wakeSchedulesByAccountId.a.lastStatus).toBe('error')
    expect(snapshot.wakeSchedulesByAccountId.a.lastTriggeredAt).toBeTruthy()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(wakeAccount).toHaveBeenCalledTimes(2)
  })

  it('wake 返回空请求结果时记录为 skipped', async () => {
    vi.setSystemTime(new Date(2026, 2, 8, 9, 1, 0, 0))

    let snapshot = createSnapshot({
      wakeSchedulesByAccountId: {
        a: createSchedule({ times: ['09:00'] })
      }
    })

    const controller = createWakeSchedulerController({
      getSnapshot: async () => snapshot,
      wakeAccount: async () => ({
        rateLimits: createUsage(),
        requestResult: null
      }),
      updateWakeScheduleRuntime: async (accountId, patch) => {
        snapshot = {
          ...snapshot,
          wakeSchedulesByAccountId: {
            ...snapshot.wakeSchedulesByAccountId,
            [accountId]: {
              ...snapshot.wakeSchedulesByAccountId[accountId],
              ...patch
            }
          }
        }
      },
      onSnapshotChanged: vi.fn(async () => undefined)
    })

    controller.start()
    await flushAsync()

    expect(snapshot.wakeSchedulesByAccountId.a.lastStatus).toBe('skipped')
  })
})
