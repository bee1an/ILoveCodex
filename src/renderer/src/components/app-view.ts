import type {
  AppLanguage,
  AppTheme,
  AccountRateLimitEntry,
  AccountRateLimits,
  AccountSummary,
  CustomProviderSummary,
  LoginEvent
} from '../../../shared/codex'
import { remainingPercent } from '../../../shared/codex'
export { statusBarAccounts } from '../../../shared/codex'

export const pollingOptions = [5, 15, 30, 60] as const

export const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' }
]

export const messages = {
  'zh-CN': {
    unnamedAccount: '未命名账号',
    actionFailed: '操作失败',
    startLoginFailed: '无法启动登录流程',
    readRateLimitFailed: '无法读取账号限额',
    legacyAccountNeedsReimport: '这个账号来自旧版本的钥匙串存储，请重新导入。',
    legacyProviderNeedsApiKey: '这个提供商的 API Key 来自旧版本的钥匙串存储，请重新填写并保存。',
    removeConfirm: (label: string) => `删除 ${label} 的本地保存登录态？`,
    callbackLogin: '回调登录',
    deviceLogin: '设备码登录',
    importCurrent: '导入当前登录',
    switchBest: '切换到最优账号',
    alreadyBest: '当前已是最优账号',
    noBestAccount: '暂无可切换账号',
    switchToAccount: (email: string) => `切换到 ${email}`,
    settings: '设置',
    pollingInterval: '额度轮询',
    autoCheckUpdates: '启动时检查更新',
    codexDesktopExecutablePath: '多开 Codex EXE（Windows）',
    codexDesktopExecutablePathHint: '仅多开',
    codexDesktopExecutablePlaceholder: '例如 C:\\Program Files\\Codex\\Codex.exe',
    minutes: '分钟',
    callbackLoginLink: '授权链接',
    deviceLoginLink: '设备验证页面',
    deviceCode: '设备码',
    copyLink: '复制链接',
    copyCode: '复制设备码',
    openBrowser: '打开浏览器',
    openMainPanel: '打开主面板',
    waitingCallback: '等待在浏览器中完成授权并回调到本地地址。',
    waitingDeviceCode: '在浏览器里完成授权后，这里会自动继续。',
    statusBarAccountCount: (count: number) => `${count} 个状态栏账号`,
    noStatusBarAccounts: '还没有可显示的账号。',
    statusBarDisplayAccounts: '状态栏显示账号',
    maxFiveAccounts: '最多 5 个',
    visible: '已显示',
    hidden: '未显示',
    accountList: '账号列表',
    accountCount: (count: number) => `${count} 个账号`,
    providerList: '提供商列表',
    providerCount: (count: number) => `${count} 个提供商`,
    dragSortHint: '拖动左侧手柄调整顺序',
    dragSortHandle: '拖动排序',
    tagManager: '标签管理',
    hideTagManager: '收起标签管理',
    newTagPlaceholder: '输入新标签名',
    createTag: '新增标签',
    editTag: '编辑标签',
    renameTag: '重命名标签',
    deleteTag: '删除标签',
    save: '保存',
    cancel: '取消',
    allTags: '全部',
    untagged: '未打标签',
    filterByTag: '按标签筛选',
    tagsForAccount: '账号标签',
    addTag: '添加标签',
    removeTag: '移除标签',
    noAvailableTags: '没有可添加标签',
    tagSummary: (tagCount: number, linkedAccountCount: number) =>
      `${tagCount} 个标签，已关联 ${linkedAccountCount} 个账号`,
    taggedAccountCount: (count: number) => `${count} 个账号`,
    noTags: '还没有标签，先在上方新增一个。',
    noAccountsForFilter: '当前筛选下没有账号。',
    deleteTagConfirm: (name: string) => `删除标签 ${name}？已绑定账号会一并取消关联。`,
    active: '当前',
    sessionQuota: '5小时',
    weeklyQuota: '周限额',
    sessionReset: '5小时重置',
    weeklyReset: '周限额重置',
    openCodex: '打开 Codex',
    openCodexIsolated: '多开 Codex',
    openCustomProvider: '启动提供商',
    switchAccount: '切换账号',
    refreshQuota: '刷新额度',
    refreshAllQuota: '刷新全部额度',
    refreshQuotaBlocked: (minutes: number) => `${minutes} 分钟内不重复请求`,
    deleteSaved: '删除保存',
    noSavedAccounts: '还没有保存任何账号。先导入当前登录，或者走一次新的回调登录。',
    providerNamePlaceholder: '提供商名称（可选）',
    providerBaseUrlPlaceholder: '提供商 Base URL',
    providerApiKeyPlaceholder: '提供商 API Key',
    providerModelPlaceholder: '模型（默认 5.4）',
    providerFastMode: '开启 Fast Mode',
    createProvider: '新增提供商',
    editProvider: '编辑提供商',
    saveProvider: '保存提供商',
    deleteProvider: '删除提供商',
    deleteProviderConfirm: (label: string) => `删除提供商 ${label}？`,
    providerBadge: '自定义提供商',
    providerEmptyName: 'custom',
    noProviders: '还没有自定义提供商。',
    instanceManager: '实例管理',
    instanceManagerHint: '独立实例使用独立 CODEX_HOME，首次创建会复制当前 .codex。',
    instanceCount: (count: number) => `${count} 个实例`,
    defaultInstance: '默认实例',
    instanceNamePlaceholder: '实例名称',
    instanceDirPlaceholder: '实例目录（可选）',
    instanceArgsPlaceholder: '附加启动参数（可选）',
    instanceBindAccount: '绑定账号',
    instanceUnbound: '不绑定账号',
    createInstance: '创建实例',
    saveInstance: '保存实例',
    startInstance: '启动实例',
    stopInstance: '停止实例',
    deleteInstance: '删除实例',
    deleteInstanceConfirm: (name: string) => `删除实例 ${name}？实例目录也会被删除。`,
    instanceDirectory: '实例目录',
    instanceStatusRunning: '运行中',
    instanceStatusStopped: '未运行',
    instanceInitialized: '已初始化',
    instanceNeedsInit: '首次启动时初始化',
    defaultInstanceRoot: '默认实例目录',
    switchLanguage: '切换语言',
    switchTheme: (current: string) => `切换主题，当前${current}`,
    openGithub: '打开 GitHub',
    githubPending: 'GitHub 链接待配置',
    checkUpdates: '检查更新',
    checkingUpdates: '检查更新中',
    downloadUpdate: (version?: string) => `下载更新${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `前往下载${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: '重启安装更新',
    updateReady: '更新已下载，重启后安装。',
    updateUpToDate: '当前已是最新版本。',
    updateAvailableVersion: (version?: string) =>
      version ? `发现新版本 v${version}` : '发现新版本',
    updateDownloadProgress: (progress?: number) => `下载中 ${progress ?? 0}%`,
    updatesUnsupported: '当前构建不支持自动更新',
    updateFailed: '检查更新失败',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    systemTheme: '跟随系统',
    portOccupied: (command: string, pid: number) => `1455 端口当前被 ${command} (${pid}) 占用`,
    killPortOccupant: '结束占用进程',
    killPortOccupantFailed: '无法结束占用 1455 端口的进程',
    emptyStateTitle: '还没有账号',
    emptyStateDescription: '导入当前登录，或者新建一次回调登录。',
    importCurrentHint: '导入当前登录',
    importCurrentDetail: '适合你已经在本机 Codex 里登录过账号的情况。',
    callbackLoginHint: '新建回调登录',
    callbackLoginDetail: '适合补充新账号，授权完成后会自动回调导入。',
    deviceLoginHint: '设备码登录',
    deviceLoginDetail: '适合在别的设备或浏览器里完成授权，再回到这里自动导入。'
  },
  en: {
    unnamedAccount: 'Unnamed account',
    actionFailed: 'Action failed',
    startLoginFailed: 'Unable to start login flow',
    readRateLimitFailed: 'Unable to read account limits',
    legacyAccountNeedsReimport:
      'This account was saved by an older Keychain-backed version. Re-import it to continue.',
    legacyProviderNeedsApiKey:
      'This provider API key was saved by an older Keychain-backed version. Enter it again and save the provider.',
    removeConfirm: (label: string) => `Remove the saved local session for ${label}?`,
    callbackLogin: 'Callback login',
    deviceLogin: 'Device code login',
    importCurrent: 'Import current login',
    switchBest: 'Switch to best account',
    alreadyBest: 'Already using best account',
    noBestAccount: 'No account to switch to',
    switchToAccount: (email: string) => `Switch to ${email}`,
    settings: 'Settings',
    pollingInterval: 'Usage polling',
    autoCheckUpdates: 'Check updates on startup',
    codexDesktopExecutablePath: 'Multi-open Codex EXE (Windows)',
    codexDesktopExecutablePathHint: 'Multi-open only',
    codexDesktopExecutablePlaceholder: 'For example C:\\Program Files\\Codex\\Codex.exe',
    minutes: 'min',
    callbackLoginLink: 'Authorization URL',
    deviceLoginLink: 'Device verification URL',
    deviceCode: 'Device code',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    openBrowser: 'Open browser',
    openMainPanel: 'Open main panel',
    waitingCallback: 'Waiting for authorization in the browser to call back to the local app.',
    waitingDeviceCode:
      'Finish authorization in the browser and Ilovecodex will continue automatically.',
    statusBarAccountCount: (count: number) => `${count} menu bar account${count === 1 ? '' : 's'}`,
    noStatusBarAccounts: 'No account selected for the menu bar.',
    statusBarDisplayAccounts: 'Menu bar accounts',
    maxFiveAccounts: 'Up to 5 accounts',
    visible: 'Shown',
    hidden: 'Hidden',
    accountList: 'Accounts',
    accountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    providerList: 'Providers',
    providerCount: (count: number) => `${count} provider${count === 1 ? '' : 's'}`,
    dragSortHint: 'Drag the left handle to reorder',
    dragSortHandle: 'Drag to reorder',
    tagManager: 'Manage tags',
    hideTagManager: 'Hide tag manager',
    newTagPlaceholder: 'Enter a new tag name',
    createTag: 'Create tag',
    editTag: 'Edit tag',
    renameTag: 'Rename tag',
    deleteTag: 'Delete tag',
    save: 'Save',
    cancel: 'Cancel',
    allTags: 'All',
    untagged: 'Untagged',
    filterByTag: 'Filter by tag',
    tagsForAccount: 'Account tags',
    addTag: 'Add tag',
    removeTag: 'Remove tag',
    noAvailableTags: 'No tags available to add',
    tagSummary: (tagCount: number, linkedAccountCount: number) =>
      `${tagCount} tag${tagCount === 1 ? '' : 's'}, linked to ${linkedAccountCount} account${linkedAccountCount === 1 ? '' : 's'}`,
    taggedAccountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    noTags: 'No tags yet. Create one above first.',
    noAccountsForFilter: 'No accounts match the current filter.',
    deleteTagConfirm: (name: string) =>
      `Delete tag ${name}? It will also be removed from any assigned accounts.`,
    active: 'Active',
    sessionQuota: 'Session',
    weeklyQuota: 'Weekly',
    sessionReset: 'Session resets',
    weeklyReset: 'Weekly resets',
    openCodex: 'Open Codex',
    openCodexIsolated: 'Open isolated Codex',
    openCustomProvider: 'Launch provider',
    switchAccount: 'Switch account',
    refreshQuota: 'Refresh usage',
    refreshAllQuota: 'Refresh all usage',
    refreshQuotaBlocked: (minutes: number) => `No repeat request within ${minutes} min`,
    deleteSaved: 'Delete saved login',
    noSavedAccounts:
      'No saved accounts yet. Import the current login or start a new callback login.',
    providerNamePlaceholder: 'Provider name (optional)',
    providerBaseUrlPlaceholder: 'Provider base URL',
    providerApiKeyPlaceholder: 'Provider API key',
    providerModelPlaceholder: 'Model (default 5.4)',
    providerFastMode: 'Enable Fast Mode',
    createProvider: 'Create provider',
    editProvider: 'Edit provider',
    saveProvider: 'Save provider',
    deleteProvider: 'Delete provider',
    deleteProviderConfirm: (label: string) => `Delete provider ${label}?`,
    providerBadge: 'Custom provider',
    providerEmptyName: 'custom',
    noProviders: 'No custom providers yet.',
    instanceManager: 'Instances',
    instanceManagerHint:
      'Each instance uses its own CODEX_HOME and copies the current .codex on first creation.',
    instanceCount: (count: number) => `${count} instance${count === 1 ? '' : 's'}`,
    defaultInstance: 'Default instance',
    instanceNamePlaceholder: 'Instance name',
    instanceDirPlaceholder: 'Instance directory (optional)',
    instanceArgsPlaceholder: 'Extra launch arguments (optional)',
    instanceBindAccount: 'Bound account',
    instanceUnbound: 'No bound account',
    createInstance: 'Create instance',
    saveInstance: 'Save instance',
    startInstance: 'Start instance',
    stopInstance: 'Stop instance',
    deleteInstance: 'Delete instance',
    deleteInstanceConfirm: (name: string) =>
      `Delete instance ${name}? Its instance directory will also be removed.`,
    instanceDirectory: 'Instance directory',
    instanceStatusRunning: 'Running',
    instanceStatusStopped: 'Stopped',
    instanceInitialized: 'Initialized',
    instanceNeedsInit: 'Initialized on first start',
    defaultInstanceRoot: 'Default instance directory',
    switchLanguage: 'Switch language',
    switchTheme: (current: string) => `Switch theme, current ${current}`,
    openGithub: 'Open GitHub',
    githubPending: 'GitHub link not configured',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking for updates',
    downloadUpdate: (version?: string) => `Download update${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `Open download page${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: 'Restart to install update',
    updateReady: 'Update downloaded and ready to install.',
    updateUpToDate: 'Already up to date.',
    updateAvailableVersion: (version?: string) =>
      version ? `Update v${version} is available.` : 'An update is available.',
    updateDownloadProgress: (progress?: number) => `Downloading ${progress ?? 0}%`,
    updatesUnsupported: 'Automatic updates are not available for this build.',
    updateFailed: 'Update check failed',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    systemTheme: 'System theme',
    portOccupied: (command: string, pid: number) =>
      `Port 1455 is currently in use by ${command} (${pid})`,
    killPortOccupant: 'Kill occupying process',
    killPortOccupantFailed: 'Unable to terminate the process using port 1455',
    emptyStateTitle: 'No accounts yet',
    emptyStateDescription: 'Import the current login or start a callback login.',
    importCurrentHint: 'Import current login',
    importCurrentDetail:
      'Best when this machine is already signed in through Codex and you want to pull it in immediately.',
    callbackLoginHint: 'Start callback login',
    callbackLoginDetail:
      'Best when you want to add another account and let the local callback finish automatically.',
    deviceLoginHint: 'Use device code',
    deviceLoginDetail:
      'Best when you want to approve the login on another browser or device and let Ilovecodex poll automatically.'
  }
} as const

export type LocalizedCopy = (typeof messages)['zh-CN']

export function accountLabel(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.name ?? account.email ?? account.accountId ?? copy.unnamedAccount
}

export function accountEmail(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.email ?? account.name ?? account.accountId ?? copy.unnamedAccount
}

export function providerLabel(
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>,
  copy: Pick<LocalizedCopy, 'providerEmptyName'>
): string {
  return provider.name?.trim() || provider.baseUrl || copy.providerEmptyName
}

export function planLabel(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'Free'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'business':
      return 'Business'
    case 'enterprise':
      return 'Enterprise'
    default:
      return planType || '--'
  }
}

export function planTagClass(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'theme-plan-neutral bg-black/[0.05] text-black/72'
    case 'plus':
      return 'theme-plan-plus bg-emerald-500/12 text-emerald-700'
    case 'pro':
      return 'theme-plan-pro bg-sky-500/12 text-sky-700'
    case 'team':
      return 'theme-plan-team bg-amber-500/14 text-amber-700'
    case 'business':
      return 'theme-plan-business bg-violet-500/14 text-violet-700'
    case 'enterprise':
      return 'theme-plan-enterprise bg-rose-500/14 text-rose-700'
    default:
      return 'theme-plan-neutral bg-black/[0.05] text-black/72'
  }
}

export function loginTone(phase: LoginEvent['phase']): string {
  if (phase === 'success') {
    return 'text-success'
  }

  if (phase === 'error' || phase === 'cancelled') {
    return 'text-danger'
  }

  return 'text-ink'
}

export function accountCardTone(active: boolean): string {
  return active
    ? 'theme-account-card theme-account-card-active border-black/14 bg-black/[0.02]'
    : 'theme-account-card border-black/8 bg-white'
}

export function progressWidth(value?: number | null): string {
  return `${remainingPercent(value)}%`
}

export function limitLabel(limit: AccountRateLimitEntry): string {
  const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()

  if (raw.includes('review')) {
    return 'review'
  }

  if (raw.includes('codex')) {
    return 'codex'
  }

  return limit.limitName ?? limit.limitId ?? 'extra'
}

export function themeIconClass(theme: AppTheme): string {
  switch (theme) {
    case 'dark':
      return 'i-lucide-moon-star'
    case 'system':
      return 'i-lucide-monitor'
    default:
      return 'i-lucide-sun-medium'
  }
}

export function themeTitle(theme: AppTheme, copy: LocalizedCopy): string {
  switch (theme) {
    case 'dark':
      return copy.darkTheme
    case 'system':
      return copy.systemTheme
    default:
      return copy.lightTheme
  }
}

export function nextTheme(theme: AppTheme): AppTheme {
  switch (theme) {
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
    default:
      return 'light'
  }
}

export function extraLimits(
  usageByAccountId: Record<string, AccountRateLimits>,
  accountId: string
): AccountRateLimitEntry[] {
  const rateLimits = usageByAccountId[accountId]
  if (!rateLimits) {
    return []
  }

  return rateLimits.limits.filter((limit) => limit.limitId !== rateLimits.limitId)
}
