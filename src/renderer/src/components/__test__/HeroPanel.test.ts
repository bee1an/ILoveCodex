// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../gsap-motion', () => {
  const action = () => ({
    update: () => undefined,
    destroy: () => undefined
  })

  return {
    cascadeIn: action,
    reveal: action
  }
})

import HeroPanel from '../HeroPanel.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

describe('HeroPanel', () => {
  it('在设置弹层里展示统计显示配置并调用更新链路', async () => {
    const updateStatsDisplay = vi.fn().mockResolvedValue(undefined)

    render(HeroPanel, {
      props: {
        heroClass: 'hero',
        compactGhostButton: 'ghost',
        copy,
        loginEvent: null,
        showSettings: true,
        showProviderComposer: false,
        onClose: vi.fn(),
        showCodexDesktopExecutablePath: false,
        showCallbackLoginDetails: true,
        showDeviceLoginDetails: true,
        loginActionBusy: false,
        pollingOptions: [5, 15, 30],
        settings: {
          usagePollingMinutes: 15,
          statusBarAccountIds: [],
          language: 'zh-CN',
          theme: 'light',
          checkForUpdatesOnStartup: true,
          codexDesktopExecutablePath: '',
          showLocalMockData: true,
          statsDisplay: {
            dailyTrend: true,
            modelBreakdown: true,
            instanceUsage: false,
            accountUsage: true
          }
        },
        updateState: {
          status: 'idle',
          delivery: 'auto',
          currentVersion: '0.3.5',
          supported: true
        },
        createProvider: vi.fn().mockResolvedValue(undefined),
        updatePollingInterval: vi.fn(),
        updateCheckForUpdatesOnStartup: vi.fn(),
        updateShowLocalMockData: vi.fn(),
        updateStatsDisplay,
        updateCodexDesktopExecutablePath: vi.fn().mockResolvedValue(undefined),
        showLocalMockToggle: false,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn().mockResolvedValue(undefined),
        installUpdate: vi.fn().mockResolvedValue(undefined),
        copyAuthUrl: vi.fn(),
        copyDeviceCode: vi.fn(),
        openExternalLink: vi.fn()
      }
    })

    const checkbox = screen.getByRole('checkbox', {
      name: new RegExp(`^${copy.instanceUsage}`)
    }) as HTMLInputElement

    expect(checkbox.checked).toBe(false)
    expect(screen.getByText(copy.displayConfig)).toBeTruthy()

    await fireEvent.click(checkbox)

    expect(updateStatsDisplay).toHaveBeenCalledWith({
      dailyTrend: true,
      modelBreakdown: true,
      instanceUsage: true,
      accountUsage: true
    })

    await fireEvent.click(
      screen.getByRole('checkbox', {
        name: new RegExp(`^${copy.modelBreakdown}`)
      })
    )

    expect(updateStatsDisplay).toHaveBeenLastCalledWith({
      dailyTrend: true,
      modelBreakdown: false,
      instanceUsage: true,
      accountUsage: true
    })
  })
})
