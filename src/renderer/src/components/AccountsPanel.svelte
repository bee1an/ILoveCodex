<script lang="ts">
  import { flip } from 'svelte/animate'
  import { onMount } from 'svelte'
  import { dragHandle, dragHandleZone, type DndEvent as SortEvent } from 'svelte-dnd-action'
  import type {
    AccountRateLimits,
    AccountSummary,
    AccountTag,
    AppLanguage
  } from '../../../shared/codex'
  import { formatRelativeReset, remainingPercent } from '../../../shared/codex'
  import {
    accountCardTone,
    accountEmail,
    extraLimits,
    limitLabel,
    planLabel,
    planTagClass,
    progressWidth,
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
  export let tags: AccountTag[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let openAccountInCodex: (accountId: string) => void
  export let activateAccount: (accountId: string) => void
  export let reorderAccounts: (accountIds: string[]) => Promise<void>
  export let createTag: (name: string) => Promise<void>
  export let updateTag: (tag: AccountTag, name: string) => Promise<void>
  export let deleteTag: (tag: AccountTag) => Promise<void>
  export let updateAccountTags: (account: AccountSummary, tagIds: string[]) => Promise<void>
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let removeAccount: (account: AccountSummary) => void
  export let startLogin: (method: 'browser' | 'device') => void
  export let importCurrent: () => void

  let showTagManager = false
  let activeTagFilter = 'all'
  let newTagName = ''
  let editingTagId: string | null = null
  let editingTagName = ''
  let tagMutationBusy = false
  let tagPickerAccountId: string | null = null
  let tagPickerAnchorRect: DOMRect | null = null
  let sortableAccounts: AccountSummary[] = []
  let sortInteractionActive = false

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

  $: if (!sortInteractionActive) {
    sortableAccounts = visibleAccounts
  }

  $: if (showTagManager) {
    tagPickerAccountId = null
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

  function taggedAccountCount(tagId: string): number {
    return accounts.filter((account) => account.tagIds.includes(tagId)).length
  }

  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)

    return {
      destroy: () => {
        node.remove()
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
    <div class="grid gap-1">
      <div class="text-sm text-faint">{showTagManager ? copy.tagManager : copy.accountList}</div>
    </div>

    <div
      class="theme-toolbar inline-flex items-center gap-1 rounded-[0.9rem] border border-black/8 bg-black/[0.03] p-1"
    >
      <button
        class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          !showTagManager
            ? 'theme-view-toggle-active bg-white text-ink shadow-[0_8px_20px_rgba(24,24,27,0.08)]'
            : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
        }`}
        type="button"
        onclick={() => {
          showTagManager = false
        }}
      >
        <span class="i-lucide-layout-list h-4 w-4"></span>
        <span>{copy.accountCount(accounts.length)}</span>
      </button>
      <button
        class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          showTagManager
            ? 'theme-view-toggle-active bg-white text-ink shadow-[0_8px_20px_rgba(24,24,27,0.08)]'
            : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
        }`}
        type="button"
        onclick={() => {
          showTagManager = true
        }}
      >
        <span class="i-lucide-tags h-4 w-4"></span>
        <span>{copy.tagManager}</span>
      </button>
    </div>
  </div>

  {#if showTagManager}
    <div
      class="theme-soft-panel theme-tag-manager-panel flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-[1rem] border border-black/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(250,250,250,0.92))] p-4"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <p class="text-sm text-muted-strong">
          {tags.length
            ? copy.tagSummary(tags.length, accounts.filter((account) => account.tagIds.length).length)
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
  {:else if accounts.length}
    <div class="grid gap-3">
      <div
        class="theme-soft-panel grid gap-2 rounded-[0.95rem] border border-black/8 bg-black/[0.02] p-3"
      >
        <p class="text-xs font-medium uppercase tracking-[0.12em] text-faint">{copy.filterByTag}</p>
        <div class="flex flex-wrap gap-2">
          <button
            class={`theme-filter-chip rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-140 ${
              activeTagFilter === 'all'
                ? 'theme-filter-chip-active bg-black text-white'
                : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
            }`}
            type="button"
            onclick={() => {
              activeTagFilter = 'all'
            }}
          >
            {copy.allTags} · {filterCount('all')}
          </button>
          <button
            class={`theme-filter-chip rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-140 ${
              activeTagFilter === untaggedFilterId
                ? 'theme-filter-chip-active bg-black text-white'
                : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
            }`}
            type="button"
            onclick={() => {
              activeTagFilter = untaggedFilterId
            }}
          >
            {copy.untagged} · {filterCount(untaggedFilterId)}
          </button>
          {#each tags as tag (tag.id)}
            <button
              class={`theme-filter-chip rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-140 ${
                activeTagFilter === tag.id
                  ? 'theme-filter-chip-active bg-black text-white'
                  : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
              }`}
              type="button"
              onclick={() => {
                activeTagFilter = tag.id
              }}
            >
              {tag.name} · {filterCount(tag.id)}
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if visibleAccounts.length}
      <div
        class="grid min-h-0 gap-2 overflow-y-auto pr-1"
        use:dragHandleZone={{
          items: sortableAccounts,
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
          <article
            class={`group grid items-center gap-3 rounded-[0.875rem] border px-3 py-2.5 transition-[border-color,box-shadow,transform] duration-140 md:grid-cols-[auto_minmax(0,1fr)_auto] ${accountCardTone(activeAccountId === account.id)}`}
            animate:flip={{ duration: flipDurationMs }}
            aria-label={accountEmail(account, copy)}
          >
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
                    <div class="flex-none" onclick={(event) => event.stopPropagation()}>
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
                          class="theme-tag-picker-surface z-[999] rounded-[0.9rem] border border-black/8 bg-white p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.12)]"
                          onclick={(event) => event.stopPropagation()}
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
                  title={`${copy.sessionReset} · ${formatRelativeReset(
                    usageByAccountId[account.id]?.primary?.resetsAt,
                    language
                  )}`}
                >
                  <span class="font-medium">{copy.sessionQuota}</span>
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
                      >{remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%</span
                    >
                  {:else}
                    <span>-</span>
                  {/if}
                </div>

                <div
                  class="theme-soft-panel inline-flex items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[11px] text-muted-strong"
                  title={`${copy.weeklyReset} · ${formatRelativeReset(
                    usageByAccountId[account.id]?.secondary?.resetsAt,
                    language
                  )}`}
                >
                  <span class="font-medium">{copy.weeklyQuota}</span>
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
                disabled={loginActionBusy}
                aria-label={`${copy.openCodex} · ${accountEmail(account, copy)}`}
                title={copy.openCodex}
              >
                <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
              </button>
              <button
                class={iconRowButton}
                onclick={() => activateAccount(account.id)}
                disabled={loginActionBusy || activeAccountId === account.id}
                aria-label={`${copy.switchAccount} · ${accountEmail(account, copy)}`}
                title={copy.switchAccount}
              >
                <span class="i-lucide-repeat-2 h-4 w-4"></span>
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
    {:else}
      <div
        class="theme-tag-empty flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[0.875rem] border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 text-center"
      >
        <p class="text-sm text-muted-strong">{copy.noAccountsForFilter}</p>
      </div>
    {/if}
  {:else}
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div class="w-full max-w-xl px-4 py-8 text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <span class="i-lucide-wallet-minimal h-6 w-6 text-muted-strong"></span>
        </div>

        <div class="mx-auto grid max-w-xl gap-2">
          <h3 class="text-lg font-semibold text-ink sm:text-xl">{copy.emptyStateTitle}</h3>
          <p class="text-sm leading-6 text-muted-strong">{copy.emptyStateDescription}</p>
        </div>

        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            class={primaryActionButton}
            onclick={() => startLogin('browser')}
            disabled={loginActionBusy}
          >
            <span
              class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
            ></span>
            <span>{copy.browserLogin}</span>
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

  :global(html[data-theme='dark']) .theme-view-toggle-active {
    background: var(--panel-strong) !important;
    color: var(--ink) !important;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.06) inset,
      0 10px 22px rgba(0, 0, 0, 0.18) !important;
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

  :global(html[data-theme='dark']) .theme-filter-chip-idle {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-idle:hover {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }
</style>
