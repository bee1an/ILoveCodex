<script lang="ts">
  import type { AccountSummary, AccountTag } from '../../../shared/codex'
  import { accountEmail, type LocalizedCopy } from './app-view'

  export let compactGhostButton: string
  export let iconRowButton: string
  export let copy: LocalizedCopy
  export let tags: AccountTag[] = []
  export let accounts: AccountSummary[] = []
  export let loginActionBusy = false
  export let tagMutationBusy = false
  export let newTagName = ''
  export let editingTagId: string | null = null
  export let editingTagName = ''
  export let submitNewTag: () => Promise<void>
  export let beginEditingTag: (tag: AccountTag) => void
  export let cancelEditingTag: () => void
  export let saveEditedTag: (tag: AccountTag) => Promise<void>
  export let confirmDeleteTag: (tag: AccountTag) => Promise<void>
  export let taggedAccountCount: (tagId: string) => number

  function taggedAccounts(tagId: string): AccountSummary[] {
    return accounts.filter((account) => account.tagIds.includes(tagId))
  }
</script>

<div
  class="theme-soft-panel theme-tag-manager-panel flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-[1rem] border border-black/8 bg-white p-4"
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
      class="theme-tag-input min-w-[220px] flex-1 rounded-[0.35rem] border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
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
          class="theme-tag-manager-card flex-none rounded-[0.4rem] border border-black/8 bg-white px-3.5 py-2.5"
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
              {#each taggedAccounts(tag.id) as account (account.id)}
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
      class="theme-tag-empty rounded-[0.4rem] border border-dashed border-black/10 bg-white px-4 py-8 text-center"
    >
      <p class="text-sm text-faint">{copy.noTags}</p>
    </div>
  {/if}
</div>

<style>
  :global(html[data-theme='dark']) .theme-tag-manager-panel {
    background: var(--panel-strong) !important;
    border-color: var(--line-strong) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-manager-card,
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

  :global(html[data-theme='dark']) .theme-tag-linked {
    background: rgb(16 185 129 / 0.14) !important;
    border-color: rgb(16 185 129 / 0.18) !important;
    color: rgb(167 243 208) !important;
  }
</style>
