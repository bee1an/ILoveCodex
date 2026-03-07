<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    AccountRateLimitEntry,
    AccountRateLimits,
    AccountSummary,
    AppSnapshot,
    LoginEvent,
    LoginMethod
  } from '../../shared/codex'
  import { formatRelativeReset, remainingPercent, resolveBestAccount } from '../../shared/codex'

  let snapshot: AppSnapshot = {
    accounts: [],
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: []
    },
    usageByAccountId: {}
  }
  let loginEvent: LoginEvent | null = null
  let activeLoginMethod: LoginMethod | null = null
  let pageError = ''
  let showSettings = false
  let usageByAccountId: Record<string, AccountRateLimits> = {}
  let usageLoadingByAccountId: Record<string, boolean> = {}
  let usageErrorByAccountId: Record<string, string> = {}
  const pollingOptions = [5, 15, 30, 60]
  const isTrayView =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tray') === '1'
  const bodyClasses = [
    'm-0',
    'min-h-screen',
    isTrayView ? 'bg-transparent' : 'bg-paper',
    'text-ink',
    'font-ui',
    'antialiased'
  ]

  const heroClass = 'rounded-[1rem] border border-black/8 bg-white p-4 sm:p-5'
  const panelClass = 'rounded-[1rem] border border-black/8 bg-white p-5'
  const compactGhostButton =
    'inline-flex items-center justify-center rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm font-medium text-ink transition-colors duration-140 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-48'
  const iconToolbarButton =
    'inline-flex h-8 w-8 appearance-none items-center justify-center border-0 rounded-md bg-transparent p-0 text-ink outline-none shadow-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-48'
  const iconRowButton =
    'inline-flex h-7 w-7 appearance-none items-center justify-center border-0 rounded-md bg-transparent p-0 text-black/68 outline-none shadow-none transition-colors duration-140 hover:bg-black/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-40'
  const dragRegionStyle = '-webkit-app-region: drag; app-region: drag;'

  const refreshSnapshot = async (): Promise<void> => {
    applySnapshot(await window.codexApp.getSnapshot())
  }

  const accountLabel = (account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>): string =>
    account.name ?? account.email ?? account.accountId ?? '未命名账号'

  const accountEmail = (account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>): string =>
    account.email ?? account.name ?? account.accountId ?? '未命名账号'

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
        return 'bg-black/[0.05] text-black/55'
      case 'plus':
        return 'bg-emerald-500/12 text-emerald-700'
      case 'pro':
        return 'bg-sky-500/12 text-sky-700'
      case 'team':
        return 'bg-amber-500/14 text-amber-700'
      case 'business':
        return 'bg-violet-500/14 text-violet-700'
      case 'enterprise':
        return 'bg-rose-500/14 text-rose-700'
      default:
        return 'bg-black/[0.05] text-black/55'
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
    active ? 'border-black/20 ring-1 ring-black/5' : 'border-black/8'

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

  const canPollUsage = (accountId: string): boolean => {
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
      pageError = error instanceof Error ? error.message : '操作失败'
    }
  }

  const startLogin = async (method: LoginMethod): Promise<void> => {
    pageError = ''
    loginEvent = null
    activeLoginMethod = method

    try {
      await window.codexApp.startLogin(method)
      applySnapshot(await window.codexApp.getSnapshot())
    } catch (error) {
      activeLoginMethod = null
      pageError = error instanceof Error ? error.message : '无法启动登录流程'
    }
  }

  const removeAccount = async (account: AccountSummary): Promise<void> => {
    if (!window.confirm(`删除 ${accountLabel(account)} 的本地保存登录态？`)) {
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

  const copyDeviceCode = async (): Promise<void> => {
    await copyText(loginEvent?.deviceCode)
  }

  const copyAuthUrl = async (): Promise<void> => {
    await copyText(loginEvent?.authUrl)
  }

  const copyVerificationUrl = async (): Promise<void> => {
    await copyText(loginEvent?.verificationUrl)
  }

  const openExternalLink = (url?: string): void => {
    if (!url) {
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const readRateLimits = async (account: AccountSummary): Promise<void> => {
    if (usageLoadingByAccountId[account.id] || !canPollUsage(account.id)) {
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
        [account.id]: error instanceof Error ? error.message : '无法读取账号限额'
      }
    } finally {
      clearUsageLoading(account.id)
    }
  }

  const ensureUsageLoaded = async (accounts: AccountSummary[]): Promise<void> => {
    for (const account of accounts) {
      if (
        usageLoadingByAccountId[account.id] ||
        (usageByAccountId[account.id] && !canPollUsage(account.id))
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

  onMount(() => {
    document.body.classList.add(...bodyClasses)
    void refreshSnapshot()

    const disposeSnapshot = window.codexApp.onSnapshotUpdated((nextSnapshot) => {
      applySnapshot(nextSnapshot)
    })

    const disposeLogin = window.codexApp.onLoginEvent((event) => {
      loginEvent = event
      const resolvedLoginSurface =
        (event.method === 'browser' && Boolean(event.authUrl)) ||
        (event.method === 'device' && Boolean(event.verificationUrl || event.deviceCode))

      activeLoginMethod =
        event.phase === 'success' ||
        event.phase === 'error' ||
        event.phase === 'cancelled' ||
        resolvedLoginSurface
          ? null
          : event.method

      if (event.snapshot) {
        applySnapshot(event.snapshot)
        return
      }

      void refreshSnapshot()
    })

    return () => {
      document.body.classList.remove(...bodyClasses)
      disposeSnapshot()
      disposeLogin()
    }
  })
</script>

<svelte:head>
  <title>Ilovecodex</title>
</svelte:head>

<div class={`min-h-screen ${isTrayView ? 'bg-transparent' : 'border-t border-black/5'}`}>
  {#if !isTrayView}
    <div class="h-7 w-full select-none sm:h-8" style={dragRegionStyle} aria-hidden="true"></div>
  {/if}

  <div
    class={`mx-auto grid gap-4 ${isTrayView ? 'max-w-[420px] px-3 pb-3 pt-2' : 'max-w-6xl px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-8'}`}
  >
    {#if isTrayView}
      <section
        class="grid gap-3 overflow-hidden rounded-[1.05rem] border border-black/[0.08] bg-white/66 p-3.5 backdrop-blur-2xl"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink">Ilovecodex</p>
            <p class="text-xs text-black/38">{statusBarAccounts().length} 个状态栏账号</p>
          </div>
          <button class={compactGhostButton} on:click={openMainPanel}>打开主面板</button>
        </div>

        {#if pageError}
          <div
            class="rounded-xl border border-danger/18 bg-danger/4 px-3 py-2.5 text-sm text-danger"
          >
            {pageError}
          </div>
        {/if}

        <div class="grid gap-2">
          {#if statusBarAccounts().length}
            {#each statusBarAccounts() as account (account.id)}
              <article class="grid gap-2 rounded-xl bg-black/[0.035] px-3 py-2.5">
                <div class="flex items-center gap-2">
                  <span
                    class={`h-2 w-2 flex-none rounded-full ${snapshot.activeAccountId === account.id ? 'bg-success' : 'bg-black/14'}`}
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
                    <span
                      class="w-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35"
                    >
                      5h
                    </span>
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-black/8">
                      <div
                        class="h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                      ></div>
                    </div>
                    <span class="w-9 text-right text-[11px] font-medium text-black/62">
                      {usageByAccountId[account.id]?.primary
                        ? `${remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%`
                        : '--'}
                    </span>
                  </div>

                  <div class="flex items-center gap-2">
                    <span
                      class="w-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35"
                    >
                      w
                    </span>
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-black/8">
                      <div
                        class="h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                      ></div>
                    </div>
                    <span class="w-9 text-right text-[11px] font-medium text-black/62">
                      {usageByAccountId[account.id]?.secondary
                        ? `${remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%`
                        : '--'}
                    </span>
                  </div>
                </div>
              </article>
            {/each}
          {:else}
            <div class="rounded-xl bg-black/[0.03] px-3 py-3 text-sm text-black/58">
              还没有可显示的账号。
            </div>
          {/if}
        </div>

        <div class="grid gap-2 border-t border-black/6 pt-3">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-black/48">状态栏显示账号</p>
            <p class="text-xs text-black/38">最多 5 个</p>
          </div>

          <div class="grid gap-1">
            {#each snapshot.accounts as account (account.id)}
              <button
                class={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 ${snapshot.settings.statusBarAccountIds.includes(account.id) ? 'bg-black/[0.05]' : 'bg-transparent hover:bg-black/[0.03]'}`}
                on:click={() => toggleStatusAccount(account.id)}
                disabled={!snapshot.settings.statusBarAccountIds.includes(account.id) &&
                  snapshot.settings.statusBarAccountIds.length >= 5}
              >
                <span class="min-w-0 flex-1 truncate text-sm text-black/72">
                  {accountEmail(account)}
                </span>
                <span class="text-xs text-black/40">
                  {snapshot.settings.statusBarAccountIds.includes(account.id) ? '已显示' : '未显示'}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-black/6 pt-3">
          <span class="text-xs text-black/48">额度轮询</span>
          <select
            class="h-8 rounded-md border border-black/8 bg-white/88 px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
            value={snapshot.settings.usagePollingMinutes}
            on:change={(event) =>
              updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
          >
            {#each pollingOptions as option (option)}
              <option value={option}>{option} 分钟</option>
            {/each}
          </select>
        </div>
      </section>
    {:else}
      <section class={heroClass}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <p class="text-[11px] font-medium uppercase tracking-[0.18em] text-black/38">
              Ilovecodex
            </p>
            {#if loginEvent}
              <p class={`truncate text-sm ${loginTone(loginEvent.phase)}`} aria-live="polite">
                {loginEvent.message}
              </p>
            {/if}
          </div>

          <div
            class="inline-flex min-w-[140px] items-center gap-0.5 rounded-lg bg-black/[0.03] p-1"
          >
            <button
              class={iconToolbarButton}
              on:click={() => startLogin('browser')}
              aria-label="浏览器登录"
              title="浏览器登录"
            >
              <span class="i-lucide-log-in h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => startLogin('device')}
              aria-label="设备码登录"
              title="设备码登录"
            >
              <span
                class={`${activeLoginMethod === 'device' ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-smartphone'} h-4.5 w-4.5`}
              ></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => runAction('import', () => window.codexApp.importCurrentAccount())}
              disabled={snapshot.loginInProgress}
              aria-label="导入当前登录"
              title="导入当前登录"
            >
              <span class="i-lucide-plus h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={activateBestAccount}
              disabled={snapshot.loginInProgress ||
                !bestAccount() ||
                bestAccount()?.id === snapshot.activeAccountId}
              aria-label="切换到最优账号"
              title={bestAccount()
                ? bestAccount()?.id === snapshot.activeAccountId
                  ? '当前已是最优账号'
                  : `切换到 ${accountEmail(bestAccount()!)}`
                : '暂无可切换账号'}
            >
              <span class="i-lucide-sparkles h-4.5 w-4.5"></span>
            </button>
            <button
              class={iconToolbarButton}
              on:click={() => {
                showSettings = !showSettings
              }}
              aria-label="设置"
              title="设置"
            >
              <span class="i-lucide-settings-2 h-4.5 w-4.5"></span>
            </button>
          </div>
        </div>

        {#if showSettings}
          <div class="mt-3 flex items-center gap-3 border-t border-black/6 pt-3">
            <span class="text-xs text-black/48">额度轮询</span>
            <select
              class="h-8 rounded-md border border-black/8 bg-white px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
              value={snapshot.settings.usagePollingMinutes}
              on:change={(event) =>
                updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
            >
              {#each pollingOptions as option (option)}
                <option value={option}>{option} 分钟</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if loginEvent?.authUrl || loginEvent?.localCallbackUrl || loginEvent?.verificationUrl || loginEvent?.deviceCode || loginEvent?.rawOutput}
          <div class="mt-3 grid gap-2 border-t border-black/6 pt-3">
            {#if loginEvent.method === 'browser' && loginEvent.authUrl}
              <div class="grid gap-2 rounded-lg bg-black/[0.03] p-3">
                <p class="text-sm text-black/58">浏览器登录链接</p>
                <code class="overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black">
                  {loginEvent.authUrl}
                </code>
                <div class="flex flex-wrap items-center gap-2">
                  <button class={compactGhostButton} on:click={copyAuthUrl}>复制链接</button>
                  <button
                    class={compactGhostButton}
                    on:click={() => openExternalLink(loginEvent.authUrl)}
                  >
                    打开浏览器
                  </button>
                </div>
              </div>
            {/if}

            {#if loginEvent.method === 'browser' && loginEvent.localCallbackUrl}
              <p class="text-sm text-ink/62">等待浏览器完成授权并回调本地地址。</p>
            {/if}

            {#if loginEvent.method === 'device' && loginEvent.verificationUrl}
              <div class="grid gap-3 rounded-lg bg-black/[0.03] p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-sm font-medium text-black/72">设备码登录</p>
                  <span class="text-xs text-black/45">按步骤完成授权</span>
                </div>

                <div class="grid gap-2 sm:grid-cols-3">
                  <div class="rounded-md bg-white px-3 py-2">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35">
                      01
                    </p>
                    <p class="mt-1 text-sm text-black/72">打开设备授权页面</p>
                  </div>
                  <div class="rounded-md bg-white px-3 py-2">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35">
                      02
                    </p>
                    <p class="mt-1 text-sm text-black/72">输入下面的设备码</p>
                  </div>
                  <div class="rounded-md bg-white px-3 py-2">
                    <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35">
                      03
                    </p>
                    <p class="mt-1 text-sm text-black/72">确认后返回这里等待同步</p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-2">
                  <code class="min-w-0 flex-1 overflow-x-auto text-sm text-black/72">
                    {loginEvent.verificationUrl}
                  </code>
                  <button class={compactGhostButton} on:click={copyVerificationUrl}>
                    复制链接
                  </button>
                  <button
                    class={compactGhostButton}
                    on:click={() => openExternalLink(loginEvent.verificationUrl)}
                  >
                    打开页面
                  </button>
                </div>

                {#if loginEvent.deviceCode}
                  <div
                    class="flex flex-wrap items-center gap-3 rounded-md border border-black/8 bg-white px-3 py-3"
                  >
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                      <span class="text-xs uppercase tracking-[0.12em] text-black/42">Code</span>
                      <code class="text-xl tracking-widest text-black">{loginEvent.deviceCode}</code
                      >
                    </div>
                    <button class={compactGhostButton} on:click={copyDeviceCode}>
                      复制设备码
                    </button>
                  </div>
                {/if}
              </div>
            {/if}

            {#if loginEvent.phase === 'error' && loginEvent.rawOutput}
              <pre
                class="m-0 max-h-60 overflow-auto rounded-lg border border-black/8 bg-[#111111] p-4 font-mono text-sm leading-6 text-[#f5f5f5]">{loginEvent.rawOutput}</pre>
            {/if}
          </div>
        {/if}
      </section>

      {#if pageError}
        <section
          class="rounded-[1rem] border border-danger/18 bg-white px-4 py-4 text-base text-danger"
        >
          {pageError}
        </section>
      {/if}

      <section class={`${panelClass} grid gap-4`}>
        <div class="text-sm text-black/42">{snapshot.accounts.length} 个账号</div>

        {#if snapshot.accounts.length}
          <div class="grid gap-2">
            {#each snapshot.accounts as account (account.id)}
              <article
                class={`grid items-center gap-3 rounded-[0.875rem] border bg-white px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)_auto] ${accountCardTone(snapshot.activeAccountId === account.id)}`}
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span
                    class={`h-2 w-2 flex-none rounded-full ${snapshot.activeAccountId === account.id ? 'bg-success' : 'bg-black/14'}`}
                  ></span>
                  <p class="truncate text-sm font-medium">{accountEmail(account)}</p>
                  <span
                    class={`inline-flex flex-none items-center rounded-full px-2 py-0.75 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
                  >
                    {planLabel(usageByAccountId[account.id]?.planType)}
                  </span>
                </div>

                <div class="grid gap-1.5 rounded-md bg-black/[0.03] px-2.5 py-2">
                  <div class="grid grid-cols-2 gap-2">
                    <div class="flex items-center gap-2">
                      <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-black/35">
                        5小时
                      </span>
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-black/8">
                        <div
                          class="h-full rounded-full bg-black/70"
                          style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                        ></div>
                      </div>
                      {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                        <span class="w-9 text-right text-[11px] text-black/45">…</span>
                      {:else if usageByAccountId[account.id]?.primary}
                        <span class="w-9 text-right text-[11px] font-medium text-black/72">
                          {remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%
                        </span>
                      {:else}
                        <span class="w-9 text-right text-[11px] text-black/40">-</span>
                      {/if}
                    </div>

                    <div class="flex items-center gap-2">
                      <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-black/35">
                        周限额
                      </span>
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-black/8">
                        <div
                          class="h-full rounded-full bg-black/70"
                          style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                        ></div>
                      </div>
                      {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                        <span class="w-9 text-right text-[11px] text-black/45">…</span>
                      {:else if usageByAccountId[account.id]?.secondary}
                        <span class="w-9 text-right text-[11px] font-medium text-black/72">
                          {remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%
                        </span>
                      {:else}
                        <span class="w-9 text-right text-[11px] text-black/40">-</span>
                      {/if}
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-[10px] text-black/42">
                    <div class="truncate">
                      5小时重置 {formatRelativeReset(
                        usageByAccountId[account.id]?.primary?.resetsAt
                      )}
                    </div>
                    <div class="truncate">
                      周限额重置 {formatRelativeReset(
                        usageByAccountId[account.id]?.secondary?.resetsAt
                      )}
                    </div>
                  </div>
                </div>

                {#if extraLimits(account.id).length}
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-black/58">
                    {#each extraLimits(account.id) as limit (`${account.id}:${limit.limitId ?? 'extra'}`)}
                      <div
                        class="inline-flex items-center gap-1.5 rounded-md bg-black/[0.03] px-2 py-1"
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
                    disabled={snapshot.loginInProgress}
                    aria-label={`用 ${accountEmail(account)} 打开 Codex`}
                    title="打开 Codex"
                  >
                    <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() =>
                      runAction(`activate:${account.id}`, () =>
                        window.codexApp.activateAccount(account.id)
                      )}
                    disabled={snapshot.loginInProgress || snapshot.activeAccountId === account.id}
                    aria-label={`切换到 ${accountEmail(account)}`}
                    title="切换账号"
                  >
                    <span class="i-lucide-repeat-2 h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() => readRateLimits(account)}
                    disabled={snapshot.loginInProgress ||
                      usageLoadingByAccountId[account.id] ||
                      !canPollUsage(account.id)}
                    aria-label={`刷新 ${accountEmail(account)} 的额度`}
                    title={canPollUsage(account.id)
                      ? '刷新额度'
                      : `${snapshot.settings.usagePollingMinutes} 分钟内不重复请求`}
                  >
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    on:click={() => removeAccount(account)}
                    disabled={snapshot.loginInProgress}
                    aria-label={`删除 ${accountEmail(account)} 的保存`}
                    title="删除保存"
                  >
                    <span class="i-lucide-trash-2 h-4 w-4"></span>
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <p class="text-base text-ink/72">
            还没有保存任何账号。先导入当前登录，或者走一次新的浏览器/设备码登录。
          </p>
        {/if}
      </section>
    {/if}
  </div>
</div>
