<script lang="ts">
  import { flip } from 'svelte/animate'
  import { onMount } from 'svelte'
  import { dragHandle, dragHandleZone, type DndEvent as SortEvent } from 'svelte-dnd-action'
  import type {
    AccountRateLimits,
    AccountSummary,
    AccountTag,
    AppLanguage,
    CustomProviderDetail,
    CustomProviderSummary,
    UpdateCustomProviderInput
  } from '../../../shared/codex'
  import { formatRelativeReset, remainingPercent } from '../../../shared/codex'
  import {
    accountUsageBadge,
    accountCardTone,
    accountEmail,
    extraLimits,
    limitLabel,
    planLabel,
    planTagClass,
    providerLabel,
    progressWidth,
    weeklyResetTimeToneClass,
    type LocalizedCopy
  } from './app-view'

  const untaggedFilterId = '__untagged__'
  const flipDurationMs = 160

  export let panelClass: string
  export let primaryActionButton: string
  export let compactGhostButton: string
  export let iconRowButton: string
  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let providers: CustomProviderSummary[] = []
  export let tags: AccountTag[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let openingAccountId = ''
  export let openingIsolatedAccountId = ''
  export let openingProviderId = ''
  export let openAccountInCodex: (accountId: string) => void
  export let openAccountInIsolatedCodex: (accountId: string) => void
  export let openProviderInCodex: (providerId: string) => Promise<void>
  export let getProvider: (providerId: string) => Promise<CustomProviderDetail>
  export let reorderProviders: (providerIds: string[]) => Promise<void>
  export let updateProvider: (providerId: string, input: UpdateCustomProviderInput) => Promise<void>
  export let removeProvider: (providerId: string) => Promise<void>
  export let reorderAccounts: (accountIds: string[]) => Promise<void>
  export let createTag: (name: string) => Promise<void>
  export let updateTag: (tag: AccountTag, name: string) => Promise<void>
  export let deleteTag: (tag: AccountTag) => Promise<void>
  export let updateAccountTags: (account: AccountSummary, tagIds: string[]) => Promise<void>
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let removeAccount: (account: AccountSummary) => void
  export let removeAccounts: (accountIds: string[]) => Promise<void>
  export let exportSelectedAccounts: (accountIds: string[]) => Promise<void>
  export let startLogin: (method: 'browser' | 'device') => void
  export let importCurrent: () => void

  let currentView: 'accounts' | 'providers' | 'tags' = 'accounts'
  let activeTagFilter = 'all'
  let newTagName = ''
  let editingTagId: string | null = null
  let editingTagName = ''
  let tagMutationBusy = false
  let tagPickerAccountId: string | null = null
  let tagPickerAnchorRect: DOMRect | null = null
  let sortableAccounts: AccountSummary[] = []
  let sortInteractionActive = false
  let sortableProviders: CustomProviderSummary[] = []
  let providerSortInteractionActive = false
  let providerMutationBusy = false
  let editingProviderId = ''
  let selectedAccountIds: string[] = []
  let accountWorkbenchExpanded = false
  let providerDrafts: Record<
    string,
    { name: string; baseUrl: string; apiKey: string; model: string; fastMode: boolean }
  > = {}

  $: if (
    activeTagFilter !== 'all' &&
    activeTagFilter !== untaggedFilterId &&
    !tags.some((tag) => tag.id === activeTagFilter)
  ) {
    activeTagFilter = 'all'
  }

  $: visibleAccounts = accounts.filter((account) => {
    if (activeTagFilter === 'all') {
      return true
    }

    if (activeTagFilter === untaggedFilterId) {
      return account.tagIds.length === 0
    }

    return account.tagIds.includes(activeTagFilter)
  })

  $: {
    const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id))
    const nextSelectedAccountIds = selectedAccountIds.filter((accountId) =>
      visibleAccountIds.has(accountId)
    )
    if (nextSelectedAccountIds.length !== selectedAccountIds.length) {
      selectedAccountIds = nextSelectedAccountIds
    }
  }

  $: if (!sortInteractionActive) {
    sortableAccounts = visibleAccounts
  }

  $: if (!providerSortInteractionActive) {
    sortableProviders = providers
  }

  $: {
    const nextDrafts: typeof providerDrafts = {}
    for (const provider of providers) {
      nextDrafts[provider.id] = providerDrafts[provider.id] ?? {
        name: provider.name ?? '',
        baseUrl: provider.baseUrl,
        apiKey: '',
        model: provider.model,
        fastMode: provider.fastMode
      }
    }
    providerDrafts = nextDrafts
  }

  $: if (currentView !== 'accounts') {
    tagPickerAccountId = null
  }

  $: selectedVisibleCount = selectedAccountIds.length
  $: allVisibleSelected =
    visibleAccounts.length > 0 && selectedVisibleCount === visibleAccounts.length
  $: showAccountFilterTools = accounts.length > 0 || tags.length > 0
  $: showAccountSelectionTools = visibleAccounts.length > 0 || selectedVisibleCount > 0

  function selectAllVisibleAccounts(): void {
    selectedAccountIds = visibleAccounts.map((account) => account.id)
  }

  function clearSelectedAccounts(): void {
    selectedAccountIds = []
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

  function accountTags(account: AccountSummary): AccountTag[] {
    return tags.filter((tag) => account.tagIds.includes(tag.id))
  }

  function availableTags(account: AccountSummary): AccountTag[] {
    return tags.filter((tag) => !account.tagIds.includes(tag.id))
  }

  function filterCount(tagId: string): number {
    if (tagId === 'all') {
      return accounts.length
    }

    if (tagId === untaggedFilterId) {
      return accounts.filter((account) => account.tagIds.length === 0).length
    }

    return accounts.filter((account) => account.tagIds.includes(tagId)).length
  }

  function tagFilterLabel(tagId: string): string {
    if (tagId === 'all') {
      return copy.allTags
    }

    if (tagId === untaggedFilterId) {
      return copy.untagged
    }

    return tags.find((tag) => tag.id === tagId)?.name ?? copy.allTags
  }

  function filterChipLabel(tagId: string): string {
    const label = tagFilterLabel(tagId)
    const count = filterCount(tagId)

    return count > 0 ? `${label} · ${count}` : label
  }

  function taggedAccountCount(tagId: string): number {
    return accounts.filter((account) => account.tagIds.includes(tagId)).length
  }

  function accountActionBusy(accountId: string): boolean {
    return openingAccountId === accountId || openingIsolatedAccountId === accountId
  }

  function providerActionBusy(providerId: string): boolean {
    return openingProviderId === providerId || providerMutationBusy
  }

  async function runProviderMutation(task: () => Promise<void>): Promise<void> {
    if (providerMutationBusy || loginActionBusy) {
      return
    }

    providerMutationBusy = true
    try {
      await task()
    } finally {
      providerMutationBusy = false
    }
  }

  async function startEditingProvider(provider: CustomProviderSummary): Promise<void> {
    editingProviderId = provider.id
    const detail = await getProvider(provider.id)
    providerDrafts = {
      ...providerDrafts,
      [provider.id]: {
        name: detail.name ?? '',
        baseUrl: detail.baseUrl,
        apiKey: detail.apiKey,
        model: detail.model,
        fastMode: detail.fastMode
      }
    }
  }

  function cancelEditingProvider(): void {
    editingProviderId = ''
  }

  async function saveProvider(provider: CustomProviderSummary): Promise<void> {
    const draft = providerDrafts[provider.id]
    if (!draft) {
      return
    }

    const input: UpdateCustomProviderInput = {}
    if ((draft.name.trim() || '') !== (provider.name ?? '')) {
      input.name = draft.name.trim()
    }
    if (draft.baseUrl.trim() !== provider.baseUrl) {
      input.baseUrl = draft.baseUrl.trim()
    }
    if (draft.apiKey.trim()) {
      input.apiKey = draft.apiKey.trim()
    }
    if ((draft.model.trim() || '5.4') !== provider.model) {
      input.model = draft.model.trim() || '5.4'
    }
    if (draft.fastMode !== provider.fastMode) {
      input.fastMode = draft.fastMode
    }
    if (!Object.keys(input).length) {
      cancelEditingProvider()
      return
    }

    await runProviderMutation(async () => {
      await updateProvider(provider.id, input)
      cancelEditingProvider()
    })
  }

  async function confirmRemoveProvider(provider: CustomProviderSummary): Promise<void> {
    if (!window.confirm(copy.deleteProviderConfirm(providerLabel(provider, copy)))) {
      return
    }

    await runProviderMutation(async () => {
      await removeProvider(provider.id)
      if (editingProviderId === provider.id) {
        cancelEditingProvider()
      }
    })
  }

  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)

    return {
      destroy: () => {
        node.remove()
      }
    }
  }

  function stopClickPropagation(node: HTMLElement): { destroy: () => void } {
    const handler = (event: MouseEvent): void => {
      event.stopPropagation()
    }

    node.addEventListener('click', handler)

    return {
      destroy: () => {
        node.removeEventListener('click', handler)
      }
    }
  }

  function floatingTagPicker(
    node: HTMLElement,
    anchorRect: DOMRect | null
  ): { update: (nextAnchorRect: DOMRect | null) => void; destroy: () => void } {
    let currentAnchorRect = anchorRect

    const applyPosition = (): void => {
      if (!currentAnchorRect) {
        return
      }

      const viewportPadding = 12
      const gap = 6
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      const minWidth = Math.max(220, Math.round(currentAnchorRect.width))

      node.style.position = 'fixed'
      node.style.minWidth = `${minWidth}px`

      const measuredWidth = Math.max(node.offsetWidth, minWidth)
      const measuredHeight = node.offsetHeight
      const maxLeft = Math.max(viewportPadding, viewportWidth - measuredWidth - viewportPadding)
      const left = Math.min(Math.max(currentAnchorRect.left, viewportPadding), maxLeft)

      const belowTop = currentAnchorRect.bottom + gap
      const aboveTop = currentAnchorRect.top - measuredHeight - gap
      const fitsBelow = belowTop + measuredHeight <= viewportHeight - viewportPadding
      const fitsAbove = aboveTop >= viewportPadding
      const top = fitsBelow
        ? belowTop
        : fitsAbove
          ? aboveTop
          : Math.min(
              Math.max(viewportPadding, belowTop),
              Math.max(viewportPadding, viewportHeight - measuredHeight - viewportPadding)
            )

      node.style.left = `${Math.round(left)}px`
      node.style.top = `${Math.round(top)}px`
    }

    const rafId = requestAnimationFrame(applyPosition)

    return {
      update: (nextAnchorRect) => {
        currentAnchorRect = nextAnchorRect
        requestAnimationFrame(applyPosition)
      },
      destroy: () => {
        cancelAnimationFrame(rafId)
      }
    }
  }

  async function runTagMutation(task: () => Promise<void>): Promise<void> {
    if (loginActionBusy || tagMutationBusy) {
      return
    }

    tagMutationBusy = true

    try {
      await task()
    } finally {
      tagMutationBusy = false
    }
  }

  async function submitNewTag(): Promise<void> {
    const name = newTagName.trim()
    if (!name) {
      return
    }

    await runTagMutation(async () => {
      await createTag(name)
      newTagName = ''
    })
  }

  function beginEditingTag(tag: AccountTag): void {
    editingTagId = tag.id
    editingTagName = tag.name
  }

  function cancelEditingTag(): void {
    editingTagId = null
    editingTagName = ''
  }

  async function saveEditedTag(tag: AccountTag): Promise<void> {
    const name = editingTagName.trim()
    if (!name) {
      return
    }

    await runTagMutation(async () => {
      await updateTag(tag, name)
      cancelEditingTag()
    })
  }

  async function confirmDeleteTag(tag: AccountTag): Promise<void> {
    if (!window.confirm(copy.deleteTagConfirm(tag.name))) {
      return
    }

    await runTagMutation(async () => {
      await deleteTag(tag)
      if (editingTagId === tag.id) {
        cancelEditingTag()
      }
    })
  }

  async function addTagToAccount(account: AccountSummary, tagId: string): Promise<void> {
    await runTagMutation(async () => {
      await updateAccountTags(account, [...account.tagIds, tagId])
      tagPickerAccountId = null
    })
  }

  async function removeTagFromAccount(account: AccountSummary, tagId: string): Promise<void> {
    await runTagMutation(async () => {
      await updateAccountTags(
        account,
        account.tagIds.filter((id) => id !== tagId)
      )
    })
  }

  function toggleTagPicker(event: MouseEvent, accountId: string): void {
    event.stopPropagation()

    if (tagPickerAccountId === accountId) {
      closeTagPicker()
      return
    }

    const trigger = event.currentTarget as HTMLElement | null
    if (!trigger) {
      return
    }

    tagPickerAnchorRect = trigger.getBoundingClientRect()
    tagPickerAccountId = accountId
  }

  function closeTagPicker(): void {
    tagPickerAccountId = null
    tagPickerAnchorRect = null
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

  function handleProviderSortConsider(event: CustomEvent<SortEvent<CustomProviderSummary>>): void {
    providerSortInteractionActive = true
    sortableProviders = event.detail.items
  }

  async function handleProviderSortFinalize(
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ): Promise<void> {
    sortableProviders = event.detail.items

    try {
      await reorderProviders(event.detail.items.map((provider) => provider.id))
    } finally {
      providerSortInteractionActive = false
    }
  }

  onMount(() => {
    const handleScroll = (): void => {
      closeTagPicker()
    }

    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
    }
  })
</script>

<svelte:window onclick={closeTagPicker} onresize={closeTagPicker} />

<section class={`${panelClass} flex min-h-0 flex-1 flex-col gap-4 overflow-hidden`}>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="grid gap-0.5">
      <div class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
        {currentView === 'tags'
          ? copy.tagManager
          : currentView === 'providers'
            ? copy.providerList
            : copy.accountList}
      </div>
      <div class="text-sm font-medium text-ink">
        {currentView === 'tags'
          ? `${tags.length} ${copy.tagManager}`
          : currentView === 'providers'
            ? copy.providerCount(providers.length)
            : copy.accountCount(accounts.length)}
      </div>
    </div>

    <div
      class="theme-toolbar inline-flex items-center gap-1 rounded-[0.8rem] border border-black/8 bg-black/[0.03] p-1"
    >
      <button
        class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          currentView === 'accounts'
            ? 'theme-view-toggle-active bg-white text-ink'
            : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
        }`}
        type="button"
        onclick={() => {
          currentView = 'accounts'
        }}
      >
        <span class="i-lucide-layout-list h-4 w-4"></span>
        <span>{copy.accountCount(accounts.length)}</span>
      </button>
      <button
        class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          currentView === 'providers'
            ? 'theme-view-toggle-active bg-white text-ink'
            : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
        }`}
        type="button"
        onclick={() => {
          currentView = 'providers'
        }}
      >
        <span class="i-lucide-plug-zap h-4 w-4"></span>
        <span>{copy.providerCount(providers.length)}</span>
      </button>
      <button
        class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          currentView === 'tags'
            ? 'theme-view-toggle-active bg-white text-ink'
            : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
        }`}
        type="button"
        onclick={() => {
          currentView = 'tags'
        }}
      >
        <span class="i-lucide-tags h-4 w-4"></span>
        <span>{copy.tagManager}</span>
      </button>
    </div>
  </div>

  {#if currentView === 'tags'}
    <div
      class="theme-soft-panel theme-tag-manager-panel flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-[1rem] border border-black/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(250,250,250,0.92))] p-4"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <p class="text-sm text-muted-strong">
          {tags.length
            ? copy.tagSummary(
                tags.length,
                accounts.filter((account) => account.tagIds.length).length
              )
            : copy.noTags}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          class="theme-tag-input min-w-[220px] flex-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
          type="text"
          bind:value={newTagName}
          placeholder={copy.newTagPlaceholder}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              void submitNewTag()
            }
          }}
          disabled={loginActionBusy || tagMutationBusy}
        />
        <button
          class={`theme-tag-create-button ${compactGhostButton} min-w-[120px] px-3 py-2.5`}
          type="button"
          onclick={() => void submitNewTag()}
          disabled={loginActionBusy || tagMutationBusy || !newTagName.trim()}
        >
          <span class="i-lucide-plus h-4 w-4"></span>
          <span>{copy.createTag}</span>
        </button>
      </div>

      {#if tags.length}
        <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
          {#each tags as tag (tag.id)}
            <div
              class="theme-tag-manager-card flex-none rounded-[0.95rem] border border-black/8 bg-white px-3.5 py-2.5"
            >
              <div class={`grid gap-2 ${taggedAccountCount(tag.id) ? 'pb-2' : ''}`}>
                {#if editingTagId === tag.id}
                  <div class="flex flex-wrap items-center gap-2">
                    <input
                      class="theme-tag-input min-w-[180px] flex-1 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                      type="text"
                      bind:value={editingTagName}
                      onkeydown={(event) => {
                        if (event.key === 'Enter') {
                          void saveEditedTag(tag)
                        }
                      }}
                      disabled={loginActionBusy || tagMutationBusy}
                    />
                    <button
                      class={`${compactGhostButton} px-3 py-2`}
                      type="button"
                      onclick={() => void saveEditedTag(tag)}
                      disabled={loginActionBusy || tagMutationBusy || !editingTagName.trim()}
                    >
                      {copy.save}
                    </button>
                    <button
                      class={`${compactGhostButton} px-3 py-2`}
                      type="button"
                      onclick={cancelEditingTag}
                      disabled={loginActionBusy || tagMutationBusy}
                    >
                      {copy.cancel}
                    </button>
                  </div>
                {:else}
                  <div class="flex items-center gap-3">
                    <span
                      class="theme-tag-count-pill inline-flex items-center rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-black/72"
                    >
                      {copy.taggedAccountCount(taggedAccountCount(tag.id))}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {tag.name}
                    </span>
                    <div class="flex items-center gap-1">
                      <button
                        class={iconRowButton}
                        type="button"
                        onclick={() => beginEditingTag(tag)}
                        disabled={loginActionBusy || tagMutationBusy}
                        aria-label={`${copy.editTag} · ${tag.name}`}
                        title={copy.renameTag}
                      >
                        <span class="i-lucide-pencil h-4 w-4"></span>
                      </button>
                      <button
                        class={iconRowButton}
                        type="button"
                        onclick={() => void confirmDeleteTag(tag)}
                        disabled={loginActionBusy || tagMutationBusy}
                        aria-label={`${copy.deleteTag} · ${tag.name}`}
                        title={copy.deleteTag}
                      >
                        <span class="i-lucide-trash-2 h-4 w-4"></span>
                      </button>
                    </div>
                  </div>
                {/if}
              </div>

              {#if taggedAccountCount(tag.id)}
                <div class="flex flex-wrap gap-1.5 border-t border-black/6 pt-2">
                  {#each accounts.filter( (account) => account.tagIds.includes(tag.id) ) as account (account.id)}
                    <span
                      class="theme-tag-linked inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                    >
                      {accountEmail(account, copy)}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div
          class="theme-tag-empty rounded-[0.95rem] border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center"
        >
          <p class="text-sm text-faint">{copy.noTags}</p>
        </div>
      {/if}
    </div>
  {:else if currentView === 'accounts'}
    <div
      class="theme-workbench-toolbar grid gap-2 rounded-[0.9rem] border border-black/8 bg-black/[0.02] px-2.5 py-2.5"
    >
      <button
        class="theme-workbench-toggle flex w-full items-center justify-between gap-3 rounded-[0.8rem] border border-black/8 bg-white/[0.84] px-3 py-2 text-left transition-colors duration-140 hover:bg-white"
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
        <div class="min-w-0 grid gap-1">
          <div class="flex items-center gap-1.5">
            <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 text-muted-strong"></span>
            <span class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.filtersAndBulkActions}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            {#if activeTagFilter !== 'all'}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-full border border-black/8 bg-white px-2 py-1 text-[11px] font-medium text-ink"
              >
                <span class="i-lucide-tags h-3 w-3 text-muted-strong"></span>
                <span>{tagFilterLabel(activeTagFilter)}</span>
              </span>
            {/if}

            {#if selectedVisibleCount}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-full border border-black/8 bg-white px-2 py-1 text-[11px] font-medium text-ink"
              >
                <span class="i-lucide-check-check h-3 w-3 text-muted-strong"></span>
                <span>{copy.selectedAccountCount(selectedVisibleCount)}</span>
              </span>
            {/if}

            {#if activeTagFilter === 'all' && !selectedVisibleCount}
              <span class="text-[11px] text-muted-strong">
                {accounts.length
                  ? copy.accountCount(visibleAccounts.length)
                  : copy.emptyFilterTools}
              </span>
            {/if}
          </div>
        </div>

        <span
          class={`theme-workbench-chevron inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/8 bg-white text-black/58 transition-[transform,background-color,color] duration-180 ${
            accountWorkbenchExpanded ? 'rotate-180' : ''
          }`}
        >
          <span class="i-lucide-chevron-down h-4 w-4"></span>
        </span>
      </button>

      {#if accountWorkbenchExpanded}
        <div id="account-workbench-panel" class="grid gap-3 px-0.5 pb-0.5">
          {#if showAccountFilterTools}
            <div class="grid gap-1.5">
              <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {copy.filterByTag}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <button
                  class={`theme-filter-chip rounded-full px-2 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                    activeTagFilter === 'all'
                      ? 'theme-filter-chip-active bg-black text-white'
                      : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
                  }`}
                  type="button"
                  onclick={() => {
                    activeTagFilter = 'all'
                  }}
                >
                  {filterChipLabel('all')}
                </button>
                <button
                  class={`theme-filter-chip rounded-full px-2 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                    activeTagFilter === untaggedFilterId
                      ? 'theme-filter-chip-active bg-black text-white'
                      : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
                  }`}
                  type="button"
                  onclick={() => {
                    activeTagFilter = untaggedFilterId
                  }}
                >
                  {filterChipLabel(untaggedFilterId)}
                </button>
                {#each tags as tag (tag.id)}
                  <button
                    class={`theme-filter-chip rounded-full px-2 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                      activeTagFilter === tag.id
                        ? 'theme-filter-chip-active bg-black text-white'
                        : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
                    }`}
                    type="button"
                    onclick={() => {
                      activeTagFilter = tag.id
                    }}
                  >
                    {filterChipLabel(tag.id)}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#if showAccountSelectionTools}
            <div
              class={`theme-selection-toolbar flex flex-wrap items-center justify-between gap-2 border-t border-black/6 pt-3 ${
                selectedVisibleCount
                  ? 'theme-selection-toolbar-active'
                  : 'theme-selection-toolbar-idle'
              }`}
            >
              <div class="grid gap-0.5">
                <div class="text-[12px] font-medium leading-none text-ink">
                  {selectedVisibleCount
                    ? copy.selectedAccountCount(selectedVisibleCount)
                    : copy.accountCount(visibleAccounts.length)}
                </div>
                {#if activeTagFilter !== 'all'}
                  <div class="text-[9px] uppercase tracking-[0.08em] text-faint">
                    {copy.filterByTag} · {tagFilterLabel(activeTagFilter)}
                  </div>
                {/if}
              </div>

              <div class="flex flex-wrap items-center justify-end gap-1.5">
                {#if visibleAccounts.length && !allVisibleSelected}
                  <button
                    class="theme-selection-group-button inline-flex min-w-[108px] items-center justify-center gap-1.5 rounded-[0.7rem] border border-black/8 bg-white/[0.72] px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors duration-140"
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
                    class="theme-selection-group-button inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-[0.7rem] border border-black/8 bg-white/[0.72] px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors duration-140"
                    type="button"
                    onclick={clearSelectedAccounts}
                    disabled={loginActionBusy}
                  >
                    <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                    <span>{copy.clearSelectedAccounts}</span>
                  </button>

                  <button
                    class="theme-selection-export inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-[0.7rem] border border-black/8 bg-white/[0.72] px-2.5 py-1.5 text-[11px] font-medium leading-none text-ink transition-colors duration-140 hover:bg-black/[0.04]"
                    type="button"
                    onclick={() => void exportCurrentSelection()}
                    disabled={loginActionBusy}
                  >
                    <span class="i-lucide-download h-3.5 w-3.5"></span>
                    <span>{copy.exportSelectedAccounts}</span>
                  </button>

                  <button
                    class="theme-selection-delete inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-[0.7rem] border border-red-500/14 bg-red-500/[0.08] px-2.5 py-1.5 text-[11px] font-medium leading-none text-danger transition-colors duration-140 hover:bg-red-500/[0.12]"
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
              class="theme-workbench-empty rounded-[0.85rem] border border-dashed border-black/8 bg-white/[0.62] px-3 py-3 text-[12px] text-muted-strong"
            >
              {copy.emptyFilterTools}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if visibleAccounts.length}
      <div class="grid min-h-0 gap-2 overflow-y-auto pr-1">
        <div
          class="grid gap-2"
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
              outline: '2px solid rgba(0,0,0,0.16)',
              borderRadius: '0.875rem'
            },
            delayTouchStart: true
          }}
          onconsider={handleSortConsider}
          onfinalize={(event) => void handleSortFinalize(event)}
          aria-label={copy.accountCount(sortableAccounts.length)}
        >
          {#each sortableAccounts as account (account.id)}
            {@const usageBadge = accountUsageBadge(
              usageErrorByAccountId[account.id],
              account,
              copy
            )}
            <article
              class={`group grid items-center gap-3 rounded-[0.95rem] border px-3 py-2.5 transition-[border-color,box-shadow,transform,background-color] duration-180 md:grid-cols-[auto_minmax(0,1fr)_auto] ${
                selectedAccountIds.includes(account.id)
                  ? 'theme-account-card-selected border-black/10 bg-white'
                  : accountCardTone(activeAccountId === account.id)
              }`}
              animate:flip={{ duration: flipDurationMs }}
              aria-label={accountEmail(account, copy)}
            >
              <div class="flex items-center gap-2">
                <label
                  class={`theme-account-selector inline-flex h-8 w-8 flex-none items-center justify-center rounded-[0.75rem] border transition-[border-color,background-color,box-shadow] duration-180 ${
                    selectedAccountIds.includes(account.id)
                      ? 'border-black/18 bg-white text-black'
                      : 'border-black/10 bg-white/80 text-black/72'
                  }`}
                  title={copy.selectAccount}
                >
                  <input
                    class="theme-account-selector-input h-4 w-4 accent-black"
                    type="checkbox"
                    value={account.id}
                    bind:group={selectedAccountIds}
                    disabled={loginActionBusy}
                    aria-label={`${copy.selectAccount} · ${accountEmail(account, copy)}`}
                  />
                </label>
                <button
                  class={`${iconRowButton} h-8 w-8 self-center text-black/42 ${activeTagFilter === 'all' ? 'cursor-grab active:cursor-grabbing' : ''}`}
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

              <div class="flex min-w-0 items-center gap-3 overflow-visible">
                <div class="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
                  <span
                    class={`h-2 w-2 flex-none rounded-full ${activeAccountId === account.id ? 'theme-status-active bg-success ring-3 ring-emerald-500/12' : 'theme-status-idle bg-black/14'}`}
                  ></span>
                  <p class="max-w-[220px] truncate text-sm font-medium">
                    {accountEmail(account, copy)}
                  </p>
                  {#if activeAccountId === account.id}
                    <span
                      class="theme-active-pill inline-flex flex-none items-center rounded-full bg-black px-2 py-0.75 text-[10px] font-medium text-white/88"
                    >
                      {copy.active}
                    </span>
                  {/if}
                  {#if usageBadge}
                    <span
                      class={`inline-flex min-w-0 max-w-[260px] items-center rounded-full border px-2 py-0.75 text-[11px] ${
                        usageBadge.kind === 'expired'
                          ? 'border-red-700/18 bg-red-700/8 text-red-700'
                          : usageBadge.kind === 'workspace'
                            ? 'border-orange-500/20 bg-orange-500/10 text-orange-700'
                            : 'border-amber-500/18 bg-amber-500/10 text-amber-700'
                      }`}
                      title={usageBadge.title}
                    >
                      <span class="min-w-0 truncate">{usageBadge.detail}</span>
                    </span>
                  {/if}
                  <span
                    class={`inline-flex flex-none items-center rounded-full px-2 py-0.75 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
                  >
                    {planLabel(usageByAccountId[account.id]?.planType)}
                  </span>
                  <div class="flex min-w-0 items-center gap-1.5">
                    <div
                      class="scroll-row flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1"
                    >
                      {#each accountTags(account) as tag (tag.id)}
                        <span
                          class="theme-tag-assigned inline-flex items-center rounded-full border border-emerald-500/14 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700"
                        >
                          <span class="max-w-28 truncate">{tag.name}</span>
                          <button
                            class="theme-tag-remove ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-transparent p-0 text-emerald-700/72 transition-colors duration-140 hover:bg-emerald-500/12 hover:text-emerald-800"
                            type="button"
                            onclick={() => void removeTagFromAccount(account, tag.id)}
                            disabled={loginActionBusy || tagMutationBusy}
                            aria-label={`${copy.removeTag} · ${tag.name}`}
                            title={copy.removeTag}
                          >
                            <span class="i-lucide-x h-3 w-3"></span>
                          </button>
                        </span>
                      {/each}
                    </div>

                    {#if availableTags(account).length}
                      <div class="flex-none" use:stopClickPropagation>
                        <button
                          class={`theme-tag-add-button inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11px] font-medium transition-[opacity,background-color,border-color,color] duration-140 ${
                            tagPickerAccountId === account.id
                              ? 'theme-tag-add-button-active border-black/16 bg-black/[0.08] text-black/80 opacity-100'
                              : 'pointer-events-none border-black/12 bg-black/[0.02] text-black/58 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:hover:bg-black/[0.05] group-focus-within:pointer-events-auto group-focus-within:opacity-100'
                          }`}
                          type="button"
                          onclick={(event) => toggleTagPicker(event, account.id)}
                          disabled={loginActionBusy || tagMutationBusy}
                          aria-label={`${copy.addTag} · ${accountEmail(account, copy)}`}
                          title={copy.addTag}
                        >
                          <span class="i-lucide-plus h-3.5 w-3.5"></span>
                          <span>{copy.addTag}</span>
                        </button>

                        {#if tagPickerAccountId === account.id}
                          <div
                            use:portal
                            use:floatingTagPicker={tagPickerAnchorRect}
                            use:stopClickPropagation
                            class="theme-tag-picker-surface z-[999] rounded-[0.9rem] border border-black/8 bg-white p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.12)]"
                          >
                            <div
                              class="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint"
                            >
                              {copy.addTag}
                            </div>
                            {#each availableTags(account) as tag (tag.id)}
                              <button
                                class="theme-tag-picker-item tag-picker-item flex w-full appearance-none items-center justify-between rounded-[0.7rem] border-0 bg-transparent px-2.5 py-2 text-left text-[12px] font-medium text-ink shadow-none outline-none transition-colors duration-140 hover:bg-black/[0.06]"
                                type="button"
                                onclick={() => void addTagToAccount(account, tag.id)}
                                disabled={loginActionBusy || tagMutationBusy}
                              >
                                <span class="truncate">{tag.name}</span>
                                <span
                                  class="theme-tag-picker-plus inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.04] text-black/45"
                                >
                                  <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                </span>
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>

                <div
                  class="scroll-row ml-auto flex flex-none items-center justify-end gap-2 overflow-x-auto whitespace-nowrap pb-1"
                >
                  <div
                    class="theme-soft-panel inline-flex items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[11px] text-muted-strong"
                    title={`${copy.sessionQuota} · ${
                      usageByAccountId[account.id]?.primary
                        ? `${remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%`
                        : '--'
                    }`}
                  >
                    <span class="font-medium">{copy.sessionReset}</span>
                    {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                      <span>…</span>
                    {:else if usageByAccountId[account.id]?.primary}
                      <span class="theme-reset-time-neutral"
                        >{formatRelativeReset(
                          usageByAccountId[account.id]?.primary?.resetsAt,
                          language
                        )}</span
                      >
                    {:else}
                      <span>--</span>
                    {/if}
                    <span
                      class="theme-progress-track h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                    >
                      <span
                        class="theme-progress-fill block h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                      ></span>
                    </span>
                    {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                      <span>…</span>
                    {:else if usageByAccountId[account.id]?.primary}
                      <span
                        >{remainingPercent(
                          usageByAccountId[account.id].primary?.usedPercent
                        )}%</span
                      >
                    {:else}
                      <span>-</span>
                    {/if}
                  </div>

                  <div
                    class="theme-soft-panel inline-flex items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[11px] text-muted-strong"
                    title={`${copy.weeklyQuota} · ${
                      usageByAccountId[account.id]?.secondary
                        ? `${remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%`
                        : '--'
                    }`}
                  >
                    <span class="font-medium">{copy.weeklyReset}</span>
                    {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                      <span>…</span>
                    {:else if usageByAccountId[account.id]?.secondary}
                      <span
                        class={weeklyResetTimeToneClass(
                          usageByAccountId[account.id]?.secondary?.resetsAt
                        )}
                        >{formatRelativeReset(
                          usageByAccountId[account.id]?.secondary?.resetsAt,
                          language
                        )}</span
                      >
                    {:else}
                      <span>--</span>
                    {/if}
                    <span
                      class="theme-progress-track h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                    >
                      <span
                        class="theme-progress-fill block h-full rounded-full bg-black/70"
                        style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                      ></span>
                    </span>
                    {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                      <span>…</span>
                    {:else if usageByAccountId[account.id]?.secondary}
                      <span
                        >{remainingPercent(
                          usageByAccountId[account.id].secondary?.usedPercent
                        )}%</span
                      >
                    {:else}
                      <span>-</span>
                    {/if}
                  </div>

                  {#if extraLimits(usageByAccountId, account.id).length}
                    {#each extraLimits(usageByAccountId, account.id) as limit (`${account.id}:${limit.limitId ?? 'extra'}`)}
                      <div
                        class="theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[11px]"
                      >
                        <span class="font-medium uppercase tracking-[0.08em]"
                          >{limitLabel(limit)}</span
                        >
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
              </div>

              <div class="flex items-center justify-end gap-1">
                <button
                  class={iconRowButton}
                  onclick={() => openAccountInCodex(account.id)}
                  disabled={loginActionBusy || Boolean(accountActionBusy(account.id))}
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
                  disabled={loginActionBusy || Boolean(accountActionBusy(account.id))}
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
                  disabled={loginActionBusy || usageLoadingByAccountId[account.id]}
                  aria-label={`${copy.refreshQuota} · ${accountEmail(account, copy)}`}
                  title={copy.refreshQuota}
                >
                  <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </button>
                <button
                  class={iconRowButton}
                  onclick={() => removeAccount(account)}
                  disabled={loginActionBusy}
                  aria-label={`${copy.deleteSaved} · ${accountEmail(account, copy)}`}
                  title={copy.deleteSaved}
                >
                  <span class="i-lucide-trash-2 h-4 w-4"></span>
                </button>
              </div>
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
  {:else if currentView === 'providers'}
    {#if providers.length}
      <div class="grid min-h-0 gap-2 overflow-y-auto pr-1">
        <div
          class="grid gap-2"
          use:dragHandleZone={{
            items: sortableProviders,
            type: 'providers',
            flipDurationMs,
            dragDisabled: loginActionBusy || providerMutationBusy || sortableProviders.length < 2,
            autoAriaDisabled: false,
            zoneItemTabIndex: -1,
            dropTargetStyle: {
              outline: '2px solid rgba(0,0,0,0.16)',
              borderRadius: '0.875rem'
            },
            delayTouchStart: true
          }}
          onconsider={handleProviderSortConsider}
          onfinalize={(event) => void handleProviderSortFinalize(event)}
          aria-label={copy.providerCount(sortableProviders.length)}
        >
          {#each sortableProviders as provider (provider.id)}
            <article
              class="theme-provider-card group grid items-center gap-3 rounded-[0.8rem] border border-black/8 bg-white px-3 py-2 transition-[border-color,box-shadow,transform,background-color] duration-140 md:grid-cols-[auto_minmax(0,1fr)_auto]"
              animate:flip={{ duration: flipDurationMs }}
              aria-label={providerLabel(provider, copy)}
            >
              <button
                class={`${iconRowButton} h-8 w-8 self-center text-black/42 ${sortableProviders.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                type="button"
                use:dragHandle
                aria-label={`${copy.dragSortHandle} · ${providerLabel(provider, copy)}`}
                title={copy.dragSortHandle}
                disabled={loginActionBusy || providerMutationBusy || sortableProviders.length < 2}
              >
                <span class="i-lucide-grip-vertical h-4 w-4"></span>
              </button>

              <div class="flex min-w-0 items-center gap-3 overflow-visible">
                <div class="min-w-0 flex-1">
                  {#if editingProviderId === provider.id}
                    <div
                      class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,0.7fr)]"
                    >
                      <input
                        class="theme-provider-input rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                        bind:value={providerDrafts[provider.id].name}
                        placeholder={copy.providerNamePlaceholder}
                        disabled={loginActionBusy || providerMutationBusy}
                      />
                      <input
                        class="theme-provider-input rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                        bind:value={providerDrafts[provider.id].baseUrl}
                        placeholder={copy.providerBaseUrlPlaceholder}
                        disabled={loginActionBusy || providerMutationBusy}
                      />
                      <input
                        class="theme-provider-input rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                        bind:value={providerDrafts[provider.id].model}
                        placeholder={copy.providerModelPlaceholder}
                        disabled={loginActionBusy || providerMutationBusy}
                      />
                      <input
                        class="theme-provider-input rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16 md:col-span-2"
                        type="password"
                        bind:value={providerDrafts[provider.id].apiKey}
                        placeholder={copy.providerApiKeyPlaceholder}
                        disabled={loginActionBusy || providerMutationBusy}
                      />
                    </div>
                  {:else}
                    <div class="grid min-w-0 gap-1.5">
                      <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                        <span
                          class="theme-provider-status h-1.5 w-1.5 flex-none rounded-full bg-sky-500/55 ring-2 ring-sky-500/12"
                        ></span>
                        <p class="min-w-0 truncate text-sm font-medium text-ink">
                          {providerLabel(provider, copy)}
                        </p>
                        <span
                          class="theme-provider-badge inline-flex flex-none items-center rounded-full border border-sky-500/16 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700"
                        >
                          {copy.providerBadge}
                        </span>
                        {#if provider.fastMode}
                          <span
                            class="theme-provider-fast-badge inline-flex flex-none items-center rounded-full border border-emerald-500/16 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                          >
                            Fast
                          </span>
                        {/if}
                      </div>
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          class="theme-provider-meta theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.03] px-2 py-1 text-[11px] text-muted-strong"
                        >
                          <span class="font-medium uppercase tracking-[0.08em]">Model</span>
                          <span>{provider.model}</span>
                        </span>
                        <span
                          class="theme-provider-meta theme-soft-panel inline-flex min-w-0 items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.03] px-2 py-1 text-[11px] text-muted-strong"
                        >
                          <span class="font-medium uppercase tracking-[0.08em]">URL</span>
                          <span class="max-w-[340px] truncate">{provider.baseUrl}</span>
                        </span>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>

              <div class="flex items-center justify-end gap-1">
                {#if editingProviderId === provider.id}
                  <label
                    class="theme-provider-toggle mr-2 inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      bind:checked={providerDrafts[provider.id].fastMode}
                      disabled={loginActionBusy || providerMutationBusy}
                    />
                    <span>{copy.providerFastMode}</span>
                  </label>
                  <button
                    class={iconRowButton}
                    onclick={() => void saveProvider(provider)}
                    disabled={loginActionBusy || providerMutationBusy}
                    aria-label={`${copy.saveProvider} · ${providerLabel(provider, copy)}`}
                    title={copy.saveProvider}
                  >
                    <span class="i-lucide-check h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    onclick={cancelEditingProvider}
                    disabled={loginActionBusy || providerMutationBusy}
                    aria-label={`${copy.cancel} · ${providerLabel(provider, copy)}`}
                    title={copy.cancel}
                  >
                    <span class="i-lucide-x h-4 w-4"></span>
                  </button>
                {:else}
                  <button
                    class={iconRowButton}
                    onclick={() => void openProviderInCodex(provider.id)}
                    disabled={loginActionBusy || providerActionBusy(provider.id)}
                    aria-label={`${copy.openCustomProvider} · ${providerLabel(provider, copy)}`}
                    title={copy.openCustomProvider}
                  >
                    {#if openingProviderId === provider.id}
                      <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    {:else}
                      <span class="i-lucide-plug-zap h-4 w-4"></span>
                    {/if}
                  </button>
                  <button
                    class={iconRowButton}
                    onclick={() => void startEditingProvider(provider)}
                    disabled={loginActionBusy || providerMutationBusy}
                    aria-label={`${copy.editProvider} · ${providerLabel(provider, copy)}`}
                    title={copy.editProvider}
                  >
                    <span class="i-lucide-pencil h-4 w-4"></span>
                  </button>
                  <button
                    class={iconRowButton}
                    onclick={() => void confirmRemoveProvider(provider)}
                    disabled={loginActionBusy || providerMutationBusy}
                    aria-label={`${copy.deleteProvider} · ${providerLabel(provider, copy)}`}
                    title={copy.deleteProvider}
                  >
                    <span class="i-lucide-trash-2 h-4 w-4"></span>
                  </button>
                {/if}
              </div>
            </article>
          {/each}
        </div>
      </div>
    {:else}
      <div
        class="theme-tag-empty flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[0.875rem] border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 text-center"
      >
        <p class="text-sm text-muted-strong">{copy.noProviders}</p>
      </div>
    {/if}
  {:else}
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div class="w-full max-w-2xl px-4 py-8">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <span class="i-lucide-wallet-minimal h-6 w-6 text-muted-strong"></span>
        </div>

        <div class="mx-auto grid max-w-xl gap-2 text-center">
          <h3 class="text-lg font-semibold text-ink sm:text-xl">{copy.emptyStateTitle}</h3>
          <p class="text-sm leading-6 text-muted-strong">{copy.emptyStateDescription}</p>
        </div>

        <div class="mt-5 grid gap-4">
          <div class="flex flex-wrap items-center justify-center gap-2.5">
            <button
              class={primaryActionButton}
              onclick={() => startLogin('browser')}
              disabled={loginActionBusy}
            >
              <span
                class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
              ></span>
              <span>{copy.callbackLogin}</span>
            </button>

            <button class={`${compactGhostButton} px-4 py-3`} onclick={() => startLogin('device')}>
              <span class="i-lucide-key-round h-4.5 w-4.5"></span>
              <span>{copy.deviceLogin}</span>
            </button>

            <button
              class={`${compactGhostButton} px-4 py-3`}
              onclick={importCurrent}
              disabled={loginActionBusy}
            >
              <span class="i-lucide-plus h-4.5 w-4.5"></span>
              <span>{copy.importCurrent}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .scroll-row {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .scroll-row::-webkit-scrollbar {
    display: none;
  }

  .tag-picker-item:hover,
  .tag-picker-item:focus-visible {
    transform: none;
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

  :global(html[data-theme='dark']) .theme-view-toggle-active {
    background: var(--panel-strong) !important;
    color: var(--ink) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
  }

  :global(html[data-theme='dark']) .theme-view-toggle-idle {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-view-toggle-idle:hover {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-manager-panel {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--panel-strong) 92%, transparent),
      color-mix(in srgb, var(--panel) 96%, transparent)
    ) !important;
    border-color: var(--line-strong) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-manager-card,
  :global(html[data-theme='dark']) .theme-tag-picker-surface,
  :global(html[data-theme='dark']) .theme-tag-input,
  :global(html[data-theme='dark']) .theme-tag-empty {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-count-pill {
    background: var(--surface-soft) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-create-button {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-create-button:hover {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-linked,
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

  :global(html[data-theme='dark']) .theme-tag-add-button {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-add-button:hover {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-add-button-active {
    background: color-mix(in srgb, var(--surface-hover) 82%, var(--ink) 8%) !important;
    border-color: var(--line-strong) !important;
    color: var(--ink) !important;
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
