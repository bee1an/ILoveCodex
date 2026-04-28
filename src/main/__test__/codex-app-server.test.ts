import { afterEach, describe, expect, it } from 'vitest'

import { readAccountRateLimits, wakeAccountRateLimits } from '../codex-app-server'

describe('readAccountRateLimits', () => {
  const originalBaseUrl = process.env['ILOVECODEX_CHATGPT_BASE_URL']

  afterEach(() => {
    if (originalBaseUrl == null) {
      delete process.env['ILOVECODEX_CHATGPT_BASE_URL']
      return
    }

    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = originalBaseUrl
  })

  it('maps the usage payload and normalizes the chatgpt base url', async () => {
    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = 'https://chatgpt.com'

    let requestedUrl = ''
    const result = await readAccountRateLimits(
      {
        tokens: {
          access_token: 'token',
          account_id: 'acct_123'
        }
      },
      {
        fetch: async (input, init) => {
          requestedUrl = input
          expect(init?.headers).toMatchObject({
            authorization: 'Bearer token',
            'chatgpt-account-id': 'acct_123',
            'user-agent': 'codexdock'
          })

          return new Response(
            JSON.stringify({
              user_id: 'user_123',
              account_id: 'acct_123',
              email: 'user@example.com',
              plan_type: 'education',
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 42,
                  limit_window_seconds: 3600,
                  reset_after_seconds: 60,
                  reset_at: 1_746_390_000
                },
                secondary_window: {
                  used_percent: 10,
                  limit_window_seconds: 86_400,
                  reset_after_seconds: 600,
                  reset_at: 1_746_450_000
                }
              },
              code_review_rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 5,
                  limit_window_seconds: 604800,
                  reset_after_seconds: 300,
                  reset_at: 1_746_493_000
                }
              },
              credits: {
                has_credits: true,
                unlimited: false,
                balance: '12.5',
                approx_local_messages: 8,
                approx_cloud_messages: 3
              },
              additional_rate_limits: [
                {
                  limit_name: 'GPT-4.1',
                  metered_feature: 'gpt-4.1',
                  rate_limit: {
                    allowed: true,
                    limit_reached: false,
                    primary_window: {
                      used_percent: 20,
                      limit_window_seconds: 7200,
                      reset_after_seconds: 10,
                      reset_at: 1_746_392_000
                    }
                  }
                }
              ],
              promo: null
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      }
    )

    expect(requestedUrl).toBe('https://chatgpt.com/backend-api/wham/usage')
    expect(result.planType).toBe('edu')
    expect(result.primary?.usedPercent).toBe(42)
    expect(result.primary?.windowDurationMins).toBe(60)
    expect(result.secondary?.windowDurationMins).toBe(1440)
    expect(result.credits).toEqual({
      hasCredits: true,
      unlimited: false,
      balance: 12.5,
      approxLocalMessages: 8,
      approxCloudMessages: 3
    })
    expect(result.limits).toHaveLength(3)
    expect(result.limits[1]).toMatchObject({
      limitId: 'code-review',
      limitName: 'Code Review',
      primary: {
        usedPercent: 5,
        windowDurationMins: 10080,
        resetsAt: 1_746_493_000
      }
    })
    expect(result.limits[2]).toMatchObject({
      limitId: 'gpt-4.1',
      limitName: 'GPT-4.1',
      primary: {
        usedPercent: 20,
        windowDurationMins: 120,
        resetsAt: 1_746_392_000
      }
    })
  })

  it('fails fast when the access token is missing', async () => {
    await expect(
      readAccountRateLimits(
        { tokens: { account_id: 'acct_123' } },
        { fetch: async () => new Response() }
      )
    ).rejects.toThrow('Missing access token required for rate-limit lookup.')
  })

  it('wraps non-ok responses in AccountRateLimitLookupError', async () => {
    await expect(
      readAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async () =>
            new Response('unauthorized', {
              status: 401,
              headers: { 'content-type': 'text/plain' }
            })
        }
      )
    ).rejects.toMatchObject({
      name: 'AccountRateLimitLookupError',
      message: 'unauthorized'
    })
  })

  it('extracts nested json detail from non-ok responses', async () => {
    await expect(
      readAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async () =>
            new Response(JSON.stringify({ detail: { code: 'deactivated_workspace' } }), {
              status: 402,
              headers: { 'content-type': 'application/json' }
            })
        }
      )
    ).rejects.toMatchObject({
      name: 'AccountRateLimitLookupError',
      message: 'deactivated_workspace'
    })
  })
})

describe('wakeAccountRateLimits', () => {
  const originalBaseUrl = process.env['ILOVECODEX_CHATGPT_BASE_URL']

  afterEach(() => {
    if (originalBaseUrl == null) {
      delete process.env['ILOVECODEX_CHATGPT_BASE_URL']
      return
    }

    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = originalBaseUrl
  })

  it('posts a minimal codex response request to the normalized responses endpoint', async () => {
    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = 'https://chatgpt.com'

    let requestedUrl = ''
    let requestedBody = ''
    await expect(
      wakeAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async (input, init) => {
            requestedUrl = input
            requestedBody = String(init?.body ?? '')
            expect(init?.method).toBe('POST')
            expect(init?.headers).toMatchObject({
              authorization: 'Bearer token',
              'chatgpt-account-id': 'acct_123',
              'user-agent': 'codexdock',
              originator: 'codex_cli_rs',
              'content-type': 'application/json'
            })

            return new Response('{}', {
              status: 200,
              headers: { 'content-type': 'text/event-stream' }
            })
          }
        }
      )
    ).resolves.toMatchObject({
      status: 200,
      accepted: true,
      model: 'gpt-5.4-mini',
      prompt: 'ping',
      body: '{}'
    })

    expect(requestedUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(JSON.parse(requestedBody)).toMatchObject({
      model: 'gpt-5.4-mini',
      instructions: 'Start or refresh this Codex session timer. Reply briefly.',
      store: false,
      stream: true
    })
  })

  it('uses the provided wake model and prompt when specified', async () => {
    let requestedBody = ''

    await expect(
      wakeAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async (_input, init) => {
            requestedBody = String(init?.body ?? '')

            return new Response('{}', {
              status: 200,
              headers: { 'content-type': 'text/event-stream' }
            })
          }
        },
        {
          model: 'gpt-4.1-mini',
          prompt: 'wake me up'
        }
      )
    ).resolves.toMatchObject({
      status: 200,
      accepted: true,
      model: 'gpt-4.1-mini',
      prompt: 'wake me up'
    })

    expect(JSON.parse(requestedBody)).toMatchObject({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'wake me up' }]
        }
      ]
    })
  })

  it('accepts 429 wake-up responses without throwing', async () => {
    await expect(
      wakeAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async () =>
            new Response(
              JSON.stringify({
                error: {
                  code: 'rate_limit_exceeded'
                }
              }),
              {
                status: 429,
                headers: { 'content-type': 'text/event-stream' }
              }
            )
        }
      )
    ).resolves.toMatchObject({
      status: 429,
      accepted: true
    })
  })

  it('summarizes successful sse wake responses into a short body', async () => {
    await expect(
      wakeAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async () =>
            new Response(
              [
                'event: response.created',
                'data: {"type":"response.created","response":{"status":"in_progress"}}',
                '',
                'event: response.output_text.delta',
                'data: {"type":"response.output_text.delta","delta":"Hello"}',
                '',
                'event: response.output_text.delta',
                'data: {"type":"response.output_text.delta","delta":"!"}',
                '',
                'event: response.output_text.done',
                'data: {"type":"response.output_text.done","text":"Hello!"}',
                '',
                'event: response.completed',
                'data: {"type":"response.completed","response":{"status":"completed","usage":{"total_tokens":21}}}',
                ''
              ].join('\n'),
              {
                status: 200,
                headers: { 'content-type': 'text/event-stream' }
              }
            )
        }
      )
    ).resolves.toMatchObject({
      status: 200,
      accepted: true,
      body: 'Hello!\nstatus: completed\ntokens: 21'
    })
  })
})
