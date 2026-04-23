<script lang="ts">
  import { onMount } from 'svelte'
  import brandMark from './assets/brand-mark.png'
  import AccountsPanel from './components/AccountsPanel.svelte'
  import AppSider from './components/AppSider.svelte'
  import { cascadeIn, reveal } from './components/gsap-motion'
  import HeroPanel from './components/HeroPanel.svelte'
  import TrayPanel from './components/TrayPanel.svelte'
  import WakeDialog from './components/WakeDialog.svelte'
  import {
    accountLabel,
    loginTone,
    messages,
    pollingOptions,
    statusBarAccounts,
    usageErrorKind
  } from './components/app-view'
  import { isValidWakeScheduleTime, normalizeWakeScheduleTimes } from './components/wake-schedule'

  import type {
    AppLanguage,
    AppMeta,
    AppTheme,
    AppUpdateState,
    AccountWakeSchedule,
    AccountTag,
    AccountTransferFormat,
    AccountRateLimits,
    AccountSummary,
    AppSnapshot,
    CustomProviderDetail,
    CreateCustomProviderInput,
    LoginEvent,
    LoginMethod,
    PortOccupant,
    StatsDisplaySettings,
    UpdateAccountWakeScheduleInput,
    WakeAccountRequestResult,
    WakeAccountRateLimitsInput,
    UpdateCustomProviderInput
  } from '../../shared/codex'
  import {
    filterLocalMockAppSnapshot,
    accountTransferFormats,
    defaultStatsDisplaySettings,
    formatRelativeReset,
    normalizeStatsDisplaySettings,
    resolveBestAccount,
    shouldAutoPollUsage,
    supportsWeeklyQuota
  } from '../../shared/codex'

  type WakeDialogStatus = 'idle' | 'running' | 'success' | 'skipped' | 'error'
  type WakeDialogTab = 'session' | 'schedule'

  let snapshot: AppSnapshot = {
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
      showLocalMockData: true,
      statsDisplay: defaultStatsDisplaySettings()
    },
    usageByAccountId: {},
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: []
  }
  let rawSnapshot: AppSnapshot = snapshot
  let appMeta: AppMeta = {
    version: '--',
    githubUrl: null,
    platform: undefined,
    isPackaged: true
  }
  let loginEvent: LoginEvent | null = null
  let loginStarting = false
  let showCallbackLoginDetails = true
  let showDeviceLoginDetails = true
  let showProviderComposer = false
  let refreshingAllUsage = false
  let pageError = ''
  let showSettings = false
  let loginPortOccupant: PortOccupant | null = null
  let killingLoginPortOccupant = false
  let accountActionKey = ''
  let updateState: AppUpdateState = {
    status: 'idle',
    delivery: 'auto',
    currentVersion: '--',
    supported: false
  }
  let usageByAccountId: Record<string, AccountRateLimits> = {}
  let usageLoadingByAccountId: Record<string, boolean> = {}
  let usageErrorByAccountId: Record<string, string> = {}
  let wakingAccountId = ''
  let wakeDialogAccount: AccountSummary | null = null
  let wakeDialogTab: WakeDialogTab = 'session'
  let wakePromptDraft = 'ping'
  let wakeModelDraft = 'gpt-5.4'
  let wakeDialogStatus: WakeDialogStatus = 'idle'
  let wakeDialogLogs: string[] = []
  let wakeRequestResult: WakeAccountRequestResult | null = null
  let wakeRequestError = ''
  let wakeRawResponseBody = ''
  let showExportFormatDialog = false
  let exportDialogBusy = false
  let exportDialogError = ''
  let exportDialogAccountIds: string[] | null = null
  let exportDialogFormat: AccountTransferFormat = 'ilovecodex'
  let wakeScheduleEnabledDraft = true
  let wakeScheduleTimesDraft: string[] = ['09:00']
  let wakeSchedulePromptDraft = 'ping'
  let wakeScheduleModelDraft = 'gpt-5.4'
  let wakeScheduleError = ''
  let wakeScheduleSaving = false
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
  const exportFormatOptionOrder = [...accountTransferFormats]
  const resolvedTheme = (theme: AppTheme): 'light' | 'dark' =>
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme

  const exportFormatLabel = (format: AccountTransferFormat): string => {
    const copy = copyForLanguage()

    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitTools
      case 'sub2api':
        return copy.exportFormatSub2api
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApi
      case 'ilovecodex':
      default:
        return copy.exportFormatIlovecodex
    }
  }

  const exportFormatDescription = (format: AccountTransferFormat): string => {
    const copy = copyForLanguage()

    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitToolsDescription
      case 'sub2api':
        return copy.exportFormatSub2apiDescription
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApiDescription
      case 'ilovecodex':
      default:
        return copy.exportFormatIlovecodexDescription
    }
  }

  const exportDialogScopeLabel = (): string =>
    exportDialogAccountIds?.length
      ? copyForLanguage().exportFormatTargetSelected(exportDialogAccountIds.length)
      : copyForLanguage().exportFormatTargetAll

  const toolbarDialogOpen = (): boolean =>
    showSettings ||
    showProviderComposer ||
    (showCallbackLoginDetails &&
      loginEvent?.method === 'browser' &&
      Boolean(loginEvent?.authUrl || loginEvent?.localCallbackUrl || loginEvent?.rawOutput)) ||
    (showDeviceLoginDetails &&
      loginEvent?.method === 'device' &&
      Boolean(loginEvent?.verificationUrl || loginEvent?.userCode || loginEvent?.rawOutput))

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

  const closeProviderComposer = (): void => {
    showProviderComposer = false
  }

  const closeExpandablePanels = (
    except?: 'provider' | 'settings' | 'browser-login' | 'device-login'
  ): void => {
    if (except !== 'provider') {
      showProviderComposer = false
    }
    if (except !== 'settings') {
      showSettings = false
    }
    if (except !== 'browser-login') {
      showCallbackLoginDetails = false
    }
    if (except !== 'device-login') {
      showDeviceLoginDetails = false
    }
  }

  const hasLoginPortConflict = (): boolean => {
    const message = `${pageError}\n${loginEvent?.message ?? ''}`.toLowerCase()
    return message.includes('1455') && (message.includes('占用') || message.includes('in use'))
  }

  const refreshLoginPortOccupant = async (): Promise<void> => {
    loginPortOccupant = await window.codexApp.getLoginPortOccupant()
  }

  const loginActionBusy = (): boolean => loginStarting || killingLoginPortOccupant

  const refreshAppMeta = async (): Promise<void> => {
    appMeta = await window.codexApp.getAppMeta()
    applySnapshot(rawSnapshot)
  }

  const refreshUpdateState = async (): Promise<void> => {
    updateState = await window.codexApp.getUpdateState()
  }

  const shouldShowCodexDesktopExecutablePath = (): boolean =>
    appMeta.isPackaged === false || appMeta.platform === 'win32'

  const bestAccount = (): AccountSummary | null =>
    resolveBestAccount(snapshot.accounts, usageByAccountId, snapshot.activeAccountId)

  const canAutoPollUsage = (accountId: string): boolean => {
    if (usageErrorByAccountId[accountId]) {
      return true
    }

    return shouldAutoPollUsage(usageByAccountId[accountId], snapshot.settings.usagePollingMinutes)
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
    rawSnapshot = nextSnapshot
    const visibleSnapshot =
      appMeta.isPackaged === false ? filterLocalMockAppSnapshot(nextSnapshot) : nextSnapshot
    snapshot = visibleSnapshot
    applyTheme(visibleSnapshot.settings.theme)
    usageByAccountId = {
      ...visibleSnapshot.usageByAccountId
    }
    usageErrorByAccountId = {
      ...visibleSnapshot.usageErrorByAccountId
    }
    syncUsageState(visibleSnapshot.accounts)
  }

  const clearUsageError = (accountId: string): void => {
    const nextState = { ...usageErrorByAccountId }
    delete nextState[accountId]
    usageErrorByAccountId = nextState
  }

  const wakeTimestamp = (): string =>
    new Intl.DateTimeFormat(snapshot.settings.language === 'en' ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date())

  const pushWakeLog = async (message: string): Promise<void> => {
    wakeDialogLogs = [...wakeDialogLogs, `[${wakeTimestamp()}] ${message}`]
  }

  const resetWakeDialogState = (): void => {
    wakeDialogStatus = 'idle'
    wakeDialogLogs = []
    wakeRequestResult = null
    wakeRequestError = ''
    wakeRawResponseBody = ''
  }

  const wakeResponsePreview = (body: string): string => {
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (!firstLine) {
      return copyForLanguage().wakeQuotaResultEmpty
    }

    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  const currentWakeScheduleDialog = (): AccountWakeSchedule | null =>
    wakeDialogAccount ? (snapshot.wakeSchedulesByAccountId[wakeDialogAccount.id] ?? null) : null

  const inlineUpdateSummary = (): string => {
    switch (updateState.status) {
      case 'checking':
        return copyForLanguage().checkingUpdates
      case 'available':
        return copyForLanguage().updateAvailableVersion(updateState.availableVersion)
      case 'downloading':
        return updateState.delivery === 'external' && updateState.externalAction === 'homebrew'
          ? copyForLanguage().homebrewUpdateStatus(
              updateState.externalCommandStatus,
              updateState.externalCommand
            )
          : copyForLanguage().updateDownloadProgress(updateState.downloadProgress)
      case 'downloaded':
        return copyForLanguage().updateReady
      case 'up-to-date':
        return copyForLanguage().updateUpToDate
      case 'unsupported':
        return copyForLanguage().updatesUnsupported
      case 'error':
        return updateState.message || copyForLanguage().updateFailed
      default:
        return ''
    }
  }

  const inlineUpdateActionLabel = (): string | null => {
    switch (updateState.status) {
      case 'available':
        return updateState.delivery === 'external'
          ? updateState.externalAction === 'homebrew'
            ? copyForLanguage().updateViaHomebrew(updateState.availableVersion)
            : copyForLanguage().openReleasePage(updateState.availableVersion)
          : copyForLanguage().downloadUpdate(updateState.availableVersion)
      case 'downloaded':
        return copyForLanguage().restartToInstallUpdate
      default:
        return null
    }
  }

  const runInlineUpdateAction = (): void => {
    switch (updateState.status) {
      case 'available':
        void downloadUpdate()
        return
      case 'downloaded':
        void installUpdate()
        return
      default:
        return
    }
  }

  const clearUsageData = (accountId: string): void => {
    const nextUsageByAccountId = { ...usageByAccountId }
    delete nextUsageByAccountId[accountId]
    usageByAccountId = nextUsageByAccountId

    const nextSnapshotUsageByAccountId = { ...snapshot.usageByAccountId }
    delete nextSnapshotUsageByAccountId[accountId]
    snapshot = {
      ...snapshot,
      usageByAccountId: nextSnapshotUsageByAccountId
    }
  }

  const localizeKnownError = (error: unknown, fallback: string): string => {
    if (!(error instanceof Error)) {
      return fallback
    }

    const copy = copyForLanguage()
    return error.message
      .replace(
        'This account was saved with macOS Keychain protection in an older version. Re-import it to use it without Keychain prompts.',
        copy.legacyAccountNeedsReimport
      )
      .replace(
        'Credentials saved by older versions used macOS Keychain storage and can no longer be read. Re-add them in this version.',
        copy.legacyAccountNeedsReimport
      )
      .replace(
        'This provider API key was saved with macOS Keychain protection in an older version. Edit the provider and save the API key again.',
        copy.legacyProviderNeedsApiKey
      )
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
      pageError = localizeKnownError(error, copyForLanguage().actionFailed)
    }
  }

  const runAccountAction = async (key: string, task: () => Promise<AppSnapshot>): Promise<void> => {
    if (accountActionKey) {
      return
    }

    accountActionKey = key

    try {
      await runAction(key, task)
    } finally {
      accountActionKey = ''
    }
  }

  const createProvider = async (input: CreateCustomProviderInput): Promise<void> => {
    await runAction(`provider:create:${input.baseUrl}`, () => window.codexApp.createProvider(input))
    closeProviderComposer()
  }

  const updateProvider = async (
    providerId: string,
    input: UpdateCustomProviderInput
  ): Promise<void> => {
    await runAction(`provider:update:${providerId}`, () =>
      window.codexApp.updateProvider(providerId, input)
    )
  }

  const removeProvider = async (providerId: string): Promise<void> => {
    await runAction(`provider:remove:${providerId}`, () =>
      window.codexApp.removeProvider(providerId)
    )
  }

  const getProvider = async (providerId: string): Promise<CustomProviderDetail> =>
    window.codexApp.getProvider(providerId)

  const reorderProviders = async (providerIds: string[]): Promise<void> => {
    if (
      providerIds.length !== snapshot.providers.length ||
      providerIds.every((providerId, index) => providerId === snapshot.providers[index]?.id)
    ) {
      return
    }

    await runAction('providers:reorder', () => window.codexApp.reorderProviders(providerIds))
  }

  const openProviderInCodex = async (providerId: string): Promise<void> => {
    await runAccountAction(`provider:open:${providerId}`, () =>
      window.codexApp.openProviderInCodex(providerId)
    )
  }

  const startLogin = async (method: LoginMethod): Promise<void> => {
    if (
      method === 'browser' &&
      loginEvent?.method === 'browser' &&
      loginEvent.phase === 'waiting'
    ) {
      closeExpandablePanels(showCallbackLoginDetails ? undefined : 'browser-login')
      showCallbackLoginDetails = !showCallbackLoginDetails
      return
    }

    if (method === 'device' && loginEvent?.method === 'device' && loginEvent.phase === 'waiting') {
      closeExpandablePanels(showDeviceLoginDetails ? undefined : 'device-login')
      showDeviceLoginDetails = !showDeviceLoginDetails
      return
    }

    closeExpandablePanels(method === 'browser' ? 'browser-login' : 'device-login')
    pageError = ''
    loginEvent = null
    loginPortOccupant = null
    loginStarting = true

    if (method === 'device') {
      showDeviceLoginDetails = true
    }

    if (method === 'browser') {
      showCallbackLoginDetails = true
    }

    try {
      await window.codexApp.startLogin(method)
      applySnapshot(await window.codexApp.getSnapshot())
    } catch (error) {
      loginStarting = false
      pageError = localizeKnownError(error, copyForLanguage().startLoginFailed)
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
      pageError = localizeKnownError(error, copyForLanguage().killPortOccupantFailed)
    } finally {
      killingLoginPortOccupant = false
    }
  }

  const removeAccount = async (account: AccountSummary): Promise<void> => {
    if (
      !window.confirm(copyForLanguage().removeConfirm(accountLabel(account, copyForLanguage())))
    ) {
      return
    }

    await runAction(`remove:${account.id}`, () => window.codexApp.removeAccount(account.id))
  }

  const removeAccounts = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    if (!window.confirm(copyForLanguage().removeSelectedConfirm(uniqueIds.length))) {
      return
    }

    await runAction(`remove-many:${uniqueIds.join(',')}`, () =>
      window.codexApp.removeAccounts(uniqueIds)
    )
  }

  const closeExportFormatDialog = (): void => {
    if (exportDialogBusy) {
      return
    }

    showExportFormatDialog = false
    exportDialogError = ''
    exportDialogAccountIds = null
    exportDialogFormat = 'ilovecodex'
  }

  const openExportFormatDialog = (accountIds?: string[]): void => {
    const uniqueIds = accountIds?.length ? [...new Set(accountIds)] : null
    if (accountIds?.length && !uniqueIds?.length) {
      return
    }

    exportDialogAccountIds = uniqueIds
    exportDialogFormat = 'ilovecodex'
    exportDialogError = ''
    showExportFormatDialog = true
  }

  const submitExportFormatDialog = async (): Promise<void> => {
    if (exportDialogBusy) {
      return
    }

    exportDialogBusy = true
    exportDialogError = ''

    try {
      const nextSnapshot = exportDialogAccountIds?.length
        ? await window.codexApp.exportSelectedAccountsToFile(
            exportDialogAccountIds,
            exportDialogFormat
          )
        : await window.codexApp.exportAccountsToFile(exportDialogFormat)
      applySnapshot(nextSnapshot)
      showExportFormatDialog = false
      exportDialogError = ''
      exportDialogAccountIds = null
      exportDialogFormat = 'ilovecodex'
    } catch (error) {
      exportDialogError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      exportDialogBusy = false
    }
  }

  const exportSelectedAccounts = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    openExportFormatDialog(uniqueIds)
  }

  const reorderAccounts = async (accountIds: string[]): Promise<void> => {
    if (
      accountIds.length !== snapshot.accounts.length ||
      accountIds.every((accountId, index) => accountId === snapshot.accounts[index]?.id)
    ) {
      return
    }

    await runAction('accounts:reorder', () => window.codexApp.reorderAccounts(accountIds))
  }

  const createTag = async (name: string): Promise<void> => {
    await runAction(`tags:create:${name}`, () => window.codexApp.createTag(name))
  }

  const updateTag = async (tag: AccountTag, name: string): Promise<void> => {
    await runAction(`tags:update:${tag.id}`, () => window.codexApp.updateTag(tag.id, name))
  }

  const deleteTag = async (tag: AccountTag): Promise<void> => {
    await runAction(`tags:delete:${tag.id}`, () => window.codexApp.deleteTag(tag.id))
  }

  const updateAccountTags = async (account: AccountSummary, tagIds: string[]): Promise<void> => {
    if (
      tagIds.length === account.tagIds.length &&
      tagIds.every((tagId, index) => tagId === account.tagIds[index])
    ) {
      return
    }

    await runAction(`account-tags:${account.id}`, () =>
      window.codexApp.updateAccountTags(account.id, tagIds)
    )
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
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      }
    } finally {
      clearUsageLoading(account.id)
    }
  }

  const closeWakeDialog = (): void => {
    if (wakingAccountId || wakeScheduleSaving) {
      return
    }

    wakeDialogAccount = null
    wakeDialogTab = 'session'
    resetWakeDialogState()
    wakeScheduleError = ''
  }

  const hydrateWakeScheduleDrafts = (account: AccountSummary): void => {
    const schedule = snapshot.wakeSchedulesByAccountId[account.id]
    wakeScheduleEnabledDraft = schedule?.enabled ?? true
    wakeScheduleTimesDraft = schedule?.times.length ? [...schedule.times] : ['09:00']
    wakeSchedulePromptDraft = schedule?.prompt ?? 'ping'
    wakeScheduleModelDraft = schedule?.model ?? 'gpt-5.4'
    wakeScheduleError = ''
  }

  const openWakeDialog = (account: AccountSummary, initialTab: WakeDialogTab = 'session'): void => {
    if (wakingAccountId || wakeScheduleSaving || usageLoadingByAccountId[account.id]) {
      return
    }

    wakeDialogAccount = account
    wakeDialogTab = initialTab
    resetWakeDialogState()
    hydrateWakeScheduleDrafts(account)
    void pushWakeLog(copyForLanguage().wakeQuotaLogReady(accountLabel(account, copyForLanguage())))
  }

  const handleGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }

    if (showExportFormatDialog && !exportDialogBusy) {
      closeExportFormatDialog()
      return
    }

    if (toolbarDialogOpen()) {
      closeExpandablePanels()
      return
    }

    if (wakeDialogAccount && !wakingAccountId && !wakeScheduleSaving) {
      closeWakeDialog()
    }
  }

  const saveWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    const times = normalizeWakeScheduleTimes(wakeScheduleTimesDraft)
    if (!times.length) {
      wakeScheduleError = copyForLanguage().wakeScheduleNoTimes
      return
    }

    if (!times.every(isValidWakeScheduleTime)) {
      wakeScheduleError = copyForLanguage().wakeScheduleInvalidTime
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    const input: UpdateAccountWakeScheduleInput = {
      enabled: wakeScheduleEnabledDraft,
      times,
      prompt: wakeSchedulePromptDraft.trim() || 'ping',
      model: wakeScheduleModelDraft.trim() || 'gpt-5.4'
    }

    try {
      applySnapshot(await window.codexApp.updateAccountWakeSchedule(wakeDialogAccount.id, input))
      wakeScheduleError = ''
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const deleteWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    try {
      applySnapshot(await window.codexApp.deleteAccountWakeSchedule(wakeDialogAccount.id))
      hydrateWakeScheduleDrafts(wakeDialogAccount)
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const wakeRateLimitReset = async (
    account: AccountSummary,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRequestResult | null> => {
    if (wakingAccountId || usageLoadingByAccountId[account.id]) {
      return null
    }

    wakingAccountId = account.id
    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const result = await window.codexApp.wakeAccountRateLimits(account.id, input)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: result.rateLimits
      }
      snapshot = {
        ...snapshot,
        usageByAccountId: {
          ...snapshot.usageByAccountId,
          [account.id]: result.rateLimits
        }
      }
      return result.requestResult
    } catch (error) {
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      }
      throw error
    } finally {
      clearUsageLoading(account.id)
      if (wakingAccountId === account.id) {
        wakingAccountId = ''
      }
    }
  }

  const submitWakeDialog = async (): Promise<void> => {
    if (!wakeDialogAccount) {
      return
    }

    resetWakeDialogState()
    wakeDialogStatus = 'running'
    await pushWakeLog(copyForLanguage().wakeQuotaLogStart(wakeModelDraft || 'gpt-5.4'))
    await pushWakeLog(copyForLanguage().wakeQuotaLogPrompt(wakePromptDraft || 'ping'))
    await pushWakeLog(copyForLanguage().wakeQuotaLogRequesting)

    try {
      wakeRequestResult = await wakeRateLimitReset(wakeDialogAccount, {
        prompt: wakePromptDraft,
        model: wakeModelDraft
      })
      wakeRawResponseBody = wakeRequestResult?.body ?? ''

      if (!wakeRequestResult) {
        wakeDialogStatus = 'skipped'
        await pushWakeLog(copyForLanguage().wakeQuotaLogSkipped)
        return
      }

      await pushWakeLog(copyForLanguage().wakeQuotaLogAccepted(wakeRequestResult.status))
      await pushWakeLog(
        copyForLanguage().wakeQuotaLogResponse(wakeResponsePreview(wakeRequestResult.body))
      )
      await pushWakeLog(copyForLanguage().wakeQuotaLogRefreshingUsage)

      const nextRateLimits = usageByAccountId[wakeDialogAccount.id]
      if (nextRateLimits?.primary?.resetsAt != null) {
        await pushWakeLog(
          copyForLanguage().wakeQuotaLogSessionReset(
            formatRelativeReset(nextRateLimits.primary.resetsAt, snapshot.settings.language)
          )
        )
      }
      if (supportsWeeklyQuota(nextRateLimits) && nextRateLimits?.secondary?.resetsAt != null) {
        await pushWakeLog(
          copyForLanguage().wakeQuotaLogWeeklyReset(
            formatRelativeReset(nextRateLimits.secondary.resetsAt, snapshot.settings.language)
          )
        )
      }

      wakeDialogStatus = 'success'
      await pushWakeLog(copyForLanguage().wakeQuotaLogCompleted)
    } catch (error) {
      wakeRequestError = localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      wakeDialogStatus = 'error'
      await pushWakeLog(copyForLanguage().wakeQuotaLogFailed(wakeRequestError))
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

  const updateCheckForUpdatesOnStartup = async (enabled: boolean): Promise<void> => {
    if (snapshot.settings.checkForUpdatesOnStartup === enabled) {
      return
    }

    await runAction('settings:update-check', () =>
      window.codexApp.updateSettings({ checkForUpdatesOnStartup: enabled })
    )
  }

  const updateShowLocalMockData = async (enabled: boolean): Promise<void> => {
    if ((snapshot.settings.showLocalMockData ?? true) === enabled) {
      return
    }

    await runAction('settings:show-local-mock-data', () =>
      window.codexApp.updateSettings({ showLocalMockData: enabled })
    )
  }

  const updateCodexDesktopExecutablePath = async (value: string): Promise<void> => {
    const normalized = value.trim()
    if (snapshot.settings.codexDesktopExecutablePath === normalized) {
      return
    }

    await runAction('settings:codex-desktop-executable-path', () =>
      window.codexApp.updateSettings({ codexDesktopExecutablePath: normalized })
    )
  }

  const toggleStatusAccount = async (accountId: string): Promise<void> => {
    const nextIds = snapshot.settings.statusBarAccountIds.includes(accountId)
      ? snapshot.settings.statusBarAccountIds.filter((id) => id !== accountId)
      : [...snapshot.settings.statusBarAccountIds, accountId].slice(0, 5)

    await runAction('settings:status-accounts', () =>
      window.codexApp.updateSettings({ statusBarAccountIds: nextIds })
    )
  }

  const updateStatsDisplay = async (statsDisplay: StatsDisplaySettings): Promise<void> => {
    const current = normalizeStatsDisplaySettings(snapshot.settings.statsDisplay)
    const next = normalizeStatsDisplaySettings(statsDisplay)

    if (JSON.stringify(current) === JSON.stringify(next)) {
      return
    }

    await runAction('settings:stats-display', () =>
      window.codexApp.updateSettings({ statsDisplay: next })
    )
  }

  const openMainPanel = async (): Promise<void> => {
    applySnapshot(await window.codexApp.openMainWindow())
  }

  const openCodex = async (): Promise<void> => {
    await runAction('codex:open', () => window.codexApp.openCodex())
  }

  const downloadUpdate = async (): Promise<void> => {
    if (updateState.delivery === 'external' && updateState.externalAction !== 'homebrew') {
      openExternalLink(updateState.externalDownloadUrl ?? appMeta.githubUrl ?? undefined)
      return
    }

    updateState = await window.codexApp.downloadUpdate()
  }

  const checkForUpdates = async (): Promise<void> => {
    updateState = await window.codexApp.checkForUpdates()
  }

  const installUpdate = async (): Promise<void> => {
    await window.codexApp.installUpdate()
  }

  const refreshAllRateLimits = async (): Promise<void> => {
    if (!snapshot.accounts.length || refreshingAllUsage) {
      return
    }

    closeExpandablePanels()
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
    void refreshUpdateState()

    const handleThemeChange = (event: MediaQueryListEvent): void => {
      prefersDark = event.matches
      applyTheme(snapshot.settings.theme)
    }

    darkMedia.addEventListener('change', handleThemeChange)

    const disposeSnapshot = window.codexApp.onSnapshotUpdated((nextSnapshot) => {
      applySnapshot(nextSnapshot)
    })

    const disposeUpdateState = window.codexApp.onUpdateState((nextState) => {
      updateState = nextState
    })

    const disposeLogin = window.codexApp.onLoginEvent((event) => {
      loginEvent = event
      loginStarting = event.phase === 'starting'

      if (event.method === 'browser' && event.phase === 'waiting') {
        showCallbackLoginDetails = true
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
      disposeUpdateState()
      disposeLogin()
    }
  })
</script>

<svelte:head>
  <title>Ilovecodex</title>
</svelte:head>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class={`app-shell ${isTrayView ? 'min-h-screen' : 'h-screen overflow-hidden'} flex flex-col`}>
  {#if !isTrayView}
    <div class="h-7 w-full select-none sm:h-8" style={dragRegionStyle} aria-hidden="true"></div>
  {/if}

  <div
    class={`mx-auto ${isTrayView ? 'grid gap-4 max-w-[420px] px-3 pb-3 pt-2' : 'flex h-0 min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-8'}`}
  >
    {#if isTrayView}
      <TrayPanel
        {brandMark}
        {snapshot}
        {usageByAccountId}
        {pageError}
        copy={copyForLanguage()}
        {compactGhostButton}
        {pollingOptions}
        statusAccounts={statusBarAccounts(
          snapshot.settings,
          snapshot.accounts,
          snapshot.activeAccountId
        )}
        {openMainPanel}
        {openCodex}
        {toggleStatusAccount}
        {updatePollingInterval}
      />
    {:else}
      <div class="grid h-full min-h-0 flex-1 items-stretch gap-4 grid-cols-[minmax(0,1fr)_44px]">
        <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
          {#if pageError}
            <section
              use:reveal={{ delay: 0 }}
              class="theme-surface theme-error-panel rounded-[1rem] border border-danger/18 bg-white px-4 py-4 text-base text-danger"
            >
              <div class="grid gap-2">
                <p>{pageError}</p>
                {#if loginPortOccupant && hasLoginPortConflict()}
                  <div class="flex flex-wrap items-center gap-2 text-sm text-danger">
                    <span>
                      {copyForLanguage().portOccupied(
                        loginPortOccupant.command,
                        loginPortOccupant.pid
                      )}
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

          <div
            class="flex h-0 min-h-0 flex-1 flex-col overflow-hidden"
            use:reveal={{ delay: 0.05 }}
          >
            <AccountsPanel
              {panelClass}
              {primaryActionButton}
              {compactGhostButton}
              {iconRowButton}
              copy={copyForLanguage()}
              workspaceVersion={appMeta.version}
              workspaceStatusText={loginEvent?.message ?? ''}
              workspaceStatusToneClass={loginEvent
                ? loginTone(loginEvent.phase)
                : 'text-muted-strong'}
              updateSummary={inlineUpdateSummary()}
              updateActionLabel={inlineUpdateActionLabel()}
              runUpdateAction={runInlineUpdateAction}
              showLocalMockToggle={appMeta.isPackaged === false}
              language={snapshot.settings.language}
              showLocalMockData={snapshot.settings.showLocalMockData !== false}
              accounts={snapshot.accounts}
              codexInstances={snapshot.codexInstances}
              providers={snapshot.providers}
              tags={snapshot.tags}
              activeAccountId={snapshot.activeAccountId}
              {usageByAccountId}
              {usageLoadingByAccountId}
              {usageErrorByAccountId}
              tokenCostByInstanceId={snapshot.tokenCostByInstanceId}
              tokenCostErrorByInstanceId={snapshot.tokenCostErrorByInstanceId}
              runningTokenCostSummary={snapshot.runningTokenCostSummary}
              runningTokenCostInstanceIds={snapshot.runningTokenCostInstanceIds}
              statsDisplay={normalizeStatsDisplaySettings(snapshot.settings.statsDisplay)}
              wakeSchedulesByAccountId={snapshot.wakeSchedulesByAccountId}
              loginActionBusy={loginActionBusy()}
              {loginStarting}
              openAccountInCodex={(accountId) =>
                runAccountAction(`open:${accountId}`, () =>
                  window.codexApp.openAccountInCodex(accountId)
                )}
              openAccountInIsolatedCodex={(accountId) =>
                runAccountAction(`open-isolated:${accountId}`, () =>
                  window.codexApp.openAccountInIsolatedCodex(accountId)
                )}
              openingAccountId={accountActionKey.startsWith('open:')
                ? accountActionKey.slice('open:'.length)
                : ''}
              openingIsolatedAccountId={accountActionKey.startsWith('open-isolated:')
                ? accountActionKey.slice('open-isolated:'.length)
                : ''}
              {wakingAccountId}
              openingProviderId={accountActionKey.startsWith('provider:open:')
                ? accountActionKey.slice('provider:open:'.length)
                : ''}
              {getProvider}
              {reorderProviders}
              {updateProvider}
              {removeProvider}
              {openProviderInCodex}
              {reorderAccounts}
              {createTag}
              {updateTag}
              {deleteTag}
              {updateAccountTags}
              refreshAccountUsage={(account) => readRateLimits(account, { force: true })}
              {updateShowLocalMockData}
              {updateStatsDisplay}
              {openWakeDialog}
              {removeAccount}
              {removeAccounts}
              {exportSelectedAccounts}
              readTokenCost={(input) => window.codexApp.readTokenCost(input)}
              {startLogin}
              importCurrent={() =>
                runAction('import', () => window.codexApp.importCurrentAccount())}
            />
          </div>
        </div>

        <div class="sticky top-0 self-start" use:reveal={{ delay: 0.08 }}>
          <AppSider
            copy={copyForLanguage()}
            {appMeta}
            language={snapshot.settings.language}
            theme={snapshot.settings.theme}
            {iconToolbarButton}
            {loginStarting}
            loginActionBusy={loginActionBusy() || (!snapshot.accounts.length && refreshingAllUsage)}
            {refreshingAllUsage}
            {showProviderComposer}
            bestAccount={bestAccount()}
            activeAccountId={snapshot.activeAccountId}
            {startLogin}
            importCurrent={() => {
              closeExpandablePanels()
              return runAction('import', () => window.codexApp.importCurrentAccount())
            }}
            importAccountsFile={() => {
              closeExpandablePanels()
              return runAction('import:file', () => window.codexApp.importAccountsFromFile())
            }}
            exportAccountsFile={() => {
              closeExpandablePanels()
              openExportFormatDialog()
            }}
            {refreshAllRateLimits}
            activateBestAccount={() => {
              closeExpandablePanels()
              const target = bestAccount()
              if (!target || target.id === snapshot.activeAccountId) {
                return Promise.resolve()
              }
              return runAccountAction(`activate:${target.id}`, () =>
                window.codexApp.activateAccount(target.id)
              )
            }}
            toggleSettings={() => {
              const nextOpen = !showSettings
              closeExpandablePanels(nextOpen ? 'settings' : undefined)
              showSettings = nextOpen
            }}
            toggleProviderComposer={() => {
              const nextOpen = !showProviderComposer
              closeExpandablePanels(nextOpen ? 'provider' : undefined)
              showProviderComposer = nextOpen
            }}
            {updateLanguage}
            {updateTheme}
            {openExternalLink}
          />
        </div>
      </div>
    {/if}
  </div>
</div>

{#if showExportFormatDialog}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/38 px-4 py-6 backdrop-blur-[2px]"
    role="presentation"
    tabindex="-1"
    on:click={(event) => {
      if (event.target === event.currentTarget) {
        closeExportFormatDialog()
      }
    }}
    on:keydown={(event) => {
      if (event.key === 'Escape') {
        closeExportFormatDialog()
      }
    }}
  >
    <div
      class="theme-surface w-full max-w-xl rounded-[1.25rem] border border-black/8 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:p-6"
      use:reveal={{ delay: 0.05 }}
      use:cascadeIn={{
        selector: '[data-motion-item]'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-format-dialog-title"
    >
      <div class="grid gap-1" data-motion-item>
        <p class="text-xs font-medium uppercase tracking-[0.22em] text-faint">
          {exportDialogScopeLabel()}
        </p>
        <h2 id="export-format-dialog-title" class="text-[1.15rem] font-semibold text-ink">
          {copyForLanguage().exportFormatDialogTitle}
        </h2>
        <p class="text-sm leading-6 text-muted-strong">
          {copyForLanguage().exportFormatDialogDescription}
        </p>
      </div>

      <div class="mt-5 grid gap-3">
        {#each exportFormatOptionOrder as format (format)}
          <label
            data-motion-item
            class={`theme-export-format-option grid cursor-pointer gap-1 rounded-2xl border px-4 py-3 transition-colors duration-140 ${exportDialogFormat === format ? 'border-black/14 bg-black/[0.045]' : 'border-black/8 bg-transparent'}`}
          >
            <div class="flex items-start gap-3">
              <input
                class="mt-1 h-4 w-4 accent-black"
                type="radio"
                name="account-export-format"
                value={format}
                checked={exportDialogFormat === format}
                on:change={() => {
                  exportDialogFormat = format
                }}
              />
              <div class="grid gap-1">
                <span class="text-sm font-medium text-ink">{exportFormatLabel(format)}</span>
                <span class="text-xs leading-5 text-muted-strong">
                  {exportFormatDescription(format)}
                </span>
              </div>
            </div>
          </label>
        {/each}
      </div>

      {#if exportDialogError}
        <p class="mt-4 text-sm text-danger" data-motion-item>{exportDialogError}</p>
      {/if}

      <div class="mt-6 flex flex-wrap justify-end gap-3" data-motion-item>
        <button
          class={compactGhostButton}
          on:click={closeExportFormatDialog}
          disabled={exportDialogBusy}
        >
          {copyForLanguage().exportFormatCancel}
        </button>
        <button
          class={primaryActionButton}
          on:click={submitExportFormatDialog}
          disabled={exportDialogBusy}
        >
          {copyForLanguage().exportFormatConfirm}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if wakeDialogAccount}
  <WakeDialog
    copy={copyForLanguage()}
    language={snapshot.settings.language}
    accountLabelText={accountLabel(wakeDialogAccount, copyForLanguage())}
    {compactGhostButton}
    {primaryActionButton}
    bind:activeTab={wakeDialogTab}
    bind:sessionPrompt={wakePromptDraft}
    bind:sessionModel={wakeModelDraft}
    sessionStatus={wakeDialogStatus}
    sessionLogs={wakeDialogLogs}
    requestResult={wakeRequestResult}
    requestError={wakeRequestError}
    rawResponseBody={wakeRawResponseBody}
    sessionBusy={Boolean(wakingAccountId)}
    schedule={currentWakeScheduleDialog()}
    bind:scheduleEnabled={wakeScheduleEnabledDraft}
    bind:scheduleTimes={wakeScheduleTimesDraft}
    bind:schedulePrompt={wakeSchedulePromptDraft}
    bind:scheduleModel={wakeScheduleModelDraft}
    scheduleError={wakeScheduleError}
    scheduleSaving={wakeScheduleSaving}
    onClose={closeWakeDialog}
    onSubmitSession={submitWakeDialog}
    onSaveSchedule={saveWakeSchedule}
    onDeleteSchedule={deleteWakeSchedule}
  />
{/if}

<div use:reveal={{ delay: 0.02 }}>
  <HeroPanel
    {heroClass}
    {compactGhostButton}
    copy={copyForLanguage()}
    {loginEvent}
    onClose={() => closeExpandablePanels()}
    {showSettings}
    {showProviderComposer}
    {showCallbackLoginDetails}
    {showDeviceLoginDetails}
    loginActionBusy={loginActionBusy() || (!snapshot.accounts.length && refreshingAllUsage)}
    {pollingOptions}
    settings={snapshot.settings}
    {updateState}
    {createProvider}
    {updatePollingInterval}
    {updateCheckForUpdatesOnStartup}
    {updateShowLocalMockData}
    {updateStatsDisplay}
    {updateCodexDesktopExecutablePath}
    showCodexDesktopExecutablePath={shouldShowCodexDesktopExecutablePath()}
    showLocalMockToggle={appMeta.isPackaged === false}
    {checkForUpdates}
    {downloadUpdate}
    {installUpdate}
    {copyAuthUrl}
    {copyDeviceCode}
    {openExternalLink}
  />
</div>

<style>
  :global(.text-muted) {
    color: var(--ink-soft);
  }

  :global(.text-muted-strong) {
    color: var(--ink-soft-strong);
  }

  :global(.text-faint) {
    color: var(--ink-faint);
  }

  :global(.border-soft) {
    border-color: var(--line);
  }

  :global(html[data-theme='dark'] .theme-surface) {
    border-color: var(--line-strong) !important;
    background: var(--panel-strong) !important;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 18px 44px color-mix(in srgb, var(--paper-shadow) 55%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-tray-panel) {
    border-color: var(--line-strong) !important;
    background: var(--panel) !important;
    box-shadow: 0 18px 48px var(--paper-shadow) !important;
  }

  :global(html[data-theme='dark'] .theme-soft-panel),
  :global(html[data-theme='dark'] .theme-toolbar),
  :global(html[data-theme='dark'] .theme-version-pill),
  :global(html[data-theme='dark'] .theme-plan-neutral),
  :global(html[data-theme='dark'] .theme-menu-choice-active),
  :global(html[data-theme='dark'] .theme-provider-toggle) {
    background: var(--surface-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-soft-panel) {
    border-color: color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-version-pill) {
    color: var(--ink-soft-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-neutral) {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-plus) {
    background: rgb(16 185 129 / 0.18) !important;
    color: rgb(110 231 183) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-pro) {
    background: rgb(14 165 233 / 0.18) !important;
    color: rgb(125 211 252) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-team) {
    background: rgb(245 158 11 / 0.18) !important;
    color: rgb(253 224 71) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-enterprise) {
    background: rgb(244 63 94 / 0.18) !important;
    color: rgb(253 164 175) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button),
  :global(html[data-theme='dark'] .theme-icon-button),
  :global(html[data-theme='dark'] .theme-row-button),
  :global(html[data-theme='dark'] .theme-menu-choice),
  :global(html[data-theme='dark'] .theme-select) {
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button:hover),
  :global(html[data-theme='dark'] .theme-icon-button:hover),
  :global(html[data-theme='dark'] .theme-row-button:hover),
  :global(html[data-theme='dark'] .theme-menu-choice:hover),
  :global(html[data-theme='dark'] .theme-select:hover) {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button:focus-visible),
  :global(html[data-theme='dark'] .theme-icon-button:focus-visible),
  :global(html[data-theme='dark'] .theme-row-button:focus-visible),
  :global(html[data-theme='dark'] .theme-menu-choice:focus-visible),
  :global(html[data-theme='dark'] .theme-select:focus-visible) {
    box-shadow: 0 0 0 2px var(--ring) !important;
  }

  :global(html[data-theme='dark'] .theme-select) {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-card) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--panel) 8%) !important;
    box-shadow: none !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input),
  :global(html[data-theme='dark'] .theme-provider-toggle) {
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input) {
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--surface-soft) 14%) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input::placeholder) {
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-toggle) {
    background: color-mix(in srgb, var(--surface-soft) 88%, var(--panel) 12%) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-status) {
    background: rgb(96 165 250 / 0.7) !important;
    box-shadow: 0 0 0 4px rgb(96 165 250 / 0.08) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-badge) {
    border-color: rgb(56 189 248 / 0.16) !important;
    background: rgb(14 165 233 / 0.1) !important;
    color: rgb(186 230 253 / 0.88) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-fast-badge) {
    border-color: rgb(16 185 129 / 0.16) !important;
    background: rgb(16 185 129 / 0.1) !important;
    color: rgb(167 243 208 / 0.88) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-meta) {
    border-color: color-mix(in srgb, var(--line) 72%, transparent) !important;
    background: color-mix(in srgb, var(--surface-soft) 82%, var(--panel) 18%) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-select option) {
    color: var(--ink);
    background: var(--panel-strong);
  }

  :global(html[data-theme='dark'] .theme-inline-code) {
    background: var(--panel-strong) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark'] .theme-code-surface) {
    border-color: var(--line) !important;
    background: var(--code-bg) !important;
    color: var(--code-ink) !important;
  }

  :global(html[data-theme='dark'] .theme-error-panel) {
    border-color: color-mix(in srgb, var(--danger) 22%, transparent) !important;
    background: color-mix(in srgb, var(--danger) 6%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark'] .theme-account-card) {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-account-card-active) {
    border-color: var(--line-strong) !important;
    background: color-mix(in srgb, var(--surface-soft) 66%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark'] .theme-export-format-option) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--panel) 8%) !important;
  }

  :global(html[data-theme='dark'] .theme-progress-track) {
    background: var(--progress-track) !important;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--line) 70%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-progress-fill) {
    background: var(--progress-fill) !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--progress-fill) 45%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-active-pill) {
    background: var(--ink) !important;
    color: var(--paper) !important;
  }

  :global(html[data-theme='dark'] .theme-status-active) {
    background: var(--success) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-status-idle) {
    background: var(--dot-idle) !important;
  }
</style>
