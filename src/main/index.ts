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
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runCli } from '../cli/run-cli'
import { createAppUpdaterService, type AppUpdaterService } from './app-updater'
import { createAuthRefreshController, type AuthRefreshController } from './auth-poller'
import { createElectronCodexPlatformAdapter } from './electron-platform'
import { installCliShim } from './cli-shim'
import { createCodexServices, type CodexServices } from './codex-services'
import { buildTrayUpdateMenuItem, buildTrayUsageMenuItems } from './tray-menu'
import { createUsagePollingController, type UsagePollingController } from './usage-poller'
import {
  type AppUpdateState,
  formatRelativeReset,
  remainingPercent,
  resolveBestAccount,
  type AppMeta,
  type AccountSummary,
  type AppSettings,
  type AppSnapshot,
  type LoginEvent,
  type LoginMethod
} from '../shared/codex'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let codexServices: CodexServices
let appUpdaterService: AppUpdaterService | null = null
let authRefreshController: AuthRefreshController | null = null
let usagePollingController: UsagePollingController | null = null
let lastSnapshot: AppSnapshot | null = null
const defaultWorkspacePath = process.cwd()
const configuredUserDataPath = join(homedir(), '.config', 'ilovecodex')
const pollingOptions = [5, 15, 30, 60] as const
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index

  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }

  return crc >>> 0
})

function localeText(language: AppSettings['language']): {
  noAccount: string
  currentAccount: string
  sessionQuota: string
  weeklyQuota: string
  remaining: string
  resetAt: string
  noVisibleAccount: string
  activePrefix: string
  bestAccount: string
  openCodex: string
  openMainWindow: string
  checkForUpdates: string
  checkingForUpdates: string
  downloadUpdate: (version?: string) => string
  openReleasePage: (version?: string) => string
  installUpdate: string
  downloadingUpdate: (progress?: number) => string
  updatesUnsupported: string
  pollingInterval: string
  minutes: string
  quit: string
  autoCheckUpdates: string
  unknownAccount: string
} {
  return {
    noAccount: language === 'en' ? 'No account available' : '当前没有可用账号',
    currentAccount: language === 'en' ? 'Active account' : '当前使用账号',
    sessionQuota: language === 'en' ? 'Session quota' : '小时限额',
    weeklyQuota: language === 'en' ? 'Weekly quota' : '周限额',
    remaining: language === 'en' ? 'left' : '剩余',
    resetAt: language === 'en' ? 'Resets in' : '重置时间',
    noVisibleAccount: language === 'en' ? 'No account to display' : '还没有可显示的账号',
    activePrefix: language === 'en' ? 'Active · ' : '当前 · ',
    bestAccount: language === 'en' ? 'Switch to best account' : '切换到最优账号',
    openCodex: language === 'en' ? 'Open Codex' : '打开 Codex',
    openMainWindow: language === 'en' ? 'Open main window' : '打开主界面',
    checkForUpdates: language === 'en' ? 'Check for updates' : '检查更新',
    checkingForUpdates: language === 'en' ? 'Checking for updates…' : '检查更新中…',
    downloadUpdate: (version) =>
      language === 'en'
        ? `Download update${version ? ` v${version}` : ''}`
        : `下载更新${version ? ` v${version}` : ''}`,
    openReleasePage: (version) =>
      language === 'en'
        ? `Open download page${version ? ` v${version}` : ''}`
        : `前往下载${version ? ` v${version}` : ''}`,
    installUpdate: language === 'en' ? 'Restart to install update' : '重启安装更新',
    downloadingUpdate: (progress) =>
      language === 'en' ? `Downloading ${progress ?? 0}%` : `下载更新中 ${progress ?? 0}%`,
    updatesUnsupported:
      language === 'en' ? 'Automatic updates unavailable for this build' : '当前构建不支持自动更新',
    pollingInterval: language === 'en' ? 'Polling interval' : '轮询间隔',
    minutes: language === 'en' ? 'min' : '分钟',
    quit: language === 'en' ? 'Quit' : '退出',
    autoCheckUpdates: language === 'en' ? 'Check updates on startup' : '启动时检查更新',
    unknownAccount: language === 'en' ? 'Unnamed account' : '未命名账号'
  }
}

function resolveGithubUrl(): string | null {
  const envUrl = process.env['ILOVECODEX_GITHUB_URL']
  if (envUrl) {
    return envUrl
  }

  try {
    const packageJsonPath = join(app.getAppPath(), 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      homepage?: string
      repository?: string | { url?: string }
    }
    const repositoryUrl =
      typeof packageJson.repository === 'string'
        ? packageJson.repository
        : packageJson.repository?.url
    const normalizedRepositoryUrl = repositoryUrl?.replace(/^git\+/, '').replace(/\.git$/, '')

    if (normalizedRepositoryUrl?.includes('github.com')) {
      return normalizedRepositoryUrl
    }

    if (packageJson.homepage?.includes('github.com')) {
      return packageJson.homepage
    }
  } catch {
    return null
  }

  return null
}

app.setPath('userData', configuredUserDataPath)

function extractCliArgs(argv: string[]): string[] | null {
  const index = argv.indexOf('--cli')
  if (index === -1) {
    return null
  }

  return argv.slice(index + 1)
}

function buildRendererUrl(query: Record<string, string> = {}): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
    return url.toString()
  }

  const url = pathToFileURL(join(__dirname, '../renderer/index.html'))
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })
  return url.toString()
}

function getAppMeta(): AppMeta {
  return {
    version: app.getVersion(),
    githubUrl: resolveGithubUrl(),
    platform: process.platform,
    isPackaged: app.isPackaged
  }
}

function loadRendererWindow(
  window: BrowserWindow,
  query: Record<string, string> = {}
): Promise<void> {
  return window.loadURL(buildRendererUrl(query))
}

async function saveAccountsExport(
  raw: string,
  options?: {
    title?: string
    defaultFilePrefix?: string
  }
): Promise<void> {
  const dialogWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
  const filePrefix = options?.defaultFilePrefix ?? 'ilovecodex-accounts'
  const exportPath = join(
    app.getPath('downloads'),
    `${filePrefix}-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}.json`
  )
  const saveDialogOptions: SaveDialogOptions = {
    title: options?.title ?? 'Export accounts',
    defaultPath: exportPath,
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const selection = dialogWindow
    ? await dialog.showSaveDialog(dialogWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions)

  if (selection.canceled || !selection.filePath) {
    return
  }

  await fs.writeFile(selection.filePath, raw, 'utf8')
}

function buildTrayTitle(snapshot: AppSnapshot): string {
  const account = resolveCurrentAccount(snapshot)
  if (!account) {
    return 'Ilovecodex'
  }

  const limits = snapshot.usageByAccountId[account.id]
  const shortHour = limits?.primary ? `${remainingPercent(limits.primary.usedPercent)}%` : '--'
  const shortWeek = limits?.secondary ? `${remainingPercent(limits.secondary.usedPercent)}%` : '--'

  return `5h ${shortHour}  w ${shortWeek}`
}

function buildTrayTooltip(snapshot: AppSnapshot): string {
  const account = resolveCurrentAccount(snapshot)
  const text = localeText(snapshot.settings.language)
  if (!account) {
    return 'Ilovecodex'
  }

  const limits = snapshot.usageByAccountId[account.id]
  const shortHour = limits?.primary ? `${remainingPercent(limits.primary.usedPercent)}%` : '--'
  const shortWeek = limits?.secondary ? `${remainingPercent(limits.secondary.usedPercent)}%` : '--'
  const label = account.email ?? account.name ?? account.accountId ?? text.currentAccount

  return `${label}\n5h ${shortHour}\nw ${shortWeek}`
}

function middleEllipsis(value: string, maxLength = 22): string {
  if (value.length <= maxLength) {
    return value
  }

  const suffixLength = value.includes('@') ? Math.min(10, Math.floor((maxLength - 1) / 2)) : 8
  const prefixLength = maxLength - suffixLength - 1

  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`
}

function accountLabel(
  account: AccountSummary,
  language: AppSettings['language'] = 'zh-CN'
): string {
  const label =
    account.email ?? account.name ?? account.accountId ?? localeText(language).unknownAccount

  return middleEllipsis(label)
}

function resolveCurrentAccount(snapshot: AppSnapshot): AccountSummary | null {
  if (snapshot.activeAccountId) {
    const activeAccount = snapshot.accounts.find(
      (account) => account.id === snapshot.activeAccountId
    )
    if (activeAccount) {
      return activeAccount
    }
  }

  return snapshot.accounts[0] ?? null
}

function buildMenuBar(remaining?: number | null): string {
  const total = 12
  const normalized = remaining == null ? 0 : Math.max(0, Math.min(100, remaining))
  const filled = Math.max(0, Math.min(total, Math.round((normalized / 100) * total)))

  return `${'█'.repeat(filled)}${'░'.repeat(total - filled)}`
}

function buildCurrentUsageMenu(snapshot: AppSnapshot): MenuItemConstructorOptions[] {
  const account = resolveCurrentAccount(snapshot)
  const text = localeText(snapshot.settings.language)

  if (!account) {
    return [{ label: text.noAccount, enabled: false }]
  }

  const limits = snapshot.usageByAccountId[account.id]
  const sessionRemaining = limits?.primary ? remainingPercent(limits.primary.usedPercent) : null
  const weeklyRemaining = limits?.secondary ? remainingPercent(limits.secondary.usedPercent) : null

  return [
    {
      label: `${text.currentAccount} · ${accountLabel(account, snapshot.settings.language)}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: `${text.sessionQuota} · ${text.remaining} ${sessionRemaining == null ? '--' : `${sessionRemaining}%`}`,
      enabled: false
    },
    {
      label: buildMenuBar(sessionRemaining),
      enabled: false
    },
    {
      label: `${text.resetAt} · ${formatRelativeReset(limits?.primary?.resetsAt, snapshot.settings.language)}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: `${text.weeklyQuota} · ${text.remaining} ${weeklyRemaining == null ? '--' : `${weeklyRemaining}%`}`,
      enabled: false
    },
    {
      label: buildMenuBar(weeklyRemaining),
      enabled: false
    },
    {
      label: `${text.resetAt} · ${formatRelativeReset(limits?.secondary?.resetsAt, snapshot.settings.language)}`,
      enabled: false
    }
  ]
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
    openReleasePage: text.openReleasePage,
    installUpdate: text.installUpdate,
    unsupported: text.updatesUnsupported,
    downloadingUpdate: text.downloadingUpdate,
    onCheck: () => {
      void appUpdaterService?.checkForUpdates()
    },
    onDownload: () => {
      const updateState = resolveUpdateState()
      if (updateState.delivery === 'external') {
        const downloadUrl = updateState.externalDownloadUrl ?? getAppMeta().githubUrl ?? undefined
        if (downloadUrl) {
          void shell.openExternal(downloadUrl)
        }
        return
      }

      void appUpdaterService?.downloadUpdate()
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

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff

  for (const value of buffer) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)

  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function buildTrayPng(hourPercent: number, weekPercent: number, scaleFactor: number): Buffer {
  const width = 18 * scaleFactor
  const height = 18 * scaleFactor
  const pixels = Buffer.alloc(width * height * 4)
  const setPixel = (x: number, y: number, alpha: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height || alpha <= 0) {
      return
    }

    const offset = (y * width + x) * 4
    pixels[offset] = 0
    pixels[offset + 1] = 0
    pixels[offset + 2] = 0
    pixels[offset + 3] = Math.max(pixels[offset + 3], alpha)
  }
  const fillRoundedRect = (
    startX: number,
    startY: number,
    rectWidth: number,
    rectHeight: number,
    radius: number,
    alpha: number
  ): void => {
    if (rectWidth <= 0 || rectHeight <= 0) {
      return
    }

    const rectRadius = Math.max(0, Math.min(radius, rectWidth / 2, rectHeight / 2))
    const innerLeft = startX + rectRadius
    const innerRight = startX + rectWidth - rectRadius
    const innerTop = startY + rectRadius
    const innerBottom = startY + rectHeight - rectRadius

    for (let y = startY; y < startY + rectHeight; y += 1) {
      for (let x = startX; x < startX + rectWidth; x += 1) {
        const pixelCenterX = x + 0.5
        const pixelCenterY = y + 0.5
        const nearestX = Math.max(innerLeft, Math.min(pixelCenterX, innerRight))
        const nearestY = Math.max(innerTop, Math.min(pixelCenterY, innerBottom))
        const distance = Math.hypot(pixelCenterX - nearestX, pixelCenterY - nearestY)

        if (distance <= rectRadius - 0.5) {
          setPixel(x, y, alpha)
          continue
        }

        if (distance < rectRadius + 0.5) {
          const feather = rectRadius + 0.5 - distance
          setPixel(x, y, Math.round(alpha * feather))
        }
      }
    }
  }

  const paddingX = Math.max(1, Math.round(1.25 * scaleFactor))
  const trackWidth = width - paddingX * 2
  const topY = Math.round(2.75 * scaleFactor)
  const topHeight = Math.max(4, Math.round(4.75 * scaleFactor))
  const bottomY = Math.round(10.25 * scaleFactor)
  const bottomHeight = Math.max(3, Math.round(3.5 * scaleFactor))
  const topFillWidth =
    hourPercent > 0 ? Math.max(1, Math.round((trackWidth * hourPercent) / 100)) : 0
  const bottomFillWidth =
    weekPercent > 0 ? Math.max(1, Math.round((trackWidth * weekPercent) / 100)) : 0

  fillRoundedRect(paddingX, topY, trackWidth, topHeight, topHeight / 2, 80)
  fillRoundedRect(paddingX, topY, topFillWidth, topHeight, topHeight / 2, 255)
  fillRoundedRect(paddingX, bottomY, trackWidth, bottomHeight, bottomHeight / 2, 68)
  fillRoundedRect(paddingX, bottomY, bottomFillWidth, bottomHeight, bottomHeight / 2, 220)

  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4)
    rawData[rowOffset] = 0
    pixels.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawData)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function buildTrayImage(snapshot: AppSnapshot): Electron.NativeImage {
  const account = resolveCurrentAccount(snapshot)
  const hourPercent = account
    ? remainingPercent(snapshot.usageByAccountId[account.id]?.primary?.usedPercent)
    : 0
  const weekPercent = account
    ? remainingPercent(snapshot.usageByAccountId[account.id]?.secondary?.usedPercent)
    : 0

  const image = nativeImage.createEmpty()
  ;([1, 2, 3] as const).forEach((scaleFactor) => {
    image.addRepresentation({
      scaleFactor,
      dataURL: `data:image/png;base64,${buildTrayPng(hourPercent, weekPercent, scaleFactor).toString('base64')}`
    })
  })
  image.setTemplateImage(true)
  return image
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

  return snapshot
}

function emitUpdateState(updateState: AppUpdateState): void {
  if (tray && lastSnapshot) {
    tray.setContextMenu(buildTrayMenu(lastSnapshot))
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codex:update-state', updateState)
  }
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
            codexDesktopExecutablePath: ''
          },
          usageByAccountId: {},
          usageErrorByAccountId: {}
        })
      : nativeImage.createFromPath(icon).resize({ width: 18, height: 18 })

  tray = new Tray(trayIcon)
  tray.setToolTip('Ilovecodex')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const cliShim = await installCliShim({
    appPath: process.execPath,
    isPackaged: app.isPackaged
  })
  if (cliShim.status === 'installed' || cliShim.status === 'updated') {
    console.info(`Installed ilc shim at ${cliShim.shimPath}`)
  } else if (cliShim.reason === 'occupied') {
    console.warn(`Skipped ilc shim install because ${cliShim.shimPath} is already occupied`)
  }

  const cliArgs = extractCliArgs(process.argv)
  const loginEventListeners = new Set<(event: LoginEvent) => void>()
  const platform = createElectronCodexPlatformAdapter()
  codexServices = createCodexServices({
    userDataPath: app.getPath('userData'),
    defaultWorkspacePath,
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
    env: process.env
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
  ipcMain.handle('codex:export-accounts-to-file', async () => {
    const raw = await codexServices.accounts.exportToTemplate()
    await saveAccountsExport(raw)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:export-selected-accounts-to-file', async (_, accountIds: string[]) => {
    const raw = await codexServices.accounts.exportToTemplate(accountIds)
    await saveAccountsExport(raw, {
      title: 'Export selected accounts',
      defaultFilePrefix: 'ilovecodex-selected-accounts'
    })
    return refreshTrayTitle()
  })
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
  ipcMain.handle('codex:check-for-updates', () => requireAppUpdaterService().checkForUpdates())
  ipcMain.handle('codex:download-update', () => requireAppUpdaterService().downloadUpdate())
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
  mainWindow = null
  tray = null
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
