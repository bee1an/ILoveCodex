<script lang="ts">
  import { onMount } from 'svelte'
  import brandMark from './assets/brand-mark.png'
  import AccountsPanel from './components/AccountsPanel.svelte'
  import FooterBar from './components/FooterBar.svelte'
  import HeroPanel from './components/HeroPanel.svelte'
  import TrayPanel from './components/TrayPanel.svelte'
  import { accountLabel, messages, pollingOptions, statusBarAccounts } from './components/app-view'

  import type {
    AppLanguage,
    AppMeta,
    AppTheme,
    AccountTag,
    AccountRateLimits,
    AccountSummary,
    AppSnapshot,
    LoginEvent,
    LoginMethod,
    PortOccupant
  } from '../../shared/codex'
  import { resolveBestAccount } from '../../shared/codex'

  let snapshot: AppSnapshot = {
    accounts: [],
    tags: [],
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

  const refreshAppMeta = async (): Promise<void> => {
    appMeta = await window.codexApp.getAppMeta()
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
    if (
      !window.confirm(copyForLanguage().removeConfirm(accountLabel(account, copyForLanguage())))
    ) {
      return
    }

    await runAction(`remove:${account.id}`, () => window.codexApp.removeAccount(account.id))
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
        {toggleStatusAccount}
        {updatePollingInterval}
      />
    {:else}
      <HeroPanel
        {brandMark}
        {heroClass}
        {compactGhostButton}
        {iconToolbarButton}
        copy={copyForLanguage()}
        {loginEvent}
        {loginStarting}
        {showSettings}
        {showBrowserLoginDetails}
        {showDeviceLoginDetails}
        {refreshingAllUsage}
        loginActionBusy={loginActionBusy() || (!snapshot.accounts.length && refreshingAllUsage)}
        {pollingOptions}
        settings={snapshot.settings}
        bestAccount={bestAccount()}
        activeAccountId={snapshot.activeAccountId}
        {startLogin}
        importCurrent={() => runAction('import', () => window.codexApp.importCurrentAccount())}
        {refreshAllRateLimits}
        {activateBestAccount}
        toggleSettings={() => {
          showSettings = !showSettings
        }}
        {updatePollingInterval}
        {copyAuthUrl}
        {copyDeviceCode}
        {openExternalLink}
      />

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

      <AccountsPanel
        {panelClass}
        {primaryActionButton}
        {compactGhostButton}
        {iconRowButton}
        copy={copyForLanguage()}
        language={snapshot.settings.language}
        accounts={snapshot.accounts}
        tags={snapshot.tags}
        activeAccountId={snapshot.activeAccountId}
        {usageByAccountId}
        {usageLoadingByAccountId}
        loginActionBusy={loginActionBusy()}
        {loginStarting}
        openAccountInCodex={(accountId) =>
          runAction(`open:${accountId}`, () => window.codexApp.openAccountInCodex(accountId))}
        activateAccount={(accountId) =>
          runAction(`activate:${accountId}`, () => window.codexApp.activateAccount(accountId))}
        {reorderAccounts}
        {createTag}
        {updateTag}
        {deleteTag}
        {updateAccountTags}
        refreshAccountUsage={(account) => readRateLimits(account, { force: true })}
        {removeAccount}
        {startLogin}
        importCurrent={() => runAction('import', () => window.codexApp.importCurrentAccount())}
      />

      <FooterBar
        {appMeta}
        language={snapshot.settings.language}
        theme={snapshot.settings.theme}
        copy={copyForLanguage()}
        {iconToolbarButton}
        {updateLanguage}
        {updateTheme}
        {openExternalLink}
      />
    {/if}
  </div>
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
  :global(html[data-theme='dark'] .theme-menu-choice-active) {
    background: var(--surface-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-soft-panel) {
    border-color: color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-version-pill),
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

  :global(html[data-theme='dark'] .theme-plan-business) {
    background: rgb(139 92 246 / 0.2) !important;
    color: rgb(196 181 253) !important;
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
