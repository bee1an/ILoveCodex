import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppUpdaterService, type AppUpdaterTestDouble } from '../app-updater'
import type { AppSettings } from '../../shared/codex'

class FakeUpdater extends EventEmitter implements AppUpdaterTestDouble {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  logger = console
  checkForUpdates = vi.fn(async () => undefined)
  downloadUpdate = vi.fn(async () => undefined)
  quitAndInstall = vi.fn(() => undefined)
}

function createSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light',
    checkForUpdatesOnStartup: true,
    codexDesktopExecutablePath: '',
    ...overrides
  }
}

describe('app updater service', () => {
  let tempDirs: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    tempDirs = []
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('falls back to unsupported for unpackaged builds', async () => {
    const updater = new FakeUpdater()
    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: false,
      updater
    })

    expect(service.getState()).toMatchObject({
      status: 'unsupported',
      delivery: 'auto',
      currentVersion: '0.2.1',
      supported: false
    })

    await service.checkForUpdates()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('runs the initial and interval silent checks on macOS via GitHub releases when enabled', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.2',
            html_url: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.2'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 5_000
    })

    service.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops scheduled checks when the startup setting is disabled', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ tag_name: 'v0.2.2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    ) as typeof fetch
    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 5_000
    })

    service.start()
    service.syncSettings(createSettings({ checkForUpdatesOnStartup: false }))
    await vi.advanceTimersByTimeAsync(6_000)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('tracks manual checks, downloads, and install actions on Windows', async () => {
    const updater = new FakeUpdater()
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', { version: '0.2.2' })
    })
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('download-progress', { percent: 42 })
      updater.emit('update-downloaded', { version: '0.2.2', downloadedFile: '/tmp/codexdock.dmg' })
    })

    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'win32',
      updater
    })

    await service.checkForUpdates()
    expect(service.getState()).toMatchObject({
      status: 'available',
      delivery: 'auto',
      availableVersion: '0.2.2',
      supported: true
    })

    await service.downloadUpdate()
    expect(service.getState()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.2.2',
      downloadProgress: 100
    })

    await service.installUpdate()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('shows up-to-date briefly for manual GitHub checks without an update', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.1',
            html_url: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.1'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl
    })

    await service.checkForUpdates()
    expect(service.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(8_000)
    expect(service.getState().status).toBe('idle')
  })

  it('returns an external download URL for macOS release checks', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.5',
            html_url: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.5'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const service = createAppUpdaterService({
      currentVersion: '0.2.4',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl
    })

    await service.checkForUpdates()
    expect(service.getState()).toMatchObject({
      status: 'available',
      delivery: 'external',
      availableVersion: '0.2.5',
      externalAction: 'release',
      externalDownloadUrl: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.5'
    })
  })

  it('prefers Homebrew updates for macOS cask installs and starts the upgrade flow', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.5',
            html_url: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.5'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const launchHomebrewUpdate = vi.fn(async () => undefined)
    const service = createAppUpdaterService({
      currentVersion: '0.2.4',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl,
      isHomebrewCaskInstalled: async () => true,
      launchHomebrewUpdate
    })

    await service.checkForUpdates()
    expect(service.getState()).toMatchObject({
      status: 'available',
      delivery: 'external',
      availableVersion: '0.2.5',
      externalAction: 'homebrew'
    })

    await service.downloadUpdate()
    expect(launchHomebrewUpdate).toHaveBeenCalledOnce()
    expect(service.getState()).toMatchObject({
      status: 'downloading',
      externalAction: 'homebrew'
    })
  })

  it('exposes Homebrew command status while updating', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codexdock-updater-test-'))
    tempDirs.push(dir)
    const statusFilePath = join(dir, 'homebrew.status')
    const logFilePath = join(dir, 'homebrew.log')
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.5',
            html_url: 'https://github.com/bee1an/CodexDock/releases/tag/v0.2.5'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const launchHomebrewUpdate = vi.fn(async () => {
      await writeFile(
        statusFilePath,
        [
          'brew-update',
          '/opt/homebrew/bin/brew update',
          'Running brew update',
          '',
          '2026-04-23T00:00:00Z'
        ].join('\t'),
        'utf8'
      )
      return {
        statusFilePath,
        logFilePath
      }
    })
    const service = createAppUpdaterService({
      currentVersion: '0.2.4',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'darwin',
      githubUrl: 'https://github.com/bee1an/CodexDock',
      fetchImpl,
      isHomebrewCaskInstalled: async () => true,
      launchHomebrewUpdate
    })

    await service.checkForUpdates()
    await service.downloadUpdate()
    expect(service.getState()).toMatchObject({
      status: 'downloading',
      externalCommandStatus: 'brew-update',
      externalCommand: '/opt/homebrew/bin/brew update',
      message: 'Running brew update',
      externalLogFilePath: logFilePath
    })
  })

  it('clears a stale manual-check error after a later silent success', async () => {
    const updater = new FakeUpdater()
    let shouldFail = true
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('checking-for-update')
      if (shouldFail) {
        updater.emit('error', new Error('network error'))
        throw new Error('network error')
      }

      updater.emit('update-not-available', { version: '0.2.1' })
    })

    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'win32',
      updater,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 5_000
    })

    await service.checkForUpdates()
    expect(service.getState()).toMatchObject({
      status: 'error',
      message: 'network error'
    })

    shouldFail = false
    service.start()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(service.getState()).toMatchObject({
      status: 'idle',
      message: undefined
    })
  })

  it('upgrades a running silent Windows check into a manual one', async () => {
    let releaseCheck: (() => void) | null = null
    const updater = new FakeUpdater()
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseCheck = () => {
            updater.emit('update-not-available', { version: '0.2.1' })
            resolve(undefined)
          }
        })
    )

    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'win32',
      updater,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 5_000
    })

    service.start()
    await vi.advanceTimersByTimeAsync(1_000)
    const manualCheck = service.checkForUpdates()

    expect(service.getState().status).toBe('checking')

    const finishCheck = releaseCheck as (() => void) | null
    if (finishCheck) {
      finishCheck()
    }
    await manualCheck

    expect(service.getState().status).toBe('up-to-date')
  })

  it('keeps the downloaded state from being overwritten by silent follow-up checks', async () => {
    const updater = new FakeUpdater()
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '0.2.2' })
    })
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('update-downloaded', { version: '0.2.2', downloadedFile: '/tmp/codexdock.exe' })
    })

    const service = createAppUpdaterService({
      currentVersion: '0.2.1',
      initialSettings: createSettings(),
      isPackaged: true,
      platform: 'win32',
      updater,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 5_000
    })

    await service.checkForUpdates()
    await service.downloadUpdate()
    expect(service.getState().status).toBe('downloaded')

    service.start()
    await vi.advanceTimersByTimeAsync(6_000)

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getState().status).toBe('downloaded')
  })
})
