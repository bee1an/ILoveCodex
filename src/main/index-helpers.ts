import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  type MenuItemConstructorOptions,
  type SaveDialogOptions
} from 'electron'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { is } from '@electron-toolkit/utils'
import {
  formatRelativeReset,
  remainingPercent,
  type AccountSummary,
  type AccountTransferFormat,
  type AppMeta,
  type AppSettings,
  type AppSnapshot
} from '../shared/codex'

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
  updatingViaHomebrew: string
  homebrewUpdateStatus: (status?: string, command?: string) => string
  updateViaHomebrew: (version?: string) => string
  openReleasePage: (version?: string) => string
  installUpdate: string
  downloadingUpdate: (progress?: number) => string
  updatesUnsupported: string
  pollingInterval: string
  minutes: string
  runningTokenCost: string
  tokenCostToday: string
  tokenCostLast30Days: string
  tokenCostNoData: string
  tokenCostDefaultFallback: string
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
    updateViaHomebrew: (version) =>
      language === 'en'
        ? `Update with Homebrew${version ? ` v${version}` : ''}`
        : `通过 Homebrew 更新${version ? ` v${version}` : ''}`,
    updatingViaHomebrew:
      language === 'en' ? 'Updating through Homebrew…' : '正在通过 Homebrew 更新…',
    homebrewUpdateStatus: (status, command) => {
      if (language === 'en') {
        if (status === 'waiting-for-app-quit') {
          return 'Homebrew is ready to install, closing the app…'
        }
        if (status === 'reopening') {
          return 'Reopening the app…'
        }
        return command ? `Running: ${command}` : 'Updating through Homebrew…'
      }

      if (status === 'waiting-for-app-quit') {
        return 'Homebrew 已准备安装，正在关闭应用…'
      }
      if (status === 'reopening') {
        return '正在重新打开应用…'
      }
      return command ? `正在执行：${command}` : '正在通过 Homebrew 更新…'
    },
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
    runningTokenCost: language === 'en' ? 'All instances token/cost' : '全部实例 token/cost',
    tokenCostToday: language === 'en' ? 'Today' : '今日',
    tokenCostLast30Days: language === 'en' ? 'Last 30 days' : '最近 30 天',
    tokenCostNoData: language === 'en' ? 'No token/cost data' : '暂无 token/cost 数据',
    tokenCostDefaultFallback:
      language === 'en' ? 'Aggregated across all instances' : '按全部实例聚合',
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
  fallbackWindow?: BrowserWindow | null,
  options?: {
    title?: string
    defaultFilePrefix?: string
  }
): Promise<void> {
  const dialogWindow = BrowserWindow.getFocusedWindow() ?? fallbackWindow ?? undefined
  const filePrefix = options?.defaultFilePrefix ?? 'codexdock-accounts'
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

function exportFileFormatSuffix(format: AccountTransferFormat): string {
  switch (format) {
    case 'cockpit_tools':
      return 'cockpit-tools'
    case 'sub2api':
      return 'sub2api'
    case 'cliproxyapi':
      return 'cliproxyapi'
    case 'codexdock':
    default:
      return 'codexdock'
  }
}

function exportFilePrefix(
  format: AccountTransferFormat,
  options?: {
    selected?: boolean
  }
): string {
  const base = options?.selected ? 'codexdock-selected-accounts' : 'codexdock-accounts'
  return format === 'codexdock' ? base : `${base}-${exportFileFormatSuffix(format)}`
}

function buildTrayTitle(snapshot: AppSnapshot): string {
  const account = resolveCurrentAccount(snapshot)
  if (!account) {
    return 'CodexDock'
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
    return 'CodexDock'
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

export {
  pollingOptions,
  localeText,
  resolveGithubUrl,
  extractCliArgs,
  buildRendererUrl,
  getAppMeta,
  loadRendererWindow,
  saveAccountsExport,
  exportFilePrefix,
  buildTrayTitle,
  buildTrayTooltip,
  buildCurrentUsageMenu,
  accountLabel,
  buildTrayImage
}
