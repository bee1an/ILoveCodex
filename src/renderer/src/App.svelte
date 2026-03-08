<script lang="ts">
  import { onMount } from 'svelte'
  import brandMark from './assets/brand-mark.png'

  import type {
    AppLanguage,
    AppMeta,
    AppTheme,
    AccountRateLimitEntry,
    AccountRateLimits,
    AccountSummary,
    AppSnapshot,
    LoginEvent,
    LoginMethod,
    PortOccupant
  } from '../../shared/codex'
  import { formatRelativeReset, remainingPercent, resolveBestAccount } from '../../shared/codex'

  let snapshot: AppSnapshot = {
    accounts: [],
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light'
    },
    usageByAccountId: {}
  }
  let appMeta: AppMeta = {
    version: '--',
    githubUrl: null
  }
  let loginEvent: LoginEvent | null = null
  let loginStarting = false
  let showBrowserLoginDetails = true
  let showDeviceLoginDetails = true
  let refreshingAllUsage = false
  let pageError = ''
  let showSettings = false
  let loginPortOccupant: PortOccupant | null = null
  let killingLoginPortOccupant = false
  let usageByAccountId: Record<string, AccountRateLimits> = {}
  let usageLoadingByAccountId: Record<string, boolean> = {}
  let usageErrorByAccountId: Record<string, string> = {}
  const pollingOptions = [5, 15, 30, 60]
  const languageOptions: Array<{ value: AppLanguage; label: string }> = [
    { value: 'zh-CN', label: '中文' },
    { value: 'en', label: 'English' }
  ]
  const messages = {
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
      accountCount: (count: number) => `${count} 个账号`,
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
      statusBarAccountCount: (count: number) =>
        `${count} menu bar account${count === 1 ? '' : 's'}`,
      noStatusBarAccounts: 'No account selected for the menu bar.',
      statusBarDisplayAccounts: 'Menu bar accounts',
      maxFiveAccounts: 'Up to 5 accounts',
      visible: 'Shown',
      hidden: 'Hidden',
      accountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
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
  const isTrayView =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tray') === '1'
  let prefersDark = false
  const bodyClasses = [
    'm-0',
    'min-h-screen',
    isTrayView ? 'bg-transparent' : 'bg-paper',
    'text-ink',
    'font-ui',
    'antialiased'
  ]

  const heroClass = 'theme-surface rounded-[1rem] border border-black/8 bg-white p-4 sm:p-5'
  const panelClass = 'theme-surface rounded-[1rem] border border-black/8 bg-white p-5'
  const primaryActionButton =
    'inline-flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition-colors duration-140 hover:bg-black/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-48'
  const compactGhostButton =
    'theme-ghost-button inline-flex items-center justify-center rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm font-medium text-ink transition-colors duration-140 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-48'
  const iconToolbarButton =
    'theme-icon-button inline-flex h-8 w-8 appearance-none items-center justify-center border-0 rounded-md bg-transparent p-0 text-ink outline-none shadow-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-48'
  const iconRowButton =
    'theme-row-button inline-flex h-7 w-7 appearance-none items-center justify-center border-0 rounded-md bg-transparent p-0 text-black/68 outline-none shadow-none transition-colors duration-140 hover:bg-black/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-40'
  const dragRegionStyle = '-webkit-app-region: drag; app-region: drag;'

  const copyForLanguage = (): (typeof messages)['zh-CN'] => messages[snapshot.settings.language]
  const resolvedTheme = (theme: AppTheme): 'light' | 'dark' =>
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme

  const applyTheme = (theme: AppTheme): void => {
    if (typeof document === 'undefined') {
      return
    }

    const nextTheme = resolvedTheme(theme)
    document.documentElement.dataset.theme = nextTheme
    document.documentElement.style.colorScheme = nextTheme
  }

  const refreshSnapshot = async (): Promise<void> => {
    applySnapshot(await window.codexApp.getSnapshot())
  }

  const hasLoginPortConflict = (): boolean => {
    const message = `${pageError}\n${loginEvent?.message ?? ''}`.toLowerCase()
    return message.includes('1455') && (message.includes('占用') || message.includes('in use'))
  }

  const refreshLoginPortOccupant = async (): Promise<void> => {
    loginPortOccupant = await window.codexApp.getLoginPortOccupant()
  }

  const loginActionBusy = (): boolean => loginStarting || killingLoginPortOccupant

  const themeIconClass = (theme: AppTheme): string => {
    switch (theme) {
      case 'dark':
        return 'i-lucide-moon-star'
      case 'system':
        return 'i-lucide-monitor'
      default:
        return 'i-lucide-sun-medium'
    }
  }

  const themeTitle = (theme: AppTheme): string => {
    const copy = copyForLanguage()

    switch (theme) {
      case 'dark':
        return copy.darkTheme
      case 'system':
        return copy.systemTheme
      default:
        return copy.lightTheme
    }
  }

  const nextTheme = (theme: AppTheme): AppTheme => {
    switch (theme) {
      case 'light':
        return 'dark'
      case 'dark':
        return 'system'
      default:
        return 'light'
    }
  }

  const refreshAppMeta = async (): Promise<void> => {
    appMeta = await window.codexApp.getAppMeta()
  }

  const accountLabel = (account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>): string =>
    account.name ?? account.email ?? account.accountId ?? copyForLanguage().unnamedAccount

  const accountEmail = (account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>): string =>
    account.email ?? account.name ?? account.accountId ?? copyForLanguage().unnamedAccount

  const planLabel = (planType?: string | null): string => {
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

  const planTagClass = (planType?: string | null): string => {
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

  const loginTone = (phase: LoginEvent['phase']): string => {
    if (phase === 'success') {
      return 'text-success'
    }

    if (phase === 'error' || phase === 'cancelled') {
      return 'text-danger'
    }

    return 'text-ink'
  }

  const accountCardTone = (active: boolean): string =>
    active
      ? 'theme-account-card theme-account-card-active border-black/14 bg-black/[0.02]'
      : 'theme-account-card border-black/8 bg-white'

  const progressWidth = (value?: number | null): string => `${remainingPercent(value)}%`

  const statusBarAccounts = (): AccountSummary[] => {
    const selectedIds = snapshot.settings.statusBarAccountIds
      .map((accountId) => snapshot.accounts.find((account) => account.id === accountId))
      .filter((account): account is AccountSummary => Boolean(account))
      .slice(0, 5)

    if (selectedIds.length) {
      return selectedIds
    }

    if (snapshot.activeAccountId) {
      const activeAccount = snapshot.accounts.find(
        (account) => account.id === snapshot.activeAccountId
      )
      if (activeAccount) {
        return [activeAccount]
      }
    }

    return snapshot.accounts.slice(0, 1)
  }

  const bestAccount = (): AccountSummary | null =>
    resolveBestAccount(snapshot.accounts, usageByAccountId, snapshot.activeAccountId)

  const canAutoPollUsage = (accountId: string): boolean => {
    if (usageErrorByAccountId[accountId]) {
      return true
    }

    const fetchedAt = usageByAccountId[accountId]?.fetchedAt
    if (!fetchedAt) {
      return true
    }

    const elapsedMs = Date.now() - Date.parse(fetchedAt)
    if (Number.isNaN(elapsedMs)) {
      return true
    }

    return elapsedMs >= snapshot.settings.usagePollingMinutes * 60 * 1000
  }

  const extraLimits = (accountId: string): AccountRateLimitEntry[] => {
    const rateLimits = usageByAccountId[accountId]
    if (!rateLimits) {
      return []
    }

    return rateLimits.limits.filter((limit) => limit.limitId !== rateLimits.limitId)
  }

  const limitLabel = (limit: AccountRateLimitEntry): string => {
    const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()

    if (raw.includes('review')) {
      return 'review'
    }

    if (raw.includes('codex')) {
      return 'codex'
    }

    return limit.limitName ?? limit.limitId ?? 'extra'
  }

  const syncUsageState = (accounts: AccountSummary[]): void => {
    const accountIds = new Set(accounts.map((account) => account.id))
    usageByAccountId = Object.fromEntries(
      Object.entries(usageByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
    usageLoadingByAccountId = Object.fromEntries(
      Object.entries(usageLoadingByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
    usageErrorByAccountId = Object.fromEntries(
      Object.entries(usageErrorByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
  }

  const applySnapshot = (nextSnapshot: AppSnapshot): void => {
    snapshot = nextSnapshot
    applyTheme(nextSnapshot.settings.theme)
    usageByAccountId = {
      ...nextSnapshot.usageByAccountId
    }
    syncUsageState(nextSnapshot.accounts)
    void ensureUsageLoaded(nextSnapshot.accounts)
  }

  const clearUsageError = (accountId: string): void => {
    const nextState = { ...usageErrorByAccountId }
    delete nextState[accountId]
    usageErrorByAccountId = nextState
  }

  const clearUsageLoading = (accountId: string): void => {
    const nextState = { ...usageLoadingByAccountId }
    delete nextState[accountId]
    usageLoadingByAccountId = nextState
  }

  const runAction = async (_key: string, task: () => Promise<AppSnapshot>): Promise<void> => {
    pageError = ''

    try {
      applySnapshot(await task())
    } catch (error) {
      pageError = error instanceof Error ? error.message : copyForLanguage().actionFailed
    }
  }

  const startLogin = async (method: LoginMethod): Promise<void> => {
    if (
      method === 'browser' &&
      loginEvent?.method === 'browser' &&
      loginEvent.phase === 'waiting'
    ) {
      showBrowserLoginDetails = !showBrowserLoginDetails
      return
    }

    if (method === 'device' && loginEvent?.method === 'device' && loginEvent.phase === 'waiting') {
      showDeviceLoginDetails = !showDeviceLoginDetails
      return
    }

    pageError = ''
    loginEvent = null
    loginPortOccupant = null
    loginStarting = true

    if (method === 'device') {
      showDeviceLoginDetails = true
    }

    if (method === 'browser') {
      showBrowserLoginDetails = true
    }

    try {
      await window.codexApp.startLogin(method)
      applySnapshot(await window.codexApp.getSnapshot())
    } catch (error) {
      loginStarting = false
      pageError = error instanceof Error ? error.message : copyForLanguage().startLoginFailed
      if (hasLoginPortConflict()) {
        await refreshLoginPortOccupant()
      }
    }
  }

  const killLoginPortOccupant = async (): Promise<void> => {
    pageError = ''
    killingLoginPortOccupant = true

    try {
      loginPortOccupant = await window.codexApp.killLoginPortOccupant()
      await refreshLoginPortOccupant()
    } catch (error) {
      pageError = error instanceof Error ? error.message : copyForLanguage().killPortOccupantFailed
    } finally {
      killingLoginPortOccupant = false
    }
  }

  const removeAccount = async (account: AccountSummary): Promise<void> => {
    if (!window.confirm(copyForLanguage().removeConfirm(accountLabel(account)))) {
      return
    }

    await runAction(`remove:${account.id}`, () => window.codexApp.removeAccount(account.id))
  }

  const copyText = async (value?: string): Promise<void> => {
    if (!value) {
      return
    }

    await navigator.clipboard.writeText(value)
  }

  const copyAuthUrl = async (): Promise<void> => {
    await copyText(loginEvent?.verificationUrl ?? loginEvent?.authUrl)
  }

  const copyDeviceCode = async (): Promise<void> => {
    await copyText(loginEvent?.userCode)
  }

  const openExternalLink = (url?: string): void => {
    if (!url) {
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const readRateLimits = async (
    account: AccountSummary,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    if (usageLoadingByAccountId[account.id] || (!options.force && !canAutoPollUsage(account.id))) {
      return
    }

    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const rateLimits = await window.codexApp.readAccountRateLimits(account.id)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: rateLimits
      }
      snapshot = {
        ...snapshot,
        usageByAccountId: {
          ...snapshot.usageByAccountId,
          [account.id]: rateLimits
        }
      }
    } catch (error) {
      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: error instanceof Error ? error.message : copyForLanguage().readRateLimitFailed
      }
    } finally {
      clearUsageLoading(account.id)
    }
  }

  const ensureUsageLoaded = async (accounts: AccountSummary[]): Promise<void> => {
    for (const account of accounts) {
      if (
        usageLoadingByAccountId[account.id] ||
        (usageByAccountId[account.id] && !canAutoPollUsage(account.id))
      ) {
        continue
      }

      await readRateLimits(account)
    }
  }

  const updatePollingInterval = async (minutes: number): Promise<void> => {
    await runAction('settings:usage-polling', () =>
      window.codexApp.updateSettings({ usagePollingMinutes: minutes })
    )
  }

  const updateLanguage = async (language: AppLanguage): Promise<void> => {
    if (snapshot.settings.language === language) {
      return
    }

    await runAction('settings:language', () => window.codexApp.updateSettings({ language }))
  }

  const updateTheme = async (theme: AppTheme): Promise<void> => {
    if (snapshot.settings.theme === theme) {
      return
    }

    applyTheme(theme)
    await runAction('settings:theme', () => window.codexApp.updateSettings({ theme }))
  }

  const toggleStatusAccount = async (accountId: string): Promise<void> => {
    const nextIds = snapshot.settings.statusBarAccountIds.includes(accountId)
      ? snapshot.settings.statusBarAccountIds.filter((id) => id !== accountId)
      : [...snapshot.settings.statusBarAccountIds, accountId].slice(0, 5)

    await runAction('settings:status-accounts', () =>
      window.codexApp.updateSettings({ statusBarAccountIds: nextIds })
    )
  }

  const openMainPanel = async (): Promise<void> => {
    applySnapshot(await window.codexApp.openMainWindow())
  }

  const activateBestAccount = async (): Promise<void> => {
    await runAction('activate:best', () => window.codexApp.activateBestAccount())
  }

  const refreshAllRateLimits = async (): Promise<void> => {
    if (!snapshot.accounts.length || refreshingAllUsage) {
      return
    }

    refreshingAllUsage = true

    try {
      for (const account of snapshot.accounts) {
        await readRateLimits(account, { force: true })
      }
    } finally {
      refreshingAllUsage = false
    }
  }

  onMount(() => {
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
    prefersDark = darkMedia.matches
    document.body.classList.add(...bodyClasses)
    applyTheme(snapshot.settings.theme)
    void refreshSnapshot()
    void refreshAppMeta()

    const handleThemeChange = (event: MediaQueryListEvent): void => {
      prefersDark = event.matches
      applyTheme(snapshot.settings.theme)
    }

    darkMedia.addEventListener('change', handleThemeChange)

    const disposeSnapshot = window.codexApp.onSnapshotUpdated((nextSnapshot) => {
      applySnapshot(nextSnapshot)
    })

    const disposeLogin = window.codexApp.onLoginEvent((event) => {
      loginEvent = event
      loginStarting = event.phase === 'starting'

      if (event.method === 'browser' && event.phase === 'waiting') {
        showBrowserLoginDetails = true
      }

      if (event.method === 'device' && event.phase === 'waiting') {
        showDeviceLoginDetails = true
      }

      if (event.method === 'device' && event.phase === 'success') {
        showDeviceLoginDetails = false
      }

      if (event.snapshot) {
        applySnapshot(event.snapshot)
        return
      }

      if (event.phase === 'error' && hasLoginPortConflict()) {
        void refreshLoginPortOccupant()
      }

      void refreshSnapshot()
    })

    return () => {
      document.body.classList.remove(...bodyClasses)
      delete document.documentElement.dataset.theme
      document.documentElement.style.removeProperty('color-scheme')
      darkMedia.removeEventListener('change', handleThemeChange)
      disposeSnapshot()
      disposeLogin()
    }
  })
</script>

<svelte:head>
  <title>Ilovecodex</title>
</svelte:head>

<div class={`app-shell ${isTrayView ? 'min-h-screen' : 'h-screen overflow-hidden'} flex flex-col`}>
  {#if !isTrayView}
    <div class="h-7 w-full select-none sm:h-8" style={dragRegionStyle} aria-hidden="true"></div>
  {/if}

  <div
    class={`mx-auto ${isTrayView ? 'grid gap-4 max-w-[420px] px-3 pb-3 pt-2' : 'flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-8'}`}
  >
    {#if isTrayView}
      <section
        class="theme-tray-panel grid gap-3 overflow-hidden rounded-[1.05rem] border border-black/[0.08] bg-white/66 p-3.5 backdrop-blur-2xl"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <img
              src={brandMark}
              alt=""
              class="h-9 w-9 flex-none rounded-[0.95rem] border border-black/[0.05] shadow-[0_10px_24px_rgba(24,24,27,0.08)]"
            />
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">Ilovecodex</p>
              <p class="text-xs text-faint">
                {copyForLanguage().statusBarAccountCount(statusBarAccounts().length)}
              </p>
            </div>
          </div>
          <button class={compactGhostButton} on:click={openMainPanel}>
            {copyForLanguage().openMainPanel}
          </button>
        </div>

        {#if pageError}
          <div
            class="theme-error-panel rounded-xl border border-danger/18 px-3 py-2.5 text-sm text-danger"
          >
            {pageError}
          </div>
        {/if}

        <div class="grid gap-2">
          {#if statusBarAccounts().length}
            {#each statusBarAccounts() as account (account.id)}
              <article class="theme-soft-panel grid gap-2 rounded-xl bg-black/[0.035] px-3 py-2.5">
                <div class="flex items-center gap-2">
                  <span
                    class={`h-2 w-2 flex-none rounded-full ${snapshot.activeAccountId === account.id ? 'bg-success' : 'theme-status-idle bg-black/14'}`}
                  ></span>
                  <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {accountEmail(account)}
                  </p>
                  <span
                    class={`inline-flex flex-none items-center rounded-full px-2 py-0.75 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
                  >
                    {planLabel(usageByAccountId[account.id]?.planType)}
                  </span>
                </div>

                <div class="grid gap-1.5">
                  <div class="flex items-center gap-2">
                    <span class="w-12 text-[10px] font-semibold tracking-[0.08em] text-muted">
                      {copyForLanguage().sessionQuota}
                    </span>
                    <div
                      class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                    >
                      <div
                        class="theme-progress-fill h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                      ></div>
                    </div>
                    <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                      {usageByAccountId[account.id]?.primary
                        ? `${remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%`
                        : '--'}
                    </span>
                  </div>

                  <div class="flex items-center gap-2">
                    <span class="w-12 text-[10px] font-semibold tracking-[0.08em] text-muted">
                      {copyForLanguage().weeklyQuota}
                    </span>
                    <div
                      class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                    >
                      <div
                        class="theme-progress-fill h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                      ></div>
                    </div>
                    <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                      {usageByAccountId[account.id]?.secondary
                        ? `${remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%`
                        : '--'}
                    </span>
                  </div>
                </div>
              </article>
            {/each}
          {:else}
            <div
              class="theme-soft-panel rounded-xl bg-black/[0.03] px-3 py-3 text-sm text-muted-strong"
            >
              {copyForLanguage().noStatusBarAccounts}
            </div>
          {/if}
        </div>

        <div class="grid gap-2 border-t border-black/6 pt-3">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-muted-strong">{copyForLanguage().statusBarDisplayAccounts}</p>
            <p class="text-xs text-faint">{copyForLanguage().maxFiveAccounts}</p>
          </div>

          <div class="grid gap-1">
            {#each snapshot.accounts as account (account.id)}
              <button
                class={`theme-menu-choice flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 ${snapshot.settings.statusBarAccountIds.includes(account.id) ? 'theme-menu-choice-active bg-black/[0.05]' : 'bg-transparent hover:bg-black/[0.03]'}`}
                on:click={() => toggleStatusAccount(account.id)}
                disabled={!snapshot.settings.statusBarAccountIds.includes(account.id) &&
                  snapshot.settings.statusBarAccountIds.length >= 5}
              >
                <span class="min-w-0 flex-1 truncate text-sm text-muted-strong">
                  {accountEmail(account)}
                </span>
                <span class="text-xs text-faint">
                  {snapshot.settings.statusBarAccountIds.includes(account.id)
                    ? copyForLanguage().visible
                    : copyForLanguage().hidden}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-black/6 pt-3">
          <span class="text-xs text-muted-strong">{copyForLanguage().pollingInterval}</span>
          <select
            class="theme-select h-8 rounded-md border border-black/8 bg-white/88 px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
            value={snapshot.settings.usagePollingMinutes}
            on:change={(event) =>
              updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
          >
            {#each pollingOptions as option (option)}
              <option value={option}>{option} {copyForLanguage().minutes}</option>
            {/each}
          </select>
        </div>
      </section>
    {:else}
      <section class={heroClass}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3.5">
            <img
              src={brandMark}
              alt=""
              class="h-12 w-12 flex-none rounded-[1.15rem] border border-black/[0.05] shadow-[0_16px_36px_rgba(24,24,27,0.1)]"
            />
            <div class="min-w-0">
              <p class="text-[11px] font-medium uppercase tracking-[0.18em] text-faint">
                Ilovecodex
              </p>
              {#if loginEvent}
                <p class={`truncate text-sm ${loginTone(loginEvent.phase)}`} aria-live="polite">
                  {loginEvent.message}
                </p>
              {/if}
            </div>
          </div>

          <div
            class="theme-toolbar inline-flex min-w-[140px] items-center gap-0.5 rounded-lg bg-black/[0.03] p-1"
          >
            <button
              class={iconToolbarButton}
              on:click={() => startLogin('browser')}
              aria-label={copyForLanguage().browserLogin}
              title={copyForLanguage().browserLogin}
            >
              <span
                class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
              ></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => startLogin('device')}
              aria-label={copyForLanguage().deviceLogin}
              title={copyForLanguage().deviceLogin}
            >
              <span class="i-lucide-key-round h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => runAction('import', () => window.codexApp.importCurrentAccount())}
              disabled={loginActionBusy()}
              aria-label={copyForLanguage().importCurrent}
              title={copyForLanguage().importCurrent}
            >
              <span class="i-lucide-plus h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={refreshAllRateLimits}
              disabled={loginActionBusy() || refreshingAllUsage || !snapshot.accounts.length}
              aria-label={copyForLanguage().refreshAllQuota}
              title={copyForLanguage().refreshAllQuota}
            >
              <span
                class={`${refreshingAllUsage ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-4.5 w-4.5`}
              ></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={activateBestAccount}
              disabled={loginActionBusy() || !bestAccount() || bestAccount()?.id === snapshot.activeAccountId}
              aria-label={copyForLanguage().switchBest}
              title={bestAccount()
                ? bestAccount()?.id === snapshot.activeAccountId
                  ? copyForLanguage().alreadyBest
                  : copyForLanguage().switchToAccount(accountEmail(bestAccount()!))
                : copyForLanguage().noBestAccount}
            >
              <span class="i-lucide-sparkles h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => {
                showSettings = !showSettings
              }}
              aria-label={copyForLanguage().settings}
              title={copyForLanguage().settings}
            >
              <span class="i-lucide-settings-2 h-4.5 w-4.5"></span>
            </button>
          </div>
        </div>

        {#if showSettings}
          <div class="mt-3 flex items-center gap-3 border-t border-black/6 pt-3">
            <span class="text-xs text-muted-strong">{copyForLanguage().pollingInterval}</span>
            <select
              class="theme-select h-8 rounded-md border border-black/8 bg-white px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
              value={snapshot.settings.usagePollingMinutes}
              on:change={(event) =>
                updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
            >
              {#each pollingOptions as option (option)}
                <option value={option}>{option} {copyForLanguage().minutes}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if (showBrowserLoginDetails && loginEvent?.method === 'browser' && (loginEvent?.authUrl || loginEvent?.localCallbackUrl)) || (showDeviceLoginDetails && loginEvent?.method === 'device' && (loginEvent?.verificationUrl || loginEvent?.userCode)) || (loginEvent?.phase === 'error' && loginEvent?.rawOutput)}
          <div class="mt-3 grid gap-2 border-t border-black/6 pt-3">
            {#if showBrowserLoginDetails && loginEvent.method === 'browser' && loginEvent.authUrl}
              <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
                <p class="text-sm text-muted-strong">{copyForLanguage().browserLoginLink}</p>
                <code
                  class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
                >
                  {loginEvent.authUrl}
                </code>
                <div class="flex flex-wrap items-center gap-2">
                  <button class={compactGhostButton} on:click={copyAuthUrl}>
                    {copyForLanguage().copyLink}
                  </button>
                  <button
                    class={compactGhostButton}
                    on:click={() => openExternalLink(loginEvent.authUrl)}
                  >
                    {copyForLanguage().openBrowser}
                  </button>
                </div>
              </div>
            {/if}

            {#if showBrowserLoginDetails && loginEvent.method === 'browser' && loginEvent.localCallbackUrl}
              <p class="text-sm text-muted-strong">{copyForLanguage().waitingCallback}</p>
            {/if}

            {#if showDeviceLoginDetails && loginEvent.method === 'device' && loginEvent.verificationUrl}
              <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
                <p class="text-sm text-muted-strong">{copyForLanguage().deviceLoginLink}</p>
                <code
                  class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
                >
                  {loginEvent.verificationUrl}
                </code>
                {#if loginEvent.userCode}
                  <div class="grid gap-1">
                    <p class="text-sm text-muted-strong">{copyForLanguage().deviceCode}</p>
                    <code
                      class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm font-semibold tracking-[0.18em] text-black"
                    >
                      {loginEvent.userCode}
                    </code>
                  </div>
                {/if}
                <div class="flex flex-wrap items-center gap-2">
                  <button class={compactGhostButton} on:click={copyAuthUrl}>
                    {copyForLanguage().copyLink}
                  </button>
                  {#if loginEvent.userCode}
                    <button class={compactGhostButton} on:click={copyDeviceCode}>
                      {copyForLanguage().copyCode}
                    </button>
                  {/if}
                  <button
                    class={compactGhostButton}
                    on:click={() => openExternalLink(loginEvent.verificationUrl)}
                  >
                    {copyForLanguage().openBrowser}
                  </button>
                </div>
              </div>
            {/if}

            {#if showDeviceLoginDetails && loginEvent.method === 'device' && loginEvent.userCode}
              <p class="text-sm text-muted-strong">{copyForLanguage().waitingDeviceCode}</p>
            {/if}

            {#if loginEvent.phase === 'error' && loginEvent.rawOutput}
              <pre
                class="theme-code-surface m-0 max-h-60 overflow-auto rounded-lg border border-black/8 bg-[#111111] p-4 font-mono text-sm leading-6 text-[#f5f5f5]">{loginEvent.rawOutput}</pre>
            {/if}
          </div>
        {/if}
      </section>

      {#if pageError}
        <section
          class="theme-surface theme-error-panel rounded-[1rem] border border-danger/18 bg-white px-4 py-4 text-base text-danger"
        >
          <div class="grid gap-2">
            <p>{pageError}</p>
            {#if loginPortOccupant && hasLoginPortConflict()}
              <div class="flex flex-wrap items-center gap-2 text-sm text-danger">
                <span>
                  {copyForLanguage().portOccupied(loginPortOccupant.command, loginPortOccupant.pid)}
                </span>
                <button
                  class={compactGhostButton}
                  on:click={killLoginPortOccupant}
                  disabled={killingLoginPortOccupant}
                >
                  {copyForLanguage().killPortOccupant}
                </button>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <section class={`${panelClass} flex min-h-0 flex-1 flex-col gap-4 overflow-hidden`}>
        <div class="text-sm text-faint">
          {copyForLanguage().accountCount(snapshot.accounts.length)}
        </div>

        {#if snapshot.accounts.length}
          <div class="grid min-h-0 gap-2 overflow-y-auto pr-1">
            {#each snapshot.accounts as account (account.id)}
              <article
                class={`grid items-center gap-3 rounded-[0.875rem] border px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)_auto] ${accountCardTone(snapshot.activeAccountId === account.id)}`}
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span
                    class={`h-2 w-2 flex-none rounded-full ${snapshot.activeAccountId === account.id ? 'theme-status-active bg-success ring-3 ring-emerald-500/12' : 'theme-status-idle bg-black/14'}`}
                  ></span>
                  <p class="truncate text-sm font-medium">{accountEmail(account)}</p>
                  {#if snapshot.activeAccountId === account.id}
                    <span
                      class="theme-active-pill inline-flex flex-none items-center rounded-full bg-black px-2 py-0.75 text-[10px] font-medium text-white/88"
                    >
                      {copyForLanguage().active}
                    </span>
                  {/if}
                  <span
                    class={`inline-flex flex-none items-center rounded-full px-2 py-0.75 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
                  >
                    {planLabel(usageByAccountId[account.id]?.planType)}
                  </span>
                </div>

                <div class="theme-soft-panel grid gap-1.5 rounded-md bg-black/[0.03] px-2.5 py-2">
                  <div class="grid grid-cols-2 gap-2">
                    <div class="flex items-center gap-2">
                      <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-muted">
                        {copyForLanguage().sessionQuota}
                      </span>
                      <div
                        class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                      >
                        <div
                          class="theme-progress-fill h-full rounded-full bg-black/70"
                          style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                        ></div>
                      </div>
                      {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                        <span class="w-9 text-right text-[11px] text-faint">…</span>
                      {:else if usageByAccountId[account.id]?.primary}
                        <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                          {remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%
                        </span>
                      {:else}
                        <span class="w-9 text-right text-[11px] text-faint">-</span>
                      {/if}
                    </div>

                    <div class="flex items-center gap-2">
                      <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-muted">
                        {copyForLanguage().weeklyQuota}
                      </span>
                      <div
                        class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                      >
                        <div
                          class="theme-progress-fill h-full rounded-full bg-black/70"
                          style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                        ></div>
                      </div>
                      {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                        <span class="w-9 text-right text-[11px] text-faint">…</span>
                      {:else if usageByAccountId[account.id]?.secondary}
                        <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                          {remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%
                        </span>
                      {:else}
                        <span class="w-9 text-right text-[11px] text-faint">-</span>
                      {/if}
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-[10px] text-faint">
                    <div class="truncate">
                      {copyForLanguage().sessionReset} · {formatRelativeReset(
                        usageByAccountId[account.id]?.primary?.resetsAt,
                        snapshot.settings.language
                      )}
                    </div>
                    <div class="truncate">
                      {copyForLanguage().weeklyReset} · {formatRelativeReset(
                        usageByAccountId[account.id]?.secondary?.resetsAt,
                        snapshot.settings.language
                      )}
                    </div>
                  </div>
                </div>

                {#if extraLimits(account.id).length}
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-strong">
                    {#each extraLimits(account.id) as limit (`${account.id}:${limit.limitId ?? 'extra'}`)}
                      <div
                        class="theme-soft-panel inline-flex items-center gap-1.5 rounded-md bg-black/[0.03] px-2 py-1"
                      >
                        <span class="font-medium uppercase tracking-[0.08em]">
                          {limitLabel(limit)}
                        </span>
                        {#if limit.primary}
                          <span>h {remainingPercent(limit.primary.usedPercent)}%</span>
                        {/if}
                        {#if limit.secondary}
                          <span>w {remainingPercent(limit.secondary.usedPercent)}%</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="flex items-center justify-end gap-1">
                  <button
                    class={iconRowButton}
                    on:click={() =>
                      runAction(`open:${account.id}`, () =>
                        window.codexApp.openAccountInCodex(account.id)
                      )}
                    disabled={loginActionBusy()}
                    aria-label={`${copyForLanguage().openCodex} · ${accountEmail(account)}`}
                    title={copyForLanguage().openCodex}
                  >
                    <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() =>
                      runAction(`activate:${account.id}`, () =>
                        window.codexApp.activateAccount(account.id)
                      )}
                    disabled={loginActionBusy() || snapshot.activeAccountId === account.id}
                    aria-label={`${copyForLanguage().switchAccount} · ${accountEmail(account)}`}
                    title={copyForLanguage().switchAccount}
                  >
                    <span class="i-lucide-repeat-2 h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() => readRateLimits(account, { force: true })}
                    disabled={loginActionBusy() || usageLoadingByAccountId[account.id]}
                    aria-label={`${copyForLanguage().refreshQuota} · ${accountEmail(account)}`}
                    title={copyForLanguage().refreshQuota}
                  >
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() => removeAccount(account)}
                    disabled={loginActionBusy()}
                    aria-label={`${copyForLanguage().deleteSaved} · ${accountEmail(account)}`}
                    title={copyForLanguage().deleteSaved}
                  >
                    <span class="i-lucide-trash-2 h-4 w-4"></span>
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div class="w-full max-w-xl px-4 py-8 text-center">
              <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
                <span class="i-lucide-wallet-minimal h-6 w-6 text-black/72"></span>
              </div>

              <div class="mx-auto grid max-w-xl gap-2">
                <h3 class="text-lg font-semibold text-ink sm:text-xl">
                  {copyForLanguage().emptyStateTitle}
                </h3>
                <p class="text-sm leading-6 text-muted-strong">
                  {copyForLanguage().emptyStateDescription}
                </p>
              </div>

              <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  class={primaryActionButton}
                  on:click={() => startLogin('browser')}
                  disabled={loginActionBusy()}
                >
                  <span
                    class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
                  ></span>
                  <span>{copyForLanguage().browserLogin}</span>
                </button>

                <button
                  class={`${compactGhostButton} px-4 py-3`}
                  on:click={() => startLogin('device')}
                >
                  <span class="i-lucide-key-round h-4.5 w-4.5"></span>
                  <span>{copyForLanguage().deviceLogin}</span>
                </button>

                <button
                  class={`${compactGhostButton} px-4 py-3`}
                  on:click={() => runAction('import', () => window.codexApp.importCurrentAccount())}
                  disabled={loginActionBusy()}
                >
                  <span class="i-lucide-plus h-4.5 w-4.5"></span>
                  <span>{copyForLanguage().importCurrent}</span>
                </button>
              </div>
            </div>
          </div>
        {/if}
      </section>

      <section class="theme-surface rounded-[1rem] border border-black/8 bg-white px-3 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 text-sm text-faint">
            <span
              class="theme-version-pill rounded-full bg-black/[0.04] px-2 py-1 text-[11px] text-black/62"
            >
              v{appMeta.version}
            </span>
          </div>

          <div
            class="theme-toolbar inline-flex items-center gap-0.5 rounded-lg bg-black/[0.03] p-1"
          >
            <div class="relative">
              <span
                class="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-languages"
              ></span>
              <select
                class="theme-select h-8 appearance-none rounded-md border-0 bg-transparent py-0 pl-8 pr-7 text-sm text-ink outline-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                aria-label={copyForLanguage().switchLanguage}
                value={snapshot.settings.language}
                on:change={(event) =>
                  updateLanguage((event.currentTarget as HTMLSelectElement).value as AppLanguage)}
              >
                {#each languageOptions as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
              <span
                class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-chevron-down"
              ></span>
            </div>

            <button
              class={iconToolbarButton}
              on:click={() => updateTheme(nextTheme(snapshot.settings.theme))}
              aria-label={copyForLanguage().switchTheme(themeTitle(snapshot.settings.theme))}
              title={copyForLanguage().switchTheme(themeTitle(snapshot.settings.theme))}
            >
              <span class={`${themeIconClass(snapshot.settings.theme)} h-4.5 w-4.5`}></span>
            </button>

            <button
              class={iconToolbarButton}
              on:click={() => openExternalLink(appMeta.githubUrl ?? undefined)}
              disabled={!appMeta.githubUrl}
              aria-label="GitHub"
              title={appMeta.githubUrl
                ? copyForLanguage().openGithub
                : copyForLanguage().githubPending}
            >
              <span class="i-lucide-github h-4.5 w-4.5"></span>
            </button>
          </div>
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .text-muted {
    color: var(--ink-soft);
  }

  .text-muted-strong {
    color: var(--ink-soft-strong);
  }

  .text-faint {
    color: var(--ink-faint);
  }

  .border-soft {
    border-color: var(--line);
  }

  :global(html[data-theme='dark']) .theme-surface {
    border-color: var(--line-strong) !important;
    background: var(--panel-strong) !important;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 18px 44px color-mix(in srgb, var(--paper-shadow) 55%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-tray-panel {
    border-color: var(--line-strong) !important;
    background: var(--panel) !important;
    box-shadow: 0 18px 48px var(--paper-shadow) !important;
  }

  :global(html[data-theme='dark']) .theme-soft-panel,
  :global(html[data-theme='dark']) .theme-toolbar,
  :global(html[data-theme='dark']) .theme-version-pill,
  :global(html[data-theme='dark']) .theme-plan-neutral,
  :global(html[data-theme='dark']) .theme-menu-choice-active {
    background: var(--surface-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-soft-panel {
    border-color: color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-version-pill,
  :global(html[data-theme='dark']) .theme-plan-neutral {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-plan-plus {
    background: rgb(16 185 129 / 0.18) !important;
    color: rgb(110 231 183) !important;
  }

  :global(html[data-theme='dark']) .theme-plan-pro {
    background: rgb(14 165 233 / 0.18) !important;
    color: rgb(125 211 252) !important;
  }

  :global(html[data-theme='dark']) .theme-plan-team {
    background: rgb(245 158 11 / 0.18) !important;
    color: rgb(253 224 71) !important;
  }

  :global(html[data-theme='dark']) .theme-plan-business {
    background: rgb(139 92 246 / 0.2) !important;
    color: rgb(196 181 253) !important;
  }

  :global(html[data-theme='dark']) .theme-plan-enterprise {
    background: rgb(244 63 94 / 0.18) !important;
    color: rgb(253 164 175) !important;
  }

  :global(html[data-theme='dark']) .theme-ghost-button,
  :global(html[data-theme='dark']) .theme-icon-button,
  :global(html[data-theme='dark']) .theme-row-button,
  :global(html[data-theme='dark']) .theme-menu-choice,
  :global(html[data-theme='dark']) .theme-select {
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-ghost-button:hover,
  :global(html[data-theme='dark']) .theme-icon-button:hover,
  :global(html[data-theme='dark']) .theme-row-button:hover,
  :global(html[data-theme='dark']) .theme-menu-choice:hover,
  :global(html[data-theme='dark']) .theme-select:hover {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark']) .theme-ghost-button:focus-visible,
  :global(html[data-theme='dark']) .theme-icon-button:focus-visible,
  :global(html[data-theme='dark']) .theme-row-button:focus-visible,
  :global(html[data-theme='dark']) .theme-menu-choice:focus-visible,
  :global(html[data-theme='dark']) .theme-select:focus-visible {
    box-shadow: 0 0 0 2px var(--ring) !important;
  }

  :global(html[data-theme='dark']) .theme-select {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark']) .theme-select option {
    color: var(--ink);
    background: var(--panel-strong);
  }

  :global(html[data-theme='dark']) .theme-inline-code {
    background: var(--panel-strong) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-code-surface {
    border-color: var(--line) !important;
    background: var(--code-bg) !important;
    color: var(--code-ink) !important;
  }

  :global(html[data-theme='dark']) .theme-error-panel {
    border-color: color-mix(in srgb, var(--danger) 22%, transparent) !important;
    background: color-mix(in srgb, var(--danger) 6%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark']) .theme-account-card {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark']) .theme-account-card-active {
    border-color: var(--line-strong) !important;
    background: color-mix(in srgb, var(--surface-soft) 66%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark']) .theme-progress-track {
    background: var(--progress-track) !important;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--line) 70%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-progress-fill {
    background: var(--progress-fill) !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--progress-fill) 45%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-active-pill {
    background: var(--ink) !important;
    color: var(--paper) !important;
  }

  :global(html[data-theme='dark']) .theme-status-active {
    background: var(--success) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-status-idle {
    background: var(--dot-idle) !important;
  }
</style>
