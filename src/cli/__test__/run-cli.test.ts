import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../run-cli'
import { defaultStatsDisplaySettings } from '../../shared/codex'
import type {
  AccountRateLimits,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  LoginEvent,
  PortOccupant,
  TokenCostDetail
} from '../../shared/codex'

function createSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    accounts: [],
    providers: [],
    tags: [],
    codexInstances: [],
    codexInstanceDefaults: {
      rootDir: '/tmp/codex-instance-homes',
      defaultCodexHome: '/Users/test/.codex'
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
      codexDesktopExecutablePath: ''
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

interface CliTestRuntime {
  platform: {
    openExternal: ReturnType<typeof vi.fn>
  }
  subscribeLoginEvents(listener: (event: LoginEvent) => void): () => boolean
  emit(event: LoginEvent): void
  services: {
    accounts: {
      list: ReturnType<typeof vi.fn>
      importCurrent: ReturnType<typeof vi.fn>
      importFromTemplate: ReturnType<typeof vi.fn>
      exportToTemplate: ReturnType<typeof vi.fn>
      activate: ReturnType<typeof vi.fn>
      activateBest: ReturnType<typeof vi.fn>
      reorder: ReturnType<typeof vi.fn>
      remove: ReturnType<typeof vi.fn>
      updateTags: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
    tags: {
      create: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      remove: ReturnType<typeof vi.fn>
      getAll: ReturnType<typeof vi.fn>
    }
    providers: {
      list: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
      reorder: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      remove: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      check: ReturnType<typeof vi.fn>
      open: ReturnType<typeof vi.fn>
    }
    doctor: {
      run: ReturnType<typeof vi.fn>
    }
    session: {
      current: ReturnType<typeof vi.fn>
    }
    settings: {
      get: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    usage: {
      read: ReturnType<typeof vi.fn>
    }
    cost: {
      read: ReturnType<typeof vi.fn>
    }
    login: {
      start: ReturnType<typeof vi.fn>
      isRunning: ReturnType<typeof vi.fn>
      getPortOccupant: ReturnType<typeof vi.fn>
      killPortOccupant: ReturnType<typeof vi.fn>
    }
    codex: {
      show: ReturnType<typeof vi.fn>
      open: ReturnType<typeof vi.fn>
      openIsolated: ReturnType<typeof vi.fn>
      instances: {
        list: ReturnType<typeof vi.fn>
        getDefaults: ReturnType<typeof vi.fn>
        create: ReturnType<typeof vi.fn>
        update: ReturnType<typeof vi.fn>
        remove: ReturnType<typeof vi.fn>
        start: ReturnType<typeof vi.fn>
        stop: ReturnType<typeof vi.fn>
      }
    }
    getSnapshot: ReturnType<typeof vi.fn>
  }
}

function createRuntime(): {
  runtime: CliTestRuntime
  snapshot: AppSnapshot
  rateLimits: AccountRateLimits
  settings: AppSettings
  currentSession: CurrentSessionSummary
  tokenCostDetail: TokenCostDetail
  portOccupant: PortOccupant
} {
  const listeners = new Set<(event: LoginEvent) => void>()
  const snapshot = createSnapshot({
    accounts: [
      {
        id: 'acct_1',
        email: 'one@example.com',
        tagIds: ['tag_a'],
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    tags: [
      {
        id: 'tag_a',
        name: 'Alpha',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      },
      {
        id: 'tag_b',
        name: 'Beta',
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z'
      }
    ],
    providers: [
      {
        id: 'provider_1',
        name: 'Bee',
        baseUrl: 'https://api.bee1an.us.kg/v1',
        model: '5.4',
        fastMode: true,
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:00.000Z'
      }
    ],
    activeAccountId: 'acct_1',
    currentSession: {
      email: 'one@example.com',
      storedAccountId: 'acct_1'
    },
    codexInstances: [
      {
        id: '__default__',
        name: '',
        codexHome: '/Users/test/.codex',
        extraArgs: '',
        isDefault: true,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        running: false,
        initialized: true
      },
      {
        id: 'inst_1',
        name: 'Work',
        codexHome: '/tmp/codex-instance-homes/work',
        bindAccountId: 'acct_1',
        extraArgs: '--approval never',
        isDefault: false,
        createdAt: '2026-03-04T00:00:00.000Z',
        updatedAt: '2026-03-04T00:00:00.000Z',
        running: false,
        initialized: true
      }
    ]
  })
  const rateLimits: AccountRateLimits = {
    limitId: 'codex',
    limitName: 'Codex',
    planType: 'plus',
    primary: {
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: null
    },
    secondary: {
      usedPercent: 10,
      windowDurationMins: 10080,
      resetsAt: null
    },
    credits: null,
    limits: [],
    fetchedAt: '2026-03-08T00:00:00.000Z'
  }
  const settings: AppSettings = {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light',
    checkForUpdatesOnStartup: true,
    codexDesktopExecutablePath: '',
    statsDisplay: defaultStatsDisplaySettings()
  }
  const currentSession: CurrentSessionSummary = {
    email: 'one@example.com',
    storedAccountId: 'acct_1'
  }
  const tokenCostDetail: TokenCostDetail = {
    instanceId: '__all__',
    codexHome: '/Users/test/.codex',
    source: 'local',
    summary: {
      sessionTokens: 120,
      sessionCostUSD: 0.0012,
      last30DaysTokens: 3400,
      last30DaysCostUSD: 0.034,
      updatedAt: '2026-03-08T00:00:00.000Z'
    },
    daily: [
      {
        date: '2026-03-08',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUSD: 0.0012,
        modelsUsed: ['gpt-5'],
        modelBreakdowns: [
          {
            modelName: 'gpt-5',
            totalTokens: 120,
            costUSD: 0.0012
          }
        ]
      }
    ]
  }
  const portOccupant: PortOccupant = { pid: 123, command: 'node' }

  const runtime = {
    platform: {
      openExternal: vi.fn(async () => undefined)
    },
    subscribeLoginEvents(listener: (event: LoginEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event: LoginEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    services: {
      accounts: {
        list: vi.fn(async () => snapshot),
        importCurrent: vi.fn(async () => snapshot),
        importFromTemplate: vi.fn(async () => snapshot),
        exportToTemplate: vi.fn(async () =>
          JSON.stringify({
            exported_at: '2026-03-08T00:00:00.000Z',
            proxies: [],
            accounts: []
          })
        ),
        activate: vi.fn(async () => snapshot),
        activateBest: vi.fn(async () => snapshot),
        reorder: vi.fn(async () => snapshot),
        remove: vi.fn(async () => snapshot),
        updateTags: vi.fn(async () => snapshot),
        get: vi.fn()
      },
      tags: {
        create: vi.fn(async () => snapshot),
        update: vi.fn(async () => snapshot),
        remove: vi.fn(async () => snapshot),
        getAll: vi.fn(async () => snapshot.tags)
      },
      providers: {
        list: vi.fn(async () => snapshot.providers),
        create: vi.fn(async () => snapshot),
        reorder: vi.fn(async () => snapshot),
        update: vi.fn(async () => snapshot),
        remove: vi.fn(async () => snapshot),
        get: vi.fn(async () => snapshot.providers[0]),
        check: vi.fn(async () => ({
          checkedAt: '2026-03-08T00:00:00.000Z',
          providerId: 'provider_1',
          providerName: 'Bee',
          baseUrl: 'https://api.bee1an.us.kg/v1',
          model: '5.4',
          ok: true,
          latencyMs: 42,
          httpStatus: 200,
          availableModels: ['5.4'],
          checks: [
            {
              id: 'connectivity',
              status: 'pass',
              summary: 'Provider responded in 42 ms.'
            }
          ]
        })),
        open: vi.fn(async () => snapshot)
      },
      doctor: {
        run: vi.fn(async () => ({
          checkedAt: '2026-03-08T00:00:00.000Z',
          ok: true,
          checks: [
            {
              id: 'login-port',
              status: 'pass',
              summary: 'Login callback port 1455 is available.'
            }
          ]
        }))
      },
      session: {
        current: vi.fn(async () => currentSession)
      },
      settings: {
        get: vi.fn(async () => settings),
        update: vi.fn(async (nextSettings: Partial<AppSettings>) =>
          createSnapshot({
            settings: {
              ...settings,
              ...nextSettings
            }
          })
        )
      },
      usage: {
        read: vi.fn(async () => rateLimits)
      },
      cost: {
        read: vi.fn(async () => tokenCostDetail)
      },
      login: {
        start: vi.fn(async (method: 'browser' | 'device') => {
          const attemptId = `${method}-attempt`
          const waitingEvent: LoginEvent =
            method === 'browser'
              ? {
                  attemptId,
                  method,
                  phase: 'waiting',
                  message: 'Callback login is waiting for the OpenAI authorization callback.',
                  authUrl: 'https://auth.openai.com/authorize',
                  localCallbackUrl: 'http://localhost:1455/auth/callback'
                }
              : {
                  attemptId,
                  method,
                  phase: 'waiting',
                  message: 'Open the verification page and enter the device code.',
                  verificationUrl: 'https://auth.openai.com/codex/device',
                  userCode: 'ABCD-EFGH'
                }

          const successEvent: LoginEvent = {
            attemptId,
            method,
            phase: 'success',
            message: `Saved the new ${method} login to the local account vault.`,
            snapshot
          }

          runtime.emit(waitingEvent)
          runtime.emit(successEvent)

          return { attemptId, method }
        }),
        isRunning: vi.fn(() => false),
        getPortOccupant: vi.fn(async () => portOccupant),
        killPortOccupant: vi.fn(async () => portOccupant)
      },
      codex: {
        show: vi.fn(async () => snapshot),
        open: vi.fn(async () => snapshot),
        openIsolated: vi.fn(async () => snapshot),
        instances: {
          list: vi.fn(async () => snapshot.codexInstances),
          getDefaults: vi.fn(async () => snapshot.codexInstanceDefaults),
          create: vi.fn(async () => snapshot.codexInstances[1]),
          update: vi.fn(async () => snapshot.codexInstances[1]),
          remove: vi.fn(async () => undefined),
          start: vi.fn(async () => snapshot.codexInstances[1]),
          stop: vi.fn(async () => snapshot.codexInstances[1])
        }
      },
      getSnapshot: vi.fn(async () => snapshot)
    }
  }

  return { runtime, snapshot, rateLimits, settings, currentSession, tokenCostDetail, portOccupant }
}

function parseJsonLog(logSpy: ReturnType<typeof vi.spyOn>, callIndex = 0): unknown {
  return JSON.parse(String(logSpy.mock.calls[callIndex]?.[0]))
}

describe('runCli', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    vi.useRealTimers()
  })

  it('prints help when no arguments are provided', async () => {
    const { runtime } = createRuntime()

    const code = await runCli(runtime as never, [])

    expect(code).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toContain('Usage:')
  })

  it('covers the account commands', async () => {
    const { runtime, snapshot } = createRuntime()

    await expect(runCli(runtime as never, ['account', 'list', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.list).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        accounts: snapshot.accounts,
        activeAccountId: snapshot.activeAccountId,
        currentSession: snapshot.currentSession
      },
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'import-current', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.importCurrent).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['account', 'activate', 'acct_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.accounts.activate).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'best', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.activateBest).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'remove', 'acct_1', '--json'])).resolves.toBe(
      0
    )
    expect(runtime.services.accounts.remove).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'export', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.exportToTemplate).toHaveBeenCalledWith([])
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        exported_at: '2026-03-08T00:00:00.000Z',
        proxies: [],
        accounts: []
      },
      error: null
    })
  })

  it('covers provider commands', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['provider', 'list', '--json'])).resolves.toBe(0)
    expect(runtime.services.providers.list).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, [
        'provider',
        'create',
        '--name',
        'Bee',
        '--base-url',
        'https://api.bee1an.us.kg/v1',
        '--api-key',
        'secret',
        '--model',
        '5.4',
        '--fast',
        'true',
        '--json'
      ])
    ).resolves.toBe(0)
    expect(runtime.services.providers.create).toHaveBeenCalledWith({
      name: 'Bee',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'secret',
      model: '5.4',
      fastMode: true
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, [
        'provider',
        'update',
        'provider_1',
        '--base-url',
        'https://api.example.com/v1',
        '--model',
        'gpt-5.4',
        '--fast',
        'false',
        '--json'
      ])
    ).resolves.toBe(0)
    expect(runtime.services.providers.update).toHaveBeenCalledWith('provider_1', {
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-5.4',
      fastMode: false
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['provider', 'open', 'provider_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.providers.open).toHaveBeenCalledWith('provider_1')

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['provider', 'remove', 'provider_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.providers.remove).toHaveBeenCalledWith('provider_1')

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['provider', 'check', 'provider_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.providers.check).toHaveBeenCalledWith('provider_1')
  })

  it('covers instance commands', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['instance', 'list', '--json'])).resolves.toBe(0)
    expect(runtime.services.codex.instances.list).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, [
        'instance',
        'create',
        '--name',
        'Work',
        '--codex-home',
        '/tmp/work',
        '--account',
        'acct_1',
        '--extra-args',
        '--approval never',
        '--json'
      ])
    ).resolves.toBe(0)
    expect(runtime.services.codex.instances.create).toHaveBeenCalledWith({
      name: 'Work',
      codexHome: '/tmp/work',
      bindAccountId: 'acct_1',
      extraArgs: '--approval never'
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, [
        'instance',
        'update',
        'inst_1',
        '--name',
        'Work 2',
        '--account',
        '-',
        '--extra-args',
        '--sandbox workspace-write',
        '--json'
      ])
    ).resolves.toBe(0)
    expect(runtime.services.codex.instances.update).toHaveBeenCalledWith('inst_1', {
      name: 'Work 2',
      bindAccountId: null,
      extraArgs: '--sandbox workspace-write'
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['instance', 'start', 'default', '--workspace', '/tmp/ws', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.codex.instances.start).toHaveBeenCalledWith('__default__', '/tmp/ws')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['instance', 'stop', 'inst_1', '--json'])).resolves.toBe(
      0
    )
    expect(runtime.services.codex.instances.stop).toHaveBeenCalledWith('inst_1')

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['instance', 'remove', 'inst_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.codex.instances.remove).toHaveBeenCalledWith('inst_1')
  })

  it('covers session current, usage read and cost read', async () => {
    const { runtime, currentSession, rateLimits, tokenCostDetail } = createRuntime()

    await expect(runCli(runtime as never, ['session', 'current', '--json'])).resolves.toBe(0)
    expect(runtime.services.session.current).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: currentSession,
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['usage', 'read', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.usage.read).toHaveBeenCalledWith('acct_1')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: rateLimits,
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['cost', 'read', '--json'])).resolves.toBe(0)
    expect(runtime.services.cost.read).toHaveBeenCalledWith({
      refresh: false
    })
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: tokenCostDetail,
      error: null
    })

    logSpy.mockClear()
    expect(runtime.services.cost.read).toHaveBeenLastCalledWith({
      refresh: false
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['cost', 'read', '--refresh', '--json'])).resolves.toBe(0)
    expect(runtime.services.cost.read).toHaveBeenLastCalledWith({
      refresh: true
    })

    logSpy.mockClear()
    runtime.services.cost.read.mockResolvedValueOnce({
      ...tokenCostDetail,
      warnings: ['Failed to read broken (/tmp/broken): boom']
    })
    await expect(runCli(runtime as never, ['cost', 'read'])).resolves.toBe(0)
    const plainOutput = String(logSpy.mock.calls.map((call) => call[0]).join('\n'))
    expect(plainOutput).toContain('Today:')
    expect(plainOutput).toContain('Last 30 days:')
    expect(plainOutput).toContain('Warnings:')
    expect(plainOutput).toContain('Failed to read broken (/tmp/broken): boom')
  })

  it('covers tag commands', async () => {
    const { runtime, snapshot } = createRuntime()

    await expect(runCli(runtime as never, ['tag', 'list', '--json'])).resolves.toBe(0)
    expect(runtime.services.tags.getAll).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: snapshot.tags,
      error: null
    })

    const createdSnapshot = createSnapshot({
      ...snapshot,
      accounts: snapshot.accounts,
      tags: [
        ...snapshot.tags,
        {
          id: 'tag_c',
          name: 'Gamma',
          createdAt: '2026-03-03T00:00:00.000Z',
          updatedAt: '2026-03-03T00:00:00.000Z'
        }
      ]
    })
    runtime.services.tags.create = vi.fn(async () => createdSnapshot)
    logSpy.mockClear()
    await expect(runCli(runtime as never, ['tag', 'create', 'Gamma', '--json'])).resolves.toBe(0)
    expect(runtime.services.tags.create).toHaveBeenCalledWith('Gamma')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: createdSnapshot,
      error: null
    })

    const renamedSnapshot = createSnapshot({
      ...snapshot,
      accounts: snapshot.accounts,
      tags: snapshot.tags.map((tag) => (tag.id === 'tag_a' ? { ...tag, name: 'Alpha 2' } : tag))
    })
    runtime.services.tags.update = vi.fn(async () => renamedSnapshot)
    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['tag', 'rename', 'tag_a', 'Alpha 2', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.tags.update).toHaveBeenCalledWith('tag_a', 'Alpha 2')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: renamedSnapshot,
      error: null
    })

    const removedSnapshot = createSnapshot({
      ...snapshot,
      accounts: snapshot.accounts.map((account) => ({ ...account, tagIds: [] })),
      tags: snapshot.tags.filter((tag) => tag.id !== 'tag_a')
    })
    runtime.services.tags.remove = vi.fn(async () => removedSnapshot)
    logSpy.mockClear()
    await expect(runCli(runtime as never, ['tag', 'remove', 'tag_a', '--json'])).resolves.toBe(0)
    expect(runtime.services.tags.remove).toHaveBeenCalledWith('tag_a')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: removedSnapshot,
      error: null
    })

    const assignedSnapshot = createSnapshot({
      ...snapshot,
      accounts: snapshot.accounts.map((account) => ({ ...account, tagIds: ['tag_a', 'tag_b'] })),
      tags: snapshot.tags
    })
    runtime.services.accounts.updateTags = vi.fn(async () => assignedSnapshot)
    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['tag', 'assign', 'acct_1', 'tag_b', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.accounts.updateTags).toHaveBeenCalledWith('acct_1', ['tag_a', 'tag_b'])
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: assignedSnapshot,
      error: null
    })

    const unassignedSnapshot = createSnapshot({
      ...snapshot,
      accounts: snapshot.accounts.map((account) => ({ ...account, tagIds: [] })),
      tags: snapshot.tags
    })
    runtime.services.accounts.updateTags = vi.fn(async () => unassignedSnapshot)
    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['tag', 'unassign', 'acct_1', 'tag_a', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.accounts.updateTags).toHaveBeenCalledWith('acct_1', [])
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: unassignedSnapshot,
      error: null
    })
  })

  it('covers browser and device login commands', async () => {
    const { runtime, snapshot } = createRuntime()

    await expect(runCli(runtime as never, ['login', 'browser', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.start).toHaveBeenCalledWith('browser')
    expect(runtime.platform.openExternal).toHaveBeenCalledWith('https://auth.openai.com/authorize')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        attemptId: 'browser-attempt',
        method: 'browser',
        phase: 'success',
        snapshot
      },
      error: null
    })

    logSpy.mockClear()
    runtime.platform.openExternal.mockClear()
    await expect(
      runCli(runtime as never, ['login', 'browser', '--json', '--no-open'])
    ).resolves.toBe(0)
    expect(runtime.platform.openExternal).not.toHaveBeenCalled()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['login', 'device', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.start).toHaveBeenCalledWith('device')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        attemptId: 'device-attempt',
        method: 'device',
        phase: 'success',
        snapshot
      },
      error: null
    })
  })

  it('covers login port status and kill', async () => {
    const { runtime, portOccupant } = createRuntime()

    await expect(runCli(runtime as never, ['login', 'port', 'status', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.getPortOccupant).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: portOccupant,
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['login', 'port', 'kill', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.killPortOccupant).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: portOccupant,
      error: null
    })
  })

  it('covers codex open and settings commands', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['codex', 'show', '--json'])).resolves.toBe(0)
    expect(runtime.services.codex.show).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['codex', 'open', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.codex.open).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['codex', 'open-isolated', 'acct_1', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.codex.openIsolated).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['settings', 'get', 'theme', '--json'])).resolves.toBe(0)
    expect(runtime.services.settings.get).toHaveBeenCalled()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: 'light',
      error: null
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'statusBarAccountIds', 'a,b,c', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.settings.update).toHaveBeenCalledWith({
      statusBarAccountIds: ['a', 'b', 'c']
    })
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        usagePollingMinutes: 15,
        statusBarAccountIds: ['a', 'b', 'c'],
        language: 'zh-CN',
        theme: 'light',
        checkForUpdatesOnStartup: true,
        codexDesktopExecutablePath: '',
        statsDisplay: defaultStatsDisplaySettings()
      },
      error: null
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'checkForUpdatesOnStartup', 'false', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.settings.update).toHaveBeenCalledWith({
      checkForUpdatesOnStartup: false
    })
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        usagePollingMinutes: 15,
        statusBarAccountIds: [],
        language: 'zh-CN',
        theme: 'light',
        checkForUpdatesOnStartup: false,
        codexDesktopExecutablePath: '',
        statsDisplay: defaultStatsDisplaySettings()
      },
      error: null
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, [
        'settings',
        'set',
        'codexDesktopExecutablePath',
        'C:\\\\Program Files\\\\Codex\\\\Codex.exe',
        '--json'
      ])
    ).resolves.toBe(0)
    expect(runtime.services.settings.update).toHaveBeenCalledWith({
      codexDesktopExecutablePath: 'C:\\\\Program Files\\\\Codex\\\\Codex.exe'
    })
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        usagePollingMinutes: 15,
        statusBarAccountIds: [],
        language: 'zh-CN',
        theme: 'light',
        checkForUpdatesOnStartup: true,
        codexDesktopExecutablePath: 'C:\\\\Program Files\\\\Codex\\\\Codex.exe',
        statsDisplay: defaultStatsDisplaySettings()
      },
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['settings', 'get', 'statsDisplay', '--json'])).resolves.toBe(0)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: defaultStatsDisplaySettings(),
      error: null
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'statsDisplay', 'dailyTrend,accountUsage', '--json'])
    ).resolves.toBe(0)
    expect(runtime.services.settings.update).toHaveBeenCalledWith({
      statsDisplay: {
        dailyTrend: true,
        modelBreakdown: false,
        instanceUsage: false,
        accountUsage: true
      }
    })
  })

  it('covers doctor command', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['doctor', '--json'])).resolves.toBe(0)
    expect(runtime.services.doctor.run).toHaveBeenCalledOnce()
  })

  it('returns usage errors for bad CLI input', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['account', 'activate', '--json'])).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'Missing account-id'
      }
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'theme', 'blue', '--json'])
    ).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'theme must be light, dark, or system'
      }
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'checkForUpdatesOnStartup', 'maybe', '--json'])
    ).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'checkForUpdatesOnStartup must be true or false'
      }
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['settings', 'set', 'statsDisplay', 'wat', '--json'])
    ).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'statsDisplay contains unknown chart key: wat'
      }
    })

    logSpy.mockClear()
    await expect(
      runCli(runtime as never, ['cost', 'read', '--instance', 'default', '--json'])
    ).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'Unknown option: --instance'
      }
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['wat', '--json'])).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'Unknown command: wat'
      }
    })
  })

  it('returns a timeout failure for stalled logins', async () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime()
    runtime.services.login.start = vi.fn(async (method: 'browser' | 'device') => ({
      attemptId: `${method}-attempt`,
      method
    }))

    const pending = runCli(runtime as never, ['login', 'device', '--json', '--timeout=0.01'])
    await vi.advanceTimersByTimeAsync(20)

    await expect(pending).resolves.toBe(1)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 1,
        message: 'Command timed out after 0.01 seconds'
      }
    })
  })
})
