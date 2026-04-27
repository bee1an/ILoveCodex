import { describe, expect, it } from 'vitest'

import {
  accountSubscriptionBadge,
  accountUsageBadge,
  extraLimits,
  messages,
  weeklyResetTimeToneClass
} from '../app-view'

describe('app view account usage badge', () => {
  it('shows the underlying refresh error detail instead of only the generic label', () => {
    const badge = accountUsageBadge(
      'user@example.com: OpenAI token refresh failed (400): invalid_grant',
      {
        id: 'acct-1',
        email: 'user@example.com'
      },
      messages['en']
    )

    expect(badge).toEqual({
      kind: 'expired',
      detail: 'OpenAI token refresh failed (400): invalid_grant',
      title:
        'Session is no longer valid. Sign in again or re-import the current login.\nOpenAI token refresh failed (400): invalid_grant'
    })
  })

  it('keeps non-expired errors visible on the account card', () => {
    const badge = accountUsageBadge(
      'service temporarily unavailable',
      {
        id: 'acct-2',
        email: 'user@example.com'
      },
      messages['zh-CN']
    )

    expect(badge).toEqual({
      kind: 'error',
      detail: 'service temporarily unavailable',
      title: 'service temporarily unavailable'
    })
  })

  it('does not classify transient refresh failures as expired sessions', () => {
    const badge = accountUsageBadge(
      'OpenAI token refresh failed (500): service temporarily unavailable',
      {
        id: 'acct-2',
        email: 'user@example.com'
      },
      messages['zh-CN']
    )

    expect(badge).toEqual({
      kind: 'error',
      detail: 'OpenAI token refresh failed (500): service temporarily unavailable',
      title: 'OpenAI token refresh failed (500): service temporarily unavailable'
    })
  })

  it('classifies refresh token reuse as an expired session', () => {
    const badge = accountUsageBadge(
      'OpenAI token refresh failed (400): refresh_token_reused',
      {
        id: 'acct-2',
        email: 'user@example.com'
      },
      messages['en']
    )

    expect(badge?.kind).toBe('expired')
    expect(badge?.detail).toBe('OpenAI token refresh failed (400): refresh_token_reused')
  })

  it('classifies deactivated workspace as a dedicated workspace error', () => {
    const badge = accountUsageBadge(
      'deactivated_workspace',
      {
        id: 'acct-4',
        email: 'user@example.com'
      },
      messages['zh-CN']
    )

    expect(badge).toEqual({
      kind: 'workspace',
      detail: 'deactivated_workspace',
      title: 'deactivated_workspace'
    })
  })

  it('returns null for healthy accounts', () => {
    expect(
      accountUsageBadge(
        undefined,
        {
          id: 'acct-3',
          email: 'user@example.com'
        },
        messages['zh-CN']
      )
    ).toBeNull()
  })

  it('hides review limits from extra limits display', () => {
    expect(
      extraLimits(
        {
          'acct-5': {
            limitId: 'codex',
            limitName: 'Codex',
            planType: 'team',
            primary: null,
            secondary: null,
            credits: null,
            fetchedAt: '2026-03-27T00:00:00.000Z',
            limits: [
              {
                limitId: 'codex',
                limitName: 'Codex',
                planType: 'team',
                primary: null,
                secondary: null
              },
              {
                limitId: 'code-review',
                limitName: 'Code Review',
                planType: 'team',
                primary: null,
                secondary: null
              },
              {
                limitId: 'gpt-4.1',
                limitName: 'GPT-4.1',
                planType: 'team',
                primary: null,
                secondary: null
              }
            ]
          }
        },
        'acct-5'
      ).map((limit) => limit.limitId)
    ).toEqual(['gpt-4.1'])
  })

  it('uses day-based colors for weekly reset times', () => {
    const now = Date.parse('2026-04-20T00:00:00.000Z')

    expect(weeklyResetTimeToneClass(undefined, now)).toBe('text-muted-strong')
    expect(weeklyResetTimeToneClass(now + 6 * 60 * 60_000, now)).toBe('text-emerald-700')
    expect(weeklyResetTimeToneClass(now + 2 * 24 * 60 * 60_000, now)).toBe('text-sky-700')
    expect(weeklyResetTimeToneClass(now + 4 * 24 * 60 * 60_000, now)).toBe('text-amber-700')
    expect(weeklyResetTimeToneClass(now + 6 * 24 * 60 * 60_000, now)).toBe('text-red-700')
  })

  it('formats subscription expiration badges when the claim exists', () => {
    const badge = accountSubscriptionBadge(
      '2026-05-15T04:28:55.000Z',
      'zh-CN',
      messages['zh-CN'],
      Date.parse('2026-05-13T02:28:55.000Z')
    )

    expect(badge).toMatchObject({
      label: '订阅剩余 2天2小时',
      expired: false,
      critical: true
    })
    expect(badge?.title).toContain('订阅到期')
  })
})
