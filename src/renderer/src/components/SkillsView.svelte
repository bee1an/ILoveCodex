<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CodexInstanceSummary,
    CodexSkillDetail,
    CodexSkillSummary,
    CodexSkillsResult,
    CopyCodexSkillInput,
    CopyCodexSkillResult
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppDialog from './AppDialog.svelte'
  import { cascadeIn, reveal } from './gsap-motion'

  export let copy: LocalizedCopy
  export let instances: CodexInstanceSummary[] = []
  export let listCodexSkills: () => Promise<CodexSkillsResult>
  export let readCodexSkillDetail: (
    instanceId: string,
    skillDirName: string
  ) => Promise<CodexSkillDetail>
  export let copyCodexSkill: (input: CopyCodexSkillInput) => Promise<CopyCodexSkillResult>

  let skills: CodexSkillSummary[] = []
  let errorsByInstanceId: Record<string, string> = {}
  let scannedAt = ''
  let loading = false
  let error = ''
  let selectedInstanceId = 'all'
  let searchQuery = ''

  // Detail dialog
  let detailSkill: CodexSkillDetail | null = null
  let detailLoading = false
  let detailError = ''
  let detailOpen = false

  // Copy dialog
  let copySourceSkill: CodexSkillSummary | null = null
  let copyOpen = false
  let copyTargetIds: string[] = []
  let copyBusy = false
  let copyResult: CopyCodexSkillResult | null = null

  $: filteredSkills = skills.filter((skill) => {
    if (selectedInstanceId !== 'all' && skill.instanceId !== selectedInstanceId) {
      return false
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase()
      return (
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
      )
    }

    return true
  })

  $: instanceGroups = buildInstanceGroups(filteredSkills, instances)
  $: skillCountByInstance = countSkillsByInstance(skills)

  function buildInstanceGroups(
    filtered: CodexSkillSummary[],
    allInstances: CodexInstanceSummary[]
  ): Array<{ instance: CodexInstanceSummary; skills: CodexSkillSummary[] }> {
    const byId: Record<string, CodexSkillSummary[]> = {}
    for (const skill of filtered) {
      const list = (byId[skill.instanceId] ??= [])
      list.push(skill)
    }

    const groups: Array<{ instance: CodexInstanceSummary; skills: CodexSkillSummary[] }> = []
    for (const instance of allInstances) {
      const instanceSkills = byId[instance.id]
      if (instanceSkills?.length) {
        groups.push({ instance, skills: instanceSkills })
      }
    }

    return groups
  }

  function countSkillsByInstance(items: CodexSkillSummary[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const skill of items) {
      counts[skill.instanceId] = (counts[skill.instanceId] ?? 0) + 1
    }

    return counts
  }

  function formatScannedAt(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  async function loadSkills(): Promise<void> {
    if (loading) {
      return
    }

    loading = true
    error = ''

    try {
      const result = await listCodexSkills()
      skills = result.skills
      errorsByInstanceId = result.errorsByInstanceId
      scannedAt = result.scannedAt
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function openDetail(skill: CodexSkillSummary): Promise<void> {
    detailLoading = true
    detailError = ''
    detailSkill = null
    detailOpen = true

    try {
      detailSkill = await readCodexSkillDetail(skill.instanceId, skill.skillDirName)
    } catch (err) {
      detailSkill = null
      detailError = err instanceof Error ? err.message : String(err)
    } finally {
      detailLoading = false
    }
  }

  function closeDetail(): void {
    detailOpen = false
    detailSkill = null
    detailError = ''
  }

  function openCopyDialog(skill: CodexSkillSummary): void {
    copySourceSkill = skill
    copyTargetIds = []
    copyResult = null
    copyOpen = true
  }

  function closeCopyDialog(): void {
    if (copyBusy) return
    copyOpen = false
    copySourceSkill = null
    copyResult = null
    copyTargetIds = []
  }

  function toggleCopyTarget(instanceId: string): void {
    if (copyTargetIds.includes(instanceId)) {
      copyTargetIds = copyTargetIds.filter((id) => id !== instanceId)
    } else {
      copyTargetIds = [...copyTargetIds, instanceId]
    }
  }

  async function executeCopy(): Promise<void> {
    if (!copySourceSkill || !copyTargetIds.length || copyBusy) {
      return
    }

    copyBusy = true

    try {
      copyResult = await copyCodexSkill({
        sourceInstanceId: copySourceSkill.instanceId,
        sourceSkillDirName: copySourceSkill.skillDirName,
        targetInstanceIds: copyTargetIds
      })
      await loadSkills()
    } catch (err) {
      copyResult = {
        copied: [],
        skipped: [],
        failed: copyTargetIds.map((id) => ({
          targetInstanceId: id,
          targetInstanceName: instances.find((inst) => inst.id === id)?.name ?? id,
          error: err instanceof Error ? err.message : String(err)
        }))
      }
    } finally {
      copyBusy = false
    }
  }

  $: availableCopyTargets = instances.filter(
    (inst) => copySourceSkill && inst.id !== copySourceSkill.instanceId
  )

  onMount(() => {
    void loadSkills()
  })
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4 pr-1"
  use:reveal={{ delay: 0.02 }}
>
  <!-- Header -->
  <section class="grid gap-2 px-1 py-1">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <p class="text-sm font-semibold tracking-[-0.01em] text-ink">{copy.skillsTitle}</p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">
          {copy.skillsDescription}
        </p>
        {#if scannedAt}
          <p class="text-[11px] text-faint">{copy.sessionsScannedAt(formatScannedAt(scannedAt))}</p>
        {/if}
      </div>
      <button
        class="skills-toolbar-button"
        type="button"
        onclick={() => void loadSkills()}
        disabled={loading}
      >
        <span
          class={`${loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}
        ></span>
        <span>{loading ? copy.refreshing : copy.skillsRefresh}</span>
      </button>
    </div>

    <div class="flex min-h-8 flex-wrap items-center gap-2 pt-1">
      <div
        class="skills-filter-shell inline-flex min-w-0 max-w-full items-center gap-0 overflow-x-auto rounded-[0.4rem] p-0.5"
      >
        <button
          class={`skills-tab ${selectedInstanceId === 'all' ? 'is-active' : ''}`}
          type="button"
          onclick={() => {
            selectedInstanceId = 'all'
          }}
        >
          {copy.skillsAllInstances}
        </button>
        {#each instances as instance (instance.id)}
          {@const instanceSkillCount = skillCountByInstance[instance.id] ?? 0}
          {#if instanceSkillCount > 0 || instance.isDefault}
            <button
              class={`skills-tab ${selectedInstanceId === instance.id ? 'is-active' : ''}`}
              type="button"
              onclick={() => {
                selectedInstanceId = instance.id
              }}
            >
              <span class="max-w-[8rem] truncate">{instance.name || copy.defaultInstance}</span>
              {#if instanceSkillCount > 0}
                <span class="skills-tab-count">{instanceSkillCount}</span>
              {/if}
            </button>
          {/if}
        {/each}
      </div>

      <div class="flex-1"></div>

      <label class="skills-search inline-flex items-center rounded-[0.35rem] px-2 py-1.5">
        <span class="i-lucide-search h-3.5 w-3.5 text-faint"></span>
        <input
          class="ml-1.5 w-44 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
          placeholder={copy.skillsSearchPlaceholder}
          bind:value={searchQuery}
        />
      </label>
    </div>

    {#if error}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {error}
      </div>
    {/if}
  </section>

  <!-- Content -->
  <div class="grid gap-3">
    {#if loading && !skills.length}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-black/8 px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-loader-circle h-5 w-5 animate-spin text-faint"></span>
          <span>{copy.refreshing}</span>
        </div>
      </section>
    {:else if filteredSkills.length === 0}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-black/8 px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-puzzle h-5 w-5 text-faint"></span>
          <p>
            {searchQuery.trim()
              ? copy.skillsEmpty
              : selectedInstanceId === 'all'
                ? copy.skillsEmpty
                : copy.skillsInstanceEmpty}
          </p>
        </div>
      </section>
    {:else}
      {#each instanceGroups as group (group.instance.id)}
        <section
          class="theme-soft-panel grid gap-2 rounded-[0.55rem] border border-black/8 px-4 py-4"
          use:cascadeIn={{ selector: '[data-motion-item]' }}
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="i-lucide-box h-3.5 w-3.5 text-faint"></span>
            <span class="text-sm font-semibold text-ink">
              {group.instance.name || copy.defaultInstance}
            </span>
            <span
              class="theme-version-pill rounded-[0.3rem] border px-1.5 py-0.5 text-[10px] text-muted-strong"
            >
              {copy.skillsCount(group.skills.length)}
            </span>
            <span class="min-w-0 flex-1 truncate text-[11px] text-faint"
              >{group.instance.codexHome}</span
            >
            {#if errorsByInstanceId[group.instance.id]}
              <span
                class="rounded-[0.35rem] border border-danger/18 bg-danger/8 px-2 py-1 text-[11px] text-danger"
                title={errorsByInstanceId[group.instance.id]}
              >
                {copy.skillsReadFailed}
              </span>
            {/if}
          </div>

          <div class="grid gap-1.5">
            {#each group.skills as skill (skill.filePath)}
              <article class="skills-card" data-motion-item>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="i-lucide-puzzle h-3.5 w-3.5 flex-none text-faint"></span>
                    <button
                      class="skills-title-button truncate text-sm font-semibold"
                      type="button"
                      onclick={() => void openDetail(skill)}
                    >
                      {skill.name}
                    </button>
                  </div>
                  {#if skill.description}
                    <p class="skills-card-description mt-0.5 truncate pl-5.5 text-xs">
                      {skill.description}
                    </p>
                  {/if}
                  <p class="mt-1 truncate pl-5.5 font-mono text-[10px] text-faint">
                    {skill.skillDirName}
                  </p>
                </div>

                <div class="skills-card-actions">
                  <button
                    class="skills-icon-button"
                    type="button"
                    aria-label={copy.skillsDetail}
                    onclick={() => void openDetail(skill)}
                  >
                    <span class="i-lucide-eye h-3.5 w-3.5"></span>
                  </button>
                  <button
                    class="skills-icon-button"
                    type="button"
                    aria-label={copy.skillsCopyToInstance}
                    onclick={() => openCopyDialog(skill)}
                  >
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>

<!-- Detail Dialog -->
{#if detailOpen}
  <AppDialog title={copy.skillsDetail} panelClass="skills-dialog-panel" onclose={closeDetail}>
    {#if detailLoading}
      <div class="flex items-center gap-2 py-4 text-sm text-muted-strong">
        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
        <span>{copy.skillsDetailLoading}</span>
      </div>
    {:else if detailError}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {detailError}
      </div>
    {:else if detailSkill}
      <div class="flex flex-col gap-4">
        <dl class="skills-detail-meta">
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsInstance}</dt>
            <dd>{detailSkill.instanceName || copy.defaultInstance}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsName}</dt>
            <dd>{detailSkill.name}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsDescription2}</dt>
            <dd>{detailSkill.description || '--'}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsPath}</dt>
            <dd class="break-all">{detailSkill.filePath}</dd>
          </div>
        </dl>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-strong">SKILL.md</span>
          <pre
            class="theme-code-surface max-h-80 overflow-auto rounded-[0.5rem] border border-black/8 px-3 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{detailSkill.content}</pre>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            class="skills-secondary-button"
            type="button"
            onclick={() => {
              const skill = detailSkill
              closeDetail()
              if (skill) {
                openCopyDialog(skill)
              }
            }}
          >
            <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
            <span>{copy.skillsCopyToInstance}</span>
          </button>
          <button class="skills-secondary-button" type="button" onclick={closeDetail}>
            {copy.closeDialog}
          </button>
        </div>
      </div>
    {/if}
  </AppDialog>
{/if}

<!-- Copy Dialog -->
{#if copyOpen && copySourceSkill}
  <AppDialog
    title={copy.skillsCopyDialogTitle}
    panelClass="skills-dialog-panel"
    onclose={closeCopyDialog}
  >
    <div class="flex flex-col gap-4">
      <p class="text-xs leading-5 text-muted-strong">
        {copy.skillsCopyDialogDescription(copySourceSkill.name)}
      </p>

      <div class="skills-copy-meta-panel grid gap-3 rounded-[0.8rem] border px-3.5 py-3.5">
        <div class="flex items-center gap-2 text-xs font-medium text-muted-strong">
          <span class="i-lucide-file-clock h-3.5 w-3.5 text-faint"></span>
          <span>{copy.skillsCopySourceInstance}</span>
        </div>
        <dl class="skills-copy-meta-item">
          <dt>{copy.skillsInstance}</dt>
          <dd>{copySourceSkill.instanceName || copy.defaultInstance}</dd>
        </dl>
      </div>

      <div class="skills-copy-target-panel grid gap-4 rounded-[0.9rem] border px-4 py-4">
        <div class="grid gap-2">
          <span class="flex items-center gap-1.5 text-xs font-medium text-muted-strong">
            <span class="i-lucide-box h-3.5 w-3.5 text-faint"></span>
            {copy.skillsCopyTargetInstances}
          </span>
          <p class="text-[11px] text-faint">{copy.skillsCopyTargetHelp}</p>

          {#if availableCopyTargets.length === 0}
            <div
              class="skills-copy-empty-state mt-2 rounded-[0.8rem] border px-4 py-5 text-sm text-muted-strong"
            >
              <span class="i-lucide-circle-alert h-5 w-5 text-faint"></span>
              <span>{copy.skillsEmpty}</span>
            </div>
          {:else}
            <div class="mt-2 flex flex-col gap-1.5">
              {#each availableCopyTargets as target (target.id)}
                <label
                  class="skills-copy-target {copyTargetIds.includes(target.id)
                    ? 'is-selected'
                    : ''}"
                >
                  <input
                    type="checkbox"
                    checked={copyTargetIds.includes(target.id)}
                    onchange={() => toggleCopyTarget(target.id)}
                    class="accent-ink"
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-ink">
                      {target.name || copy.defaultInstance}
                    </span>
                    <span class="block truncate text-[11px] text-faint">{target.codexHome}</span>
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </div>

        {#if copyResult}
          <div class="skills-result-panel">
            <span class="text-sm font-semibold text-ink">{copy.skillsCopyResult}</span>
            {#if copyResult.copied.length > 0}
              <span class="text-success">
                {copy.skillsCopySuccess(copyResult.copied.length)}
              </span>
            {/if}
            {#if copyResult.skipped.length > 0}
              <span class="text-amber-600">
                {copy.skillsCopySkipped(copyResult.skipped.length)}
              </span>
            {/if}
            {#if copyResult.failed.length > 0}
              <span class="text-danger">
                {copy.skillsCopyFailed(copyResult.failed.length)}
              </span>
              {#each copyResult.failed as fail (fail.targetInstanceId)}
                <span class="pl-2 text-[11px] text-danger">
                  {fail.targetInstanceName}: {fail.error}
                </span>
              {/each}
            {/if}
          </div>
        {/if}

        <div class="skills-copy-actions flex justify-end gap-2 pt-1">
          <button class="skills-secondary-button" type="button" onclick={closeCopyDialog}>
            {copy.skillsCopyCancel}
          </button>
          <button
            class="skills-confirm-button"
            type="button"
            onclick={() => void executeCopy()}
            disabled={copyTargetIds.length === 0 || copyBusy}
          >
            {#if copyBusy}
              <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            {:else}
              <span class="i-lucide-copy h-3.5 w-3.5"></span>
            {/if}
            <span>{copy.skillsCopyConfirm}</span>
          </button>
        </div>
      </div>
    </div>
  </AppDialog>
{/if}

<style>
  .skills-filter-shell {
    background: transparent;
    scrollbar-width: none;
  }

  .skills-filter-shell::-webkit-scrollbar {
    display: none;
  }

  .skills-tab {
    appearance: none;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.3rem;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 650;
    line-height: 1;
    padding: 0.34rem 0.52rem;
    transition:
      background-color 140ms ease,
      color 140ms ease;
  }

  .skills-tab:hover {
    background: color-mix(in srgb, var(--surface-hover) 42%, transparent);
    color: var(--ink-soft-strong);
  }

  .skills-tab.is-active {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
    color: var(--ink);
  }

  .skills-tab-count {
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    color: var(--ink-faint);
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1;
    padding: 0.15rem 0.35rem;
  }

  .skills-search {
    background: transparent;
    color: var(--ink-faint);
    transition:
      background-color 140ms ease,
      box-shadow 140ms ease;
  }

  .skills-search:hover {
    background: color-mix(in srgb, var(--surface-hover) 34%, transparent);
  }

  .skills-search:focus-within {
    background: color-mix(in srgb, var(--surface-hover) 48%, transparent);
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--line-strong) 82%, transparent);
  }

  .skills-search input {
    border: 0;
    box-shadow: none;
  }

  .skills-search input:focus {
    outline: none;
    box-shadow: none;
  }

  .skills-toolbar-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 650;
    padding: 0.35rem 0.45rem;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .skills-toolbar-button:hover,
  .skills-toolbar-button:focus-visible {
    background: color-mix(in srgb, var(--surface-hover) 42%, transparent);
    color: var(--ink-soft-strong);
  }

  .skills-toolbar-button:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .skills-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.62rem 0.75rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .skills-card:hover,
  .skills-card:focus-within {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 78%, transparent);
  }

  .skills-title-button {
    appearance: none;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .skills-title-button:hover,
  .skills-title-button:focus-visible {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .skills-card-description {
    color: var(--ink-soft-strong);
  }

  .skills-card-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    opacity: 0.58;
    transition: opacity 140ms ease;
  }

  .skills-card:hover .skills-card-actions,
  .skills-card:focus-within .skills-card-actions {
    opacity: 1;
  }

  .skills-icon-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
    border-radius: 0.38rem;
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 0;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .skills-icon-button:hover,
  .skills-icon-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--ink);
  }

  .skills-detail-meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
    padding: 0.75rem;
    font-size: 0.75rem;
  }

  .skills-detail-meta-item {
    display: contents;
  }

  .skills-detail-meta dt {
    color: var(--ink-faint);
    font-weight: 650;
    white-space: nowrap;
  }

  .skills-detail-meta dd {
    min-width: 0;
    color: var(--ink);
    font-weight: 600;
  }

  .skills-copy-meta-panel,
  .skills-copy-target-panel,
  .skills-copy-empty-state,
  .skills-result-panel {
    border-color: color-mix(in srgb, var(--line) 82%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
  }

  .skills-copy-empty-state {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .skills-copy-meta-item {
    display: grid;
    min-width: 0;
    gap: 0.25rem;
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 48%, transparent);
    padding: 0.55rem 0.65rem;
  }

  .skills-copy-meta-item dt {
    color: var(--ink-faint);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .skills-copy-meta-item dd {
    min-width: 0;
    overflow: hidden;
    color: var(--ink);
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skills-copy-target {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.65rem;
    border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
    border-radius: 0.45rem;
    background: transparent;
    cursor: pointer;
    padding: 0.55rem 0.65rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .skills-copy-target:hover,
  .skills-copy-target:focus-within {
    border-color: var(--line-strong);
    background: var(--surface-hover);
  }

  .skills-copy-target.is-selected {
    border-color: var(--line-strong);
    background: var(--surface-selected, color-mix(in srgb, var(--ink) 5%, transparent));
  }

  .skills-result-panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
    border-radius: 0.45rem;
    padding: 0.62rem 0.75rem;
    font-size: 0.72rem;
  }

  .skills-secondary-button,
  .skills-confirm-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-weight: 650;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .skills-secondary-button {
    min-height: 2.1rem;
    border: 1px solid color-mix(in srgb, var(--line) 86%, transparent);
    background: transparent;
    color: var(--ink-soft-strong);
    font-size: 0.8125rem;
    padding: 0.42rem 0.68rem;
  }

  .skills-secondary-button:hover,
  .skills-secondary-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--ink);
  }

  .skills-confirm-button {
    min-height: 2.2rem;
    border: 1px solid color-mix(in srgb, var(--ink) 72%, transparent);
    background: var(--ink);
    color: var(--paper);
    font-size: 0.8125rem;
    padding: 0.48rem 0.85rem;
  }

  .skills-confirm-button:hover,
  .skills-confirm-button:focus-visible {
    border-color: var(--ink);
    background: color-mix(in srgb, var(--ink) 88%, var(--surface-soft));
  }

  .skills-confirm-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  :global(.skills-dialog-panel) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: var(--panel-strong) !important;
  }
</style>
