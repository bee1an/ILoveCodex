<script lang="ts">
  import { flip } from 'svelte/animate'
  import { dragHandle, dragHandleZone, type DndEvent as SortEvent } from 'svelte-dnd-action'
  import type { CustomProviderSummary } from '../../../shared/codex'
  import { providerLabel, type LocalizedCopy } from './app-view'
  import type { ProviderDraft } from './accounts-panel-provider'
  import Checkbox from './Checkbox.svelte'

  export let copy: LocalizedCopy
  export let iconRowButton: string
  export let providers: CustomProviderSummary[] = []
  export let sortableProviders: CustomProviderSummary[] = []
  export let flipDurationMs = 160
  export let loginActionBusy = false
  export let providerMutationBusy = false
  export let editingProviderId = ''
  export let providerDrafts: Record<string, ProviderDraft> = {}
  export let openingProviderId = ''
  export let providerActionBusy: (providerId: string) => boolean = () => false
  export let openProviderInCodex: (providerId: string) => Promise<void>
  export let startEditingProvider: (provider: CustomProviderSummary) => Promise<void>
  export let saveProvider: (provider: CustomProviderSummary) => Promise<void>
  export let cancelEditingProvider: () => void
  export let confirmRemoveProvider: (provider: CustomProviderSummary) => Promise<void>
  export let handleProviderSortConsider: (
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ) => void
  export let handleProviderSortFinalize: (
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ) => Promise<void>
</script>

{#if providers.length}
  <div class="min-h-0 flex-1 overflow-y-auto pr-1">
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
          class="theme-provider-card group grid items-center gap-3 rounded-[0.35rem] border border-black/8 bg-white px-3 py-2 transition-colors duration-140 md:grid-cols-[auto_minmax(0,1fr)_auto]"
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
                    class="theme-provider-input rounded-[0.35rem] border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                    bind:value={providerDrafts[provider.id].name}
                    placeholder={copy.providerNamePlaceholder}
                    disabled={loginActionBusy || providerMutationBusy}
                  />
                  <input
                    class="theme-provider-input rounded-[0.35rem] border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                    bind:value={providerDrafts[provider.id].baseUrl}
                    placeholder={copy.providerBaseUrlPlaceholder}
                    disabled={loginActionBusy || providerMutationBusy}
                  />
                  <input
                    class="theme-provider-input rounded-[0.35rem] border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                    bind:value={providerDrafts[provider.id].model}
                    placeholder={copy.providerModelPlaceholder}
                    disabled={loginActionBusy || providerMutationBusy}
                  />
                  <input
                    class="theme-provider-input rounded-[0.35rem] border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16 md:col-span-2"
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
                class="theme-provider-toggle mr-2 inline-flex items-center gap-2 rounded-[0.35rem] border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink"
              >
                <Checkbox
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
    class="theme-tag-empty flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[0.4rem] border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 text-center"
  >
    <p class="text-sm text-muted-strong">{copy.noProviders}</p>
  </div>
{/if}

<style>
  :global(html[data-theme='dark']) .theme-tag-empty {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }
</style>
