import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  filterLocalMockAppSnapshot,
  formatRelativeReset,
  isLocalMockAccount,
  isLocalMockProvider,
  normalizeStatsDisplaySettings,
  remainingPercent,
  resolveBestAccount,
  serializeStatsDisplaySettings,
  shouldAutoPollUsage,
  statusBarAccounts,
  usagePollDueInMs,
  usagePollingIntervalMs,
  type AccountRateLimits,
  type AppSnapshot,
  type AccountSummary
} from '../codex'

function createAccount(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    tagIds: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides
  }
}

function createUsage(overrides: Partial<AccountRateLimits> = {}): AccountRateLimits {
  return {
    limitId: 'codex',
    limitName: 'Codex',
    planType: 'plus',
    primary: {
      usedPercent: 50,
      windowDurationMins: 300,
      resetsAt: Date.parse('2026-03-08T10:00:00.000Z')
    },
    secondary: {
      usedPercent: 50,
      windowDurationMins: 10080,
      resetsAt: Date.parse('2026-03-15T10:00:00.000Z')
    },
    credits: null,
    limits: [],
    fetchedAt: '2026-03-08T00:00:00.000Z',
    ...overrides
  }
}

function createSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    accounts: [],
    providers: [],
    tags: [],
    codexInstances: [],
    codexInstanceDefaults: {
      rootDir: '',
      defaultCodexHome: ''
    },
    activeAccountId: undefined,
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light',
      checkForUpdatesOnStartup: true,
      codexDesktopExecutablePath: '',
      showLocalMockData: true
    },
    usageByAccountId: {},
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: [],
    ...overrides
  }
}

describe('codex shared helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T00:00:00.000Z'))
  })

  it('formats reset windows for english and chinese', () => {
    expect(formatRelativeReset(Date.parse('2026-03-08T02:30:00.000Z'), 'en')).toBe('2h 30m')
    expect(formatRelativeReset(Date.parse('2026-03-09T03:00:00.000Z'), 'zh-CN')).toBe('1天3小时')
    expect(formatRelativeReset(Date.parse('2026-03-07T23:59:00.000Z'), 'en')).toBe('Soon')
  })

  it('clamps remaining percent to the valid range', () => {
    expect(remainingPercent(-20)).toBe(100)
    expect(remainingPercent(25)).toBe(75)
    expect(remainingPercent(140)).toBe(0)
  })

  it('serializes stats display settings for CLI output', () => {
    expect(serializeStatsDisplaySettings()).toBe('all')
    expect(
      serializeStatsDisplaySettings({
        dailyTrend: false,
        modelBreakdown: true,
        instanceUsage: false,
        accountUsage: true
      })
    ).toBe('modelBreakdown,accountUsage')
    expect(
      serializeStatsDisplaySettings(
        normalizeStatsDisplaySettings({
          dailyTrend: false,
          modelBreakdown: false,
          instanceUsage: false,
          accountUsage: false
        })
      )
    ).toBe('none')
  })

  it('normalizes partial stats display settings with token-first defaults', () => {
    expect(
      normalizeStatsDisplaySettings({
        instanceUsage: false
      })
    ).toEqual({
      dailyTrend: true,
      modelBreakdown: true,
      instanceUsage: false,
      accountUsage: true
    })
  })

  it('detects seeded local mock accounts', () => {
    expect(isLocalMockAccount({ email: 'local-plus-1@mock.local' })).toBe(true)
    expect(isLocalMockAccount({ accountId: 'acct-local-enterprise' })).toBe(true)
    expect(isLocalMockAccount({ email: 'real@example.com', accountId: 'acct-real' })).toBe(false)
  })

  it('detects seeded local mock providers', () => {
    expect(isLocalMockProvider({ baseUrl: 'https://mock-provider.local/v1' })).toBe(true)
    expect(isLocalMockProvider({ baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })

  it('filters local mock content from snapshots when the toggle is disabled', () => {
    const realAccount = createAccount('real-a', { email: 'real@example.com' })
    const mockAccount = createAccount('mock-a', {
      email: 'local-plus-1@mock.local',
      accountId: 'acct-local-plus-1'
    })

    const filtered = filterLocalMockAppSnapshot(
      createSnapshot({
        accounts: [mockAccount, realAccount],
        providers: [
          {
            id: 'mock-provider',
            name: 'Local Mock Provider',
            baseUrl: 'https://mock-provider.local/v1',
            model: 'gpt-5.4',
            fastMode: false,
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z'
          }
        ],
        activeAccountId: mockAccount.id,
        currentSession: {
          email: mockAccount.email,
          accountId: mockAccount.accountId
        },
        settings: {
          usagePollingMinutes: 15,
          statusBarAccountIds: [mockAccount.id, realAccount.id],
          language: 'zh-CN',
          theme: 'light',
          checkForUpdatesOnStartup: true,
          codexDesktopExecutablePath: '',
          showLocalMockData: false
        },
        usageByAccountId: {
          [mockAccount.id]: createUsage(),
          [realAccount.id]: createUsage()
        },
        usageErrorByAccountId: {
          [mockAccount.id]: 'mock error',
          [realAccount.id]: 'real error'
        },
        wakeSchedulesByAccountId: {
          [mockAccount.id]: {
            enabled: true,
            times: ['09:00'],
            model: 'gpt-5.4',
            prompt: 'ping'
          },
          [realAccount.id]: {
            enabled: true,
            times: ['10:00'],
            model: 'gpt-5.4',
            prompt: 'ping'
          }
        }
      })
    )

    expect(filtered.accounts.map((account) => account.id)).toEqual([realAccount.id])
    expect(filtered.providers).toHaveLength(0)
    expect(filtered.activeAccountId).toBeUndefined()
    expect(filtered.currentSession).toBeNull()
    expect(filtered.settings.statusBarAccountIds).toEqual([realAccount.id])
    expect(Object.keys(filtered.usageByAccountId)).toEqual([realAccount.id])
    expect(Object.keys(filtered.usageErrorByAccountId)).toEqual([realAccount.id])
    expect(Object.keys(filtered.wakeSchedulesByAccountId)).toEqual([realAccount.id])
  })

  it('filters real content from snapshots when the toggle is enabled', () => {
    const realAccount = createAccount('real-a', { email: 'real@example.com' })
    const mockAccount = createAccount('mock-a', {
      email: 'local-plus-1@mock.local',
      accountId: 'acct-local-plus-1'
    })

    const filtered = filterLocalMockAppSnapshot(
      createSnapshot({
        accounts: [mockAccount, realAccount],
        providers: [
          {
            id: 'mock-provider',
            name: 'Local Mock Provider',
            baseUrl: 'https://mock-provider.local/v1',
            model: 'gpt-5.4',
            fastMode: false,
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z'
          },
          {
            id: 'real-provider',
            name: 'Real Provider',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.4',
            fastMode: false,
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z'
          }
        ],
        activeAccountId: realAccount.id,
        currentSession: {
          email: realAccount.email,
          accountId: realAccount.accountId
        },
        settings: {
          usagePollingMinutes: 15,
          statusBarAccountIds: [mockAccount.id, realAccount.id],
          language: 'zh-CN',
          theme: 'light',
          checkForUpdatesOnStartup: true,
          codexDesktopExecutablePath: '',
          showLocalMockData: true
        },
        usageByAccountId: {
          [mockAccount.id]: createUsage(),
          [realAccount.id]: createUsage()
        },
        usageErrorByAccountId: {
          [mockAccount.id]: 'mock error',
          [realAccount.id]: 'real error'
        },
        wakeSchedulesByAccountId: {
          [mockAccount.id]: {
            enabled: true,
            times: ['09:00'],
            model: 'gpt-5.4',
            prompt: 'ping'
          },
          [realAccount.id]: {
            enabled: true,
            times: ['10:00'],
            model: 'gpt-5.4',
            prompt: 'ping'
          }
        }
      })
    )

    expect(filtered.accounts.map((account) => account.id)).toEqual([mockAccount.id])
    expect(filtered.providers.map((provider) => provider.id)).toEqual(['mock-provider'])
    expect(filtered.activeAccountId).toBeUndefined()
    expect(filtered.currentSession).toBeNull()
    expect(filtered.settings.statusBarAccountIds).toEqual([mockAccount.id])
    expect(Object.keys(filtered.usageByAccountId)).toEqual([mockAccount.id])
    expect(Object.keys(filtered.usageErrorByAccountId)).toEqual([mockAccount.id])
    expect(Object.keys(filtered.wakeSchedulesByAccountId)).toEqual([mockAccount.id])
  })

  it('computes usage polling windows from fetched timestamps', () => {
    expect(usagePollingIntervalMs(15)).toBe(15 * 60 * 1000)
    expect(usagePollDueInMs(createUsage(), 15)).toBe(15 * 60 * 1000)

    const freshUsage = createUsage({ fetchedAt: '2026-03-08T00:10:00.000Z' })
    vi.setSystemTime(new Date('2026-03-08T00:20:00.000Z'))

    expect(usagePollDueInMs(freshUsage, 15)).toBe(5 * 60 * 1000)
    expect(shouldAutoPollUsage(freshUsage, 15)).toBe(false)
    expect(shouldAutoPollUsage(freshUsage, 10)).toBe(true)
  })

  it('prefers the account with better remaining usage', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' })
    ]
    const usageByAccountId = {
      a: createUsage({ primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: null } }),
      b: createUsage({ primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null } })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)?.id).toBe('b')
  })

  it('prefers accounts that still have both 5h and weekly quota remaining', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' })
    ]
    const usageByAccountId = {
      a: createUsage({
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: null }
      }),
      b: createUsage({
        primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null }
      })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)?.id).toBe('b')
  })

  it('uses the tighter quota window as the primary ranking signal', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' })
    ]
    const usageByAccountId = {
      a: createUsage({
        primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: null }
      }),
      b: createUsage({
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: null }
      })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)?.id).toBe('a')
  })

  it('falls back to the active account when usage is tied', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com', lastUsedAt: '2026-03-07T00:00:00.000Z' }),
      createAccount('b', { email: 'b@example.com', lastUsedAt: '2026-03-08T00:00:00.000Z' })
    ]
    const usageByAccountId = {
      a: createUsage(),
      b: createUsage()
    }

    expect(resolveBestAccount(accounts, usageByAccountId, 'a')?.id).toBe('a')
  })

  it('returns null when no account has both 5h and weekly quota left', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' })
    ]
    const usageByAccountId = {
      a: createUsage({
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: null }
      }),
      b: createUsage({
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: null }
      })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)).toBeNull()
  })

  it('treats free accounts as weekly-only quota accounts', () => {
    const accounts = [createAccount('free-a', { email: 'free@example.com' })]
    const usageByAccountId = {
      'free-a': createUsage({
        planType: 'free',
        primary: null,
        secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: null }
      })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)?.id).toBe('free-a')
  })

  it('does not select free accounts without weekly quota', () => {
    const accounts = [createAccount('free-a', { email: 'free@example.com' })]
    const usageByAccountId = {
      'free-a': createUsage({
        planType: 'free',
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null },
        secondary: null
      })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)).toBeNull()
  })

  it('resolves menu bar accounts from configured ids before falling back', () => {
    const accounts = [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' }),
      createAccount('c', { email: 'c@example.com' })
    ]

    expect(
      statusBarAccounts(
        {
          usagePollingMinutes: 15,
          statusBarAccountIds: ['c', 'b'],
          language: 'zh-CN',
          theme: 'light',
          checkForUpdatesOnStartup: true,
          codexDesktopExecutablePath: ''
        },
        accounts,
        'a'
      ).map((account) => account.id)
    ).toEqual(['c', 'b'])
  })
})
