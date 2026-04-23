// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenCostDetail } from '../../../../shared/codex'

type MockAction = {
  update: () => void
  destroy: () => void
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve = (): void => undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve
  }
}

const chartConfigs: Array<{
  type: string
  data?: {
    labels?: unknown[]
    datasets?: Array<{ label?: string }>
  }
}> = []

vi.mock('svelte-dnd-action', () => {
  const noop = (): void => undefined
  const action = (): MockAction => ({
    update: noop,
    destroy: noop
  })

  return {
    dragHandle: action,
    dragHandleZone: action
  }
})

vi.mock('../gsap-motion', () => {
  const noop = (): void => undefined
  const action = (): MockAction => ({
    update: noop,
    destroy: noop
  })

  return {
    animateProgress: action,
    cascadeIn: action,
    reveal: action
  }
})

vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn()
    data: unknown
    options: unknown

    constructor(_context: unknown, config: (typeof chartConfigs)[number]) {
      this.data = config.data
      this.options = config
      chartConfigs.push(config)
    }

    update(): void {}

    destroy(): void {}
  }

  class MockChartPart {}

  return {
    BarController: MockChartPart,
    BarElement: MockChartPart,
    CategoryScale: MockChartPart,
    Chart: MockChart,
    Filler: MockChartPart,
    Legend: MockChartPart,
    LineController: MockChartPart,
    LineElement: MockChartPart,
    LinearScale: MockChartPart,
    PointElement: MockChartPart,
    Tooltip: MockChartPart
  }
})

import AccountsPanel from '../AccountsPanel.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

const accounts = [
  {
    id: 'acct-1',
    email: 'tagged@example.com',
    tagIds: ['tag-1'],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  },
  {
    id: 'acct-2',
    email: 'untagged@example.com',
    tagIds: [],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

const tags = [
  {
    id: 'tag-1',
    name: '重点',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

function renderAccountsPanel(
  overrideProps: Record<string, unknown> = {}
): ReturnType<typeof render> {
  return render(AccountsPanel, {
    props: {
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      codexInstances: [],
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {},
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: null,
      runningTokenCostInstanceIds: [],
      statsDisplay: {
        dailyTrend: true,
        modelBreakdown: true,
        instanceUsage: true,
        accountUsage: true
      },
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost: vi.fn().mockResolvedValue({
        instanceId: '__default__',
        codexHome: '/tmp/.codex',
        source: 'local',
        summary: {
          sessionTokens: 0,
          sessionCostUSD: null,
          last30DaysTokens: 0,
          last30DaysCostUSD: null,
          updatedAt: '2026-04-21T00:00:00.000Z'
        },
        daily: []
      }),
      startLogin: vi.fn(),
      importCurrent: vi.fn(),
      ...overrideProps
    }
  })
}

const getMetricBlockText = (label: string): string =>
  screen
    .getAllByText(label)
    .find((element) => element.closest('.stats-metric-block'))
    ?.closest('.stats-metric-block')?.textContent ?? ''

describe('AccountsPanel', () => {
  beforeEach(() => {
    chartConfigs.length = 0
  })

  it('在切换 tabs 后保持账户筛选、选择和工作台展开状态', async () => {
    renderAccountsPanel()

    await fireEvent.click(screen.getByRole('button', { name: copy.showFiltersAndBulkActions }))
    await fireEvent.click(screen.getByRole('button', { name: '重点 · 1' }))
    await fireEvent.click(screen.getByRole('button', { name: copy.selectAllVisibleAccounts }))

    expect(
      (
        screen.getByRole('checkbox', {
          name: `${copy.selectAccount} · tagged@example.com`
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(screen.queryByText('untagged@example.com')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: copy.providerCount(0) }))
    await fireEvent.click(screen.getByRole('button', { name: copy.accountCount(accounts.length) }))

    expect(screen.getByRole('button', { name: copy.hideFiltersAndBulkActions })).toBeTruthy()
    expect(
      (
        screen.getByRole('checkbox', {
          name: `${copy.selectAccount} · tagged@example.com`
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(screen.queryByText('untagged@example.com')).toBeNull()
  })

  it('账户标签变更在忙碌期间只允许串行执行一次', async () => {
    const updateAccountTagsDeferred = createDeferred()
    const updateAccountTags = vi.fn().mockReturnValue(updateAccountTagsDeferred.promise)

    renderAccountsPanel({
      updateAccountTags
    })

    const removeTagButton = screen.getByRole('button', { name: `${copy.removeTag} · 重点` })

    await fireEvent.click(removeTagButton)

    expect(updateAccountTags).toHaveBeenCalledOnce()
    expect(updateAccountTags).toHaveBeenCalledWith(accounts[0], [])
    expect((removeTagButton as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(removeTagButton)

    expect(updateAccountTags).toHaveBeenCalledOnce()

    updateAccountTagsDeferred.resolve()
    await updateAccountTagsDeferred.promise
  })

  it('统计页在实例集合变化但更新时间不变时重新拉取明细', async () => {
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: {
        sessionTokens: 10,
        sessionCostUSD: 0.001,
        last30DaysTokens: 20,
        last30DaysCostUSD: 0.002,
        updatedAt: '2026-04-21T00:00:00.000Z'
      },
      daily: []
    })

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: {
          sessionTokens: 10,
          sessionCostUSD: 0.001,
          last30DaysTokens: 20,
          last30DaysCostUSD: 0.002,
          updatedAt: '2026-04-21T00:00:00.000Z'
        }
      },
      runningTokenCostSummary: {
        sessionTokens: 10,
        sessionCostUSD: 0.001,
        last30DaysTokens: 20,
        last30DaysCostUSD: 0.002,
        updatedAt: '2026-04-21T00:00:00.000Z'
      },
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instB: {
          sessionTokens: 10,
          sessionCostUSD: 0.001,
          last30DaysTokens: 20,
          last30DaysCostUSD: 0.002,
          updatedAt: '2026-04-21T00:00:00.000Z'
        }
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: {
        sessionTokens: 10,
        sessionCostUSD: 0.001,
        last30DaysTokens: 20,
        last30DaysCostUSD: 0.002,
        updatedAt: '2026-04-21T00:00:00.000Z'
      },
      runningTokenCostInstanceIds: ['instB'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(2))
  })

  it('统计页拉取完成后立即用最新明细刷新页头指标', async () => {
    const initialSummary = {
      sessionTokens: 10,
      sessionCostUSD: 0.001,
      last30DaysTokens: 20,
      last30DaysCostUSD: 0.002,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }
    const refreshedSummary = {
      sessionTokens: 16,
      sessionCostUSD: 0.0016,
      last30DaysTokens: 28,
      last30DaysCostUSD: 0.0028,
      updatedAt: '2026-04-22T00:00:00.000Z'
    }
    const expectedUpdatedAt = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(refreshedSummary.updatedAt))
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: refreshedSummary,
      daily: []
    })

    renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: initialSummary
      },
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    expect(getMetricBlockText(copy.today)).toContain('$0.0016')
    expect(getMetricBlockText(copy.last30Days)).toContain('$0.0028')
    expect(screen.getByText(copy.updatedAt).parentElement?.textContent ?? '').toContain(
      expectedUpdatedAt
    )
  })

  it('实例图表使用实例汇总快照而不是单个明细汇总', async () => {
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: {
        sessionTokens: 0,
        sessionCostUSD: null,
        last30DaysTokens: 0,
        last30DaysCostUSD: null,
        updatedAt: '2026-04-21T00:00:00.000Z'
      },
      daily: []
    })

    renderAccountsPanel({
      codexInstances: [
        {
          id: '__default__',
          name: '',
          codexHome: '/tmp/.codex',
          extraArgs: '',
          isDefault: true,
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z',
          running: false,
          initialized: true
        },
        {
          id: 'inst-work',
          name: 'Work',
          codexHome: '/tmp/instances/work',
          extraArgs: '',
          isDefault: false,
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z',
          running: true,
          initialized: true
        }
      ],
      tokenCostByInstanceId: {
        __default__: {
          sessionTokens: 20,
          sessionCostUSD: 0.0002,
          last30DaysTokens: 80,
          last30DaysCostUSD: 0.0008,
          updatedAt: '2026-04-21T00:00:00.000Z'
        },
        'inst-work': {
          sessionTokens: 40,
          sessionCostUSD: 0.0004,
          last30DaysTokens: 180,
          last30DaysCostUSD: 0.0018,
          updatedAt: '2026-04-22T00:00:00.000Z'
        }
      },
      runningTokenCostSummary: {
        sessionTokens: 60,
        sessionCostUSD: 0.0006,
        last30DaysTokens: 260,
        last30DaysCostUSD: 0.0026,
        updatedAt: '2026-04-22T00:00:00.000Z'
      },
      runningTokenCostInstanceIds: ['inst-work'],
      readTokenCost
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    expect(
      chartConfigs.some(
        (config) => JSON.stringify(config.data?.labels ?? []) === JSON.stringify(['Work', 'default'])
      )
    ).toBe(true)
  })

  it('账号图表使用账号展示名而不是裸 account id', async () => {
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: {
        sessionTokens: 0,
        sessionCostUSD: null,
        last30DaysTokens: 0,
        last30DaysCostUSD: null,
        updatedAt: '2026-04-21T00:00:00.000Z'
      },
      daily: []
    })

    renderAccountsPanel({
      usageByAccountId: {
        'acct-1': {
          limitId: 'codex',
          limitName: 'Codex',
          planType: 'plus',
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: null
          },
          secondary: null,
          credits: null,
          limits: [],
          fetchedAt: '2026-04-21T00:00:00.000Z'
        },
        'acct-2': {
          limitId: 'codex',
          limitName: 'Codex',
          planType: 'plus',
          primary: {
            usedPercent: 80,
            windowDurationMins: 300,
            resetsAt: null
          },
          secondary: null,
          credits: null,
          limits: [],
          fetchedAt: '2026-04-21T01:00:00.000Z'
        }
      },
      readTokenCost
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    expect(
      chartConfigs.some(
        (config) =>
          JSON.stringify(config.data?.labels ?? []) ===
          JSON.stringify(['untagged@example.com', 'tagged@example.com'])
      )
    ).toBe(true)
  })

  it('统计页连续切换显示配置时保留前一次改动', async () => {
    const updateStatsDisplay = vi.fn().mockResolvedValue(undefined)

    renderAccountsPanel({
      updateStatsDisplay
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))

    await fireEvent.click(screen.getByRole('checkbox', { name: copy.instanceUsage }))
    expect(updateStatsDisplay).toHaveBeenCalledWith({
      dailyTrend: true,
      modelBreakdown: true,
      instanceUsage: false,
      accountUsage: true
    })

    await fireEvent.click(screen.getByRole('checkbox', { name: copy.modelBreakdown }))
    expect(updateStatsDisplay).toHaveBeenLastCalledWith({
      dailyTrend: true,
      modelBreakdown: false,
      instanceUsage: false,
      accountUsage: true
    })
  })

  it('统计页成功拉取明细后不再继续展示旧的 snapshot 告警', async () => {
    const initialSummary = {
      sessionTokens: 10,
      sessionCostUSD: 0.001,
      last30DaysTokens: 20,
      last30DaysCostUSD: 0.002,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }
    const refreshedSummary = {
      sessionTokens: 16,
      sessionCostUSD: 0.0016,
      last30DaysTokens: 28,
      last30DaysCostUSD: 0.0028,
      updatedAt: '2026-04-22T00:00:00.000Z'
    }
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: refreshedSummary,
      daily: []
    })

    renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: initialSummary
      },
      tokenCostErrorByInstanceId: {
        instA: '旧的 snapshot 告警'
      },
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('旧的 snapshot 告警')).toBeNull()
  })

  it('统计页首次自动拉取后收到同拓扑 snapshot 更新时不重复拉取明细', async () => {
    const initialSummary = {
      sessionTokens: 10,
      sessionCostUSD: 0.001,
      last30DaysTokens: 20,
      last30DaysCostUSD: 0.002,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }
    const refreshedSummary = {
      sessionTokens: 16,
      sessionCostUSD: 0.0016,
      last30DaysTokens: 28,
      last30DaysCostUSD: 0.0028,
      updatedAt: '2026-04-22T00:00:00.000Z'
    }
    const readTokenCost = vi.fn().mockResolvedValue({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: refreshedSummary,
      daily: []
    })

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: initialSummary
      },
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instA: refreshedSummary
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: refreshedSummary,
      runningTokenCostInstanceIds: ['instA'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readTokenCost).toHaveBeenCalledTimes(1)
  })

  it('手动刷新后收到同拓扑 snapshot 更新时不重复拉取明细', async () => {
    const initialSummary = {
      sessionTokens: 10,
      sessionCostUSD: 0.001,
      last30DaysTokens: 20,
      last30DaysCostUSD: 0.002,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }
    const refreshedSummary = {
      sessionTokens: 16,
      sessionCostUSD: 0.0016,
      last30DaysTokens: 28,
      last30DaysCostUSD: 0.0028,
      updatedAt: '2026-04-22T00:00:00.000Z'
    }
    const readTokenCost = vi
      .fn()
      .mockResolvedValueOnce({
        instanceId: '__all__',
        codexHome: '/tmp/.codex',
        source: 'local',
        summary: initialSummary,
        daily: []
      })
      .mockResolvedValueOnce({
        instanceId: '__all__',
        codexHome: '/tmp/.codex',
        source: 'local',
        summary: refreshedSummary,
        daily: []
      })

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: initialSummary
      },
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    await fireEvent.click(screen.getByRole('button', { name: copy.refresh }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(2))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instA: refreshedSummary
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: refreshedSummary,
      runningTokenCostInstanceIds: ['instA'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readTokenCost).toHaveBeenCalledTimes(2)
  })

  it('旧并发请求回流 snapshot 时不会触发额外重读', async () => {
    const initialSummary = {
      sessionTokens: 10,
      sessionCostUSD: 0.001,
      last30DaysTokens: 20,
      last30DaysCostUSD: 0.002,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }
    const staleSummary = {
      sessionTokens: 12,
      sessionCostUSD: 0.0012,
      last30DaysTokens: 22,
      last30DaysCostUSD: 0.0022,
      updatedAt: '2026-04-22T00:00:00.000Z'
    }
    const refreshedSummary = {
      sessionTokens: 16,
      sessionCostUSD: 0.0016,
      last30DaysTokens: 28,
      last30DaysCostUSD: 0.0028,
      updatedAt: '2026-04-23T00:00:00.000Z'
    }

    let resolveInitialRead: ((value: TokenCostDetail) => void) | undefined
    let resolveNextRead: ((value: TokenCostDetail) => void) | undefined
    const readTokenCost = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TokenCostDetail>((resolve) => {
            resolveInitialRead = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<TokenCostDetail>((resolve) => {
            resolveNextRead = resolve
          })
      )
      .mockResolvedValue({
        instanceId: '__all__',
        codexHome: '/tmp/.codex',
        source: 'local',
        summary: refreshedSummary,
        daily: []
      })

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: initialSummary
      },
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instB: initialSummary
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: initialSummary,
      runningTokenCostInstanceIds: ['instB'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(2))

    resolveInitialRead?.({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: staleSummary,
      daily: []
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instB: staleSummary
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: staleSummary,
      runningTokenCostInstanceIds: ['instB'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readTokenCost).toHaveBeenCalledTimes(2)

    resolveNextRead?.({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: refreshedSummary,
      daily: []
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('统计明细刷新失败后清空旧图表', async () => {
    const readTokenCost = vi
      .fn()
      .mockResolvedValueOnce({
        instanceId: '__all__',
        codexHome: '/tmp/.codex',
        source: 'local',
        summary: {
          sessionTokens: 12,
          sessionCostUSD: 0.0012,
          last30DaysTokens: 24,
          last30DaysCostUSD: 0.0024,
          updatedAt: '2026-04-21T00:00:00.000Z'
        },
        daily: [
          {
            date: '2026-04-21',
            inputTokens: 8,
            outputTokens: 4,
            totalTokens: 12,
            costUSD: 0.0012,
            modelsUsed: ['gpt-5'],
            modelBreakdowns: [
              {
                modelName: 'gpt-5',
                totalTokens: 12,
                costUSD: 0.0012
              }
            ]
          }
        ]
      })
      .mockRejectedValueOnce(new Error('读取失败'))

    const summary = {
      sessionTokens: 12,
      sessionCostUSD: 0.0012,
      last30DaysTokens: 24,
      last30DaysCostUSD: 0.0024,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: summary
      },
      runningTokenCostSummary: summary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(view.container.querySelector(`canvas[aria-label="${copy.dailyTrend}"]`)).not.toBeNull()
    )
    await waitFor(() =>
      expect(
        view.container.querySelector(`canvas[aria-label="${copy.modelBreakdown}"]`)
      ).not.toBeNull()
    )

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instB: summary
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: summary,
      runningTokenCostInstanceIds: ['instB'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('读取失败')).toBeTruthy())
    expect(view.container.querySelector(`canvas[aria-label="${copy.dailyTrend}"]`)).toBeNull()
    expect(view.container.querySelector(`canvas[aria-label="${copy.modelBreakdown}"]`)).toBeNull()
  })

  it('并发统计请求只保留最新一次结果', async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined
    let resolveSecond: ((value: TokenCostDetail) => void) | undefined

    const readTokenCost = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TokenCostDetail>((_resolve, reject) => {
            rejectFirst = reject
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<TokenCostDetail>((resolve) => {
            resolveSecond = resolve
          })
      )

    const summary = {
      sessionTokens: 9,
      sessionCostUSD: 0.0009,
      last30DaysTokens: 18,
      last30DaysCostUSD: 0.0018,
      updatedAt: '2026-04-21T00:00:00.000Z'
    }

    const view = renderAccountsPanel({
      readTokenCost,
      tokenCostByInstanceId: {
        instA: summary
      },
      runningTokenCostSummary: summary,
      runningTokenCostInstanceIds: ['instA']
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.tokenStats }))
    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(1))

    await view.rerender({
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      tokenCostByInstanceId: {
        instB: {
          ...summary,
          updatedAt: '2026-04-22T00:00:00.000Z'
        }
      },
      tokenCostErrorByInstanceId: {},
      runningTokenCostSummary: {
        ...summary,
        updatedAt: '2026-04-22T00:00:00.000Z'
      },
      runningTokenCostInstanceIds: ['instB'],
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      updateShowLocalMockData: vi.fn(),
      updateStatsDisplay: vi.fn().mockResolvedValue(undefined),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      readTokenCost,
      startLogin: vi.fn(),
      importCurrent: vi.fn()
    })

    await waitFor(() => expect(readTokenCost).toHaveBeenCalledTimes(2))

    resolveSecond?.({
      instanceId: '__all__',
      codexHome: '/tmp/.codex',
      source: 'local',
      summary: {
        sessionTokens: 15,
        sessionCostUSD: 0.0015,
        last30DaysTokens: 25,
        last30DaysCostUSD: 0.0025,
        updatedAt: '2026-04-22T00:00:00.000Z'
      },
      daily: [
        {
          date: '2026-04-22',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUSD: 0.0015,
          modelsUsed: ['gpt-5'],
          modelBreakdowns: [
            {
              modelName: 'gpt-5',
              totalTokens: 15,
              costUSD: 0.0015
            }
          ]
        }
      ]
    })

    await waitFor(() =>
      expect(view.container.querySelector(`canvas[aria-label="${copy.dailyTrend}"]`)).not.toBeNull()
    )

    rejectFirst?.(new Error('过期失败'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('过期失败')).toBeNull()
    expect(view.container.querySelector(`canvas[aria-label="${copy.dailyTrend}"]`)).not.toBeNull()
  })
})
