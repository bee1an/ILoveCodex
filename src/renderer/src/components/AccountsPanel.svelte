<script lang="ts">
  import type { DndEvent as SortEvent } from 'svelte-dnd-action'

  import type {
    AccountRateLimits,
    AccountSummary,
    AccountTag,
    AccountWakeSchedule,
    AppLanguage,
    CodexInstanceSummary,
    CustomProviderDetail,
    CustomProviderSummary,
    StatsDisplaySettings,
    TokenCostDetail,
    TokenCostReadOptions,
    TokenCostSummary,
    UpdateCustomProviderInput
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AccountsListView from './AccountsListView.svelte'
  import AccountsProvidersView from './AccountsProvidersView.svelte'
  import AccountsTagsView from './AccountsTagsView.svelte'
  import CostStatsView from './CostStatsView.svelte'
  import { taggedAccountCount as taggedAccountCountForAccounts } from './accounts-panel-account'
  import {
    buildProviderUpdateInput,
    createProviderDraft,
    type ProviderDraft
  } from './accounts-panel-provider'
  import { providerLabel } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'

  const flipDurationMs = 160

  export let panelClass: string
  export let primaryActionButton: string
  export let compactGhostButton: string
  export let iconRowButton: string
  export let copy: LocalizedCopy
  export let workspaceVersion = '--'
  export let workspaceStatusText = ''
  export let workspaceStatusToneClass = 'text-muted-strong'
  export let updateSummary = ''
  export let updateActionLabel: string | null = null
  export let runUpdateAction: () => void = () => {}
  export let showLocalMockToggle = false
  export let language: AppLanguage
  export let showLocalMockData = true
  export let accounts: AccountSummary[] = []
  export let codexInstances: CodexInstanceSummary[] = []
  export let providers: CustomProviderSummary[] = []
  export let tags: AccountTag[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let tokenCostByInstanceId: Record<string, TokenCostSummary>
  export let tokenCostErrorByInstanceId: Record<string, string>
  export let runningTokenCostSummary: TokenCostSummary | null
  export let runningTokenCostInstanceIds: string[]
  export let statsDisplay: StatsDisplaySettings
  export let wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let openingAccountId = ''
  export let openingIsolatedAccountId = ''
  export let wakingAccountId = ''
  export let openingProviderId = ''
  export let openAccountInCodex: (accountId: string) => void
  export let openAccountInIsolatedCodex: (accountId: string) => void
  export let openWakeDialog: (account: AccountSummary, initialTab?: 'session' | 'schedule') => void
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
  export let updateShowLocalMockData: (enabled: boolean) => void
  export let updateStatsDisplay: (statsDisplay: StatsDisplaySettings) => Promise<void>
  export let removeAccount: (account: AccountSummary) => void
  export let removeAccounts: (accountIds: string[]) => Promise<void>
  export let exportSelectedAccounts: (accountIds: string[]) => Promise<void>
  export let readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>
  export let startLogin: (method: 'browser' | 'device') => void
  export let importCurrent: () => void

  let currentView: 'accounts' | 'providers' | 'tags' | 'stats' = 'accounts'
  let activeTagFilter = 'all'
  let newTagName = ''
  let editingTagId: string | null = null
  let editingTagName = ''
  let tagMutationBusy = false
  let selectedAccountIds: string[] = []
  let accountWorkbenchExpanded = false
  let sortableProviders: CustomProviderSummary[] = []
  let providerSortInteractionActive = false
  let providerMutationBusy = false
  let editingProviderId = ''
  let providerDrafts: Record<string, ProviderDraft> = {}

  $: if (!providerSortInteractionActive) {
    sortableProviders = providers
  }

  $: {
    const nextDrafts: typeof providerDrafts = {}
    for (const provider of providers) {
      nextDrafts[provider.id] = providerDrafts[provider.id] ?? createProviderDraft(provider)
    }
    providerDrafts = nextDrafts
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
      [provider.id]: createProviderDraft(detail)
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

    const input = buildProviderUpdateInput(provider, draft)
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

  async function updateAccountTagsWithProtection(
    account: AccountSummary,
    tagIds: string[]
  ): Promise<void> {
    await runTagMutation(async () => {
      await updateAccountTags(account, tagIds)
    })
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
</script>

<section
  class={`${panelClass} flex h-full min-h-0 flex-1 w-full flex-col gap-4 overflow-hidden`}
  use:reveal={{ delay: 0.05 }}
  use:cascadeIn={{ selector: '[data-panel-motion]' }}
>
  <div class="flex flex-wrap items-center justify-between gap-3" data-panel-motion>
    <div class="min-w-0 flex flex-1 items-center gap-3">
      <div class="min-w-0 grid gap-0.5">
        <div class="min-w-0 flex items-center gap-2">
          <span class="text-[13px] font-semibold tracking-[0.04em] text-ink/80">ILoveCodex</span>
          <span
            class="theme-version-pill inline-flex items-center rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-strong"
          >
            v{workspaceVersion}
          </span>
          {#if workspaceStatusText}
            <span
              class={`min-w-0 flex-1 truncate text-[11px] ${workspaceStatusToneClass}`}
              aria-live="polite"
            >
              {workspaceStatusText}
            </span>
          {/if}
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      {#if updateSummary}
        <span class="text-xs text-muted-strong" aria-live="polite">{updateSummary}</span>
      {/if}

      {#if showLocalMockToggle}
        <label
          class="inline-flex items-center gap-2 rounded-[0.8rem] border border-black/8 bg-black/[0.03] px-3 py-2 text-xs text-muted-strong"
        >
          <input
            type="checkbox"
            class="h-4 w-4 rounded border border-black/14"
            checked={showLocalMockData}
            onchange={(event) =>
              updateShowLocalMockData((event.currentTarget as HTMLInputElement).checked)}
          />
          <span>{copy.showLocalMockData}</span>
        </label>
      {/if}

      {#if updateActionLabel}
        <button class={compactGhostButton} type="button" onclick={runUpdateAction}>
          {updateActionLabel}
        </button>
      {/if}

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
        <button
          class={`theme-view-toggle inline-flex items-center gap-2 rounded-[0.7rem] px-3 py-2 text-sm font-medium transition-colors duration-140 ${
            currentView === 'stats'
              ? 'theme-view-toggle-active bg-white text-ink'
              : 'theme-view-toggle-idle bg-transparent text-black/60 hover:bg-black/[0.04]'
          }`}
          type="button"
          onclick={() => {
            currentView = 'stats'
          }}
        >
          <span class="i-lucide-chart-no-axes-combined h-4 w-4"></span>
          <span>{copy.tokenStats}</span>
        </button>
      </div>
    </div>
  </div>

  {#if currentView === 'stats'}
    <CostStatsView
      {copy}
      {language}
      {accounts}
      {codexInstances}
      {usageByAccountId}
      {tokenCostByInstanceId}
      {tokenCostErrorByInstanceId}
      {runningTokenCostSummary}
      {runningTokenCostInstanceIds}
      {statsDisplay}
      {compactGhostButton}
      {readTokenCost}
      {updateStatsDisplay}
    />
  {:else if currentView === 'tags'}
    <AccountsTagsView
      {compactGhostButton}
      {iconRowButton}
      {copy}
      {tags}
      {accounts}
      {loginActionBusy}
      {tagMutationBusy}
      bind:newTagName
      bind:editingTagId
      bind:editingTagName
      {submitNewTag}
      {beginEditingTag}
      {cancelEditingTag}
      {saveEditedTag}
      {confirmDeleteTag}
      taggedAccountCount={(tagId) => taggedAccountCountForAccounts(accounts, tagId)}
    />
  {:else if currentView === 'accounts'}
    <AccountsListView
      bind:activeTagFilter
      bind:selectedAccountIds
      bind:accountWorkbenchExpanded
      {iconRowButton}
      {copy}
      {language}
      {accounts}
      {tags}
      {activeAccountId}
      {usageByAccountId}
      {usageLoadingByAccountId}
      {usageErrorByAccountId}
      {wakeSchedulesByAccountId}
      {loginActionBusy}
      {tagMutationBusy}
      {openingAccountId}
      {openingIsolatedAccountId}
      {wakingAccountId}
      {openAccountInCodex}
      {openAccountInIsolatedCodex}
      {openWakeDialog}
      {reorderAccounts}
      updateAccountTags={updateAccountTagsWithProtection}
      {refreshAccountUsage}
      {removeAccount}
      {removeAccounts}
      {exportSelectedAccounts}
    />
  {:else if currentView === 'providers'}
    <AccountsProvidersView
      {copy}
      {iconRowButton}
      {providers}
      {sortableProviders}
      {flipDurationMs}
      {loginActionBusy}
      {providerMutationBusy}
      {editingProviderId}
      {providerDrafts}
      {openingProviderId}
      {providerActionBusy}
      {openProviderInCodex}
      {startEditingProvider}
      {saveProvider}
      {cancelEditingProvider}
      {confirmRemoveProvider}
      {handleProviderSortConsider}
      {handleProviderSortFinalize}
    />
  {:else}
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div class="w-full max-w-2xl px-4 py-8">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <span class="i-lucide-users-round h-6 w-6 text-muted-strong"></span>
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
              <span class="i-lucide-monitor-down h-4.5 w-4.5"></span>
              <span>{copy.importCurrent}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
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
</style>
