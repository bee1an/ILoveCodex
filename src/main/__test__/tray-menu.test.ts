import { describe, expect, it, vi } from 'vitest'

import {
  buildTrayTokenCostMenuItems,
  buildTrayUpdateMenuItem,
  buildTrayUsageMenuItems,
  resolveTrayAccounts
} from '../tray-menu'
import type {
  AccountRateLimits,
  AccountSummary,
  AppSnapshot,
  AppUpdateState
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
      statusBarAccountIds: ['c', 'b'],
      language: 'zh-CN',
      theme: 'light',
      checkForUpdatesOnStartup: true,
      codexDesktopExecutablePath: ''
    },
    usageByAccountId: {
      a: createUsage(),
      b: createUsage({ primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } }),
      c: createUsage({ primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: null } })
    },
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: []
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

  it('switches the tray update action based on updater state', () => {
    const check = vi.fn()
    const download = vi.fn()
    const install = vi.fn()
    const labels = {
      checkForUpdates: '检查更新',
      checkingForUpdates: '检查更新中…',
      downloadUpdate: (version?: string) => `下载更新${version ? ` v${version}` : ''}`,
      updatingViaHomebrew: '正在通过 Homebrew 更新…',
      homebrewUpdateStatus: (status?: string, command?: string) =>
        status === 'waiting-for-app-quit'
          ? 'Homebrew 已准备安装，正在关闭应用…'
          : command
            ? `正在执行：${command}`
            : '正在通过 Homebrew 更新…',
      updateViaHomebrew: (version?: string) => `通过 Homebrew 更新${version ? ` v${version}` : ''}`,
      openReleasePage: (version?: string) => `前往下载${version ? ` v${version}` : ''}`,
      installUpdate: '重启安装更新',
      unsupported: '当前构建不支持自动更新',
      downloadingUpdate: (progress?: number) => `下载更新中 ${progress ?? 0}%`,
      onCheck: check,
      onDownload: download,
      onInstall: install
    }

    const idleItem = buildTrayUpdateMenuItem(
      {
        status: 'idle',
        delivery: 'auto',
        currentVersion: '0.2.1',
        supported: true
      } satisfies AppUpdateState,
      labels
    )
    expect(idleItem).not.toBeNull()
    if (!idleItem) {
      throw new Error('idle item should render a manual check action')
    }
    expect(idleItem.label).toBe('检查更新')
    idleItem.click?.(undefined as never, undefined as never, undefined as never)
    expect(check).toHaveBeenCalledOnce()

    const availableItem = buildTrayUpdateMenuItem(
      {
        status: 'available',
        delivery: 'auto',
        currentVersion: '0.2.1',
        availableVersion: '0.2.2',
        supported: true
      } satisfies AppUpdateState,
      labels
    )
    expect(availableItem).not.toBeNull()
    if (!availableItem) {
      throw new Error('available item should be rendered when an update is available')
    }
    expect(availableItem.label).toBe('下载更新 v0.2.2')
    availableItem.click?.(undefined as never, undefined as never, undefined as never)
    expect(download).toHaveBeenCalledOnce()

    const errorItem = buildTrayUpdateMenuItem(
      {
        status: 'error',
        delivery: 'auto',
        currentVersion: '0.2.1',
        supported: true,
        message: 'network error'
      } satisfies AppUpdateState,
      labels
    )
    expect(errorItem).not.toBeNull()
    if (!errorItem) {
      throw new Error('error item should render a retry action')
    }
    errorItem.click?.(undefined as never, undefined as never, undefined as never)
    expect(check).toHaveBeenCalledTimes(2)

    const downloadedItem = buildTrayUpdateMenuItem(
      {
        status: 'downloaded',
        delivery: 'auto',
        currentVersion: '0.2.1',
        availableVersion: '0.2.2',
        supported: true
      } satisfies AppUpdateState,
      labels
    )
    expect(downloadedItem).not.toBeNull()
    if (!downloadedItem) {
      throw new Error('downloaded item should be rendered when an update is ready to install')
    }
    downloadedItem.click?.(undefined as never, undefined as never, undefined as never)
    expect(install).toHaveBeenCalledOnce()

    const externalItem = buildTrayUpdateMenuItem(
      {
        status: 'available',
        delivery: 'external',
        currentVersion: '0.2.4',
        availableVersion: '0.2.5',
        supported: true,
        externalDownloadUrl: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.5'
      } satisfies AppUpdateState,
      labels
    )
    expect(externalItem).not.toBeNull()
    if (!externalItem) {
      throw new Error('external item should render a release page action')
    }
    expect(externalItem.label).toBe('前往下载 v0.2.5')

    const homebrewItem = buildTrayUpdateMenuItem(
      {
        status: 'available',
        delivery: 'external',
        currentVersion: '0.2.4',
        availableVersion: '0.2.5',
        supported: true,
        externalAction: 'homebrew'
      } satisfies AppUpdateState,
      labels
    )
    expect(homebrewItem).not.toBeNull()
    if (!homebrewItem) {
      throw new Error('homebrew item should render a Homebrew update action')
    }
    expect(homebrewItem.label).toBe('通过 Homebrew 更新 v0.2.5')

    const homebrewDownloadingItem = buildTrayUpdateMenuItem(
      {
        status: 'downloading',
        delivery: 'external',
        currentVersion: '0.2.4',
        availableVersion: '0.2.5',
        supported: true,
        externalAction: 'homebrew',
        externalCommandStatus: 'brew-update',
        externalCommand: '/opt/homebrew/bin/brew update'
      } satisfies AppUpdateState,
      labels
    )
    expect(homebrewDownloadingItem).not.toBeNull()
    if (!homebrewDownloadingItem) {
      throw new Error('homebrew downloading item should render current command')
    }
    expect(homebrewDownloadingItem.label).toBe('正在执行：/opt/homebrew/bin/brew update')
  })

  it('空 token/cost 统计只展示占位文案', () => {
    const items = buildTrayTokenCostMenuItems(
      {
        ...createSnapshot(),
        runningTokenCostSummary: {
          sessionTokens: 0,
          sessionCostUSD: null,
          last30DaysTokens: 0,
          last30DaysCostUSD: null,
          updatedAt: '2026-04-22T00:00:00.000Z'
        }
      },
      {
        title: '全部实例 token/cost',
        today: '今日',
        last30Days: '最近 30 天',
        noData: '暂无 token/cost 数据',
        fallbackToDefault: '按全部实例聚合'
      }
    )

    expect(items.map((item) => item.label)).toEqual(['全部实例 token/cost', '暂无 token/cost 数据'])
  })
})
