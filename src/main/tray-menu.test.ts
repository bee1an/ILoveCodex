import { describe, expect, it, vi } from 'vitest'

import { buildTrayUsageMenuItems, resolveTrayAccounts } from './tray-menu'
import type { AccountRateLimits, AccountSummary, AppSnapshot } from '../shared/codex'

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
    fetchedAt: '2026-03-08T00:00:00.000Z',
    ...overrides
  }
}

function createSnapshot(): AppSnapshot {
  return {
    accounts: [
      createAccount('a', { email: 'a@example.com' }),
      createAccount('b', { email: 'b@example.com' }),
      createAccount('c', { email: 'c@example.com' })
    ],
    tags: [],
    activeAccountId: 'a',
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: ['c', 'b'],
      language: 'zh-CN',
      theme: 'light'
    },
    usageByAccountId: {
      a: createUsage(),
      b: createUsage({ primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } }),
      c: createUsage({ primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: null } })
    }
  }
}

describe('tray menu helpers', () => {
  it('shows up to five tray accounts with the active account first', () => {
    const snapshot: AppSnapshot = {
      ...createSnapshot(),
      accounts: [
        createAccount('a', { email: 'a@example.com' }),
        createAccount('b', { email: 'b@example.com' }),
        createAccount('c', { email: 'c@example.com' }),
        createAccount('d', { email: 'd@example.com' }),
        createAccount('e', { email: 'e@example.com' }),
        createAccount('f', { email: 'f@example.com' })
      ],
      settings: {
        ...createSnapshot().settings,
        statusBarAccountIds: ['c']
      }
    }

    expect(resolveTrayAccounts(snapshot).map((account) => account.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e'
    ])
  })

  it('restarts Codex with the clicked tray account instead of only opening the main window', () => {
    const openAccount = vi.fn()
    const items = buildTrayUsageMenuItems(createSnapshot(), {
      activePrefix: '当前 · ',
      noVisibleAccount: '还没有可显示的账号',
      language: 'zh-CN',
      accountLabel: (account) => account.email ?? account.id,
      openAccount
    })

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      label: '当前 · a@example.com  h70%  w60%',
      checked: true,
      enabled: false,
      type: 'radio'
    })

    items[1].click?.(undefined as never, undefined as never, undefined as never)
    expect(openAccount).toHaveBeenCalledWith('b')
  })
})
