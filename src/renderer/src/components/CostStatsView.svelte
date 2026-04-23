<script lang="ts">
  import { onMount } from 'svelte'
  import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip,
    type ChartConfiguration
  } from 'chart.js'
  import type {
    AccountRateLimits,
    AccountSummary,
    AppLanguage,
    CodexInstanceSummary,
    StatsDisplaySettings,
    TokenCostDetail,
    TokenCostModelBreakdown,
    TokenCostReadOptions,
    TokenCostSummary
  } from '../../../shared/codex'
  import { normalizeStatsDisplaySettings } from '../../../shared/codex'
  import { buildAccountUsageEntries, buildInstanceConsumptionEntries } from './cost-stats-data'
  import { accountLabel, type LocalizedCopy } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'

  Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Filler,
    Tooltip,
    Legend
  )

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let codexInstances: CodexInstanceSummary[] = []
  export let tokenCostByInstanceId: Record<string, TokenCostSummary> = {}
  export let tokenCostErrorByInstanceId: Record<string, string> = {}
  export let runningTokenCostSummary: TokenCostSummary | null = null
  export let runningTokenCostInstanceIds: string[] = []
  export let compactGhostButton: string
  export let usageByAccountId: Record<string, AccountRateLimits> = {}
  export let statsDisplay: StatsDisplaySettings
  export let updateStatsDisplay: (statsDisplay: StatsDisplaySettings) => Promise<void>
  export let readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>

  let lastLoadedKey = ''
  let detailRequestVersion = 0
  let pendingSnapshotSyncs: Array<{
    topologyKey: string
    updatedAt: string
  }> = []
  let detail: TokenCostDetail | null = null
  let loadingDetail = false
  let detailError = ''
  let detailWarnings: string[] = []
  let detailTopologyKey = ''
  let snapshotSelectedSummary: TokenCostSummary | null = null
  let selectedSummary: TokenCostSummary | null = null
  let currentSnapshotTopologyKey = ''
  let snapshotError = ''
  let warningMessages: string[] = []
  let modelBreakdowns: TokenCostModelBreakdown[] = []
  let instanceUsageRows: InstanceUsageRow[] = []
  let accountUsageRows: AccountUsageRow[] = []
  let chartDaily: TokenCostDetail['daily'] = []
  let trendCanvas: HTMLCanvasElement | null = null
  let modelCanvas: HTMLCanvasElement | null = null
  let instanceCanvas: HTMLCanvasElement | null = null
  let accountCanvas: HTMLCanvasElement | null = null
  let trendChart: Chart<'line', (number | null)[], string> | null = null
  let modelChart: Chart<'bar', number[], string> | null = null
  let instanceChart: Chart<'bar', number[], string> | null = null
  let accountChart: Chart<'bar', number[], string> | null = null
  let trendChartSyncKey = ''
  let modelChartSyncKey = ''
  let instanceChartSyncKey = ''
  let accountChartSyncKey = ''
  let modelChartHeight = 280
  let instanceChartHeight = 280
  let accountChartHeight = 280
  let statsDisplayDraft = normalizeStatsDisplaySettings(statsDisplay)

  const summaryHasData = (summary: TokenCostSummary | null): boolean =>
    Boolean(summary && (summary.sessionTokens > 0 || summary.last30DaysTokens > 0))

  const formatTokens = (value: number): string =>
    new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN').format(value)

  const formatCost = (value: number | null): string => {
    if (value === null) {
      return '--'
    }

    if (value > 0 && value < 0.0001) {
      return `$${value.toExponential(2)}`
    }

    return `$${value.toFixed(4)}`
  }

  const formatUpdatedAt = (value?: string): string => {
    if (!value) {
      return '--'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date)
  }

  const formatPercent = (value: number | null): string => {
    if (value === null || Number.isNaN(value)) {
      return '--'
    }

    return `${Math.round(value)}%`
  }

  const formatCredits = (usage: AccountRateLimits): string => {
    if (!usage.credits?.hasCredits) {
      return '--'
    }

    if (usage.credits.unlimited) {
      return copy.unlimited
    }

    if (usage.credits.balance === null) {
      return '--'
    }

    return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN', {
      maximumFractionDigits: 2
    }).format(usage.credits.balance)
  }

  const formatInstanceName = (instanceId: string, instance?: CodexInstanceSummary): string => {
    if (instance?.isDefault || instanceId === '__default__') {
      return 'default'
    }

    const name = instance?.name?.trim()
    if (name) {
      return name
    }

    const segments = instance?.codexHome?.split('/').filter(Boolean) ?? []
    return segments.at(-1) || instanceId
  }

  const formatDayLabel = (value: string): string => {
    const [, month = '0', day = '0'] = value.split('-')
    return `${Number(month)}/${Number(day)}`
  }

  const setStatsDisplay = (
    key: keyof StatsDisplaySettings,
    enabled: boolean
  ): void => {
    const next = normalizeStatsDisplaySettings({
      ...statsDisplayDraft,
      [key]: enabled
    })
    statsDisplayDraft = next
    void updateStatsDisplay(next)
  }

  interface CostRollup {
    total: number
    hasKnown: boolean
    hasUnknown: boolean
  }

  interface InstanceUsageRow {
    label: string
    tokens: number
    costUSD: number | null
  }

  interface AccountUsageRow {
    label: string
    sessionUsedPercent: number | null
    weeklyUsedPercent: number | null
    credits: string
  }

  const createCostRollup = (): CostRollup => ({
    total: 0,
    hasKnown: false,
    hasUnknown: false
  })

  const addCostToRollup = (
    rollup: CostRollup,
    costUSD: number | null,
    totalTokens: number
  ): void => {
    if (costUSD === null) {
      if (totalTokens > 0) {
        rollup.hasUnknown = true
      }
      return
    }

    rollup.total += costUSD
    rollup.hasKnown = true
  }

  const finalizeCostRollup = (rollup: CostRollup): number | null => {
    if (rollup.hasUnknown) {
      return null
    }

    if (!rollup.hasKnown) {
      return null
    }

    return rollup.total
  }

  const buildSnapshotTopologyKey = (
    instanceIds = runningTokenCostInstanceIds,
    costByInstanceId = tokenCostByInstanceId,
    errorByInstanceId = tokenCostErrorByInstanceId
  ): string =>
    JSON.stringify({
      runningTokenCostInstanceIds: [...instanceIds],
      tokenCostInstanceIds: Object.keys(costByInstanceId).sort(),
      tokenCostErrorEntries: Object.entries(errorByInstanceId).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    })

  const buildSnapshotLoadKey = (): string =>
    JSON.stringify({
      topologyKey: buildSnapshotTopologyKey(),
      runningTokenCostSummary,
      tokenCostByInstanceId: Object.entries(tokenCostByInstanceId)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instanceId, summary]) => [instanceId, summary]),
      tokenCostErrorByInstanceId: Object.entries(tokenCostErrorByInstanceId)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instanceId, message]) => [instanceId, message])
    })

  const rememberPendingSnapshotSync = (topologyKey: string, updatedAt: string): void => {
    const nextSync = { topologyKey, updatedAt }
    pendingSnapshotSyncs = [
      ...pendingSnapshotSyncs.filter(
        (sync) => sync.topologyKey !== topologyKey || sync.updatedAt !== updatedAt
      ),
      nextSync
    ].slice(-8)
  }

  const consumePendingSnapshotSync = (topologyKey: string, updatedAt: string): boolean => {
    const index = pendingSnapshotSyncs.findIndex(
      (sync) => sync.topologyKey === topologyKey && sync.updatedAt === updatedAt
    )
    if (index === -1) {
      return false
    }

    pendingSnapshotSyncs = pendingSnapshotSyncs.filter((_, currentIndex) => currentIndex !== index)
    return true
  }

  const readCssVar = (name: string, fallback: string): string => {
    if (typeof window === 'undefined') {
      return fallback
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  }

  const withAlpha = (color: string, alpha: number): string => {
    const normalized = color.trim()
    if (!normalized) {
      return color
    }

    if (normalized.startsWith('#')) {
      const hex = normalized.slice(1)
      const expanded =
        hex.length === 3
          ? hex
              .split('')
              .map((segment) => segment + segment)
              .join('')
          : hex
      if (expanded.length === 6) {
        const red = Number.parseInt(expanded.slice(0, 2), 16)
        const green = Number.parseInt(expanded.slice(2, 4), 16)
        const blue = Number.parseInt(expanded.slice(4, 6), 16)
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`
      }
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i)
    if (rgbMatch) {
      const [red = '0', green = '0', blue = '0'] = rgbMatch[1].split(',').map((part) => part.trim())
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    }

    const hslMatch = normalized.match(/^hsla?\(([^)]+)\)$/i)
    if (hslMatch) {
      return normalized.replace(/hsla?\(([^)]+)\)/i, (match, p1) => {
        const parts = p1.split(',')
        if (parts.length === 3) {
          return `hsla(${p1}, ${alpha})`
        }
        if (parts.length === 4) {
          parts[3] = alpha.toString()
          return `hsla(${parts.join(',')})`
        }
        return match
      })
    }

    return color
  }

  const aggregateModelBreakdowns = (
    currentDetail: TokenCostDetail | null
  ): TokenCostModelBreakdown[] => {
    if (!currentDetail) {
      return []
    }

    const byModel: Record<string, TokenCostModelBreakdown & { cost: CostRollup }> = {}
    for (const entry of currentDetail.daily) {
      for (const breakdown of entry.modelBreakdowns) {
        const existing = byModel[breakdown.modelName]
        const cost = existing?.cost ?? createCostRollup()
        addCostToRollup(cost, breakdown.costUSD, breakdown.totalTokens)
        byModel[breakdown.modelName] = {
          modelName: breakdown.modelName,
          totalTokens: (existing?.totalTokens ?? 0) + breakdown.totalTokens,
          costUSD: finalizeCostRollup(cost),
          cost
        }
      }
    }

    return Object.values(byModel)
      .map(({ modelName, totalTokens, costUSD }) => ({
        modelName,
        totalTokens,
        costUSD
      }))
      .sort((left, right) => {
        const leftCost = left.costUSD ?? -1
        const rightCost = right.costUSD ?? -1
        if (leftCost !== rightCost) {
          return rightCost - leftCost
        }
        return right.totalTokens - left.totalTokens
      })
  }

  const syncTrendChart = (): void => {
    if (!trendCanvas) {
      return
    }

    if (!chartDaily.length) {
      trendChart?.destroy()
      trendChart = null
      return
    }

    const context = trendCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accentTokens = readCssVar('--ink', '#18181b')
    const accentCost = readCssVar('--success', '#0f766e')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'line', (number | null)[], string> = {
      type: 'line',
      data: {
        labels: chartDaily.map((entry) => formatDayLabel(entry.date)),
        datasets: [
          {
            label: copy.tokens,
            data: chartDaily.map((entry) => entry.totalTokens),
            yAxisID: 'yTokens',
            borderColor: accentTokens,
            backgroundColor: withAlpha(accentTokens, 0.08),
            fill: true,
            tension: 0.32,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: accentTokens,
            pointHitRadius: 14
          },
          {
            label: copy.cost,
            data: chartDaily.map((entry) => entry.costUSD),
            yAxisID: 'yCost',
            borderColor: withAlpha(accentCost, 0.6),
            backgroundColor: 'transparent',
            tension: 0.28,
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointBackgroundColor: accentCost,
            pointHitRadius: 12
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        animation: {
          duration: 260
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              color: ink,
              padding: 14,
              font: {
                size: 11,
                weight: 600
              }
            }
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: true,
            callbacks: {
              title: (items) => {
                const index = items[0]?.dataIndex ?? 0
                return chartDaily[index]?.date ?? items[0]?.label ?? ''
              },
              label: (context) => {
                const value = typeof context.parsed.y === 'number' ? context.parsed.y : null
                if (context.dataset.yAxisID === 'yCost') {
                  return `${copy.cost}: ${formatCost(value)}`
                }
                return `${copy.tokens}: ${formatTokens(value ?? 0)}`
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: muted,
              autoSkip: true,
              maxTicksLimit: 7
            }
          },
          yTokens: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          yCost: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: {
              drawOnChartArea: false
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatCost(Number(value))
            }
          }
        }
      }
    }

    if (trendChart) {
      trendChart.data = config.data
      trendChart.options = config.options ?? {}
      trendChart.update()
      return
    }

    trendChart = new Chart(context, config)
  }

  const syncModelChart = (): void => {
    if (!modelCanvas) {
      return
    }

    if (!modelBreakdowns.length) {
      modelChart?.destroy()
      modelChart = null
      return
    }

    const context = modelCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accentTokens = readCssVar('--ink', '#18181b')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: modelBreakdowns.map((entry) => entry.modelName),
        datasets: [
          {
            label: copy.tokens,
            data: modelBreakdowns.map((entry) => entry.totalTokens),
            backgroundColor: withAlpha(accentTokens, 0.75),
            borderColor: accentTokens,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context) => {
                const model = modelBreakdowns[context.dataIndex]
                return `${copy.tokens}: ${formatTokens(model?.totalTokens ?? 0)}`
              },
              afterLabel: (context) => {
                const model = modelBreakdowns[context.dataIndex]
                return `${copy.cost}: ${formatCost(model?.costUSD ?? null)}`
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (modelChart) {
      modelChart.data = config.data
      modelChart.options = config.options ?? {}
      modelChart.update()
      return
    }

    modelChart = new Chart(context, config)
  }

  const syncInstanceChart = (): void => {
    if (!instanceCanvas) {
      return
    }

    if (!instanceUsageRows.length) {
      instanceChart?.destroy()
      instanceChart = null
      return
    }

    const context = instanceCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accent = readCssVar('--ink', '#18181b')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: instanceUsageRows.map((entry) => entry.label),
        datasets: [
          {
            label: copy.tokens,
            data: instanceUsageRows.map((entry) => entry.tokens),
            backgroundColor: withAlpha(accent, 0.72),
            borderColor: accent,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context) => {
                const item = instanceUsageRows[context.dataIndex]
                return `${copy.tokens}: ${formatTokens(item?.tokens ?? 0)}`
              },
              afterLabel: (context) => {
                const item = instanceUsageRows[context.dataIndex]
                return copy.costReference(formatCost(item?.costUSD ?? null))
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (instanceChart) {
      instanceChart.data = config.data
      instanceChart.options = config.options ?? {}
      instanceChart.update()
      return
    }

    instanceChart = new Chart(context, config)
  }

  const syncAccountChart = (): void => {
    if (!accountCanvas) {
      return
    }

    if (!accountUsageRows.length) {
      accountChart?.destroy()
      accountChart = null
      return
    }

    const context = accountCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accentPrimary = readCssVar('--ink', '#18181b')
    const accentSecondary = readCssVar('--success', '#0f766e')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: accountUsageRows.map((entry) => entry.label),
        datasets: [
          {
            label: copy.sessionUsed,
            data: accountUsageRows.map((entry) => entry.sessionUsedPercent ?? 0),
            backgroundColor: withAlpha(accentPrimary, 0.72),
            borderColor: accentPrimary,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 14,
            maxBarThickness: 16
          },
          {
            label: copy.weeklyUsed,
            data: accountUsageRows.map((entry) => entry.weeklyUsedPercent ?? 0),
            backgroundColor: withAlpha(accentSecondary, 0.64),
            borderColor: accentSecondary,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 14,
            maxBarThickness: 16
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              color: ink,
              padding: 14,
              font: {
                size: 11,
                weight: 600
              }
            }
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              afterBody: (items) => {
                const row = accountUsageRows[items[0]?.dataIndex ?? 0]
                return row ? ["", `${copy.credits}: ${row.credits}`] : []
              },
              label: (context) => {
                const row = accountUsageRows[context.dataIndex]
                return `${context.dataset.label}: ${formatPercent(
                  context.datasetIndex === 0 ? row?.sessionUsedPercent ?? null : row?.weeklyUsedPercent ?? null
                )}`
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => `${Number(value)}%`
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (accountChart) {
      accountChart.data = config.data
      accountChart.options = config.options ?? {}
      accountChart.update()
      return
    }

    accountChart = new Chart(context, config)
  }

  async function loadDetail(refresh = false): Promise<void> {
    const requestVersion = ++detailRequestVersion
    const requestTopologyKey = buildSnapshotTopologyKey()
    loadingDetail = true
    detailError = ''
    detailWarnings = []

    try {
      const nextDetail = await readTokenCost({ refresh })
      rememberPendingSnapshotSync(buildSnapshotTopologyKey(), nextDetail.summary.updatedAt)
      if (requestVersion !== detailRequestVersion) {
        return
      }
      detail = nextDetail
      detailWarnings = nextDetail.warnings ?? []
      detailTopologyKey = requestTopologyKey
    } catch (error) {
      if (requestVersion !== detailRequestVersion) {
        return
      }
      detail = null
      detailError = error instanceof Error ? error.message : copy.tokenStatsReadFailed
      detailTopologyKey = ''
    } finally {
      if (requestVersion === detailRequestVersion) {
        loadingDetail = false
      }
    }
  }

  onMount(() => {
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            syncTrendChart()
            syncModelChart()
            syncInstanceChart()
            syncAccountChart()
          })

    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    syncTrendChart()
    syncModelChart()
    syncInstanceChart()
    syncAccountChart()

    return () => {
      observer?.disconnect()
      trendChart?.destroy()
      trendChart = null
      modelChart?.destroy()
      modelChart = null
      instanceChart?.destroy()
      instanceChart = null
      accountChart?.destroy()
      accountChart = null
    }
  })

  $: {
    const key = buildSnapshotLoadKey()
    const topologyKey = buildSnapshotTopologyKey()
    if (key && key !== lastLoadedKey) {
      const shouldSkipAutoLoad = consumePendingSnapshotSync(
        topologyKey,
        snapshotSelectedSummary?.updatedAt ?? ''
      )
      lastLoadedKey = key
      if (!shouldSkipAutoLoad) {
        void loadDetail(false)
      }
    }
  }

  $: snapshotSelectedSummary =
    runningTokenCostSummary ?? Object.values(tokenCostByInstanceId)[0] ?? null
  $: selectedSummary = detail?.summary ?? snapshotSelectedSummary
  $: currentSnapshotTopologyKey = buildSnapshotTopologyKey(
    runningTokenCostInstanceIds,
    tokenCostByInstanceId,
    tokenCostErrorByInstanceId
  )
  $: snapshotError = Object.values(tokenCostErrorByInstanceId).find(Boolean) ?? ''
  $: warningMessages = [
    ...new Set(
      [
        !detail || detailTopologyKey !== currentSnapshotTopologyKey ? snapshotError : '',
        ...detailWarnings
      ].filter((message): message is string => Boolean(message))
    )
  ]
  $: modelBreakdowns = aggregateModelBreakdowns(detail)
  $: statsDisplayDraft = normalizeStatsDisplaySettings(statsDisplay)
  $: instanceUsageRows = buildInstanceConsumptionEntries({
    tokenCostByInstanceId,
    instances: codexInstances,
    runningInstanceIds: runningTokenCostInstanceIds,
    resolveLabel: (instanceId, instance) => formatInstanceName(instanceId, instance)
  }).map((entry) => ({
    label: entry.label,
    tokens: entry.last30DaysTokens,
    costUSD: entry.last30DaysCostUSD
  }))
  $: accountUsageRows = buildAccountUsageEntries({
    accounts,
    usageByAccountId,
    resolveLabel: (account) => accountLabel(account, copy)
  }).map((entry) => ({
    label: entry.label,
    sessionUsedPercent: entry.sessionUsedPercent,
    weeklyUsedPercent: entry.weeklyUsedPercent,
    credits:
      usageByAccountId[entry.accountId] != null ? formatCredits(usageByAccountId[entry.accountId]) : '--'
  }))
  $: chartDaily = detail ? [...detail.daily] : []
  $: modelChartHeight = Math.max(280, modelBreakdowns.length * 38)
  $: instanceChartHeight = Math.max(280, instanceUsageRows.length * 38)
  $: accountChartHeight = Math.max(280, accountUsageRows.length * 44)
  $: trendChartSyncKey = [
    language,
    copy.tokens,
    copy.cost,
    runningTokenCostInstanceIds.join(','),
    selectedSummary?.updatedAt ?? '',
    ...chartDaily.map((entry) => `${entry.date}:${entry.totalTokens}:${entry.costUSD ?? ''}`)
  ].join('|')
  $: modelChartSyncKey = [
    language,
    copy.tokens,
    copy.cost,
    runningTokenCostInstanceIds.join(','),
    ...modelBreakdowns.map(
      (entry) => `${entry.modelName}:${entry.totalTokens}:${entry.costUSD ?? ''}`
    )
  ].join('|')
  $: instanceChartSyncKey = [
    language,
    copy.instanceUsage,
    copy.tokens,
    copy.cost,
    ...instanceUsageRows.map((entry) => `${entry.label}:${entry.tokens}:${entry.costUSD ?? ''}`)
  ].join('|')
  $: accountChartSyncKey = [
    language,
    copy.accountUsage,
    copy.sessionUsed,
    copy.weeklyUsed,
    copy.credits,
    ...accountUsageRows.map(
      (entry) =>
        `${entry.label}:${entry.sessionUsedPercent ?? ''}:${entry.weeklyUsedPercent ?? ''}:${entry.credits}`
    )
  ].join('|')
  $: if (!trendCanvas && trendChart) {
    trendChart.destroy()
    trendChart = null
  }
  $: if (!modelCanvas && modelChart) {
    modelChart.destroy()
    modelChart = null
  }
  $: if (!instanceCanvas && instanceChart) {
    instanceChart.destroy()
    instanceChart = null
  }
  $: if (!accountCanvas && accountChart) {
    accountChart.destroy()
    accountChart = null
  }
  $: if (trendCanvas && trendChartSyncKey) {
    syncTrendChart()
  }
  $: if (modelCanvas && modelChartSyncKey) {
    syncModelChart()
  }
  $: if (instanceCanvas && instanceChartSyncKey) {
    syncInstanceChart()
  }
  $: if (accountCanvas && accountChartSyncKey) {
    syncAccountChart()
  }
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4 pr-1"
  use:reveal={{ delay: 0.02 }}
>
  <section
    class="stats-stage rounded-2xl border px-4 py-4 sm:px-5 sm:py-5"
    use:cascadeIn={{
      selector: '[data-motion-item]'
    }}
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="grid gap-2" data-motion-item>
        <p class="text-[11px] font-bold uppercase tracking-[0.26em] text-faint opacity-80">
          {copy.tokenStats}
        </p>
        <h2 class="text-[1.4rem] font-semibold tracking-[-0.03em] text-ink sm:text-[1.65rem]">
          {copy.tokenStatsTitle}
        </h2>
        <p class="max-w-2xl text-sm text-muted-strong">
          {copy.tokenStatsDescription}
        </p>
      </div>

      <button
        class={`${compactGhostButton} stats-refresh-button h-11 rounded-2xl px-4`}
        type="button"
        onclick={() => loadDetail(true)}
        disabled={loadingDetail}
        data-motion-item
      >
        <span
          class={`${loadingDetail ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-4 w-4`}
        ></span>
        <span>{loadingDetail ? copy.refreshing : copy.refresh}</span>
      </button>
    </div>

    <div class="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
      <div class="grid gap-4" data-motion-item>
        <div class="grid gap-3 sm:grid-cols-2">
          <div
            class="stats-metric-block stats-metric-tokens group grid gap-2 rounded-2xl px-4 py-4 sm:px-5"
            data-motion-item
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-faint">
                {copy.today}
              </p>
              <span class="h-1.5 w-1.5 rounded-full bg-ink/60"></span>
            </div>
            <div class="flex items-end gap-2">
              <span
                class="text-[1.8rem] font-semibold tabular-nums tracking-[-0.04em] text-ink sm:text-[2.25rem]"
              >
                {formatTokens(selectedSummary?.sessionTokens ?? 0)}
              </span>
              <span
                class="pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-strong"
              >
                {copy.tokens}
              </span>
            </div>
            <p class="text-sm font-medium tabular-nums text-muted-strong">
              {copy.costReference(formatCost(selectedSummary?.sessionCostUSD ?? null))}
            </p>
          </div>

          <div
            class="stats-metric-block stats-metric-cost group grid gap-2 rounded-2xl px-4 py-4 sm:px-5"
            data-motion-item
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-faint">
                {copy.last30Days}
              </p>
              <span class="h-1.5 w-1.5 rounded-full bg-success/60"></span>
            </div>
            <div class="flex items-end gap-2">
              <span
                class="text-[1.8rem] font-semibold tabular-nums tracking-[-0.04em] text-ink sm:text-[2.25rem]"
              >
                {formatTokens(selectedSummary?.last30DaysTokens ?? 0)}
              </span>
              <span
                class="pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-strong"
              >
                {copy.tokens}
              </span>
            </div>
            <p class="text-sm font-medium tabular-nums text-muted-strong">
              {copy.costReference(formatCost(selectedSummary?.last30DaysCostUSD ?? null))}
            </p>
          </div>
        </div>
      </div>

      <div class="stats-info-rail grid gap-3 rounded-2xl border px-4 py-4 sm:px-5" data-motion-item>
        <div class="grid gap-1">
          <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-faint">
            {copy.updatedAt}
          </p>
          <p class="text-sm font-medium tabular-nums text-ink">
            {formatUpdatedAt(selectedSummary?.updatedAt)}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3 border-t border-line/70 pt-3">
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.dailyTrend}
            </p>
            <p class="text-sm font-medium text-ink">{chartDaily.length}</p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.modelBreakdown}
            </p>
            <p class="text-sm font-medium text-ink">{modelBreakdowns.length}</p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.instanceUsage}
            </p>
            <p class="text-sm font-medium text-ink">{instanceUsageRows.length}</p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.accountUsage}
            </p>
            <p class="text-sm font-medium text-ink">{accountUsageRows.length}</p>
          </div>
        </div>

        {#if detailError}
          <div
            class="rounded-2xl border border-danger/18 bg-danger/6 px-3 py-3 text-sm text-danger"
          >
            {detailError}
          </div>
        {:else if loadingDetail && !detail}
          <div
            class="flex items-center gap-2 rounded-2xl border border-line bg-panel-strong/50 px-3 py-3 text-sm text-muted-strong"
          >
            <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
            <span>{copy.refreshing}</span>
          </div>
        {:else if !summaryHasData(selectedSummary)}
          <div
            class="rounded-2xl border border-dashed border-line bg-panel-strong/35 px-3 py-3 text-sm text-muted-strong"
          >
            {copy.tokenStatsNoData}
          </div>
        {/if}

        {#if warningMessages.length}
          <div
            class="grid gap-2 rounded-2xl border border-danger/18 bg-danger/6 px-3 py-3 text-sm text-danger"
          >
            {#each warningMessages as message (message)}
              <p>{message}</p>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <div class="grid gap-4">
    <section
      class="stats-surface flex flex-col rounded-2xl border px-4 py-4 sm:px-5"
      use:reveal={{ delay: 0.02 }}
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
        <div>
          <h4 class="text-sm font-semibold tracking-tight text-ink">{copy.displayConfig}</h4>
          <p class="mt-1 text-xs text-muted-strong">{copy.displayConfigDescription}</p>
        </div>
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {#each [
          { key: 'dailyTrend', label: copy.dailyTrend },
          { key: 'modelBreakdown', label: copy.modelBreakdown },
          { key: 'instanceUsage', label: copy.instanceUsage },
          { key: 'accountUsage', label: copy.accountUsage }
        ] as option (option.key)}
          <label class="stats-toggle-card flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm text-ink">
            <input
              class="h-4 w-4 accent-black"
              type="checkbox"
              checked={statsDisplayDraft[option.key]}
              onchange={(event) =>
                setStatsDisplay(option.key, (event.currentTarget as HTMLInputElement).checked)}
            />
            <span class="font-medium">{option.label}</span>
          </label>
        {/each}
      </div>
    </section>

    {#if !statsDisplayDraft.modelBreakdown && !statsDisplayDraft.dailyTrend && !statsDisplayDraft.instanceUsage && !statsDisplayDraft.accountUsage}
      <div class="stats-empty-state">
        <span class="i-lucide-layout-dashboard h-8 w-8 opacity-20"></span>
        <p class="text-sm font-medium text-muted-strong">{copy.noChartsVisible}</p>
      </div>
    {/if}

    {#if statsDisplayDraft.modelBreakdown}
      <section
        class="stats-surface flex flex-col rounded-2xl border px-4 py-4 sm:px-5"
        use:reveal={{ delay: 0.04 }}
      >
        <div class="flex items-center justify-between gap-3 border-b border-line/70 pb-3">
          <div>
            <h4 class="text-sm font-semibold tracking-tight text-ink">{copy.modelBreakdown}</h4>
            <p class="mt-1 text-xs text-muted-strong">{copy.last30Days}</p>
          </div>
          <span class="i-lucide-pie-chart h-4 w-4 text-muted-strong opacity-60"></span>
        </div>

        {#if modelBreakdowns.length}
          <div class="stats-chart-shell mt-4 rounded-xl border px-3 py-4 sm:px-4">
            <div class="stats-model-chart-canvas" style={`min-height: ${modelChartHeight}px`}>
              <canvas bind:this={modelCanvas} aria-label={copy.modelBreakdown}></canvas>
            </div>
          </div>
        {:else}
          <div class="mt-4 stats-empty-state">
            <span class="i-lucide-layers h-8 w-8 opacity-20"></span>
            <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
          </div>
        {/if}
      </section>
    {/if}

    {#if statsDisplayDraft.instanceUsage}
      <section
        class="stats-surface flex flex-col rounded-2xl border px-4 py-4 sm:px-5"
        use:reveal={{ delay: 0.08 }}
      >
        <div class="flex items-center justify-between gap-3 border-b border-line/70 pb-3">
          <div>
            <h4 class="text-sm font-semibold tracking-tight text-ink">{copy.instanceUsage}</h4>
            <p class="mt-1 text-xs text-muted-strong">{copy.instanceUsageDescription}</p>
          </div>
          <span class="i-lucide-monitor-smartphone h-4 w-4 text-muted-strong opacity-60"></span>
        </div>

        {#if instanceUsageRows.length}
          <div class="stats-chart-shell mt-4 rounded-xl border px-3 py-4 sm:px-4">
            <div class="stats-model-chart-canvas" style={`min-height: ${instanceChartHeight}px`}>
              <canvas bind:this={instanceCanvas} aria-label={copy.instanceUsage}></canvas>
            </div>
          </div>
        {:else}
          <div class="mt-4 stats-empty-state">
            <span class="i-lucide-monitor-x h-8 w-8 opacity-20"></span>
            <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
          </div>
        {/if}
      </section>
    {/if}

    {#if statsDisplayDraft.accountUsage}
      <section
        class="stats-surface flex flex-col rounded-2xl border px-4 py-4 sm:px-5"
        use:reveal={{ delay: 0.1 }}
      >
        <div class="flex items-center justify-between gap-3 border-b border-line/70 pb-3">
          <div>
            <h4 class="text-sm font-semibold tracking-tight text-ink">{copy.accountUsage}</h4>
            <p class="mt-1 text-xs text-muted-strong">{copy.accountUsageDescription}</p>
          </div>
          <span class="i-lucide-badge-percent h-4 w-4 text-muted-strong opacity-60"></span>
        </div>

        {#if accountUsageRows.length}
          <div class="stats-chart-shell mt-4 rounded-xl border px-3 py-4 sm:px-4">
            <div class="stats-model-chart-canvas" style={`min-height: ${accountChartHeight}px`}>
              <canvas bind:this={accountCanvas} aria-label={copy.accountUsage}></canvas>
            </div>
          </div>
        {:else}
          <div class="mt-4 stats-empty-state">
            <span class="i-lucide-user-round-x h-8 w-8 opacity-20"></span>
            <p class="text-sm font-medium text-muted-strong">{copy.noAccountUsageData}</p>
          </div>
        {/if}
      </section>
    {/if}
  </div>

  {#if statsDisplayDraft.dailyTrend}
    <section
      class="stats-surface flex flex-col rounded-2xl border px-4 py-4 sm:px-5"
      use:reveal={{ delay: 0.12 }}
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
        <div>
          <h4 class="text-sm font-semibold tracking-tight text-ink">{copy.dailyTrend}</h4>
          <p class="mt-1 text-xs text-muted-strong">
            {formatTokens(selectedSummary?.last30DaysTokens ?? 0)}
            {copy.tokens}
            <span class="mx-1.5 opacity-40">·</span>
            {copy.costReference(formatCost(selectedSummary?.last30DaysCostUSD ?? null))}
          </p>
        </div>
        <span class="i-lucide-chart-column-big h-4 w-4 text-muted-strong opacity-60"></span>
      </div>

      {#if chartDaily.length}
        <div class="stats-chart-shell mt-4 rounded-xl border px-3 py-4 sm:px-4">
          <div class="stats-chart-canvas">
            <canvas bind:this={trendCanvas} aria-label={copy.dailyTrend}></canvas>
          </div>
        </div>
      {:else}
        <div class="mt-4 stats-empty-state">
          <span class="i-lucide-chart-no-axes-combined h-8 w-8 opacity-20"></span>
          <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .stats-stage {
    background: var(--panel-strong);
    border-color: var(--line);
    box-shadow: 0 4px 20px -6px var(--paper-shadow);
  }

  .stats-surface {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  .stats-info-rail {
    background: var(--surface-soft);
    border-color: var(--line);
  }

  .stats-refresh-button {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
  }

  .stats-refresh-button:hover {
    background: var(--surface-soft) !important;
  }

  .stats-metric-block {
    background: var(--surface-soft);
    border: 1px solid var(--line);
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .stats-metric-block:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .stats-toggle-card {
    background: var(--surface-soft);
    border-color: var(--line);
  }

  .stats-chart-shell {
    background: var(--surface-soft);
    border-color: var(--line);
  }

  .stats-chart-canvas {
    position: relative;
    min-height: 300px;
  }

  .stats-chart-canvas canvas {
    display: block;
    height: 100% !important;
    width: 100% !important;
  }

  .stats-model-chart-canvas {
    position: relative;
  }

  .stats-model-chart-canvas canvas {
    display: block;
    height: 100% !important;
    width: 100% !important;
  }

  .stats-empty-state {
    display: flex;
    min-height: 180px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px dashed var(--line);
    border-radius: 1rem;
    background: var(--surface-soft);
    text-align: center;
  }

  :global(html[data-theme='dark']) .stats-stage {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    box-shadow: none !important;
  }

  :global(html[data-theme='dark']) .stats-surface {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
  }

  :global(html[data-theme='dark']) .stats-info-rail,
  :global(html[data-theme='dark']) .stats-metric-block,
  :global(html[data-theme='dark']) .stats-toggle-card,
  :global(html[data-theme='dark']) .stats-chart-shell {
    background: var(--surface-hover) !important;
    border-color: var(--line) !important;
  }

  :global(html[data-theme='dark']) .stats-refresh-button {
    background: var(--surface-soft) !important;
  }
</style>
