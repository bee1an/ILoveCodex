<script lang="ts">
  import { flip } from 'svelte/animate'
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { dragHandle, dragHandleZone, type DndEvent as SortEvent } from 'svelte-dnd-action'

  import type {
    AccountRateLimits,
    AccountSummary,
    AccountTag,
    AccountWakeSchedule,
    AppLanguage
  } from '../../../shared/codex'
  import {
    formatRelativeReset,
    isLocalMockAccount,
    remainingPercent,
    supportsWeeklyQuota,
    supportsWakeSessionQuota
  } from '../../../shared/codex'
  import {
    accountUsageBadge,
    accountEmail,
    extraLimits,
    limitLabel,
    planLabel,
    planTagClass,
    progressWidth,
    weeklyResetTimeToneClass,
    type LocalizedCopy
  } from './app-view'
  import {
    accountTagsForDisplay,
    availableTagsForAccount,
    filterChipLabel,
    normalizeSelectedAccountIds,
    tagFilterLabel,
    untaggedFilterId,
    visibleAccountsForFilter
  } from './accounts-panel-account'
  import { animateProgress } from './gsap-motion'
  import {
    eventTargetsFloatingRoot,
    floatingAnchor,
    portal,
    stopFloatingPointerPropagation
  } from './floating'
  import Checkbox from './Checkbox.svelte'
  import {
    formatWakeScheduleLastTriggeredAt,
    nextWakeScheduleLabel,
    wakeScheduleSummary as wakeScheduleSummaryText
  } from './wake-schedule'

  const flipDurationMs = 160

  export let iconRowButton: string
  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let tags: AccountTag[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
  export let loginActionBusy: boolean
  export let tagMutationBusy = false
  export let activeTagFilter = 'all'
  export let selectedAccountIds: string[] = []
  export let accountWorkbenchExpanded = false
  export let openingAccountId = ''
  export let openingIsolatedAccountId = ''
  export let wakingAccountId = ''
  export let openAccountInCodex: (accountId: string) => void
  export let openAccountInIsolatedCodex: (accountId: string) => void
  export let openWakeDialog: (account: AccountSummary, initialTab?: 'session' | 'schedule') => void
  export let reorderAccounts: (accountIds: string[]) => Promise<void>
  export let updateAccountTags: (account: AccountSummary, tagIds: string[]) => Promise<void>
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let removeAccount: (account: AccountSummary) => void
  export let removeAccounts: (accountIds: string[]) => Promise<void>
  export let exportSelectedAccounts: (accountIds: string[]) => Promise<void>

  let accountActionMenuAccountId: string | null = null
  let accountActionMenuAnchorRect: DOMRect | null = null
  let accountTagMenuAccountId = ''
  let accountTagMenuAnchorRect: DOMRect | null = null
  let usageErrorPopoverAccountId: string | null = null
  let usageErrorPopoverAnchorRect: DOMRect | null = null
  let sortableAccounts: AccountSummary[] = []
  let sortInteractionActive = false

  $: if (
    activeTagFilter !== 'all' &&
    activeTagFilter !== untaggedFilterId &&
    !tags.some((tag) => tag.id === activeTagFilter)
  ) {
    activeTagFilter = 'all'
  }

  $: visibleAccounts = visibleAccountsForFilter(accounts, activeTagFilter)

  $: {
    const nextSelectedAccountIds = normalizeSelectedAccountIds(selectedAccountIds, visibleAccounts)
    if (nextSelectedAccountIds.length !== selectedAccountIds.length) {
      selectedAccountIds = nextSelectedAccountIds
    }
  }

  $: if (!sortInteractionActive) {
    sortableAccounts = visibleAccounts
  }

  $: selectedVisibleCount = selectedAccountIds.length
  $: allVisibleSelected =
    visibleAccounts.length > 0 && selectedVisibleCount === visibleAccounts.length
  $: showAccountFilterTools = accounts.length > 0 || tags.length > 0
  $: showAccountSelectionTools = visibleAccounts.length > 0 || selectedVisibleCount > 0
  $: if (
    usageErrorPopoverAccountId &&
    !accounts.some((account) => account.id === usageErrorPopoverAccountId)
  ) {
    closeUsageErrorPopover()
  }

  function usageErrorLines(detail: string): string[] {
    const lines = detail
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    return lines.length ? lines : [detail.trim()].filter(Boolean)
  }

  function usageErrorToneClass(kind: 'expired' | 'workspace' | 'error'): string {
    switch (kind) {
      case 'expired':
        return 'border-red-700/18 bg-red-700/8 text-red-700'
      case 'workspace':
        return 'border-orange-500/20 bg-orange-500/10 text-orange-700'
      case 'error':
      default:
        return 'border-amber-500/18 bg-amber-500/10 text-amber-700'
    }
  }

  function stopUsageErrorEvent(event: Event): void {
    event.stopPropagation()
  }

  function toggleUsageErrorPopover(event: MouseEvent, accountId: string): void {
    event.preventDefault()
    event.stopPropagation()

    if (usageErrorPopoverAccountId === accountId) {
      closeUsageErrorPopover()
      return
    }

    closeAccountActionMenu()
    closeAccountTagMenu()
    usageErrorPopoverAccountId = accountId
    usageErrorPopoverAnchorRect =
      (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null
  }

  function closeUsageErrorPopover(): void {
    usageErrorPopoverAccountId = null
    usageErrorPopoverAnchorRect = null
  }

  function showWakeAccount(accountId: string): boolean {
    const rateLimits = usageByAccountId[accountId]
    return !rateLimits || supportsWakeSessionQuota(rateLimits)
  }

  function hasEnabledWakeSchedule(accountId: string): boolean {
    const schedule = wakeSchedulesByAccountId[accountId]
    return Boolean(schedule?.enabled && schedule.times.length)
  }

  function wakeScheduleStatusLabel(status?: AccountWakeSchedule['lastStatus']): string {
    switch (status) {
      case 'success':
        return copy.wakeScheduleStatusSuccess
      case 'error':
        return copy.wakeScheduleStatusError
      case 'skipped':
        return copy.wakeScheduleStatusSkipped
      default:
        return copy.wakeScheduleStatusIdle
    }
  }

  function wakeScheduleTitle(accountId: string): string {
    const schedule = wakeSchedulesByAccountId[accountId]
    if (!schedule) {
      return copy.wakeSchedule
    }

    const lines = [
      `${copy.wakeSchedule} · ${wakeScheduleSummaryText(schedule, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleNextRun}: ${nextWakeScheduleLabel(schedule, language, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleLastRun}: ${formatWakeScheduleLastTriggeredAt(schedule.lastTriggeredAt, language, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleLastStatus}: ${wakeScheduleStatusLabel(schedule.lastStatus)}`
    ]

    if (schedule.lastMessage) {
      lines.push(`${copy.wakeScheduleLastMessage}: ${schedule.lastMessage}`)
    }

    return lines.join('\n')
  }

  function wakeScheduleSummary(accountId: string): string {
    const schedule = wakeSchedulesByAccountId[accountId]
    return wakeScheduleSummaryText(schedule, copy.wakeSchedule)
  }

  function selectAllVisibleAccounts(): void {
    selectedAccountIds = visibleAccounts.map((account) => account.id)
  }

  function clearSelectedAccounts(): void {
    selectedAccountIds = []
  }

  function setAccountSelected(accountId: string, selected: boolean): void {
    if (selected) {
      selectedAccountIds = selectedAccountIds.includes(accountId)
        ? selectedAccountIds
        : [...selectedAccountIds, accountId]
      return
    }

    selectedAccountIds = selectedAccountIds.filter(
      (selectedAccountId) => selectedAccountId !== accountId
    )
  }

  async function exportCurrentSelection(): Promise<void> {
    if (!selectedAccountIds.length || loginActionBusy) {
      return
    }

    await exportSelectedAccounts(selectedAccountIds)
  }

  async function removeCurrentSelection(): Promise<void> {
    if (!selectedAccountIds.length || loginActionBusy) {
      return
    }

    await removeAccounts(selectedAccountIds)
    clearSelectedAccounts()
  }

  function accountActionBusy(accountId: string): boolean {
    return openingAccountId === accountId || openingIsolatedAccountId === accountId
  }

  function accountRowTone(account: AccountSummary): string {
    let tone = ''

    if (selectedAccountIds.includes(account.id)) {
      tone += 'bg-[var(--surface-selected)]'
    } else if (activeAccountId === account.id) {
      tone += 'bg-transparent'
    } else {
      tone += 'bg-transparent'
    }

    return tone
  }

  function accountLaunchDisabled(account: AccountSummary): boolean {
    return loginActionBusy || accountActionBusy(account.id) || isLocalMockAccount(account)
  }

  function accountRefreshDisabled(account: AccountSummary): boolean {
    const usageLoading = Boolean(usageLoadingByAccountId[account.id])
    return loginActionBusy || usageLoading || isLocalMockAccount(account)
  }

  function wakeDialogDisabled(account: AccountSummary): boolean {
    const usageLoading = Boolean(usageLoadingByAccountId[account.id])
    return loginActionBusy || Boolean(wakingAccountId) || usageLoading
  }

  function accountMoreActionsLabel(): string {
    return language === 'en' ? 'More actions' : '更多操作'
  }

  async function addTagToAccount(account: AccountSummary, tagId: string): Promise<void> {
    await updateAccountTags(account, [...account.tagIds, tagId])
    closeAccountActionMenu()
    closeAccountTagMenu()
  }

  async function removeTagFromAccount(account: AccountSummary, tagId: string): Promise<void> {
    await updateAccountTags(
      account,
      account.tagIds.filter((id) => id !== tagId)
    )
  }

  function toggleAccountActionMenu(event: MouseEvent, accountId: string): void {
    event.stopPropagation()

    if (accountActionMenuAccountId === accountId) {
      closeAccountActionMenu()
      return
    }

    const trigger = event.currentTarget as HTMLElement | null
    if (!trigger) {
      return
    }

    closeUsageErrorPopover()
    closeAccountTagMenu()
    accountActionMenuAnchorRect = trigger.getBoundingClientRect()
    accountActionMenuAccountId = accountId
  }

  function closeAccountActionMenu(): void {
    accountActionMenuAccountId = null
    accountActionMenuAnchorRect = null
  }

  function closeAccountTagMenu(): void {
    accountTagMenuAccountId = ''
    accountTagMenuAnchorRect = null
  }

  function openAccountTagMenuFromActionMenu(accountId: string): void {
    if (!accountActionMenuAnchorRect) {
      return
    }

    accountTagMenuAnchorRect = accountActionMenuAnchorRect
    accountTagMenuAccountId = accountId
    closeAccountActionMenu()
  }

  function returnToAccountActionMenu(): void {
    if (!accountTagMenuAnchorRect || !accountTagMenuAccountId) {
      return
    }

    accountActionMenuAnchorRect = accountTagMenuAnchorRect
    accountActionMenuAccountId = accountTagMenuAccountId
    closeAccountTagMenu()
  }

  function handleSortConsider(event: CustomEvent<SortEvent<AccountSummary>>): void {
    sortInteractionActive = true
    sortableAccounts = event.detail.items
  }

  async function handleSortFinalize(event: CustomEvent<SortEvent<AccountSummary>>): Promise<void> {
    sortableAccounts = event.detail.items

    if (activeTagFilter !== 'all') {
      sortInteractionActive = false
      return
    }

    try {
      await reorderAccounts(event.detail.items.map((account) => account.id))
    } finally {
      sortInteractionActive = false
    }
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!eventTargetsFloatingRoot(event)) {
        closeAccountActionMenu()
        closeAccountTagMenu()
        closeUsageErrorPopover()
      }
    }
    const handleScroll = (): void => {
      closeAccountActionMenu()
      closeAccountTagMenu()
      closeUsageErrorPopover()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleScroll, true)
    }
  })
</script>

<svelte:window
  onresize={() => {
    closeAccountActionMenu()
    closeAccountTagMenu()
    closeUsageErrorPopover()
  }}
/>

<div class="theme-workbench-toolbar border-b border-black/8 px-4 py-1.5">
  <button
    class="theme-workbench-toggle flex w-full items-center justify-between gap-3 rounded-[0.35rem] border-0 bg-transparent px-1.5 py-1 text-left transition-colors duration-140 hover:bg-black/[0.03]"
    type="button"
    aria-expanded={accountWorkbenchExpanded}
    aria-controls="account-workbench-panel"
    aria-label={accountWorkbenchExpanded
      ? copy.hideFiltersAndBulkActions
      : copy.showFiltersAndBulkActions}
    title={accountWorkbenchExpanded
      ? copy.hideFiltersAndBulkActions
      : copy.showFiltersAndBulkActions}
    onclick={() => {
      accountWorkbenchExpanded = !accountWorkbenchExpanded
    }}
  >
    <div class="min-w-0 flex flex-wrap items-center gap-2">
      <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 flex-none text-muted-strong"></span>
      <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
        {copy.filtersAndBulkActions}
      </span>
    </div>

    {#if !accountWorkbenchExpanded && (selectedVisibleCount || activeTagFilter !== 'all')}
      <span
        class="theme-workbench-collapsed-summary ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
      >
        {#if selectedVisibleCount}
          <span
            class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink"
          >
            <span class="i-lucide-check-check h-3 w-3 text-muted-strong"></span>
            <span class="truncate">{copy.selectedAccountCount(selectedVisibleCount)}</span>
          </span>
        {/if}

        {#if activeTagFilter !== 'all'}
          <span
            class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink"
          >
            <span class="i-lucide-tags h-3 w-3 text-muted-strong"></span>
            <span class="max-w-[12rem] truncate">{tagFilterLabel(activeTagFilter, tags, copy)}</span
            >
          </span>
        {/if}
      </span>
    {/if}

    <span
      class={`theme-workbench-chevron inline-flex h-6 w-6 items-center justify-center rounded-[0.35rem] border border-black/8 bg-white text-black/58 transition-[transform,background-color,color] duration-180 ${
        accountWorkbenchExpanded ? 'rotate-180' : ''
      }`}
    >
      <span class="i-lucide-chevron-down h-4 w-4"></span>
    </span>
  </button>

  {#if accountWorkbenchExpanded}
    <div id="account-workbench-panel" class="grid gap-2 px-2 pb-2 pt-1">
      {#if showAccountFilterTools}
        <div class="grid gap-1.5">
          <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
            {copy.filterByTag}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              class={`theme-filter-chip rounded-[0.32rem] px-1.5 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                activeTagFilter === 'all'
                  ? 'theme-filter-chip-active bg-black text-white'
                  : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
              }`}
              type="button"
              onclick={() => {
                activeTagFilter = 'all'
              }}
            >
              {filterChipLabel(accounts, 'all', tags, copy)}
            </button>
            <button
              class={`theme-filter-chip rounded-[0.32rem] px-1.5 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                activeTagFilter === untaggedFilterId
                  ? 'theme-filter-chip-active bg-black text-white'
                  : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
              }`}
              type="button"
              onclick={() => {
                activeTagFilter = untaggedFilterId
              }}
            >
              {filterChipLabel(accounts, untaggedFilterId, tags, copy)}
            </button>
            {#each tags as tag (tag.id)}
              <button
                class={`theme-filter-chip rounded-[0.32rem] px-1.5 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                  activeTagFilter === tag.id
                    ? 'theme-filter-chip-active bg-black text-white'
                    : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
                }`}
                type="button"
                onclick={() => {
                  activeTagFilter = tag.id
                }}
              >
                {filterChipLabel(accounts, tag.id, tags, copy)}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAccountSelectionTools}
        <div
          class={`theme-selection-toolbar flex flex-wrap items-center justify-between gap-2 border-t border-black/6 pt-3 ${
            selectedVisibleCount ? 'theme-selection-toolbar-active' : 'theme-selection-toolbar-idle'
          }`}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            {#if selectedVisibleCount}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink"
              >
                <span class="i-lucide-check-check h-3 w-3 text-muted-strong"></span>
                <span>{copy.selectedAccountCount(selectedVisibleCount)}</span>
              </span>
            {/if}

            {#if activeTagFilter !== 'all'}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink"
              >
                <span class="i-lucide-tags h-3 w-3 text-muted-strong"></span>
                <span>{tagFilterLabel(activeTagFilter, tags, copy)}</span>
              </span>
            {/if}
          </div>

          <div class="flex flex-wrap items-center justify-end gap-1.5">
            {#if visibleAccounts.length && !allVisibleSelected}
              <button
                class="theme-selection-group-button inline-flex min-w-[108px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-black/8 bg-white px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors duration-140"
                type="button"
                onclick={selectAllVisibleAccounts}
                disabled={loginActionBusy || !visibleAccounts.length}
              >
                <span class="i-lucide-check-check h-3.5 w-3.5"></span>
                <span>{copy.selectAllVisibleAccounts}</span>
              </button>
            {/if}

            {#if selectedVisibleCount}
              <button
                class="theme-selection-group-button inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-black/8 bg-white px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors duration-140"
                type="button"
                onclick={clearSelectedAccounts}
                disabled={loginActionBusy}
              >
                <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                <span>{copy.clearSelectedAccounts}</span>
              </button>

              <button
                class="theme-selection-export inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-black/8 bg-white px-2.5 py-1.5 text-[11px] font-medium leading-none text-ink transition-colors duration-140 hover:bg-black/[0.04]"
                type="button"
                onclick={() => void exportCurrentSelection()}
                disabled={loginActionBusy}
              >
                <span class="i-lucide-download h-3.5 w-3.5"></span>
                <span>{copy.exportSelectedAccounts}</span>
              </button>

              <button
                class="theme-selection-delete inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-red-500/14 bg-red-500/[0.08] px-2.5 py-1.5 text-[11px] font-medium leading-none text-danger transition-colors duration-140 hover:bg-red-500/[0.12]"
                type="button"
                onclick={() => void removeCurrentSelection()}
                disabled={loginActionBusy}
              >
                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                <span>{copy.deleteSelectedAccounts}</span>
              </button>
            {/if}
          </div>
        </div>
      {:else if !showAccountFilterTools}
        <div
          class="theme-workbench-empty rounded-[0.85rem] border border-dashed border-black/8 bg-white px-3 py-3 text-[12px] text-muted-strong"
        >
          {copy.emptyFilterTools}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if visibleAccounts.length}
  <div class="min-h-0 flex-1 overflow-y-auto px-4">
    <div
      class="grid"
      use:dragHandleZone={{
        items: sortableAccounts,
        type: 'accounts',
        flipDurationMs,
        dragDisabled:
          loginActionBusy ||
          tagMutationBusy ||
          activeTagFilter !== 'all' ||
          sortableAccounts.length < 2,
        autoAriaDisabled: false,
        zoneItemTabIndex: -1,
        dropTargetStyle: {
          outline: '2px solid rgba(0,0,0,0.16)'
        },
        delayTouchStart: true
      }}
      onconsider={handleSortConsider}
      onfinalize={(event) => void handleSortFinalize(event)}
      aria-label={copy.accountCount(sortableAccounts.length)}
    >
      {#each sortableAccounts as account, accountIndex (account.id)}
        {@const usageBadge = accountUsageBadge(usageErrorByAccountId[account.id], account, copy)}
        {@const assignableTags = availableTagsForAccount(tags, account)}
        <article
          class={`theme-account-row group grid items-center gap-3 px-2.5 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${accountRowTone(
            account
          )}`}
          animate:flip={{ duration: flipDurationMs }}
          aria-label={accountEmail(account, copy)}
        >
          <div class="flex items-center gap-2">
            <label
              class={`theme-account-selector inline-flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border transition-[border-color,background-color,box-shadow] duration-180 ${
                selectedAccountIds.includes(account.id)
                  ? 'border-black/18 bg-white text-black'
                  : 'border-black/10 bg-white text-black/72'
              }`}
              title={copy.selectAccount}
            >
              <Checkbox
                value={account.id}
                checked={selectedAccountIds.includes(account.id)}
                disabled={loginActionBusy}
                ariaLabel={`${copy.selectAccount} · ${accountEmail(account, copy)}`}
                onCheckedChange={(checked) => setAccountSelected(account.id, checked)}
              />
            </label>
            <button
              class={`${iconRowButton} h-7 w-7 self-center text-black/42 ${activeTagFilter === 'all' ? 'cursor-grab active:cursor-grabbing' : ''}`}
              type="button"
              use:dragHandle
              aria-label={`${copy.dragSortHandle} · ${accountEmail(account, copy)}`}
              title={copy.dragSortHandle}
              disabled={loginActionBusy ||
                tagMutationBusy ||
                activeTagFilter !== 'all' ||
                sortableAccounts.length < 2}
            >
              <span class="i-lucide-grip-vertical h-4 w-4"></span>
            </button>
          </div>

          <div class="grid min-w-0 gap-2.5 overflow-visible">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class={`h-2 w-2 flex-none rounded-full ${activeAccountId === account.id ? 'theme-status-active bg-success ring-3 ring-emerald-500/12' : 'theme-status-idle bg-black/14'}`}
              ></span>
              <p class="min-w-0 truncate text-sm font-medium leading-5 text-ink">
                {accountEmail(account, copy)}
              </p>
            </div>

            <div class="mt-[-2px] flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class={`inline-flex flex-none items-center rounded-[0.32rem] px-1.5 py-0.5 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
              >
                {planLabel(usageByAccountId[account.id]?.planType)}
              </span>

              {#if showWakeAccount(account.id) && hasEnabledWakeSchedule(account.id)}
                <button
                  class="theme-wake-schedule-pill inline-flex min-w-0 max-w-full items-center rounded-[0.32rem] border border-sky-500/16 bg-sky-500/10 px-2 py-0.75 text-[10px] text-sky-700 transition-colors duration-140 hover:bg-sky-500/14"
                  type="button"
                  onclick={() => openWakeDialog(account, 'schedule')}
                  disabled={loginActionBusy || usageLoadingByAccountId[account.id]}
                  title={wakeScheduleTitle(account.id)}
                >
                  <span class="i-lucide-calendar-clock mr-1.5 h-3.5 w-3.5 flex-none"></span>
                  <span class="truncate">{wakeScheduleSummary(account.id)}</span>
                </button>
              {/if}

              {#each accountTagsForDisplay(tags, account) as tag (tag.id)}
                <span
                  class="theme-tag-assigned inline-flex max-w-full items-center rounded-[0.32rem] border border-emerald-500/14 bg-emerald-500/10 px-1.75 py-0.5 text-[10px] font-medium leading-none text-emerald-700"
                >
                  <span class="max-w-28 truncate">{tag.name}</span>
                  <button
                    class="theme-tag-remove ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-transparent p-0 text-emerald-700/72 transition-colors duration-140 hover:bg-emerald-500/12 hover:text-emerald-800"
                    type="button"
                    onclick={() => void removeTagFromAccount(account, tag.id)}
                    disabled={loginActionBusy || tagMutationBusy}
                    aria-label={`${copy.removeTag} · ${tag.name}`}
                    title={copy.removeTag}
                  >
                    <span class="i-lucide-x h-2.5 w-2.5"></span>
                  </button>
                </span>
              {/each}
            </div>

            {#if usageBadge}
              {@const errorLines = usageErrorLines(usageBadge.detail)}
              <div class="min-w-0">
                <button
                  class={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] leading-4 transition-colors duration-140 hover:bg-black/[0.04] ${usageErrorToneClass(
                    usageBadge.kind
                  )}`}
                  type="button"
                  data-no-dnd="true"
                  onpointerdown={stopUsageErrorEvent}
                  onmousedown={stopUsageErrorEvent}
                  onclick={(event) => toggleUsageErrorPopover(event, account.id)}
                  aria-expanded={usageErrorPopoverAccountId === account.id}
                  title={usageBadge.title}
                >
                  <span class="min-w-0 truncate whitespace-nowrap">{errorLines[0]}</span>
                  <span class="i-lucide-info h-3.5 w-3.5 flex-none opacity-70"></span>
                </button>

                {#if usageErrorPopoverAccountId === account.id}
                  <div
                    use:portal
                    use:floatingAnchor={{
                      anchorRect: usageErrorPopoverAnchorRect,
                      minWidth: 360,
                      gap: 8,
                      placement: 'right'
                    }}
                    use:stopFloatingPointerPropagation
                    data-floating-root=""
                    class="theme-tag-picker-surface z-[999] w-[380px] max-w-[min(380px,calc(100vw-24px))] rounded-[1.1rem] p-2"
                    style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                  >
                    <div class="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
                      <span
                        class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]"
                      >
                        {copy.accountUsageRefreshFailed}
                      </span>
                      <button
                        class="inline-flex h-6 w-6 flex-none appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--ink-faint)] shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] hover:text-ink"
                        type="button"
                        onclick={closeUsageErrorPopover}
                        aria-label="关闭"
                        title="关闭"
                      >
                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                      </button>
                    </div>
                    <div
                      class="max-h-52 overflow-auto rounded-[0.85rem] bg-black/[0.035] p-2.5 text-[12px] leading-5 text-ink"
                    >
                      <pre
                        class="m-0 whitespace-pre-wrap break-words font-sans">{usageBadge.detail}</pre>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <div
            class="scroll-row flex min-w-0 flex-wrap items-center justify-start gap-1.5 overflow-x-auto self-center md:justify-end"
          >
            {#if !usageByAccountId[account.id] || supportsWakeSessionQuota(usageByAccountId[account.id])}
              <div
                class="theme-soft-panel inline-grid grid-cols-[auto_auto_3.5rem_2.75rem] items-center gap-x-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px] text-muted-strong"
                title={`${copy.sessionQuota} · ${
                  usageByAccountId[account.id]?.primary
                    ? `${remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%`
                    : '--'
                }`}
              >
                <span class="font-medium">{copy.sessionReset}</span>
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span class="inline-flex h-4 items-center leading-none">…</span>
                {:else if usageByAccountId[account.id]?.primary}
                  <span class="theme-reset-time-neutral inline-flex h-4 items-center leading-none"
                    >{formatRelativeReset(
                      usageByAccountId[account.id]?.primary?.resetsAt,
                      language
                    )}</span
                  >
                {:else}
                  <span class="inline-flex h-4 items-center leading-none">--</span>
                {/if}
                <span
                  class="theme-progress-track self-center h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                >
                  <span
                    class="theme-progress-fill block h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                    use:animateProgress={{
                      delay: Math.min(accountIndex * 0.028, 0.14),
                      duration: 0.46
                    }}
                  ></span>
                </span>
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >…</span
                  >
                {:else if usageByAccountId[account.id]?.primary}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >{remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%</span
                  >
                {:else}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >-</span
                  >
                {/if}
              </div>
            {/if}

            {#if !usageByAccountId[account.id] || supportsWeeklyQuota(usageByAccountId[account.id])}
              <div
                class="theme-soft-panel inline-grid grid-cols-[auto_auto_3.5rem_2.75rem] items-center gap-x-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px] text-muted-strong"
                title={`${copy.weeklyQuota} · ${
                  usageByAccountId[account.id]?.secondary
                    ? `${remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%`
                    : '--'
                }`}
              >
                <span class="font-medium">{copy.weeklyReset}</span>
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span class="inline-flex h-4 items-center leading-none">…</span>
                {:else if usageByAccountId[account.id]?.secondary}
                  <span
                    class={`${weeklyResetTimeToneClass(
                      usageByAccountId[account.id]?.secondary?.resetsAt
                    )} inline-flex h-4 items-center leading-none`}
                    >{formatRelativeReset(
                      usageByAccountId[account.id]?.secondary?.resetsAt,
                      language
                    )}</span
                  >
                {:else}
                  <span class="inline-flex h-4 items-center leading-none">--</span>
                {/if}
                <span
                  class="theme-progress-track self-center h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                >
                  <span
                    class="theme-progress-fill block h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                    use:animateProgress={{
                      delay: Math.min(accountIndex * 0.028 + 0.03, 0.18),
                      duration: 0.5
                    }}
                  ></span>
                </span>
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >…</span
                  >
                {:else if usageByAccountId[account.id]?.secondary}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >{remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%</span
                  >
                {:else}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >-</span
                  >
                {/if}
              </div>
            {/if}

            {#if extraLimits(usageByAccountId, account.id).length}
              {#each extraLimits(usageByAccountId, account.id) as limit (`${account.id}:${limit.limitId ?? 'extra'}`)}
                <div
                  class="theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px]"
                >
                  <span class="font-medium uppercase tracking-[0.08em]">{limitLabel(limit)}</span>
                  {#if limit.primary}
                    <span>h {remainingPercent(limit.primary.usedPercent)}%</span>
                  {/if}
                  {#if limit.secondary}
                    <span>w {remainingPercent(limit.secondary.usedPercent)}%</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          <div class="flex items-center self-center justify-end gap-1">
            <button
              class={iconRowButton}
              onclick={() => openAccountInCodex(account.id)}
              disabled={accountLaunchDisabled(account)}
              aria-label={`${copy.openCodex} · ${accountEmail(account, copy)}`}
              title={copy.openCodex}
            >
              {#if openingAccountId === account.id}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
              {/if}
            </button>
            <button
              class={iconRowButton}
              onclick={() => openAccountInIsolatedCodex(account.id)}
              disabled={accountLaunchDisabled(account)}
              aria-label={`${copy.openCodexIsolated} · ${accountEmail(account, copy)}`}
              title={copy.openCodexIsolated}
            >
              {#if openingIsolatedAccountId === account.id}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-copy-plus h-4 w-4"></span>
              {/if}
            </button>
            <button
              class={iconRowButton}
              onclick={() => refreshAccountUsage(account)}
              disabled={accountRefreshDisabled(account)}
              aria-label={`${copy.refreshQuota} · ${accountEmail(account, copy)}`}
              title={copy.refreshQuota}
            >
              <span class="i-lucide-refresh-cw h-4 w-4"></span>
            </button>
            <div class="relative" use:stopFloatingPointerPropagation data-floating-root="">
              <button
                class={iconRowButton}
                type="button"
                onclick={(event) => toggleAccountActionMenu(event, account.id)}
                aria-label={`${accountMoreActionsLabel()} · ${accountEmail(account, copy)}`}
                title={accountMoreActionsLabel()}
              >
                <span class="i-lucide-ellipsis h-4 w-4"></span>
              </button>

              {#if accountActionMenuAccountId === account.id}
                <div
                  use:portal
                  use:floatingAnchor={{
                    anchorRect: accountActionMenuAnchorRect,
                    minWidth: 220,
                    matchAnchorWidth: true
                  }}
                  use:stopFloatingPointerPropagation
                  data-floating-root=""
                  transition:fly={{ y: -6, duration: 200 }}
                  class="theme-tag-picker-surface z-[999] w-[264px] rounded-[1.25rem] p-1.5"
                  style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                >
                  <div
                    class="px-2.5 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]"
                  >
                    {accountMoreActionsLabel()}
                  </div>

                  {#if showWakeAccount(account.id)}
                    <button
                      class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                      type="button"
                      onclick={() => {
                        openWakeDialog(account)
                        closeAccountActionMenu()
                      }}
                      disabled={wakeDialogDisabled(account)}
                    >
                      <span
                        class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--paper)] group-hover:text-ink"
                      >
                        {#if wakingAccountId === account.id}
                          <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        {:else}
                          <span class="i-lucide-alarm-clock h-4 w-4"></span>
                        {/if}
                      </span>
                      <span class="flex-1">{copy.wakeQuota}</span>
                    </button>
                  {/if}

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      openAccountInIsolatedCodex(account.id)
                      closeAccountActionMenu()
                    }}
                    disabled={accountLaunchDisabled(account)}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--paper)] group-hover:text-ink"
                    >
                      {#if openingIsolatedAccountId === account.id}
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                      {:else}
                        <span class="i-lucide-copy-plus h-4 w-4"></span>
                      {/if}
                    </span>
                    <span class="flex-1">{copy.openCodexIsolated}</span>
                  </button>

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-danger shadow-none outline-none transition-colors duration-140 hover:bg-danger/10 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      removeAccount(account)
                      closeAccountActionMenu()
                    }}
                    disabled={loginActionBusy}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-danger transition-colors duration-140 group-hover:bg-[var(--paper)]"
                    >
                      <span class="i-lucide-trash-2 h-4 w-4"></span>
                    </span>
                    <span class="flex-1">{copy.deleteSaved}</span>
                  </button>

                  {#if assignableTags.length}
                    <div class="mx-2 my-1.5 border-t border-[var(--line)]"></div>
                    <button
                      class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
                      type="button"
                      onclick={() => openAccountTagMenuFromActionMenu(account.id)}
                    >
                      <span
                        class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--paper)] group-hover:text-ink"
                      >
                        <span class="i-lucide-tags h-4 w-4"></span>
                      </span>
                      <span class="flex-1">{copy.addTag}</span>
                      <span
                        class="i-lucide-chevron-right h-4 w-4 text-[var(--ink-faint)] transition-colors"
                      ></span>
                    </button>
                  {/if}
                </div>
              {/if}

              {#if accountTagMenuAccountId === account.id}
                <div
                  use:portal
                  use:floatingAnchor={{
                    anchorRect: accountTagMenuAnchorRect,
                    minWidth: 220,
                    matchAnchorWidth: true
                  }}
                  use:stopFloatingPointerPropagation
                  data-floating-root=""
                  transition:fly={{ y: -6, duration: 200 }}
                  class="theme-tag-picker-surface z-[999] w-[210px] rounded-[1.25rem] p-1.5"
                  style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                >
                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-faint)] shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] hover:text-ink active:scale-[0.98]"
                    type="button"
                    onclick={returnToAccountActionMenu}
                  >
                    <span class="i-lucide-chevron-left h-3.5 w-3.5 flex-none transition-colors"
                    ></span>
                    {copy.addTag}
                  </button>
                  <div class="mx-2 my-1 border-t border-[var(--line)]"></div>
                  <div class="mt-1 max-h-[300px] overflow-y-auto pr-1">
                    {#each assignableTags as tag (tag.id)}
                      <button
                        class="theme-tag-picker-item group flex w-full appearance-none items-center justify-between gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-ink shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                        type="button"
                        onclick={() => void addTagToAccount(account, tag.id)}
                        disabled={loginActionBusy || tagMutationBusy}
                      >
                        <span class="flex-1 truncate">{tag.name}</span>
                        <span
                          class="theme-tag-picker-plus inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--paper)] group-hover:text-ink"
                        >
                          <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          </div>

          {#if accountIndex < sortableAccounts.length - 1}
            <div class="theme-account-divider col-span-full"></div>
          {/if}
        </article>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="theme-tag-empty flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[0.875rem] border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 text-center"
  >
    <p class="text-sm text-muted-strong">{copy.noAccountsForFilter}</p>
  </div>
{/if}

<style>
  .scroll-row {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .scroll-row::-webkit-scrollbar {
    display: none;
  }

  .theme-account-divider {
    height: 1px;
    background: rgba(24, 24, 27, 0.08);
  }

  .theme-selection-toolbar-idle,
  .theme-selection-toolbar-active {
    opacity: 1;
  }

  .theme-workbench-toggle:hover .theme-workbench-chevron,
  .theme-workbench-toggle:focus-visible .theme-workbench-chevron {
    background: rgba(24, 24, 27, 0.06);
    color: var(--ink);
  }

  .theme-selection-group-button:disabled,
  .theme-selection-export:disabled,
  .theme-selection-delete:disabled {
    opacity: 1 !important;
    cursor: not-allowed;
  }

  .theme-selection-group {
    background: rgba(24, 24, 27, 0.04);
    border-color: rgba(24, 24, 27, 0.08);
  }

  .theme-selection-group-button {
    background: transparent;
    color: var(--ink);
  }

  .theme-selection-group-button:hover:not(:disabled) {
    background: rgba(24, 24, 27, 0.04);
  }

  .theme-selection-group-button:disabled,
  .theme-selection-export:disabled {
    color: var(--ink-faint) !important;
  }

  .theme-selection-group-button:disabled {
    background: transparent !important;
  }

  .theme-selection-export:disabled {
    background: rgba(24, 24, 27, 0.03) !important;
    border-color: rgba(24, 24, 27, 0.1) !important;
  }

  .theme-selection-delete:disabled {
    color: color-mix(in srgb, var(--danger) 72%, transparent) !important;
    background: rgba(239, 68, 68, 0.1) !important;
  }

  :global(html[data-theme='dark']) .theme-account-divider {
    background: var(--line) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-surface,
  :global(html[data-theme='dark']) .theme-tag-empty {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-assigned {
    background: rgb(16 185 129 / 0.14) !important;
    border-color: rgb(16 185 129 / 0.18) !important;
    color: rgb(167 243 208) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-remove {
    color: rgb(167 243 208 / 0.78) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-remove:hover {
    background: rgb(16 185 129 / 0.16) !important;
    color: rgb(209 250 229) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-plus {
    background: var(--surface-soft) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item {
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item:hover,
  :global(html[data-theme='dark']) .theme-tag-picker-item:focus-visible {
    background: color-mix(in srgb, var(--surface-hover) 88%, transparent) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item:hover .theme-tag-picker-plus,
  :global(html[data-theme='dark']) .theme-tag-picker-item:focus-visible .theme-tag-picker-plus {
    background: color-mix(in srgb, var(--ink) 10%, var(--surface-soft)) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-active {
    background: var(--ink) !important;
    color: var(--paper) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toolbar {
    background: color-mix(in srgb, var(--surface-soft) 90%, var(--panel) 10%) !important;
    border-color: var(--line) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle,
  :global(html[data-theme='dark']) .theme-workbench-summary-pill,
  :global(html[data-theme='dark']) .theme-workbench-chevron,
  :global(html[data-theme='dark']) .theme-workbench-empty {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle:hover {
    background: color-mix(in srgb, var(--surface-hover) 84%, var(--panel-strong) 16%) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle:hover .theme-workbench-chevron,
  :global(html[data-theme='dark']) .theme-workbench-toggle:focus-visible .theme-workbench-chevron {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-idle {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-idle:hover {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-toolbar-idle {
    color: var(--ink) !important;
    border-top-color: color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-toolbar-active {
    color: var(--ink) !important;
    border-top-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-group,
  :global(html[data-theme='dark']) .theme-selection-export {
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft) 16%) !important;
    border-color: color-mix(in srgb, var(--line) 78%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-divider {
    background: color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-group-button,
  :global(html[data-theme='dark']) .theme-selection-export {
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-group-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-hover) 86%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-group-button[disabled] {
    background: transparent !important;
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-group-button:hover,
  :global(html[data-theme='dark']) .theme-selection-export:hover {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-export[disabled] {
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft) 16%) !important;
    color: var(--ink-faint) !important;
    border-color: color-mix(in srgb, var(--line) 78%, transparent) !important;
  }

  .theme-reset-time-neutral {
    color: var(--ink-soft-strong);
  }

  :global(html[data-theme='dark']) .theme-selection-delete {
    border-color: rgb(239 68 68 / 0.18) !important;
    background: rgb(239 68 68 / 0.1) !important;
    color: rgb(252 165 165) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-delete[disabled] {
    border-color: rgb(239 68 68 / 0.12) !important;
    background: rgb(239 68 68 / 0.08) !important;
    color: rgb(252 165 165 / 0.76) !important;
  }

  :global(html[data-theme='dark']) .theme-account-card-selected {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
  }

  :global(html[data-theme='dark']) .theme-account-selector {
    border-color: var(--line) !important;
    background: var(--panel-strong) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-account-selector-input {
    accent-color: var(--ink);
  }

  :global(html[data-theme='dark']) .theme-reset-time-neutral {
    color: rgb(255 255 255 / 0.88) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-danger:hover {
    background: color-mix(in srgb, rgb(239 68 68) 12%, var(--surface-hover)) !important;
  }
</style>
