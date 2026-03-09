import type {
  AppLanguage,
  AppTheme,
  AccountRateLimitEntry,
  AccountRateLimits,
  AccountSummary,
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
    removeConfirm: (label: string) => `删除 ${label} 的本地保存登录态？`,
    browserLogin: '浏览器登录',
    deviceLogin: '设备码登录',
    importCurrent: '导入当前登录',
    switchBest: '切换到最优账号',
    alreadyBest: '当前已是最优账号',
    noBestAccount: '暂无可切换账号',
    switchToAccount: (email: string) => `切换到 ${email}`,
    settings: '设置',
    pollingInterval: '额度轮询',
    minutes: '分钟',
    browserLoginLink: '浏览器登录链接',
    deviceLoginLink: '设备验证页面',
    deviceCode: '设备码',
    copyLink: '复制链接',
    copyCode: '复制设备码',
    openBrowser: '打开浏览器',
    openMainPanel: '打开主面板',
    waitingCallback: '等待浏览器完成授权并回调本地地址。',
    waitingDeviceCode: '在浏览器里完成授权后，这里会自动继续。',
    statusBarAccountCount: (count: number) => `${count} 个状态栏账号`,
    noStatusBarAccounts: '还没有可显示的账号。',
    statusBarDisplayAccounts: '状态栏显示账号',
    maxFiveAccounts: '最多 5 个',
    visible: '已显示',
    hidden: '未显示',
    accountList: '账号列表',
    accountCount: (count: number) => `${count} 个账号`,
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
    switchAccount: '切换账号',
    refreshQuota: '刷新额度',
    refreshAllQuota: '刷新全部额度',
    refreshQuotaBlocked: (minutes: number) => `${minutes} 分钟内不重复请求`,
    deleteSaved: '删除保存',
    noSavedAccounts: '还没有保存任何账号。先导入当前登录，或者走一次新的浏览器登录。',
    switchLanguage: '切换语言',
    switchTheme: (current: string) => `切换主题，当前${current}`,
    openGithub: '打开 GitHub',
    githubPending: 'GitHub 链接待配置',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    systemTheme: '跟随系统',
    portOccupied: (command: string, pid: number) => `1455 端口当前被 ${command} (${pid}) 占用`,
    killPortOccupant: '结束占用进程',
    killPortOccupantFailed: '无法结束占用 1455 端口的进程',
    emptyStateTitle: '还没有账号',
    emptyStateDescription: '导入当前登录，或者新建一次浏览器登录。',
    importCurrentHint: '导入当前登录',
    importCurrentDetail: '适合你已经在本机 Codex 里登录过账号的情况。',
    browserLoginHint: '新建浏览器登录',
    browserLoginDetail: '适合补充新账号，或者把别的付费账号接进来。',
    deviceLoginHint: '设备码登录',
    deviceLoginDetail: '适合在别的设备或浏览器里完成授权，再回到这里自动导入。'
  },
  en: {
    unnamedAccount: 'Unnamed account',
    actionFailed: 'Action failed',
    startLoginFailed: 'Unable to start login flow',
    readRateLimitFailed: 'Unable to read account limits',
    removeConfirm: (label: string) => `Remove the saved local session for ${label}?`,
    browserLogin: 'Browser login',
    deviceLogin: 'Device code login',
    importCurrent: 'Import current login',
    switchBest: 'Switch to best account',
    alreadyBest: 'Already using best account',
    noBestAccount: 'No account to switch to',
    switchToAccount: (email: string) => `Switch to ${email}`,
    settings: 'Settings',
    pollingInterval: 'Usage polling',
    minutes: 'min',
    browserLoginLink: 'Browser login URL',
    deviceLoginLink: 'Device verification URL',
    deviceCode: 'Device code',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    openBrowser: 'Open browser',
    openMainPanel: 'Open main panel',
    waitingCallback: 'Waiting for the browser to finish authorization and call back locally.',
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
    switchAccount: 'Switch account',
    refreshQuota: 'Refresh usage',
    refreshAllQuota: 'Refresh all usage',
    refreshQuotaBlocked: (minutes: number) => `No repeat request within ${minutes} min`,
    deleteSaved: 'Delete saved login',
    noSavedAccounts:
      'No saved accounts yet. Import the current login or start a new browser login.',
    switchLanguage: 'Switch language',
    switchTheme: (current: string) => `Switch theme, current ${current}`,
    openGithub: 'Open GitHub',
    githubPending: 'GitHub link not configured',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    systemTheme: 'System theme',
    portOccupied: (command: string, pid: number) =>
      `Port 1455 is currently in use by ${command} (${pid})`,
    killPortOccupant: 'Kill occupying process',
    killPortOccupantFailed: 'Unable to terminate the process using port 1455',
    emptyStateTitle: 'No accounts yet',
    emptyStateDescription: 'Import the current login or start a browser login.',
    importCurrentHint: 'Import current login',
    importCurrentDetail:
      'Best when this machine is already signed in through Codex and you want to pull it in immediately.',
    browserLoginHint: 'Start browser login',
    browserLoginDetail:
      'Best when you want to add another account or connect a different paid workspace.',
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
      return 'theme-plan-neutral bg-black/[0.05] text-black/55'
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
      return 'theme-plan-neutral bg-black/[0.05] text-black/55'
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
