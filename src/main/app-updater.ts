import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { autoUpdater } from 'electron-updater'
import { readFile } from 'node:fs/promises'

import type {
  AppSettings,
  AppUpdateDelivery,
  AppUpdateExternalAction,
  AppUpdateState
} from '../shared/codex'

const DEFAULT_INITIAL_CHECK_DELAY_MS = 10_000
const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const RESET_UP_TO_DATE_DELAY_MS = 8_000

type CheckMode = 'manual' | 'silent'
type UpdateStrategyMode = 'auto' | 'external' | 'unsupported'

export interface AppUpdaterService {
  getState(): AppUpdateState
  start(): void
  stop(): void
  syncSettings(settings: AppSettings): void
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<void>
  subscribe(listener: (state: AppUpdateState) => void): () => void
}

interface AppUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  logger: {
    info(message?: unknown): void
    warn(message?: unknown): void
    error(message?: unknown): void
  } | null
  on(event: 'checking-for-update', listener: () => void): this
  on(event: 'update-available', listener: (info: UpdateInfo) => void): this
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): this
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): this
  on(event: 'update-downloaded', listener: (event: UpdateDownloadedEvent) => void): this
  on(event: 'error', listener: (error: Error, message?: string) => void): this
  removeAllListeners(event?: string): this
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface GithubReleaseSummary {
  version: string
  url: string
}

interface HomebrewCaskUpgradeLaunch {
  logFilePath: string
  statusFilePath: string
}

interface HomebrewCommandStatus {
  phase: string
  command?: string
  message?: string
  exitCode?: number
  updatedAt?: string
}

interface UpdateStrategy {
  mode: UpdateStrategyMode
  delivery: AppUpdateDelivery
  supported: boolean
  message?: string
  githubRepo?: {
    owner: string
    repo: string
    releasesUrl: string
  }
}

function createNoopUpdater(): AppUpdaterLike {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    logger: console,
    on() {
      return this
    },
    removeAllListeners() {
      return this
    },
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => undefined
  }
}

export interface CreateAppUpdaterServiceOptions {
  currentVersion: string
  initialSettings: AppSettings
  githubUrl?: string | null
  isPackaged?: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  updater?: AppUpdaterLike
  fetchImpl?: typeof fetch
  initialCheckDelayMs?: number
  checkIntervalMs?: number
  isHomebrewCaskInstalled?: () => Promise<boolean>
  launchHomebrewUpdate?: () => Promise<HomebrewCaskUpgradeLaunch | void>
}

function createBaseState(
  currentVersion: string,
  strategy: Pick<UpdateStrategy, 'delivery' | 'supported'>,
  message?: string
): AppUpdateState {
  return {
    status: strategy.supported ? 'idle' : 'unsupported',
    delivery: strategy.delivery,
    currentVersion,
    message,
    supported: strategy.supported
  }
}

function parseGithubRepository(githubUrl?: string | null):
  | {
      owner: string
      repo: string
      releasesUrl: string
    }
  | undefined {
  if (!githubUrl) {
    return undefined
  }

  try {
    const url = new URL(githubUrl)
    if (!url.hostname.includes('github.com')) {
      return undefined
    }

    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (!owner || !repo) {
      return undefined
    }

    return {
      owner,
      repo,
      releasesUrl: `https://github.com/${owner}/${repo}/releases`
    }
  } catch {
    return undefined
  }
}

function resolveStrategy(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  githubUrl?: string | null
): UpdateStrategy {
  if (!isPackaged) {
    return {
      mode: 'unsupported',
      delivery: 'auto',
      supported: false,
      message: 'Automatic updates are only available in packaged builds.'
    }
  }

  if (platform === 'darwin') {
    const githubRepo = parseGithubRepository(githubUrl)
    if (!githubRepo) {
      return {
        mode: 'unsupported',
        delivery: 'external',
        supported: false,
        message: 'GitHub release URL is required for update checks on macOS.'
      }
    }

    return {
      mode: 'external',
      delivery: 'external',
      supported: true,
      githubRepo
    }
  }

  if (platform === 'win32') {
    return {
      mode: 'auto',
      delivery: 'auto',
      supported: true
    }
  }

  if (platform === 'linux') {
    if (env['APPIMAGE']) {
      return {
        mode: 'auto',
        delivery: 'auto',
        supported: true
      }
    }

    if (env['SNAP']) {
      return {
        mode: 'unsupported',
        delivery: 'auto',
        supported: false,
        message: 'Automatic updates are managed by the Snap store for this build.'
      }
    }

    return {
      mode: 'unsupported',
      delivery: 'auto',
      supported: false,
      message: 'Automatic updates are only supported for the AppImage build on Linux.'
    }
  }

  return {
    mode: 'unsupported',
    delivery: 'auto',
    supported: false,
    message: `Automatic updates are not supported on ${platform}.`
  }
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split(/[.-]/)
  const rightParts = normalizeVersion(right).split(/[.-]/)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? '0'
    const rightPart = rightParts[index] ?? '0'
    const leftNumber = Number(leftPart)
    const rightNumber = Number(rightPart)
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)

    if (bothNumeric) {
      if (leftNumber > rightNumber) {
        return 1
      }
      if (leftNumber < rightNumber) {
        return -1
      }
      continue
    }

    const lexical = leftPart.localeCompare(rightPart)
    if (lexical !== 0) {
      return lexical > 0 ? 1 : -1
    }
  }

  return 0
}

async function fetchLatestGithubRelease(
  strategy: UpdateStrategy,
  fetchImpl: typeof fetch
): Promise<GithubReleaseSummary> {
  if (!strategy.githubRepo) {
    throw new Error('GitHub repository is not configured.')
  }

  const response = await fetchImpl(
    `https://api.github.com/repos/${strategy.githubRepo.owner}/${strategy.githubRepo.repo}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CodexDock'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as {
    tag_name?: string
    html_url?: string
    name?: string
  }
  const version = payload.tag_name?.trim() || payload.name?.trim()
  const url = payload.html_url?.trim() || strategy.githubRepo.releasesUrl

  if (!version) {
    throw new Error('Latest GitHub release does not contain a version tag.')
  }

  return { version, url }
}

function parseHomebrewStatus(raw: string): HomebrewCommandStatus | null {
  const [phase, command, message, exitCode, updatedAt] = raw.trim().split('\t')
  if (!phase) {
    return null
  }

  const parsedExitCode = exitCode ? Number(exitCode) : undefined

  return {
    phase,
    command: command || undefined,
    message: message || undefined,
    exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : undefined,
    updatedAt: updatedAt || undefined
  }
}

export function createAppUpdaterService(
  options: CreateAppUpdaterServiceOptions
): AppUpdaterService {
  const strategy = resolveStrategy(
    options.isPackaged ?? false,
    options.platform ?? process.platform,
    options.env ?? process.env,
    options.githubUrl
  )
  const updater =
    strategy.mode === 'auto'
      ? ((options.updater ?? autoUpdater) as AppUpdaterLike)
      : createNoopUpdater()
  const fetchImpl = options.fetchImpl ?? fetch

  let settings = options.initialSettings
  let state = createBaseState(options.currentVersion, strategy, strategy.message)
  let activeCheckMode: CheckMode | null = null
  let started = false
  let checkPromise: Promise<AppUpdateState> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let resetTimer: ReturnType<typeof setTimeout> | null = null
  let homebrewStatusTimer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<(nextState: AppUpdateState) => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener(state)
    }
  }

  function setState(nextState: AppUpdateState): AppUpdateState {
    state = nextState
    notify()
    return state
  }

  function mergeState(nextState: Partial<AppUpdateState>): AppUpdateState {
    return setState({
      ...state,
      ...nextState
    })
  }

  function clearResetTimer(): void {
    if (!resetTimer) {
      return
    }

    clearTimeout(resetTimer)
    resetTimer = null
  }

  function scheduleUpToDateReset(): void {
    clearResetTimer()
    resetTimer = setTimeout(() => {
      resetTimer = null
      if (state.status === 'up-to-date') {
        mergeState({
          status: 'idle',
          message: undefined,
          downloadProgress: undefined,
          externalDownloadUrl: undefined
        })
      }
    }, RESET_UP_TO_DATE_DELAY_MS)
  }

  function clearTimers(): void {
    if (initialTimer) {
      clearTimeout(initialTimer)
      initialTimer = null
    }

    if (intervalTimer) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }

  function clearHomebrewStatusTimer(): void {
    if (!homebrewStatusTimer) {
      return
    }

    clearInterval(homebrewStatusTimer)
    homebrewStatusTimer = null
  }

  async function readHomebrewStatus(statusFilePath: string): Promise<HomebrewCommandStatus | null> {
    try {
      return parseHomebrewStatus(await readFile(statusFilePath, 'utf8'))
    } catch {
      return null
    }
  }

  function applyHomebrewStatus(status: HomebrewCommandStatus, logFilePath?: string): void {
    if (status.phase === 'success') {
      clearHomebrewStatusTimer()
    }

    if (status.phase === 'error') {
      clearHomebrewStatusTimer()
      mergeState({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: status.message ?? 'Homebrew update failed.',
        downloadProgress: undefined,
        externalCommand: status.command,
        externalCommandStatus: status.phase,
        externalLogFilePath: logFilePath
      })
      return
    }

    mergeState({
      status: 'downloading',
      message: status.message,
      downloadProgress: undefined,
      externalCommand: status.command,
      externalCommandStatus: status.phase,
      externalLogFilePath: logFilePath
    })
  }

  async function startHomebrewStatusPolling(launch: HomebrewCaskUpgradeLaunch): Promise<void> {
    clearHomebrewStatusTimer()

    const applyLatest = async (): Promise<void> => {
      const latest = await readHomebrewStatus(launch.statusFilePath)
      if (latest) {
        applyHomebrewStatus(latest, launch.logFilePath)
      }
    }

    await applyLatest()
    homebrewStatusTimer = setInterval(() => {
      void applyLatest()
    }, 300)
  }

  async function resolveExternalAction(): Promise<AppUpdateExternalAction> {
    if (strategy.mode !== 'external' || (options.platform ?? process.platform) !== 'darwin') {
      return 'release'
    }

    if (!options.isHomebrewCaskInstalled) {
      return 'release'
    }

    try {
      return (await options.isHomebrewCaskInstalled()) ? 'homebrew' : 'release'
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Failed to detect the Homebrew cask installation.'
      console.warn(`Homebrew update detection failed: ${detail}`)
      return 'release'
    }
  }

  async function runExternalCheck(mode: CheckMode): Promise<AppUpdateState> {
    try {
      const release = await fetchLatestGithubRelease(strategy, fetchImpl)
      const hasUpdate = compareVersions(release.version, options.currentVersion) > 0

      if (hasUpdate) {
        const externalAction = await resolveExternalAction()
        return mergeState({
          status: 'available',
          availableVersion: normalizeVersion(release.version),
          checkedAt: new Date().toISOString(),
          message: undefined,
          downloadProgress: undefined,
          externalDownloadUrl: release.url,
          externalAction
        })
      }

      if (mode === 'manual') {
        mergeState({
          status: 'up-to-date',
          checkedAt: new Date().toISOString(),
          availableVersion: undefined,
          message: 'You are already using the latest version.',
          downloadProgress: undefined,
          externalDownloadUrl: undefined,
          externalAction: undefined
        })
        scheduleUpToDateReset()
        return state
      }

      return mergeState({
        status: 'idle',
        checkedAt: new Date().toISOString(),
        availableVersion: undefined,
        message: undefined,
        downloadProgress: undefined,
        externalDownloadUrl: undefined,
        externalAction: undefined
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to check GitHub releases for updates.'
      if (mode === 'manual') {
        return mergeState({
          status: 'error',
          checkedAt: new Date().toISOString(),
          message,
          downloadProgress: undefined
        })
      }

      console.warn(`GitHub update check failed: ${message}`)
      return state
    }
  }

  async function runAutoCheck(mode: CheckMode): Promise<AppUpdateState> {
    return updater
      .checkForUpdates()
      .then(() => state)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to check for updates.'
        if (mode === 'manual') {
          return mergeState({
            status: 'error',
            checkedAt: new Date().toISOString(),
            message
          })
        }
        return state
      })
  }

  async function runCheck(mode: CheckMode): Promise<AppUpdateState> {
    if (!strategy.supported) {
      return setState(createBaseState(options.currentVersion, strategy, strategy.message))
    }

    if (checkPromise) {
      if (mode === 'manual' && activeCheckMode === 'silent') {
        activeCheckMode = 'manual'
        clearResetTimer()
        mergeState({
          status: 'checking',
          message: undefined,
          downloadProgress: undefined
        })
      }
      return checkPromise
    }

    clearResetTimer()
    activeCheckMode = mode
    if (mode === 'manual') {
      mergeState({
        status: 'checking',
        message: undefined,
        downloadProgress: undefined
      })
    }

    checkPromise = (
      strategy.mode === 'external' ? runExternalCheck(mode) : runAutoCheck(mode)
    ).finally(() => {
      activeCheckMode = null
      checkPromise = null
    })

    return checkPromise
  }

  function scheduleAutoChecks(): void {
    clearTimers()
    if (
      !strategy.supported ||
      !settings.checkForUpdatesOnStartup ||
      state.status === 'downloaded'
    ) {
      return
    }

    initialTimer = setTimeout(() => {
      initialTimer = null
      void runCheck('silent')
    }, options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS)

    intervalTimer = setInterval(() => {
      void runCheck('silent')
    }, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS)
  }

  if (strategy.mode === 'auto') {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.logger = console

    updater.removeAllListeners('checking-for-update')
    updater.removeAllListeners('update-available')
    updater.removeAllListeners('update-not-available')
    updater.removeAllListeners('download-progress')
    updater.removeAllListeners('update-downloaded')
    updater.removeAllListeners('error')

    updater.on('checking-for-update', () => {
      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'checking',
          message: undefined,
          downloadProgress: undefined
        })
      }
    })

    updater.on('update-available', (info) => {
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

      mergeState({
        status: 'available',
        availableVersion: info.version,
        checkedAt: new Date().toISOString(),
        message: undefined,
        downloadProgress: undefined,
        externalDownloadUrl: undefined
      })
    })

    updater.on('update-not-available', () => {
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'up-to-date',
          checkedAt: new Date().toISOString(),
          availableVersion: undefined,
          message: 'You are already using the latest version.',
          downloadProgress: undefined,
          externalDownloadUrl: undefined
        })
        scheduleUpToDateReset()
        return
      }

      mergeState({
        status: 'idle',
        checkedAt: new Date().toISOString(),
        availableVersion: undefined,
        message: undefined,
        downloadProgress: undefined,
        externalDownloadUrl: undefined
      })
    })

    updater.on('download-progress', (info) => {
      mergeState({
        status: 'downloading',
        downloadProgress: Math.round(info.percent),
        message: undefined
      })
    })

    updater.on('update-downloaded', (event) => {
      clearTimers()
      mergeState({
        status: 'downloaded',
        availableVersion: event.version,
        checkedAt: new Date().toISOString(),
        downloadProgress: 100,
        message: 'Update downloaded and ready to install.'
      })
    })

    updater.on('error', (error, message) => {
      const detail = message || error.message || 'Update failed.'
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'error',
          checkedAt: new Date().toISOString(),
          message: detail,
          downloadProgress: undefined
        })
      } else {
        console.warn(`Auto-update check failed: ${detail}`)
      }
    })
  }

  return {
    getState(): AppUpdateState {
      return state
    },
    start(): void {
      if (started) {
        return
      }

      started = true
      scheduleAutoChecks()
    },
    stop(): void {
      started = false
      clearTimers()
      clearResetTimer()
      clearHomebrewStatusTimer()
    },
    syncSettings(nextSettings): void {
      settings = nextSettings
      if (started) {
        scheduleAutoChecks()
      }
    },
    async checkForUpdates(): Promise<AppUpdateState> {
      return runCheck('manual')
    },
    async downloadUpdate(): Promise<AppUpdateState> {
      if (!strategy.supported) {
        return setState(createBaseState(options.currentVersion, strategy, strategy.message))
      }

      if (strategy.mode === 'external') {
        if (state.status !== 'available' || state.externalAction !== 'homebrew') {
          return state
        }

        if (!options.launchHomebrewUpdate) {
          return mergeState({
            status: 'error',
            checkedAt: new Date().toISOString(),
            message: 'Homebrew update is not configured for this build.',
            downloadProgress: undefined
          })
        }

        try {
          const launch = await options.launchHomebrewUpdate()
          mergeState({
            status: 'downloading',
            message: 'Starting Homebrew update…',
            downloadProgress: undefined,
            externalCommand: undefined,
            externalCommandStatus: 'starting',
            externalLogFilePath: launch?.logFilePath
          })
          if (launch) {
            await startHomebrewStatusPolling(launch)
          }
          return state
        } catch (error) {
          return mergeState({
            status: 'error',
            checkedAt: new Date().toISOString(),
            message:
              error instanceof Error ? error.message : 'Failed to start the Homebrew update.',
            downloadProgress: undefined
          })
        }
      }

      if (strategy.mode !== 'auto' || state.status !== 'available') {
        return state
      }

      clearResetTimer()
      mergeState({
        status: 'downloading',
        message: undefined,
        downloadProgress: 0
      })

      try {
        await updater.downloadUpdate()
      } catch (error) {
        return mergeState({
          status: 'error',
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'Failed to download the update.',
          downloadProgress: undefined
        })
      }

      return state
    },
    async installUpdate(): Promise<void> {
      if (strategy.mode !== 'auto' || !strategy.supported || state.status !== 'downloaded') {
        return
      }

      updater.quitAndInstall(false, true)
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }
  }
}

export type { AppUpdaterLike as AppUpdaterTestDouble, AppUpdater as ElectronAppUpdater }
