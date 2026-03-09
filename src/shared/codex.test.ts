import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatRelativeReset,
  remainingPercent,
  resolveBestAccount,
  statusBarAccounts,
  type AccountRateLimits,
  type AccountSummary
} from './codex'

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

  it('prefers the account with better remaining usage', () => {
    const accounts = [createAccount('a', { email: 'a@example.com' }), createAccount('b', { email: 'b@example.com' })]
    const usageByAccountId = {
      a: createUsage({ primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: null } }),
      b: createUsage({ primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null } })
    }

    expect(resolveBestAccount(accounts, usageByAccountId)?.id).toBe('b')
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
          theme: 'light'
        },
        accounts,
        'a'
      ).map((account) => account.id)
    ).toEqual(['c', 'b'])
  })
})
