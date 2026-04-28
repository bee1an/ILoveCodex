import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CodexCostUsageService, codexCostUSD, scanCodexTokenCost } from '../codex-cost-usage'
import type { CodexInstanceSummary } from '../../shared/codex'

const NOW = new Date('2026-04-22T12:00:00+08:00')

const createdDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codexdock-cost-'))
  createdDirectories.push(dir)
  return dir
}

async function writeJsonl(filePath: string, entries: unknown[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
}

function tokenCount(
  timestamp: string,
  info: Record<string, unknown>,
  payload: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info,
      ...payload
    }
  }
}

function turnContext(timestamp: string, model: string): Record<string, unknown> {
  return {
    timestamp,
    type: 'turn_context',
    payload: { model }
  }
}

function sessionMeta(
  sessionId: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    timestamp: '2026-04-22T08:00:00+08:00',
    type: 'session_meta',
    payload: {
      session_id: sessionId,
      ...extra
    }
  }
}

function instance(
  id: string,
  codexHome: string,
  running = false,
  isDefault = false
): CodexInstanceSummary {
  return {
    id,
    name: isDefault ? '' : id,
    codexHome,
    extraArgs: '',
    isDefault,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    running,
    initialized: true
  }
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('Codex token/cost usage scanner', () => {
  it('继承 turn_context model，并按 total_token_usage 计算增量与 cached input 成本', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/session.jsonl'), [
      sessionMeta('s-total'),
      turnContext('2026-04-22T09:00:00+08:00', 'gpt-5'),
      tokenCount('2026-04-22T09:01:00+08:00', {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 60,
          output_tokens: 10
        }
      }),
      tokenCount('2026-04-22T09:02:00+08:00', {
        total_token_usage: {
          input_tokens: 150,
          cached_input_tokens: 70,
          output_tokens: 25
        }
      })
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.sessionTokens).toBe(175)
    expect(detail.summary.last30DaysTokens).toBe(175)
    expect(detail.daily[0]).toMatchObject({
      date: '2026-04-22',
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      modelsUsed: ['gpt-5']
    })
    expect(detail.daily[0]?.modelBreakdowns[0]).toMatchObject({
      modelName: 'gpt-5',
      totalTokens: 175
    })
    expect(detail.daily[0]?.costUSD).toBeCloseTo(codexCostUSD('gpt-5', 150, 70, 25) ?? 0, 12)
  })

  it('累计 last_token_usage，并纳入 archived_sessions', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/last.jsonl'), [
      sessionMeta('s-last'),
      turnContext('2026-04-22T10:00:00+08:00', 'gpt-5-mini'),
      tokenCount('2026-04-22T10:01:00+08:00', {
        last_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 2 }
      }),
      tokenCount('2026-04-22T10:02:00+08:00', {
        last_token_usage: { input_tokens: 5, cached_input_tokens: 1, output_tokens: 3 }
      })
    ])
    await writeJsonl(join(codexHome, 'archived_sessions/archived.jsonl'), [
      sessionMeta('s-archived'),
      tokenCount(
        '2026-04-21T10:00:00+08:00',
        {
          last_token_usage: { input_tokens: 7, output_tokens: 4 }
        },
        { model: 'gpt-5' }
      )
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.sessionTokens).toBe(20)
    expect(detail.summary.last30DaysTokens).toBe(31)
    expect(detail.daily.map((entry) => entry.date)).toEqual(['2026-04-21', '2026-04-22'])
  })

  it('同一 session 同时存在 live 与 archived 日志时优先统计 live 文件', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'archived_sessions/duplicate.jsonl'), [
      sessionMeta('session-duplicate'),
      tokenCount(
        '2026-04-22T09:00:00+08:00',
        {
          last_token_usage: { input_tokens: 1, output_tokens: 1 }
        },
        { model: 'gpt-5' }
      )
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/duplicate.jsonl'), [
      sessionMeta('session-duplicate'),
      tokenCount(
        '2026-04-22T10:00:00+08:00',
        {
          last_token_usage: { input_tokens: 10, output_tokens: 5 }
        },
        { model: 'gpt-5' }
      )
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.sessionTokens).toBe(15)
    expect(detail.summary.last30DaysTokens).toBe(15)
  })

  it('对 fork / inherited session 扣除父 session 已累计 token，避免重复计数', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/21/parent.jsonl'), [
      sessionMeta('parent'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        total_token_usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 }
      })
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/child.jsonl'), [
      sessionMeta('child', {
        forked_from_id: 'parent',
        timestamp: '2026-04-21T11:00:00+08:00'
      }),
      tokenCount(
        '2026-04-22T10:00:00+08:00',
        {
          total_token_usage: { input_tokens: 150, cached_input_tokens: 15, output_tokens: 30 }
        },
        { model: 'gpt-5' }
      )
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)
    const childDay = detail.daily.find((entry) => entry.date === '2026-04-22')

    expect(childDay).toMatchObject({
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60
    })
  })

  it('fork session 使用 last_token_usage 时不扣除父 session 累计 token', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/21/parent-last.jsonl'), [
      sessionMeta('parent-last'),
      tokenCount(
        '2026-04-21T10:00:00+08:00',
        {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 }
        },
        { model: 'gpt-5' }
      )
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/child-last.jsonl'), [
      sessionMeta('child-last', {
        forked_from_id: 'parent-last',
        timestamp: '2026-04-21T11:00:00+08:00'
      }),
      turnContext('2026-04-22T10:00:00+08:00', 'gpt-5'),
      tokenCount('2026-04-22T10:01:00+08:00', {
        last_token_usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 1 }
      }),
      tokenCount('2026-04-22T10:02:00+08:00', {
        last_token_usage: { input_tokens: 2, cached_input_tokens: 1, output_tokens: 1 }
      })
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)
    const childDay = detail.daily.find((entry) => entry.date === '2026-04-22')

    expect(childDay).toMatchObject({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7
    })
  })

  it('未知模型仍统计 token，cost 为空', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/unknown.jsonl'), [
      sessionMeta('unknown'),
      tokenCount(
        '2026-04-22T10:00:00+08:00',
        {
          last_token_usage: { input_tokens: 11, output_tokens: 5 }
        },
        { model: 'unknown-model' }
      )
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.last30DaysTokens).toBe(16)
    expect(detail.summary.last30DaysCostUSD).toBeNull()
    expect(detail.daily[0]?.modelBreakdowns[0]).toEqual({
      modelName: 'unknown-model',
      totalTokens: 16,
      costUSD: null
    })
  })

  it('缺失 model 信息时只统计 token，不伪造 GPT-5 成本', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'archived_sessions/no-model.jsonl'), [
      sessionMeta('no-model'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 8, output_tokens: 3 }
      })
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.last30DaysTokens).toBe(11)
    expect(detail.summary.last30DaysCostUSD).toBeNull()
    expect(detail.daily[0]?.modelBreakdowns[0]).toEqual({
      modelName: 'unknown',
      totalTokens: 11,
      costUSD: null
    })
  })

  it('同一天混入未知模型时，整天成本应标记为未知', async () => {
    const root = await createTempDir()
    const codexHome = join(root, '.codex')
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/mixed.jsonl'), [
      sessionMeta('mixed'),
      tokenCount(
        '2026-04-22T10:00:00+08:00',
        {
          last_token_usage: { input_tokens: 12, output_tokens: 4 }
        },
        { model: 'gpt-5' }
      ),
      tokenCount(
        '2026-04-22T10:05:00+08:00',
        {
          last_token_usage: { input_tokens: 7, output_tokens: 2 }
        },
        { model: 'unknown-model' }
      )
    ])

    const detail = await scanCodexTokenCost('__default__', codexHome, NOW)

    expect(detail.summary.sessionTokens).toBe(25)
    expect(detail.summary.sessionCostUSD).toBeNull()
    expect(detail.summary.last30DaysCostUSD).toBeNull()
    expect(detail.daily[0]?.costUSD).toBeNull()
  })
})

describe('CodexCostUsageService', () => {
  it('支持按实例或运行实例范围读取 token/cost 数据', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const defaultHome = join(root, 'default')
    const runningHome = join(root, 'running')
    await writeJsonl(join(defaultHome, 'sessions/2026/04/22/default.jsonl'), [
      sessionMeta('default'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 1, output_tokens: 1 }
      })
    ])
    await writeJsonl(join(runningHome, 'sessions/2026/04/22/running.jsonl'), [
      sessionMeta('running'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 10, output_tokens: 5 }
      })
    ])

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => NOW,
      listInstances: async () => [
        instance('__default__', defaultHome, false, true),
        instance('running', runningHome, true)
      ]
    })

    await expect(service.read()).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 17 }
    })
    await expect(service.read({ instanceId: 'running' })).resolves.toMatchObject({
      instanceId: 'running',
      codexHome: runningHome,
      summary: { last30DaysTokens: 15, sessionTokens: 15 }
    })
    await expect(service.read({ running: true })).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 15, sessionTokens: 15 }
    })
    await expect(service.read({ instanceId: 'missing' })).rejects.toThrow(
      'Codex instance not found: missing'
    )
  })

  it('聚合时按唯一 codexHome 去重，避免重复统计同一份日志', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const sharedHome = join(root, 'shared-home')
    await writeJsonl(join(sharedHome, 'sessions/2026/04/22/shared.jsonl'), [
      sessionMeta('shared'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 6, output_tokens: 2 }
      })
    ])

    const duplicateInstances = [
      instance('__default__', sharedHome, false, true),
      instance('alias', sharedHome, true)
    ]
    const service = new CodexCostUsageService({
      userDataPath,
      now: () => NOW,
      listInstances: async () => duplicateInstances
    })

    await expect(service.read()).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 8, sessionTokens: 8 }
    })

    await expect(service.readSnapshotSummaries(duplicateInstances)).resolves.toMatchObject({
      tokenCostByInstanceId: {
        __default__: { last30DaysTokens: 8, sessionTokens: 8 },
        alias: { last30DaysTokens: 8, sessionTokens: 8 }
      },
      runningTokenCostSummary: { last30DaysTokens: 8, sessionTokens: 8 }
    })
  })

  it('在大小写不敏感平台上按 codexHome 大小写归一后去重', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const sharedHome = join(root, 'Shared-Home')
    await writeJsonl(join(sharedHome, 'sessions/2026/04/22/shared.jsonl'), [
      sessionMeta('shared-case-insensitive'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 3, output_tokens: 2 }
      })
    ])

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => NOW,
      platform: 'darwin',
      listInstances: async () => [
        instance('__default__', sharedHome, false, true),
        instance('alias', sharedHome.toLowerCase(), true)
      ]
    })

    await expect(service.read()).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 5, sessionTokens: 5 }
    })
  })

  it('在大小写不敏感平台上复用同一路径的 token/cost 缓存', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const sharedHome = join(root, 'Shared-Home')
    const sharedHomeAlias = join(root, 'shared-home')
    const logPath = join(sharedHome, 'sessions/2026/04/22/shared.jsonl')
    let now = new Date('2026-04-22T12:00:00+08:00')
    let currentHome = sharedHome

    await writeJsonl(logPath, [
      sessionMeta('shared-cache'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        last_token_usage: { input_tokens: 2, output_tokens: 2 }
      }),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 1, output_tokens: 1 }
      })
    ])
    try {
      await symlink(sharedHome, sharedHomeAlias)
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
      if (code !== 'EEXIST') {
        throw error
      }
    }

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => now,
      platform: 'darwin',
      listInstances: async () => [instance('__default__', currentHome, false, true)]
    })

    await expect(service.read({ refresh: true })).resolves.toMatchObject({
      summary: { last30DaysTokens: 6, sessionTokens: 2 }
    })

    await writeJsonl(logPath, [
      sessionMeta('shared-cache'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        last_token_usage: { input_tokens: 20, output_tokens: 5 }
      }),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 3, output_tokens: 1 }
      })
    ])
    currentHome = sharedHomeAlias
    now = new Date('2026-04-22T12:03:00+08:00')

    await expect(service.read()).resolves.toMatchObject({
      summary: { last30DaysTokens: 8, sessionTokens: 4 }
    })
  })

  it('聚合读取时忽略单个实例失败，并保留其他实例结果', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const goodHome = join(root, 'good-home')
    const brokenHome = join(root, 'broken-home')
    await writeJsonl(join(goodHome, 'sessions/2026/04/22/good.jsonl'), [
      sessionMeta('good'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 4, output_tokens: 2 }
      })
    ])
    await mkdir(brokenHome, { recursive: true })
    await writeFile(join(brokenHome, 'sessions'), 'not-a-directory', 'utf8')

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => NOW,
      listInstances: async () => [
        instance('__default__', goodHome, false, true),
        instance('broken', brokenHome, true)
      ]
    })

    await expect(service.read()).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 6, sessionTokens: 6 },
      warnings: [expect.stringContaining('broken')]
    })

    await expect(
      service.readSnapshotSummaries([
        instance('__default__', goodHome, false, true),
        instance('broken', brokenHome, true)
      ])
    ).resolves.toMatchObject({
      tokenCostByInstanceId: {
        __default__: { last30DaysTokens: 6, sessionTokens: 6 }
      },
      tokenCostErrorByInstanceId: {
        broken: expect.any(String)
      }
    })
  })

  it('不可读日志文件应进入 warning / error 路径，而不是静默忽略', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const goodHome = join(root, 'good-home')
    const brokenHome = join(root, 'broken-home')
    await writeJsonl(join(goodHome, 'sessions/2026/04/22/good.jsonl'), [
      sessionMeta('good-readable'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 4, output_tokens: 1 }
      })
    ])
    const unreadableLog = join(brokenHome, 'sessions/2026/04/22/unreadable.jsonl')
    await writeJsonl(unreadableLog, [
      sessionMeta('broken-unreadable'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 20, output_tokens: 5 }
      })
    ])
    await chmod(unreadableLog, 0o000)

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => NOW,
      listInstances: async () => [
        instance('__default__', goodHome, false, true),
        instance('broken', brokenHome, true)
      ]
    })

    await expect(service.read()).resolves.toMatchObject({
      instanceId: '__all__',
      summary: { last30DaysTokens: 5, sessionTokens: 5 },
      warnings: [expect.stringContaining('broken')]
    })

    await expect(
      service.readSnapshotSummaries([
        instance('__default__', goodHome, false, true),
        instance('broken', brokenHome, true)
      ])
    ).resolves.toMatchObject({
      tokenCostByInstanceId: {
        __default__: { last30DaysTokens: 5, sessionTokens: 5 }
      },
      tokenCostErrorByInstanceId: {
        broken: expect.any(String)
      }
    })
  })

  it('自动刷新只重算当天，历史日期沿用缓存；手动刷新全量更新缓存', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const codexHome = join(root, 'default')
    const logPath = join(codexHome, 'sessions/2026/04/22/default.jsonl')
    let now = new Date('2026-04-22T12:00:00+08:00')
    await writeJsonl(logPath, [
      sessionMeta('default'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        last_token_usage: { input_tokens: 2, output_tokens: 2 }
      }),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 1, output_tokens: 1 }
      })
    ])

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => now,
      listInstances: async () => [instance('__default__', codexHome, false, true)]
    })

    await expect(service.read({ refresh: true })).resolves.toMatchObject({
      summary: { last30DaysTokens: 6, sessionTokens: 2 }
    })

    await writeJsonl(logPath, [
      sessionMeta('default'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        last_token_usage: { input_tokens: 20, output_tokens: 5 }
      }),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 3, output_tokens: 1 }
      })
    ])
    now = new Date('2026-04-22T12:03:00+08:00')

    await expect(service.read()).resolves.toMatchObject({
      summary: { last30DaysTokens: 8, sessionTokens: 4 }
    })
    await expect(service.read({ refresh: true })).resolves.toMatchObject({
      summary: { last30DaysTokens: 29, sessionTokens: 4 }
    })
  })

  it('自动刷新只合并当天数据，历史缺口保留到手动刷新处理', async () => {
    const root = await createTempDir()
    const userDataPath = join(root, 'user-data')
    const codexHome = join(root, 'default')
    const initialLogPath = join(codexHome, 'sessions/2026/04/20/default.jsonl')
    let now = new Date('2026-04-20T12:00:00+08:00')
    await writeJsonl(initialLogPath, [
      sessionMeta('default'),
      tokenCount('2026-04-20T10:00:00+08:00', {
        last_token_usage: { input_tokens: 2, output_tokens: 1 }
      })
    ])

    const service = new CodexCostUsageService({
      userDataPath,
      now: () => now,
      listInstances: async () => [instance('__default__', codexHome, false, true)]
    })

    await expect(service.read({ refresh: true })).resolves.toMatchObject({
      summary: { last30DaysTokens: 3, sessionTokens: 3 }
    })

    await writeJsonl(join(codexHome, 'sessions/2026/04/21/missed.jsonl'), [
      sessionMeta('missed'),
      tokenCount('2026-04-21T10:00:00+08:00', {
        last_token_usage: { input_tokens: 1, output_tokens: 1 }
      })
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/today.jsonl'), [
      sessionMeta('today'),
      tokenCount('2026-04-22T10:00:00+08:00', {
        last_token_usage: { input_tokens: 4, output_tokens: 2 }
      })
    ])
    now = new Date('2026-04-22T12:05:00+08:00')

    await expect(service.read()).resolves.toMatchObject({
      summary: { last30DaysTokens: 9, sessionTokens: 6 }
    })
    await expect(service.read({ refresh: true })).resolves.toMatchObject({
      summary: { last30DaysTokens: 11, sessionTokens: 6 }
    })
  })
})
