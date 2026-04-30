import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  dialog,
  nativeImage,
  Menu,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from 'electron'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runCli } from '../cli/run-cli'
import { createAppUpdaterService, type AppUpdaterService } from './app-updater'
import { createAuthRefreshController, type AuthRefreshController } from './auth-poller'
import { isHomebrewCaskInstalled, launchHomebrewCaskUpgrade } from './homebrew-updater'
import { createElectronCodexPlatformAdapter } from './electron-platform'
import { installCliShim } from './cli-shim'
import { createCodexServices, type CodexServices } from './codex-services'
import { migrateLegacyElectronUserData } from './app-data-migration'
import { refreshLocalMockData, seedLocalMockData } from './local-mock-data'
import {
  buildTrayTokenCostMenuItems,
  buildTrayUpdateMenuItem,
  buildTrayUsageMenuItems
} from './tray-menu'
import { createUsagePollingController, type UsagePollingController } from './usage-poller'
import { createWakeSchedulerController, type WakeSchedulerController } from './wake-scheduler'
import {
  type AppUpdateState,
  type AccountTransferFormat,
  resolveBestAccount,
  type AppSettings,
  type AppSnapshot,
  type CopyCodexSessionToProviderInput,
  type CopyCodexSkillInput,
  type LoginEvent,
  type LoginMethod,
  type ListCodexSessionProjectsInput,
  type ListCodexSessionsInput,
  type ReadCodexSessionDetailInput,
  type TokenCostReadOptions,
  type UpdateAccountWakeScheduleInput,
  type WakeAccountRateLimitsInput
} from '../shared/codex'
import {
  accountLabel,
  buildCurrentUsageMenu,
  buildTrayImage,
  buildTrayTitle,
  buildTrayTooltip,
  exportFilePrefix,
  extractCliArgs,
  getAppMeta,
  loadRendererWindow,
  localeText,
  pollingOptions,
  resolveGithubUrl,
  saveAccountsExport
} from './index-helpers'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let codexServices: CodexServices
let appUpdaterService: AppUpdaterService | null = null
let authRefreshController: AuthRefreshController | null = null
let usagePollingController: UsagePollingController | null = null
let wakeSchedulerController: WakeSchedulerController | null = null
let lastSnapshot: AppSnapshot | null = null
let homebrewUpdateQuitTimer: ReturnType<typeof setTimeout> | null = null
let homebrewUpdateQuitCountdownStarted = false
const defaultWorkspacePath = process.cwd()
const isLocalEnvironment = !app.isPackaged
const productionAppConfigPath = join(homedir(), '.config', 'codexdock')
const localMockAppConfigPath = join(homedir(), '.config', 'codexdock-local')
let useLocalMockDataSource = isLocalEnvironment && shouldUseLocalMockDataSource()

function shouldUseLocalMockDataSource(): boolean {
  if (!isLocalEnvironment) {
    return false
  }

  try {
    const raw = readFileSync(join(localMockAppConfigPath, 'codex-accounts.json'), 'utf8')
    const parsed = JSON.parse(raw) as { settings?: { showLocalMockData?: unknown } }
    return parsed.settings?.showLocalMockData !== false
  } catch {
    return true
  }
}

function configuredAppConfigPath(): string {
  return isLocalEnvironment && useLocalMockDataSource
    ? localMockAppConfigPath
    : productionAppConfigPath
}

function configuredCodexHomePath(): string {
  return isLocalEnvironment && useLocalMockDataSource
    ? join(localMockAppConfigPath, '.codex')
    : join(homedir(), '.codex')
}

async function persistLocalMockDataSourcePreference(enabled: boolean): Promise<void> {
  const stateFile = join(localMockAppConfigPath, 'codex-accounts.json')
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(await fs.readFile(stateFile, 'utf8')) as Record<string, unknown>
  } catch {
    parsed = {}
  }

  const settings =
    typeof parsed.settings === 'object' && parsed.settings !== null
      ? (parsed.settings as Record<string, unknown>)
      : {}

  await fs.mkdir(localMockAppConfigPath, { recursive: true })
  await fs.writeFile(
    stateFile,
    `${JSON.stringify(
      {
        ...parsed,
        settings: {
          ...settings,
          showLocalMockData: enabled
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

function buildTrayUsageMenu(snapshot: AppSnapshot): MenuItemConstructorOptions[] {
  const text = localeText(snapshot.settings.language)

  return buildTrayUsageMenuItems(snapshot, {
    activePrefix: text.activePrefix,
    noVisibleAccount: text.noVisibleAccount,
    language: snapshot.settings.language,
    accountLabel,
    openAccount: (accountId) => {
      void codexServices.codex.open(accountId).then(() => {
        void refreshTrayTitle()
      })
    }
  })
}

function bestAccountMenuLabel(snapshot: AppSnapshot): string {
  const text = localeText(snapshot.settings.language)
  const bestAccount = resolveBestAccount(
    snapshot.accounts,
    snapshot.usageByAccountId,
    snapshot.activeAccountId
  )

  if (!bestAccount) {
    return text.bestAccount
  }

  return `${text.bestAccount} · ${accountLabel(bestAccount, snapshot.settings.language)}`
}

function buildTrayPollingMenu(snapshot: AppSnapshot): MenuItemConstructorOptions[] {
  const text = localeText(snapshot.settings.language)
  return pollingOptions.map((minutes) => ({
    label: `${minutes} ${text.minutes}`,
    type: 'radio',
    checked: snapshot.settings.usagePollingMinutes === minutes,
    click: () => {
      void codexServices.settings.update({ usagePollingMinutes: minutes }).then(() => {
        void refreshTrayTitle()
      })
    }
  }))
}

function resolveUpdateState(): AppUpdateState {
  return (
    appUpdaterService?.getState() ?? {
      status: 'unsupported',
      delivery: 'auto',
      currentVersion: app.getVersion(),
      supported: false,
      message: 'Automatic updates are unavailable.'
    }
  )
}

function requireAppUpdaterService(): AppUpdaterService {
  if (!appUpdaterService) {
    throw new Error('App updater is not initialized.')
  }

  return appUpdaterService
}

function buildTrayMenu(snapshot: AppSnapshot): ReturnType<typeof Menu.buildFromTemplate> {
  const bestAccount = resolveBestAccount(
    snapshot.accounts,
    snapshot.usageByAccountId,
    snapshot.activeAccountId
  )
  const text = localeText(snapshot.settings.language)
  const trayUpdateItem = buildTrayUpdateMenuItem(resolveUpdateState(), {
    checkForUpdates: text.checkForUpdates,
    checkingForUpdates: text.checkingForUpdates,
    downloadUpdate: text.downloadUpdate,
    updatingViaHomebrew: text.updatingViaHomebrew,
    homebrewUpdateStatus: text.homebrewUpdateStatus,
    updateViaHomebrew: text.updateViaHomebrew,
    openReleasePage: text.openReleasePage,
    installUpdate: text.installUpdate,
    unsupported: text.updatesUnsupported,
    downloadingUpdate: text.downloadingUpdate,
    onCheck: () => {
      void appUpdaterService?.checkForUpdates()
    },
    onDownload: () => {
      const updateState = resolveUpdateState()
      if (updateState.delivery === 'external' && updateState.externalAction !== 'homebrew') {
        const downloadUrl = updateState.externalDownloadUrl ?? getAppMeta().githubUrl ?? undefined
        if (downloadUrl) {
          void shell.openExternal(downloadUrl)
        }
        return
      }

      void triggerUpdateDownload()
    },
    onInstall: () => {
      void appUpdaterService?.installUpdate()
    }
  })

  return Menu.buildFromTemplate([
    ...buildCurrentUsageMenu(snapshot),
    { type: 'separator' },
    {
      label: text.openMainWindow,
      click: () => showMainWindow()
    },
    {
      label: text.openCodex,
      click: () => {
        void codexServices.codex.show().then(() => {
          void refreshTrayTitle()
        })
      }
    },
    {
      label: bestAccountMenuLabel(snapshot),
      enabled: Boolean(bestAccount) && bestAccount?.id !== snapshot.activeAccountId,
      click: () => {
        if (!bestAccount) {
          return
        }

        void codexServices.codex.open(bestAccount.id).then(() => {
          void refreshTrayTitle()
        })
      }
    },
    { type: 'separator' },
    ...buildTrayUsageMenu(snapshot),
    { type: 'separator' },
    ...buildTrayTokenCostMenuItems(snapshot, {
      title: text.runningTokenCost,
      today: text.tokenCostToday,
      last30Days: text.tokenCostLast30Days,
      noData: text.tokenCostNoData,
      fallbackToDefault: text.tokenCostDefaultFallback
    }),
    { type: 'separator' },
    {
      label: text.pollingInterval,
      submenu: buildTrayPollingMenu(snapshot)
    },
    ...(trayUpdateItem ? [{ type: 'separator' as const }, trayUpdateItem] : []),
    ...(trayUpdateItem ? [{ type: 'separator' as const }] : []),
    {
      label: text.quit,
      role: 'quit'
    }
  ])
}

async function refreshTrayTitle(): Promise<AppSnapshot> {
  const snapshot = await codexServices.getSnapshot()
  lastSnapshot = snapshot
  if (tray) {
    tray.setImage(buildTrayImage(snapshot))
    tray.setToolTip(buildTrayTooltip(snapshot))
    tray.setTitle(process.platform === 'darwin' ? '' : buildTrayTitle(snapshot))
    tray.setContextMenu(buildTrayMenu(snapshot))
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codex:snapshot-updated', snapshot)
  }

  usagePollingController?.sync(snapshot)
  authRefreshController?.sync(snapshot)
  wakeSchedulerController?.sync(snapshot)

  return snapshot
}

function emitUpdateState(updateState: AppUpdateState): void {
  if (tray && lastSnapshot) {
    tray.setContextMenu(buildTrayMenu(lastSnapshot))
  }

  if (
    homebrewUpdateQuitTimer &&
    updateState.externalAction === 'homebrew' &&
    updateState.status === 'error'
  ) {
    clearTimeout(homebrewUpdateQuitTimer)
    homebrewUpdateQuitTimer = null
    homebrewUpdateQuitCountdownStarted = false
  }

  if (
    updateState.delivery === 'external' &&
    updateState.externalAction === 'homebrew' &&
    updateState.status === 'downloading' &&
    updateState.externalCommandStatus === 'waiting-for-app-quit' &&
    !homebrewUpdateQuitCountdownStarted
  ) {
    homebrewUpdateQuitCountdownStarted = true
    if (homebrewUpdateQuitTimer) {
      clearTimeout(homebrewUpdateQuitTimer)
    }
    homebrewUpdateQuitTimer = setTimeout(() => {
      app.quit()
    }, 400)
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codex:update-state', updateState)
  }
}

async function triggerUpdateDownload(): Promise<AppUpdateState> {
  const updateState = await requireAppUpdaterService().downloadUpdate()
  if (
    updateState.delivery === 'external' &&
    updateState.externalAction === 'homebrew' &&
    updateState.status === 'downloading' &&
    !homebrewUpdateQuitTimer
  ) {
    homebrewUpdateQuitTimer = setTimeout(() => {
      app.quit()
    }, 60_000)
  }

  return updateState
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  void loadRendererWindow(window)
}

function createTray(): void {
  const trayIcon =
    process.platform === 'darwin'
      ? buildTrayImage({
          accounts: [],
          providers: [],
          tags: [],
          codexInstances: [],
          codexInstanceDefaults: {
            rootDir: '',
            defaultCodexHome: ''
          },
          currentSession: null,
          loginInProgress: false,
          settings: {
            usagePollingMinutes: 15,
            statusBarAccountIds: [],
            language: 'zh-CN',
            theme: 'light',
            checkForUpdatesOnStartup: true,
            codexDesktopExecutablePath: '',
            localGateway: {
              host: '127.0.0.1',
              port: 11456,
              apiKey: '',
              stickyTtlMinutes: 360,
              requestTimeoutMs: 120_000
            }
          },
          usageByAccountId: {},
          usageErrorByAccountId: {},
          wakeSchedulesByAccountId: {},
          tokenCostByInstanceId: {},
          tokenCostErrorByInstanceId: {},
          runningTokenCostSummary: null,
          runningTokenCostInstanceIds: [],
          localGatewayStatus: {
            running: false,
            baseUrl: 'http://127.0.0.1:11456',
            apiKeyPreview: ''
          }
        })
      : nativeImage.createFromPath(icon).resize({ width: 18, height: 18 })

  tray = new Tray(trayIcon)
  tray.setToolTip('CodexDock')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const legacyUserDataMigration = await migrateLegacyElectronUserData({
    legacyConfigPath: configuredAppConfigPath(),
    defaultUserDataPath: app.getPath('userData')
  })
  if (legacyUserDataMigration.moved.length || legacyUserDataMigration.backedUp.length) {
    console.info(
      [
        'Migrated legacy Electron user data out of CodexDock config directory.',
        `moved=${legacyUserDataMigration.moved.length}`,
        `backedUp=${legacyUserDataMigration.backedUp.length}`
      ].join(' ')
    )
  }

  const cliShim = await installCliShim({
    appPath: process.execPath,
    isPackaged: app.isPackaged
  })
  if (cliShim.status === 'installed' || cliShim.status === 'updated') {
    console.info(`Installed cdock shim at ${cliShim.shimPath}`)
  } else if (cliShim.reason === 'occupied') {
    console.warn(`Skipped cdock shim install because ${cliShim.shimPath} is already occupied`)
  }

  const cliArgs = extractCliArgs(process.argv)
  const shouldBootstrapLocalMockData = isLocalEnvironment && !cliArgs && useLocalMockDataSource
  const loginEventListeners = new Set<(event: LoginEvent) => void>()
  const platform = createElectronCodexPlatformAdapter()

  const createRuntimeServices = (): CodexServices =>
    createCodexServices({
      userDataPath: configuredAppConfigPath(),
      defaultWorkspacePath,
      defaultCodexHome: configuredCodexHomePath(),
      platform,
      emitLoginEvent: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('codex:login-event', event)
        }
        for (const listener of loginEventListeners) {
          listener(event)
        }
        void refreshTrayTitle()
      }
    })

  const bootstrapLocalMockData = async (): Promise<void> => {
    const seeded = await seedLocalMockData(codexServices)
    if (seeded) {
      console.info('Seeded local mock data.')
    }

    const refreshed = await refreshLocalMockData(codexServices)
    if (refreshed.usageRefreshed || refreshed.scheduleErrorsCleared) {
      console.info(
        `Refreshed local mock data. usage=${refreshed.usageRefreshed} scheduleErrors=${refreshed.scheduleErrorsCleared}`
      )
    }
  }

  const stopRunningGatewayBeforeRuntimeSwap = async (): Promise<void> => {
    if ((await codexServices.gateway.status()).running) {
      await codexServices.gateway.stop()
    }
  }

  codexServices = createRuntimeServices()
  await codexServices.settings.update({ showLocalMockData: useLocalMockDataSource })

  if (shouldBootstrapLocalMockData) {
    await bootstrapLocalMockData()
  }

  if (cliArgs) {
    const code = await runCli(
      {
        services: codexServices,
        platform,
        subscribeLoginEvents: (listener) => {
          loginEventListeners.add(listener)
          return () => loginEventListeners.delete(listener)
        }
      },
      cliArgs
    )
    app.exit(code)
    return
  }

  const initialSettings = await codexServices.settings.get()
  appUpdaterService = createAppUpdaterService({
    currentVersion: app.getVersion(),
    initialSettings,
    githubUrl: resolveGithubUrl(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
    isHomebrewCaskInstalled: async () =>
      isHomebrewCaskInstalled({
        caskToken: 'codexdock'
      }),
    launchHomebrewUpdate: async () =>
      launchHomebrewCaskUpgrade({
        appName: app.getName(),
        caskToken: 'codexdock',
        executablePath: app.getPath('exe'),
        appPid: process.pid
      })
  })
  appUpdaterService.subscribe((updateState) => {
    emitUpdateState(updateState)
  })

  usagePollingController = createUsagePollingController({
    getSnapshot: () => codexServices.getSnapshot(),
    readAccountRateLimits: (accountId) => codexServices.usage.read(accountId),
    onSnapshotChanged: () => refreshTrayTitle(),
    onReadError: (account, error) => {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`Failed to poll usage for ${account.email ?? account.id}: ${detail}`)
    }
  })
  authRefreshController = createAuthRefreshController({
    getSnapshot: () => codexServices.getSnapshot(),
    refreshExpiringSession: (accountId) => codexServices.accounts.refreshExpiringSession(accountId),
    onSnapshotChanged: () => refreshTrayTitle(),
    onRefreshError: (account, error) => {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`Failed to refresh auth for ${account.email ?? account.id}: ${detail}`)
    }
  })
  wakeSchedulerController = createWakeSchedulerController({
    getSnapshot: () => codexServices.getSnapshot(),
    wakeAccount: (accountId, input) => codexServices.usage.wake(accountId, input),
    updateWakeScheduleRuntime: (accountId, patch) =>
      codexServices.accounts.updateWakeScheduleRuntime(accountId, patch),
    onSnapshotChanged: () => refreshTrayTitle(),
    onWakeError: (account, error) => {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`Failed to scheduled-wake ${account.email ?? account.id}: ${detail}`)
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('codex:get-snapshot', () => refreshTrayTitle())
  ipcMain.handle('codex:get-app-meta', () => getAppMeta())
  ipcMain.handle('codex:get-update-state', () => resolveUpdateState())
  ipcMain.handle('codex:update-settings', async (_, nextSettings: Partial<AppSettings>) => {
    if (
      isLocalEnvironment &&
      typeof nextSettings.showLocalMockData === 'boolean' &&
      nextSettings.showLocalMockData !== useLocalMockDataSource
    ) {
      await stopRunningGatewayBeforeRuntimeSwap()
      useLocalMockDataSource = nextSettings.showLocalMockData
      await persistLocalMockDataSourcePreference(useLocalMockDataSource)
      codexServices = createRuntimeServices()
      if (useLocalMockDataSource) {
        await bootstrapLocalMockData()
      }
    }

    const snapshot = await codexServices.settings.update(nextSettings)
    appUpdaterService?.syncSettings(snapshot.settings)
    await refreshTrayTitle()
    return snapshot
  })
  ipcMain.handle('codex:open-main-window', async () => {
    showMainWindow()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-codex', async () => {
    await codexServices.codex.show()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:import-current-account', async () => {
    await codexServices.accounts.importCurrent()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:import-accounts-from-file', async () => {
    const dialogWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
    const openDialogOptions: OpenDialogOptions = {
      title: 'Import accounts',
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const selection = dialogWindow
      ? await dialog.showOpenDialog(dialogWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions)

    if (selection.canceled || !selection.filePaths[0]) {
      return refreshTrayTitle()
    }

    const raw = await fs.readFile(selection.filePaths[0], 'utf8')
    await codexServices.accounts.importFromTemplate(raw)
    return refreshTrayTitle()
  })
  ipcMain.handle(
    'codex:export-accounts-to-file',
    async (_, format: AccountTransferFormat = 'codexdock') => {
      const raw = await codexServices.accounts.exportToTemplate(undefined, format)
      await saveAccountsExport(raw, mainWindow, {
        defaultFilePrefix: exportFilePrefix(format)
      })
      return refreshTrayTitle()
    }
  )
  ipcMain.handle(
    'codex:export-selected-accounts-to-file',
    async (_, accountIds: string[], format: AccountTransferFormat = 'codexdock') => {
      const raw = await codexServices.accounts.exportToTemplate(accountIds, format)
      await saveAccountsExport(raw, mainWindow, {
        title: 'Export selected accounts',
        defaultFilePrefix: exportFilePrefix(format, {
          selected: true
        })
      })
      return refreshTrayTitle()
    }
  )
  ipcMain.handle('codex:activate-account', async (_, accountId: string) => {
    await codexServices.accounts.activate(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:activate-best-account', async () => {
    await codexServices.accounts.activateBest()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:reorder-accounts', async (_, accountIds: string[]) => {
    await codexServices.accounts.reorder(accountIds)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:remove-account', async (_, accountId: string) => {
    await codexServices.accounts.remove(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:remove-accounts', async (_, accountIds: string[]) => {
    await codexServices.accounts.removeMany(accountIds)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:update-account-tags', async (_, accountId: string, tagIds: string[]) => {
    await codexServices.accounts.updateTags(accountId, tagIds)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:get-account-wake-schedule', (_, accountId: string) =>
    codexServices.accounts.getWakeSchedule(accountId)
  )
  ipcMain.handle(
    'codex:update-account-wake-schedule',
    async (_, accountId: string, input: UpdateAccountWakeScheduleInput) => {
      await codexServices.accounts.updateWakeSchedule(accountId, input)
      return refreshTrayTitle()
    }
  )
  ipcMain.handle('codex:delete-account-wake-schedule', async (_, accountId: string) => {
    await codexServices.accounts.deleteWakeSchedule(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:create-tag', async (_, name: string) => {
    await codexServices.tags.create(name)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:update-tag', async (_, tagId: string, name: string) => {
    await codexServices.tags.update(tagId, name)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:delete-tag', async (_, tagId: string) => {
    await codexServices.tags.remove(tagId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:list-providers', () => codexServices.providers.list())
  ipcMain.handle('codex:get-provider', (_, providerId: string) =>
    codexServices.providers.get(providerId)
  )
  ipcMain.handle('codex:reorder-providers', async (_, providerIds: string[]) => {
    await codexServices.providers.reorder(providerIds)
    return refreshTrayTitle()
  })
  ipcMain.handle(
    'codex:create-provider',
    async (
      _,
      input: {
        name?: string
        baseUrl: string
        apiKey: string
        model?: string
        fastMode?: boolean
      }
    ) => {
      await codexServices.providers.create(input)
      return refreshTrayTitle()
    }
  )
  ipcMain.handle(
    'codex:update-provider',
    async (
      _,
      providerId: string,
      input: {
        name?: string
        baseUrl?: string
        apiKey?: string
        model?: string
        fastMode?: boolean
      }
    ) => {
      await codexServices.providers.update(providerId, input)
      return refreshTrayTitle()
    }
  )
  ipcMain.handle('codex:remove-provider', async (_, providerId: string) => {
    await codexServices.providers.remove(providerId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-provider-in-codex', async (_, providerId: string) => {
    await codexServices.providers.open(providerId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-account-in-codex', async (_, accountId: string) => {
    await codexServices.codex.open(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-account-in-isolated-codex', async (_, accountId: string) => {
    await codexServices.codex.openIsolated(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:list-instances', () => codexServices.codex.instances.list())
  ipcMain.handle('codex:get-instance-defaults', () => codexServices.codex.instances.getDefaults())
  ipcMain.handle(
    'codex:create-instance',
    async (
      _,
      input: {
        name: string
        codexHome?: string
        bindAccountId?: string
        extraArgs?: string
      }
    ) => {
      await codexServices.codex.instances.create(input)
      return refreshTrayTitle()
    }
  )
  ipcMain.handle(
    'codex:update-instance',
    async (
      _,
      instanceId: string,
      input: {
        name?: string
        bindAccountId?: string | null
        extraArgs?: string
      }
    ) => {
      await codexServices.codex.instances.update(instanceId, input)
      return refreshTrayTitle()
    }
  )
  ipcMain.handle('codex:remove-instance', async (_, instanceId: string) => {
    await codexServices.codex.instances.remove(instanceId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:start-instance', async (_, instanceId: string) => {
    await codexServices.codex.instances.start(instanceId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:stop-instance', async (_, instanceId: string) => {
    await codexServices.codex.instances.stop(instanceId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:read-account-rate-limits', async (_, accountId: string) => {
    try {
      return await codexServices.usage.read(accountId)
    } finally {
      await refreshTrayTitle()
    }
  })
  ipcMain.handle(
    'codex:wake-account-rate-limits',
    async (_, accountId: string, input?: WakeAccountRateLimitsInput) => {
      try {
        return await codexServices.usage.wake(accountId, input)
      } finally {
        await refreshTrayTitle()
      }
    }
  )
  ipcMain.handle('codex:read-token-cost', async (_, input?: TokenCostReadOptions) => {
    try {
      return await codexServices.cost.read(input)
    } finally {
      setTimeout(() => {
        void refreshTrayTitle().catch(() => undefined)
      }, 0)
    }
  })
  ipcMain.handle('codex:list-sessions', (_, input?: ListCodexSessionsInput) =>
    codexServices.session.list(input)
  )
  ipcMain.handle('codex:list-session-projects', (_, input?: ListCodexSessionProjectsInput) =>
    codexServices.session.projects(input)
  )
  ipcMain.handle('codex:read-session-detail', (_, input: ReadCodexSessionDetailInput) =>
    codexServices.session.detail(input)
  )
  ipcMain.handle('codex:copy-session-to-provider', (_, input: CopyCodexSessionToProviderInput) =>
    codexServices.session.copyToProvider(input)
  )
  ipcMain.handle('codex:list-skills', () => codexServices.skill.list())
  ipcMain.handle('codex:read-skill-detail', (_, instanceId: string, skillDirName: string) =>
    codexServices.skill.detail(instanceId, skillDirName)
  )
  ipcMain.handle('codex:copy-skill', (_, input: CopyCodexSkillInput) =>
    codexServices.skill.copy(input)
  )
  ipcMain.handle('codex:get-local-gateway-status', () => codexServices.gateway.status())
  ipcMain.handle('codex:start-local-gateway', async () => {
    await codexServices.gateway.start()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:stop-local-gateway', async () => {
    await codexServices.gateway.stop()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:rotate-local-gateway-key', async () => {
    const result = await codexServices.gateway.rotateKey()
    await refreshTrayTitle()
    return result
  })
  ipcMain.handle('codex:check-for-updates', () => requireAppUpdaterService().checkForUpdates())
  ipcMain.handle('codex:download-update', () => triggerUpdateDownload())
  ipcMain.handle('codex:install-update', () => requireAppUpdaterService().installUpdate())
  ipcMain.handle('codex:start-login', (_, method: LoginMethod) => codexServices.login.start(method))
  ipcMain.handle('codex:get-login-port-occupant', () => codexServices.login.getPortOccupant())
  ipcMain.handle('codex:kill-login-port-occupant', () => codexServices.login.killPortOccupant())

  createWindow()
  if (process.platform === 'darwin') {
    createTray()
  }
  void refreshTrayTitle()
  appUpdaterService.start()
  authRefreshController.start()
  usagePollingController.start()
  wakeSchedulerController.start()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  appUpdaterService?.stop()
  authRefreshController?.stop()
  usagePollingController?.stop()
  wakeSchedulerController?.stop()
  mainWindow = null
  tray = null
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
