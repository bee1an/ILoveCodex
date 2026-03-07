import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  nativeImage,
  Menu,
  type MenuItemConstructorOptions
} from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CodexAccountStore, CodexLoginCoordinator } from './codex-auth'
import { readAccountRateLimits } from './codex-app-server'
import {
  formatRelativeReset,
  remainingPercent,
  resolveBestAccount,
  type AccountSummary,
  type AppSettings,
  type AppSnapshot,
  type LoginMethod
} from '../shared/codex'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let accountStore: CodexAccountStore
let loginCoordinator: CodexLoginCoordinator
const defaultWorkspacePath = process.cwd()
const pollingOptions = [5, 15, 30, 60] as const
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index

  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }

  return crc >>> 0
})

function launchCodexDesktop(workspacePath: string): void {
  const child = spawn('codex', ['app', workspacePath], {
    cwd: workspacePath,
    env: process.env,
    detached: true,
    stdio: 'ignore'
  })

  child.unref()
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

function loadRendererWindow(
  window: BrowserWindow,
  query: Record<string, string> = {}
): Promise<void> {
  return window.loadURL(buildRendererUrl(query))
}

function resolveTrayAccounts(snapshot: AppSnapshot): AccountSummary[] {
  if (!snapshot.accounts.length) {
    return []
  }

  const activeAccount = snapshot.activeAccountId
    ? snapshot.accounts.find((account) => account.id === snapshot.activeAccountId)
    : undefined
  const remainingAccounts = snapshot.accounts.filter((account) => account.id !== activeAccount?.id)

  return [activeAccount, ...remainingAccounts]
    .filter((account): account is AccountSummary => Boolean(account))
    .slice(0, 5)
}

function buildTrayTitle(snapshot: AppSnapshot): string {
  const account = resolveTrayAccounts(snapshot)[0]
  if (!account) {
    return 'Ilovecodex'
  }

  const limits = snapshot.usageByAccountId[account.id]
  const shortHour = limits?.primary ? `${remainingPercent(limits.primary.usedPercent)}%` : '--'
  const shortWeek = limits?.secondary ? `${remainingPercent(limits.secondary.usedPercent)}%` : '--'

  return `5h ${shortHour}  w ${shortWeek}`
}

function buildTrayTooltip(snapshot: AppSnapshot): string {
  const account = resolveTrayAccounts(snapshot)[0]
  if (!account) {
    return 'Ilovecodex'
  }

  const limits = snapshot.usageByAccountId[account.id]
  const shortHour = limits?.primary ? `${remainingPercent(limits.primary.usedPercent)}%` : '--'
  const shortWeek = limits?.secondary ? `${remainingPercent(limits.secondary.usedPercent)}%` : '--'
  const label = account.email ?? account.name ?? account.accountId ?? '当前账号'

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

function accountLabel(account: AccountSummary): string {
  const label = account.email ?? account.name ?? account.accountId ?? '未命名账号'

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

  if (!account) {
    return [{ label: '当前没有可用账号', enabled: false }]
  }

  const limits = snapshot.usageByAccountId[account.id]
  const sessionRemaining = limits?.primary ? remainingPercent(limits.primary.usedPercent) : null
  const weeklyRemaining = limits?.secondary ? remainingPercent(limits.secondary.usedPercent) : null

  return [
    { label: `当前使用账号 · ${accountLabel(account)}`, enabled: false },
    { type: 'separator' },
    {
      label: `小时限额 · 剩余 ${sessionRemaining == null ? '--' : `${sessionRemaining}%`}`,
      enabled: false
    },
    {
      label: buildMenuBar(sessionRemaining),
      enabled: false
    },
    {
      label: `重置时间 · ${formatRelativeReset(limits?.primary?.resetsAt)}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: `周限额 · 剩余 ${weeklyRemaining == null ? '--' : `${weeklyRemaining}%`}`,
      enabled: false
    },
    {
      label: buildMenuBar(weeklyRemaining),
      enabled: false
    },
    {
      label: `重置时间 · ${formatRelativeReset(limits?.secondary?.resetsAt)}`,
      enabled: false
    }
  ]
}

function buildTrayUsageMenu(snapshot: AppSnapshot): MenuItemConstructorOptions[] {
  const accounts = resolveTrayAccounts(snapshot)

  if (!accounts.length) {
    return [{ label: '还没有可显示的账号', enabled: false }]
  }

  return accounts.map((account) => {
    const limits = snapshot.usageByAccountId[account.id]
    const hourRemaining = limits?.primary
      ? `${remainingPercent(limits.primary.usedPercent)}%`
      : '--'
    const weekRemaining = limits?.secondary
      ? `${remainingPercent(limits.secondary.usedPercent)}%`
      : '--'
    const prefix = account.id === snapshot.activeAccountId ? '当前 · ' : ''

    return {
      label: `${prefix}${accountLabel(account)}  h${hourRemaining}  w${weekRemaining}`,
      click: () => showMainWindow()
    }
  })
}

function bestAccountMenuLabel(snapshot: AppSnapshot): string {
  const bestAccount = resolveBestAccount(
    snapshot.accounts,
    snapshot.usageByAccountId,
    snapshot.activeAccountId
  )

  if (!bestAccount) {
    return '切换到最优账号'
  }

  return `切换到最优账号 · ${accountLabel(bestAccount)}`
}

function buildTrayPollingMenu(snapshot: AppSnapshot): MenuItemConstructorOptions[] {
  return pollingOptions.map((minutes) => ({
    label: `${minutes} 分钟`,
    type: 'radio',
    checked: snapshot.settings.usagePollingMinutes === minutes,
    click: () => {
      void accountStore.updateSettings({ usagePollingMinutes: minutes }).then(() => {
        void refreshTrayTitle()
      })
    }
  }))
}

function buildTrayMenu(snapshot: AppSnapshot): ReturnType<typeof Menu.buildFromTemplate> {
  const bestAccount = resolveBestAccount(
    snapshot.accounts,
    snapshot.usageByAccountId,
    snapshot.activeAccountId
  )

  return Menu.buildFromTemplate([
    ...buildCurrentUsageMenu(snapshot),
    { type: 'separator' },
    {
      label: '打开主界面',
      click: () => showMainWindow()
    },
    {
      label: bestAccountMenuLabel(snapshot),
      enabled: Boolean(bestAccount) && bestAccount?.id !== snapshot.activeAccountId,
      click: () => {
        if (!bestAccount) {
          return
        }

        void accountStore.activateAccount(bestAccount.id).then(() => {
          void refreshTrayTitle()
        })
      }
    },
    { type: 'separator' },
    ...buildTrayUsageMenu(snapshot),
    { type: 'separator' },
    {
      label: '轮询间隔',
      submenu: buildTrayPollingMenu(snapshot)
    },
    { type: 'separator' },
    {
      label: '退出',
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
  const width = 16 * scaleFactor
  const height = 16 * scaleFactor
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

  const paddingX = Math.max(1, Math.round(1.5 * scaleFactor))
  const trackWidth = width - paddingX * 2
  const topY = Math.round(2.5 * scaleFactor)
  const topHeight = Math.max(3, Math.round(4 * scaleFactor))
  const bottomY = Math.round(9.5 * scaleFactor)
  const bottomHeight = Math.max(2, Math.round(3 * scaleFactor))
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
  const account = resolveTrayAccounts(snapshot)[0]
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
  const snapshot = await accountStore.getSnapshot(loginCoordinator.isRunning())
  if (tray) {
    tray.setImage(buildTrayImage(snapshot))
    tray.setToolTip(buildTrayTooltip(snapshot))
    tray.setTitle(process.platform === 'darwin' ? '' : buildTrayTitle(snapshot))
    tray.setContextMenu(buildTrayMenu(snapshot))
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codex:snapshot-updated', snapshot)
  }

  return snapshot
}

function showMainWindow(): void {
  if (!mainWindow) {
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
  mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  void loadRendererWindow(mainWindow)
}

function createTray(): void {
  const trayIcon =
    process.platform === 'darwin'
      ? buildTrayImage({
          accounts: [],
          currentSession: null,
          loginInProgress: false,
          settings: {
            usagePollingMinutes: 15,
            statusBarAccountIds: []
          },
          usageByAccountId: {}
        })
      : nativeImage.createFromPath(icon).resize({ width: 18, height: 18 })

  tray = new Tray(trayIcon)
  tray.setToolTip('Ilovecodex')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  accountStore = new CodexAccountStore(app.getPath('userData'))
  loginCoordinator = new CodexLoginCoordinator(accountStore, (event) => {
    mainWindow?.webContents.send('codex:login-event', event)
    void refreshTrayTitle()
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
  ipcMain.handle('codex:update-settings', async (_, nextSettings: Partial<AppSettings>) => {
    await accountStore.updateSettings(nextSettings)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-main-window', async () => {
    showMainWindow()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:import-current-account', async () => {
    await accountStore.importCurrentAuth()
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:activate-account', async (_, accountId: string) => {
    await accountStore.activateAccount(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:activate-best-account', async () => {
    const snapshot = await accountStore.getSnapshot(loginCoordinator.isRunning())
    const bestAccount = resolveBestAccount(
      snapshot.accounts,
      snapshot.usageByAccountId,
      snapshot.activeAccountId
    )

    if (!bestAccount || bestAccount.id === snapshot.activeAccountId) {
      return refreshTrayTitle()
    }

    await accountStore.activateAccount(bestAccount.id)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:remove-account', async (_, accountId: string) => {
    await accountStore.removeAccount(accountId)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:open-account-in-codex', async (_, accountId: string) => {
    await accountStore.activateAccount(accountId)
    launchCodexDesktop(defaultWorkspacePath)
    return refreshTrayTitle()
  })
  ipcMain.handle('codex:read-account-rate-limits', async (_, accountId: string) => {
    const rateLimits = await accountStore.queryAccount(accountId, () => readAccountRateLimits())
    await accountStore.saveAccountRateLimits(accountId, rateLimits)
    void refreshTrayTitle()
    return rateLimits
  })
  ipcMain.handle('codex:start-login', (_, method: LoginMethod) => loginCoordinator.start(method))
  ipcMain.handle('codex:cancel-login', () => loginCoordinator.cancel())

  createWindow()
  if (process.platform === 'darwin') {
    createTray()
    void refreshTrayTitle()
  }

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
  mainWindow = null
  tray = null
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
