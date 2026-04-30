<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CodexInstanceSummary,
    CodexSessionDetail,
    CodexSessionMessageRole,
    CodexSessionProjectSummary,
    CodexSessionStatus,
    CodexSessionSummary,
    CodexSessionProjectsResult,
    CodexSessionsResult,
    CopyCodexSessionToProviderInput,
    CopyCodexSessionToProviderResult,
    CustomProviderSummary,
    ListCodexSessionsInput,
    ReadCodexSessionDetailInput
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppDialog from './AppDialog.svelte'
  import FloatingSelect, { type FloatingSelectOption } from './FloatingSelect.svelte'
  import {
    type CopyTargetProviderOption,
    type ProviderProjectGroup,
    type SessionProviderContext,
    copyTargetProviderOptionsForInstance as resolveCopyTargetProviderOptionsForInstance,
    defaultCopyInstanceId as resolveDefaultCopyInstanceId,
    defaultCopyProviderId as resolveDefaultCopyProviderId,
    formatSessionDateTime,
    instanceLabel,
    isAuxiliaryRole,
    isProjectExpanded,
    messageParts,
    preferredCopyTargetProviderOptions as resolvePreferredCopyTargetProviderOptions,
    projectGroupsForInstance as resolveProjectGroupsForInstance,
    projectSessionCount as resolveProjectSessionCount,
    projectSubtitle as resolveProjectSubtitle,
    projectTitle as resolveProjectTitle,
    providerGroupsForProjects as resolveProviderGroupsForProjects,
    providerLabel as resolveProviderLabel,
    roleIconClass,
    roleLabel as resolveRoleLabel,
    shortSessionId,
    sourceText as resolveSourceText
  } from './sessions-view-model'

  export let copy: LocalizedCopy
  export let language: 'zh-CN' | 'en'
  export let instances: CodexInstanceSummary[] = []
  export let providers: CustomProviderSummary[] = []
  export let compactGhostButton = ''
  export let listCodexSessionProjects: () => Promise<CodexSessionProjectsResult>
  export let listCodexSessions: (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult>
  export let readCodexSessionDetail: (
    input: ReadCodexSessionDetailInput
  ) => Promise<CodexSessionDetail>
  export let copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ) => Promise<CopyCodexSessionToProviderResult>

  const visibleLimit = 10

  let projects: CodexSessionProjectSummary[] = []
  let sessionsByProjectKey: Record<string, CodexSessionSummary[]> = {}
  let sessionLoadingByProjectKey: Record<string, boolean> = {}
  let errorsByInstanceId: Record<string, string> = {}
  let scannedAt = ''
  let loading = false
  let error = ''
  let selectedInstanceId = 'all'
  let statusFilter: 'all' | CodexSessionStatus = 'all'
  let collapsedByInstanceId: Record<string, boolean> = {}
  let collapsedByProviderKey: Record<string, boolean> = {}
  let expandedByProjectKey: Record<string, boolean> = {}
  let visibleLimitByProjectKey: Record<string, number> = {}
  let searchByInstanceId: Record<string, string> = {}
  let selectedDetail: CodexSessionDetail | null = null
  let selectedSummary: CodexSessionSummary | null = null
  let expandedMessageById: Record<string, boolean> = {}
  let overflowMessageById: Record<string, boolean> = {}
  let detailLoading = false
  let detailError = ''
  let copyTargetSession: CodexSessionSummary | null = null
  let copyTargetInstanceId = ''
  let copyTargetProviderId = ''
  let copySessionBusy = false
  let copySessionError = ''
  let copySessionNotice = ''
  let copiedInstancesById: Record<string, CodexInstanceSummary> = {}
  let allKnownInstances: CodexInstanceSummary[] = []
  let sessionProviderContext: SessionProviderContext = {
    projects: [],
    allKnownInstances: [],
    providers: [],
    statusFilter: 'all',
    unknownProviderLabel: ''
  }

  const floatingSelectButtonClass =
    'theme-select flex h-11 w-full items-center justify-between rounded-[0.4rem] border border-black/10 bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors duration-140 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 disabled:cursor-not-allowed disabled:opacity-60'
  const floatingSelectMenuClass = 'theme-tag-picker-surface z-[999] rounded-[0.75rem] p-1.5'
  const floatingSelectOptionClass =
    'theme-menu-choice flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-strong transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16'
  const formatDateTime = (value?: string): string => formatSessionDateTime(value, language)
  const roleLabel = (role: CodexSessionMessageRole): string => resolveRoleLabel(role, copy)
  const sourceText = (session: CodexSessionSummary): string => resolveSourceText(session, copy)

  function updateMessageOverflow(messageId: string, overflows: boolean): void {
    if (overflowMessageById[messageId] === overflows) {
      return
    }

    overflowMessageById = {
      ...overflowMessageById,
      [messageId]: overflows
    }
  }

  function parseCssLengthToPixels(value: string, node: HTMLElement): number {
    const trimmed = value.trim()
    const parsed = Number.parseFloat(trimmed)
    if (!Number.isFinite(parsed)) {
      return Number.NaN
    }

    if (trimmed.endsWith('rem')) {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      return parsed * (Number.isFinite(rootFontSize) ? rootFontSize : 16)
    }

    if (trimmed.endsWith('em')) {
      const fontSize = Number.parseFloat(getComputedStyle(node).fontSize)
      return parsed * (Number.isFinite(fontSize) ? fontSize : 16)
    }

    return parsed
  }

  function measureMessageOverflow(
    node: HTMLElement,
    messageId: string
  ): { update: (nextMessageId: string) => void; destroy: () => void } {
    let currentMessageId = messageId
    let frame = 0

    const measure = (): void => {
      if (frame) {
        cancelAnimationFrame(frame)
      }

      frame = requestAnimationFrame(() => {
        const measuredMaxHeight = parseCssLengthToPixels(getComputedStyle(node).maxHeight, node)
        const fallbackMaxHeight = node.classList.contains('message-text-auxiliary') ? 120 : 160
        const maxHeight = Number.isFinite(measuredMaxHeight)
          ? measuredMaxHeight
          : node.classList.contains('is-expanded')
            ? Number.NaN
            : fallbackMaxHeight
        const previous = overflowMessageById[currentMessageId] ?? false
        const overflows = Number.isFinite(maxHeight) ? node.scrollHeight > maxHeight + 1 : previous

        updateMessageOverflow(currentMessageId, overflows)
      })
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())

    measure()
    resizeObserver?.observe(node)

    return {
      update(nextMessageId: string): void {
        currentMessageId = nextMessageId
        measure()
      },
      destroy(): void {
        if (frame) {
          cancelAnimationFrame(frame)
        }
        resizeObserver?.disconnect()
      }
    }
  }

  function projectSessionCount(project: CodexSessionProjectSummary): number {
    return resolveProjectSessionCount(project, statusFilter)
  }

  function projectGroupsForInstance(
    instanceId: string,
    currentProjects: CodexSessionProjectSummary[],
    currentSearchByInstanceId: Record<string, string>,
    currentSessionsByProjectKey: Record<string, CodexSessionSummary[]>,
    currentStatusFilter: 'all' | CodexSessionStatus = statusFilter
  ): CodexSessionProjectSummary[] {
    return resolveProjectGroupsForInstance(
      instanceId,
      currentProjects,
      currentSearchByInstanceId,
      currentSessionsByProjectKey,
      currentStatusFilter
    )
  }

  function providerLabel(
    provider: string,
    label?: string,
    currentSessionProviderContext: SessionProviderContext = sessionProviderContext
  ): string {
    return resolveProviderLabel(provider, label, currentSessionProviderContext)
  }

  function copyTargetProviderOptionsForInstance(
    instanceId: string,
    sourceSession?: CodexSessionSummary | null,
    currentSessionProviderContext: SessionProviderContext = sessionProviderContext
  ): CopyTargetProviderOption[] {
    return resolveCopyTargetProviderOptionsForInstance(
      instanceId,
      sourceSession,
      currentSessionProviderContext
    )
  }

  function preferredCopyTargetProviderOptions(
    instanceId: string,
    session: CodexSessionSummary,
    currentSessionProviderContext: SessionProviderContext = sessionProviderContext
  ): CopyTargetProviderOption[] {
    return resolvePreferredCopyTargetProviderOptions(
      instanceId,
      session,
      currentSessionProviderContext
    )
  }

  function defaultCopyInstanceId(session: CodexSessionSummary): string {
    return resolveDefaultCopyInstanceId(session, allKnownInstances, sessionProviderContext)
  }

  function defaultCopyProviderId(session: CodexSessionSummary, instanceId: string): string {
    return resolveDefaultCopyProviderId(session, instanceId, sessionProviderContext)
  }

  function updateCopyTargetInstance(instanceId: string): void {
    copyTargetInstanceId = instanceId
    copyTargetProviderId = copyTargetSession
      ? defaultCopyProviderId(copyTargetSession, instanceId)
      : ''
  }

  function providerGroupsForProjects(
    currentProjects: CodexSessionProjectSummary[],
    currentSessionProviderContext: SessionProviderContext = sessionProviderContext
  ): ProviderProjectGroup[] {
    return resolveProviderGroupsForProjects(currentProjects, currentSessionProviderContext)
  }

  function projectTitle(project: CodexSessionProjectSummary): string {
    return resolveProjectTitle(project, copy.sessionsUnknownProject)
  }

  function projectSubtitle(project: CodexSessionProjectSummary): string {
    return resolveProjectSubtitle(project, copy.sessionsUnknownProject)
  }

  async function loadProjects(): Promise<void> {
    if (loading) {
      return
    }

    loading = true
    error = ''
    sessionsByProjectKey = {}
    visibleLimitByProjectKey = {}
    expandedByProjectKey = {}
    collapsedByProviderKey = {}
    try {
      const result = await listCodexSessionProjects()
      projects = result.projects
      errorsByInstanceId = result.errorsByInstanceId
      scannedAt = result.scannedAt
    } catch (nextError) {
      error = nextError instanceof Error ? nextError.message : copy.sessionsReadFailed
    } finally {
      loading = false
    }
  }

  async function loadProjectSessions(
    project: CodexSessionProjectSummary,
    limit = visibleLimitByProjectKey[project.key] ?? visibleLimit
  ): Promise<void> {
    if (sessionLoadingByProjectKey[project.key]) {
      return
    }

    sessionLoadingByProjectKey = {
      ...sessionLoadingByProjectKey,
      [project.key]: true
    }

    try {
      const result = await listCodexSessions({
        instanceId: project.instanceId,
        status: statusFilter === 'all' ? undefined : statusFilter,
        modelProvider: project.modelProvider,
        projectPath: project.projectPath ?? '',
        limit
      })
      sessionsByProjectKey = {
        ...sessionsByProjectKey,
        [project.key]: result.sessions
      }
      errorsByInstanceId = {
        ...errorsByInstanceId,
        ...result.errorsByInstanceId
      }
    } catch (nextError) {
      errorsByInstanceId = {
        ...errorsByInstanceId,
        [project.instanceId]:
          nextError instanceof Error ? nextError.message : copy.sessionsReadFailed
      }
    } finally {
      sessionLoadingByProjectKey = {
        ...sessionLoadingByProjectKey,
        [project.key]: false
      }
    }
  }

  async function toggleProject(project: CodexSessionProjectSummary): Promise<void> {
    const nextExpanded = !isProjectExpanded(project, expandedByProjectKey)
    expandedByProjectKey = {
      ...expandedByProjectKey,
      [project.key]: nextExpanded
    }

    if (nextExpanded && !sessionsByProjectKey[project.key]?.length) {
      visibleLimitByProjectKey = {
        ...visibleLimitByProjectKey,
        [project.key]: visibleLimit
      }
      await loadProjectSessions(project, visibleLimit)
    }
  }

  async function showMoreProjectSessions(project: CodexSessionProjectSummary): Promise<void> {
    const nextLimit = Math.min(
      projectSessionCount(project),
      (visibleLimitByProjectKey[project.key] ?? visibleLimit) + visibleLimit
    )
    visibleLimitByProjectKey = {
      ...visibleLimitByProjectKey,
      [project.key]: nextLimit
    }
    await loadProjectSessions(project, nextLimit)
  }

  function collapseProjectSessions(project: CodexSessionProjectSummary): void {
    visibleLimitByProjectKey = {
      ...visibleLimitByProjectKey,
      [project.key]: visibleLimit
    }
    sessionsByProjectKey = {
      ...sessionsByProjectKey,
      [project.key]: (sessionsByProjectKey[project.key] ?? []).slice(0, visibleLimit)
    }
  }

  async function openDetail(session: CodexSessionSummary): Promise<void> {
    selectedSummary = session
    selectedDetail = null
    expandedMessageById = {}
    overflowMessageById = {}
    detailError = ''
    detailLoading = true

    try {
      selectedDetail = await readCodexSessionDetail({
        instanceId: session.instanceId,
        filePath: session.filePath
      })
    } catch (nextError) {
      detailError = nextError instanceof Error ? nextError.message : copy.sessionsReadFailed
    } finally {
      detailLoading = false
    }
  }

  function closeDetail(): void {
    selectedSummary = null
    selectedDetail = null
    expandedMessageById = {}
    overflowMessageById = {}
    detailError = ''
    detailLoading = false
  }

  function openCopySessionDialog(session: CodexSessionSummary): void {
    copyTargetSession = session
    copySessionError = ''
    copySessionNotice = ''
    copyTargetInstanceId = defaultCopyInstanceId(session)
    copyTargetProviderId = defaultCopyProviderId(session, copyTargetInstanceId)
  }

  function closeCopySessionDialog(): void {
    if (copySessionBusy) {
      return
    }

    copyTargetSession = null
    copyTargetInstanceId = ''
    copyTargetProviderId = ''
    copySessionError = ''
  }

  async function confirmCopySessionToProvider(): Promise<void> {
    if (!copyTargetSession || !copyTargetInstanceId || !copyTargetProviderId || copySessionBusy) {
      return
    }

    const targetProvider = copyScopedProviders.find(
      (provider) => provider.value === copyTargetProviderId
    )
    if (!targetProvider) {
      return
    }

    copySessionBusy = true
    copySessionError = ''
    copySessionNotice = ''
    try {
      const result = await copyCodexSessionToProvider({
        sourceInstanceId: copyTargetSession.instanceId,
        sourceFilePath: copyTargetSession.filePath,
        targetInstanceId: copyTargetInstanceId,
        targetProviderId: targetProvider.targetProviderId,
        targetModelProvider: targetProvider.targetProviderId
          ? undefined
          : targetProvider.targetModelProvider,
        targetModelProviderLabel: targetProvider.targetProviderId
          ? undefined
          : targetProvider.targetModelProviderLabel
      })
      if (!instances.some((instance) => instance.id === result.targetInstanceId)) {
        const now = new Date().toISOString()
        copiedInstancesById = {
          ...copiedInstancesById,
          [result.targetInstanceId]: {
            id: result.targetInstanceId,
            name: result.targetInstanceName,
            codexHome: result.targetCodexHome,
            extraArgs: '',
            isDefault: false,
            createdAt: now,
            updatedAt: now,
            running: false,
            initialized: true
          }
        }
      }
      copySessionNotice = copy.sessionsCopySuccess(result.targetInstanceName, result.targetModel)
      copyTargetSession = null
      copyTargetInstanceId = ''
      copyTargetProviderId = ''
      await loadProjects()
    } catch (nextError) {
      copySessionError = nextError instanceof Error ? nextError.message : copy.sessionsCopyFailed
    } finally {
      copySessionBusy = false
    }
  }

  $: allKnownInstances = [
    ...instances,
    ...Object.values(copiedInstancesById).filter(
      (instance) => !instances.some((item) => item.id === instance.id)
    )
  ]

  $: sessionProviderContext = {
    projects,
    allKnownInstances,
    providers,
    statusFilter,
    unknownProviderLabel: copy.sessionsUnknownProvider
  }

  $: visibleInstances =
    selectedInstanceId === 'all'
      ? allKnownInstances
      : allKnownInstances.filter((instance) => instance.id === selectedInstanceId)

  $: instanceFilterOptions = [
    { value: 'all', label: copy.sessionsAllInstances },
    ...allKnownInstances.map(
      (instance): FloatingSelectOption => ({
        value: instance.id,
        label: instanceLabel(instance)
      })
    )
  ]

  $: statusFilterOptions = [
    { value: 'all', label: copy.sessionsStatusAll },
    { value: 'active', label: copy.sessionsStatusActive },
    { value: 'archived', label: copy.sessionsStatusArchived }
  ]

  $: copyScopedProviders = copyTargetInstanceId
    ? copyTargetProviderOptionsForInstance(
        copyTargetInstanceId,
        copyTargetSession,
        sessionProviderContext
      )
    : []

  $: if (copyTargetSession && copyTargetInstanceId) {
    const scopedProviderIds = copyScopedProviders.map((provider) => provider.value)
    if (!copyTargetProviderId || !scopedProviderIds.includes(copyTargetProviderId)) {
      copyTargetProviderId =
        preferredCopyTargetProviderOptions(
          copyTargetInstanceId,
          copyTargetSession,
          sessionProviderContext
        )[0]?.value ?? ''
    }
  }

  $: copyProviderOptions = copyScopedProviders.map(
    (provider): FloatingSelectOption => ({ value: provider.value, label: provider.label })
  )

  $: copyAvailableInstances = copyTargetSession
    ? allKnownInstances.filter(
        (instance) =>
          copyTargetProviderOptionsForInstance(
            instance.id,
            copyTargetSession,
            sessionProviderContext
          ).length
      )
    : allKnownInstances

  $: copyInstanceOptions = copyAvailableInstances.map(
    (instance): FloatingSelectOption => ({
      value: instance.id,
      label: instanceLabel(instance)
    })
  )

  onMount(() => {
    void loadProjects()
  })
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4 pr-1">
  <section class="theme-soft-panel grid gap-4 rounded-[0.55rem] border border-black/8 px-4 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <p class="text-sm font-semibold tracking-[-0.01em] text-ink">{copy.sessionsTitle}</p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">
          {copy.sessionsDescription}
        </p>
        {#if scannedAt}
          <p class="text-[11px] text-faint">{copy.sessionsScannedAt(formatDateTime(scannedAt))}</p>
        {/if}
      </div>
      <button class={compactGhostButton} type="button" onclick={() => void loadProjects()}>
        {loading ? copy.refreshing : copy.sessionsRefresh}
      </button>
    </div>

    <div class="grid gap-3 md:grid-cols-[220px_180px]">
      <FloatingSelect
        options={instanceFilterOptions}
        value={selectedInstanceId}
        ariaLabel={copy.sessionsAllInstances}
        disabled={loading || detailLoading}
        buttonClass={floatingSelectButtonClass}
        menuClass={floatingSelectMenuClass}
        optionClass={floatingSelectOptionClass}
        activeOptionClass="theme-menu-choice-active bg-black/[0.05]"
        inactiveOptionClass="bg-transparent hover:bg-black/[0.03]"
        on:change={(event) => {
          selectedInstanceId = event.detail
        }}
      />

      <FloatingSelect
        options={statusFilterOptions}
        value={statusFilter}
        ariaLabel={copy.sessionsStatusAll}
        disabled={loading || detailLoading}
        buttonClass={floatingSelectButtonClass}
        menuClass={floatingSelectMenuClass}
        optionClass={floatingSelectOptionClass}
        activeOptionClass="theme-menu-choice-active bg-black/[0.05]"
        inactiveOptionClass="bg-transparent hover:bg-black/[0.03]"
        on:change={(event) => {
          statusFilter = event.detail as 'all' | CodexSessionStatus
          sessionsByProjectKey = {}
          visibleLimitByProjectKey = {}
        }}
      />
    </div>

    {#if error}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {copy.sessionsReadFailed}: {error}
      </div>
    {/if}

    {#if copySessionNotice}
      <div
        class="rounded-[0.45rem] border border-black/6 bg-black/[0.035] px-3 py-2 text-sm text-muted-strong"
      >
        {copySessionNotice}
      </div>
    {/if}
  </section>

  {#if selectedSummary}
    <section class="theme-soft-panel grid gap-4 rounded-[0.55rem] border border-black/8 px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs text-faint">{copy.sessionsDetail}</p>
          <h3
            class="session-line-clamp-2 mt-1 text-base font-semibold tracking-[-0.015em] text-ink"
          >
            {selectedDetail?.session.title || selectedSummary.title || selectedSummary.id}
          </h3>
          <p class="mt-1 truncate text-xs text-muted-strong">
            {selectedSummary.instanceName} · {selectedSummary.projectPath || '--'}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class={compactGhostButton}
            type="button"
            onclick={() => openCopySessionDialog(selectedSummary)}
          >
            {copy.sessionsCopyToProvider}
          </button>
          <button class={compactGhostButton} type="button" onclick={closeDetail}>
            {copy.sessionsBackToList}
          </button>
        </div>
      </div>

      <div class="grid gap-2 text-xs text-muted-strong md:grid-cols-4">
        <span>{copy.sessionsCreatedAt}: {formatDateTime(selectedSummary.createdAt)}</span>
        <span>{copy.sessionsUpdatedAt}: {formatDateTime(selectedSummary.updatedAt)}</span>
        <span>{copy.sessionsSource}: {sourceText(selectedSummary)}</span>
        <span title={selectedSummary.id}
          >{copy.sessionsId}: {shortSessionId(selectedSummary.id)}</span
        >
      </div>

      {#if detailLoading}
        <div
          class="rounded-[0.45rem] border border-black/6 px-3 py-8 text-center text-sm text-muted-strong"
        >
          {copy.sessionsDetailLoading}
        </div>
      {:else if detailError}
        <div
          class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
        >
          {detailError}
        </div>
      {:else if !selectedDetail?.messages.length}
        <div
          class="rounded-[0.45rem] border border-black/6 px-3 py-8 text-center text-sm text-muted-strong"
        >
          {copy.sessionsNoMessages}
        </div>
      {:else}
        <div class="grid gap-3">
          {#each selectedDetail.messages as message (message.id)}
            {@const messageExpanded = Boolean(expandedMessageById[message.id])}
            {@const messageOverflows = Boolean(overflowMessageById[message.id])}
            {@const auxiliaryMessage = isAuxiliaryRole(message.role)}
            {@const parts = messageParts(message.text)}
            <article
              class={`session-message session-message-${message.role} ${
                auxiliaryMessage ? 'session-message-auxiliary' : ''
              } grid gap-2 rounded-[0.5rem] border px-3 py-3`}
            >
              <div class="message-header flex flex-wrap items-center justify-between gap-2">
                <span class={`message-role-badge ${auxiliaryMessage ? 'is-auxiliary' : ''}`}>
                  <span class={`${roleIconClass(message.role)} h-3.5 w-3.5`}></span>
                  <span>{roleLabel(message.role)}</span>
                </span>
                {#if message.createdAt}
                  <span class="text-[11px] text-faint">{formatDateTime(message.createdAt)}</span>
                {/if}
              </div>
              <button
                class="message-text-toggle relative block w-full rounded-[0.4rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
                type="button"
                aria-expanded={messageExpanded}
                aria-disabled={!messageOverflows}
                onclick={() => {
                  if (!messageOverflows) {
                    return
                  }

                  expandedMessageById = {
                    ...expandedMessageById,
                    [message.id]: !messageExpanded
                  }
                }}
              >
                <p
                  class={`message-text whitespace-pre-wrap break-words ${
                    auxiliaryMessage
                      ? 'message-text-auxiliary text-xs leading-5'
                      : 'text-sm leading-6'
                  } text-muted-strong ${messageExpanded ? 'is-expanded' : ''}`}
                  use:measureMessageOverflow={message.id}
                >
                  {#each parts as part, partIndex (`${part.type}-${partIndex}`)}
                    {#if part.type === 'image'}
                      <img
                        class="message-image"
                        src={part.value}
                        alt={copy.sessionsImageAlt}
                        loading="lazy"
                      />
                    {:else}
                      <span>{part.value}</span>
                    {/if}
                  {/each}
                </p>
              </button>
              {#if messageOverflows}
                <button
                  class="message-expand-button"
                  type="button"
                  aria-label={messageExpanded
                    ? copy.sessionsCollapseMessage
                    : copy.sessionsExpandMessage}
                  onclick={() => {
                    expandedMessageById = {
                      ...expandedMessageById,
                      [message.id]: !messageExpanded
                    }
                  }}
                >
                  <span class={messageExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'}
                  ></span>
                  {messageExpanded ? copy.sessionsCollapseMessage : copy.sessionsExpandMessage}
                </button>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {:else if !instances.length}
    <section
      class="theme-soft-panel rounded-[0.55rem] border border-black/8 px-4 py-8 text-center text-sm text-muted-strong"
    >
      {copy.sessionsEmpty}
    </section>
  {:else}
    <div class="grid gap-3">
      {#each visibleInstances as instance (instance.id)}
        {@const projectGroups = projectGroupsForInstance(
          instance.id,
          projects,
          searchByInstanceId,
          sessionsByProjectKey,
          statusFilter
        )}
        {@const providerGroups = providerGroupsForProjects(projectGroups, sessionProviderContext)}
        {@const instanceCollapsed = collapsedByInstanceId[instance.id] ?? true}
        {@const instanceSessionCount = providerGroups.reduce(
          (count, provider) => count + provider.sessionCount,
          0
        )}
        <section
          class="theme-soft-panel grid gap-3 rounded-[0.55rem] border border-black/8 px-4 py-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <button
              class="tree-toggle min-w-0 flex-1 text-left"
              type="button"
              aria-expanded={!instanceCollapsed}
              onclick={() => {
                collapsedByInstanceId = {
                  ...collapsedByInstanceId,
                  [instance.id]: !instanceCollapsed
                }
              }}
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class={`tree-caret ${instanceCollapsed ? '' : 'is-open'}`}>›</span>
                <span class="text-sm font-semibold text-ink">{instanceLabel(instance)}</span>
                <span
                  class="theme-version-pill rounded-[0.3rem] border border-black/6 px-1.5 py-0.5 text-[10px] text-muted-strong"
                >
                  {copy.sessionsCount(instanceSessionCount)}
                </span>
                <span
                  class="theme-version-pill rounded-[0.3rem] border border-black/6 px-1.5 py-0.5 text-[10px] text-muted-strong"
                >
                  {copy.sessionsProjectCount(projectGroups.length)}
                </span>
                <span
                  class="theme-version-pill rounded-[0.3rem] border border-black/6 px-1.5 py-0.5 text-[10px] text-muted-strong"
                >
                  {copy.sessionsProviderCount(providerGroups.length)}
                </span>
              </div>
              <p class="mt-1 truncate text-xs text-faint">{instance.codexHome}</p>
            </button>
            {#if errorsByInstanceId[instance.id]}
              <div
                class="max-w-xl rounded-[0.4rem] border border-danger/18 bg-danger/8 px-3 py-2 text-xs text-danger"
              >
                {errorsByInstanceId[instance.id]}
              </div>
            {/if}
          </div>

          {#if !instanceCollapsed}
            <input
              class="theme-select rounded-[0.4rem] border border-black/10 bg-transparent px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-black/16"
              value={searchByInstanceId[instance.id] ?? ''}
              placeholder={copy.sessionsInstanceSearchPlaceholder}
              disabled={loading}
              oninput={(event) => {
                searchByInstanceId = {
                  ...searchByInstanceId,
                  [instance.id]: (event.currentTarget as HTMLInputElement).value
                }
              }}
            />

            {#if loading && !projects.length}
              <div
                class="rounded-[0.45rem] border border-black/6 px-3 py-6 text-center text-sm text-muted-strong"
              >
                {copy.refreshing}
              </div>
            {:else if !providerGroups.length}
              <div
                class="rounded-[0.45rem] border border-black/6 px-3 py-6 text-center text-sm text-muted-strong"
              >
                {copy.sessionsInstanceEmpty}
              </div>
            {:else}
              <div class="session-tree grid gap-2">
                {#each providerGroups as providerGroup (providerGroup.key)}
                  {@const providerCollapsed = collapsedByProviderKey[providerGroup.key] ?? false}
                  <div class="provider-node grid gap-2">
                    <button
                      class="provider-toggle grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-[0.45rem] border border-black/6 px-3 py-2 text-left"
                      type="button"
                      aria-expanded={!providerCollapsed}
                      onclick={() => {
                        collapsedByProviderKey = {
                          ...collapsedByProviderKey,
                          [providerGroup.key]: !providerCollapsed
                        }
                      }}
                    >
                      <span class={`tree-caret mt-0.5 ${providerCollapsed ? '' : 'is-open'}`}
                        >›</span
                      >
                      <span class="min-w-0">
                        <span
                          class="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink"
                        >
                          <span class="i-lucide-server h-3.5 w-3.5 flex-none text-faint"></span>
                          <span class="truncate">
                            {providerLabel(
                              providerGroup.modelProvider,
                              providerGroup.modelProviderLabel,
                              sessionProviderContext
                            )}
                          </span>
                        </span>
                        <span class="mt-0.5 block truncate text-[11px] text-faint">
                          {copy.sessionsProjectCount(providerGroup.projectCount)}
                        </span>
                      </span>
                      <span class="text-right text-[11px] text-muted-strong">
                        <span class="block">{copy.sessionsCount(providerGroup.sessionCount)}</span>
                        {#if providerGroup.latestAt}
                          <span class="block text-faint"
                            >{formatDateTime(providerGroup.latestAt)}</span
                          >
                        {/if}
                      </span>
                    </button>

                    {#if !providerCollapsed}
                      <div class="provider-children grid gap-2 pl-5">
                        {#each providerGroup.projects as project (project.key)}
                          {@const projectExpanded = isProjectExpanded(
                            project,
                            expandedByProjectKey
                          )}
                          {@const displayedSessions = sessionsByProjectKey[project.key] ?? []}
                          {@const currentVisibleLimit =
                            visibleLimitByProjectKey[project.key] ?? visibleLimit}
                          <div class="project-node grid gap-2">
                            <button
                              class="project-toggle grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-[0.45rem] border border-black/6 px-3 py-2 text-left"
                              type="button"
                              aria-expanded={projectExpanded}
                              onclick={() => void toggleProject(project)}
                            >
                              <span class={`tree-caret mt-0.5 ${projectExpanded ? 'is-open' : ''}`}
                                >›</span
                              >
                              <span class="min-w-0">
                                <span class="block truncate text-sm font-semibold text-ink">
                                  {projectTitle(project)}
                                </span>
                                {#if projectSubtitle(project)}
                                  <span class="mt-0.5 block truncate text-[11px] text-faint">
                                    {projectSubtitle(project)}
                                  </span>
                                {/if}
                              </span>
                              <span class="text-right text-[11px] text-muted-strong">
                                <span class="block"
                                  >{copy.sessionsCount(projectSessionCount(project))}</span
                                >
                                {#if project.latestAt}
                                  <span class="block text-faint"
                                    >{formatDateTime(project.latestAt)}</span
                                  >
                                {/if}
                              </span>
                            </button>

                            {#if projectExpanded}
                              <div class="project-children grid gap-2 pl-5">
                                {#if sessionLoadingByProjectKey[project.key] && !displayedSessions.length}
                                  <div
                                    class="rounded-[0.45rem] border border-black/6 px-3 py-5 text-center text-sm text-muted-strong"
                                  >
                                    {copy.refreshing}
                                  </div>
                                {:else}
                                  {#each displayedSessions as session (session.filePath)}
                                    <div
                                      class="session-card grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[0.45rem] border border-black/6 px-3 py-3"
                                    >
                                      <button
                                        class="session-card-main min-w-0 text-left"
                                        type="button"
                                        onclick={() => void openDetail(session)}
                                      >
                                        <div class="min-w-0">
                                          <p
                                            class="session-line-clamp-2 text-sm font-semibold text-ink"
                                          >
                                            {session.title || session.id}
                                          </p>
                                          <p
                                            class="session-line-clamp-2 mt-1 text-xs leading-5 text-muted-strong"
                                          >
                                            {session.lastMessage || '--'}
                                          </p>
                                        </div>

                                        <div
                                          class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-strong"
                                        >
                                          {#if session.createdAt}
                                            <span
                                              >{copy.sessionsCreatedAt}: {formatDateTime(
                                                session.createdAt
                                              )}</span
                                            >
                                          {/if}
                                          {#if session.updatedAt}
                                            <span
                                              >{copy.sessionsUpdatedAt}: {formatDateTime(
                                                session.updatedAt
                                              )}</span
                                            >
                                          {/if}
                                        </div>
                                      </button>

                                      <button
                                        class="session-copy-button"
                                        type="button"
                                        title={copy.sessionsCopyToProvider}
                                        aria-label={copy.sessionsCopySessionLabel(
                                          session.title || session.id
                                        )}
                                        onclick={() => openCopySessionDialog(session)}
                                      >
                                        <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
                                      </button>
                                    </div>
                                  {/each}

                                  {#if projectSessionCount(project) > visibleLimit}
                                    <div class="flex justify-center pt-1">
                                      {#if currentVisibleLimit < projectSessionCount(project)}
                                        <button
                                          class={compactGhostButton}
                                          type="button"
                                          disabled={sessionLoadingByProjectKey[project.key]}
                                          onclick={() => void showMoreProjectSessions(project)}
                                        >
                                          {copy.sessionsShowMore(
                                            projectSessionCount(project) - currentVisibleLimit
                                          )}
                                        </button>
                                      {:else}
                                        <button
                                          class={compactGhostButton}
                                          type="button"
                                          onclick={() => collapseProjectSessions(project)}
                                        >
                                          {copy.sessionsCollapse}
                                        </button>
                                      {/if}
                                    </div>
                                  {/if}
                                {/if}
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  {#if copyTargetSession}
    <AppDialog
      ariaLabel={copy.sessionsCopyToProvider}
      maxWidthClass="max-w-2xl"
      panelClass="session-copy-dialog-panel"
      on:close={closeCopySessionDialog}
    >
      <div class="session-copy-dialog grid gap-5">
        <div class="flex items-start justify-between gap-4" data-dialog-motion>
          <div class="min-w-0">
            <p
              class="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.035] px-2 py-1 text-[11px] font-medium text-muted-strong"
            >
              <span class="i-lucide-copy-plus h-3 w-3"></span>
              {copy.sessionsCopyToProvider}
            </p>
            <h3 class="session-line-clamp-2 mt-3 text-base font-semibold leading-6 text-ink">
              {copyTargetSession.title || copyTargetSession.id}
            </h3>
            <p class="mt-1 text-xs leading-5 text-muted-strong">
              {copy.sessionsCopyTargetProviderHelp}
            </p>
          </div>
          <button
            class="session-copy-dialog-close-button"
            type="button"
            aria-label={copy.cancel}
            onclick={closeCopySessionDialog}
          >
            <span class="i-lucide-x h-4 w-4"></span>
            <span class="hidden sm:inline">{copy.cancel}</span>
          </button>
        </div>

        <div
          class="session-copy-source-card grid gap-3 rounded-[0.8rem] border px-3.5 py-3.5"
          data-dialog-motion
        >
          <div class="flex items-center gap-2 text-xs font-medium text-muted-strong">
            <span class="i-lucide-file-clock h-3.5 w-3.5 text-faint"></span>
            <span>{copy.sessionsSource}</span>
          </div>
          <dl class="grid gap-2 text-xs sm:grid-cols-3">
            <div class="session-copy-meta-item">
              <dt>{copy.sessionsInstance}</dt>
              <dd>{copyTargetSession.instanceName}</dd>
            </div>
            <div class="session-copy-meta-item">
              <dt>{copy.sessionsProvider}</dt>
              <dd>
                {providerLabel(
                  copyTargetSession.modelProvider,
                  copyTargetSession.modelProviderLabel,
                  sessionProviderContext
                )}
              </dd>
            </div>
            <div class="session-copy-meta-item">
              <dt>{copy.sessionsProject}</dt>
              <dd>{copyTargetSession.projectPath || '--'}</dd>
            </div>
          </dl>
        </div>

        {#if !copyProviderOptions.length}
          <div
            class="session-copy-empty-state rounded-[0.8rem] border px-4 py-5 text-sm text-muted-strong"
            data-dialog-motion
          >
            <span class="i-lucide-circle-alert h-5 w-5 text-faint"></span>
            <span>{copy.sessionsNoTargetProvider}</span>
          </div>
        {:else}
          <div
            class="session-copy-target-card grid gap-4 rounded-[0.9rem] border px-4 py-4"
            data-dialog-motion
          >
            <div class="grid gap-1">
              <p class="text-sm font-semibold text-ink">{copy.sessionsCopyToProvider}</p>
              <p class="text-xs leading-5 text-muted-strong">
                {copy.sessionsCopyTargetInstanceHelp}
              </p>
            </div>

            <label class="grid gap-2">
              <span class="flex items-center gap-1.5 text-xs font-medium text-muted-strong">
                <span class="i-lucide-box h-3.5 w-3.5 text-faint"></span>
                {copy.sessionsTargetInstance}
              </span>
              <FloatingSelect
                options={copyInstanceOptions}
                value={copyTargetInstanceId}
                ariaLabel={copy.sessionsTargetInstance}
                disabled={copySessionBusy}
                buttonClass={`${floatingSelectButtonClass} session-copy-select-button`}
                menuClass={floatingSelectMenuClass}
                optionClass={floatingSelectOptionClass}
                activeOptionClass="theme-menu-choice-active bg-black/[0.05]"
                inactiveOptionClass="bg-transparent hover:bg-black/[0.03]"
                on:change={(event) => {
                  updateCopyTargetInstance(event.detail)
                }}
              />
              {#if copyTargetInstanceId}
                {@const targetInstance = allKnownInstances.find(
                  (instance) => instance.id === copyTargetInstanceId
                )}
                {#if targetInstance?.codexHome}
                  <span class="session-copy-path truncate font-mono text-[11px] leading-4">
                    {targetInstance.codexHome}
                  </span>
                {/if}
              {/if}
            </label>

            <label class="grid gap-2">
              <span class="flex items-center gap-1.5 text-xs font-medium text-muted-strong">
                <span class="i-lucide-server h-3.5 w-3.5 text-faint"></span>
                {copy.sessionsTargetProvider}
              </span>
              <FloatingSelect
                options={copyProviderOptions}
                value={copyTargetProviderId}
                ariaLabel={copy.sessionsTargetProvider}
                disabled={copySessionBusy}
                buttonClass={`${floatingSelectButtonClass} session-copy-select-button`}
                menuClass={floatingSelectMenuClass}
                optionClass={floatingSelectOptionClass}
                activeOptionClass="theme-menu-choice-active bg-black/[0.05]"
                inactiveOptionClass="bg-transparent hover:bg-black/[0.03]"
                on:change={(event) => {
                  copyTargetProviderId = event.detail
                }}
              />
            </label>

            <div class="session-copy-actions flex justify-end gap-2 pt-1">
              <button
                class="session-copy-secondary-button"
                type="button"
                onclick={closeCopySessionDialog}
              >
                {copy.cancel}
              </button>
              <button
                class="session-copy-confirm-button"
                type="button"
                disabled={copySessionBusy || !copyTargetInstanceId || !copyTargetProviderId}
                onclick={() => void confirmCopySessionToProvider()}
              >
                {#if copySessionBusy}
                  <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin" aria-hidden="true"
                  ></span>
                  {copy.refreshing}
                {:else}
                  {copy.sessionsCopyConfirm}
                {/if}
              </button>
            </div>
          </div>
        {/if}

        {#if copySessionError}
          <div
            class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
            data-dialog-motion
          >
            {copy.sessionsCopyFailed}: {copySessionError}
          </div>
        {/if}
      </div>
    </AppDialog>
  {/if}
</div>

<style>
  .session-card,
  .session-message {
    background: color-mix(in srgb, var(--panel-strong) 78%, var(--surface-soft));
    color: var(--ink);
    box-shadow: none;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .session-message {
    width: fit-content;
    max-width: min(82%, 64rem);
    justify-self: start;
  }

  .session-card:hover {
    border-color: var(--line-strong);
    background: var(--surface-hover);
  }

  .session-card-main {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0;
  }

  .session-copy-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid color-mix(in srgb, var(--line) 86%, transparent);
    border-radius: 0.4rem;
    background: transparent;
    color: var(--muted-strong);
    padding: 0;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .session-copy-button:hover,
  .session-copy-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--ink);
  }

  :global(.session-copy-dialog-panel) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--panel-strong) 96%, var(--surface-soft)),
      var(--panel-strong)
    ) !important;
    box-shadow:
      0 30px 80px -50px var(--paper-shadow),
      0 0 0 1px color-mix(in srgb, var(--line) 72%, transparent) !important;
  }

  .session-copy-dialog-close-button,
  .session-copy-secondary-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    border: 1px solid color-mix(in srgb, var(--line) 86%, transparent);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
    color: var(--muted-strong);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .session-copy-dialog-close-button {
    flex: none;
    min-width: 2.25rem;
    padding-inline: 0.65rem;
  }

  .session-copy-dialog-close-button:hover,
  .session-copy-dialog-close-button:focus-visible,
  .session-copy-secondary-button:hover,
  .session-copy-secondary-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--ink);
  }

  .session-copy-source-card,
  .session-copy-target-card,
  .session-copy-empty-state {
    border-color: color-mix(in srgb, var(--line) 82%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 68%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--paper) 34%, transparent);
  }

  .session-copy-target-card {
    background: color-mix(in srgb, var(--panel-strong) 72%, var(--surface-soft));
  }

  .session-copy-empty-state {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .session-copy-meta-item {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--panel-strong) 52%, transparent);
    padding: 0.65rem 0.7rem;
  }

  .session-copy-meta-item dt {
    color: var(--ink-faint);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: uppercase;
  }

  .session-copy-meta-item dd {
    min-width: 0;
    overflow: hidden;
    color: var(--ink);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-copy-path {
    color: var(--ink-faint);
  }

  :global(.session-copy-select-button) {
    min-height: 3rem !important;
    border-radius: 0.75rem !important;
    background: color-mix(in srgb, var(--panel-strong) 70%, transparent) !important;
    font-size: 0.95rem !important;
    font-weight: 600 !important;
  }

  :global(.session-copy-select-button:hover),
  :global(.session-copy-select-button:focus-visible) {
    border-color: var(--line-strong) !important;
    background: var(--surface-hover) !important;
  }

  .session-copy-confirm-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.45rem;
    border: 1px solid color-mix(in srgb, var(--ink) 82%, transparent);
    border-radius: 0.65rem;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 700;
    padding: 0.6rem 1rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      opacity 140ms ease;
  }

  .session-copy-confirm-button:hover,
  .session-copy-confirm-button:focus-visible {
    border-color: var(--ink);
    background: color-mix(in srgb, var(--ink) 88%, var(--surface-soft));
  }

  .session-copy-confirm-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .tree-toggle {
    appearance: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0;
  }

  .tree-caret {
    display: inline-flex;
    width: 0.9rem;
    justify-content: center;
    color: var(--muted-strong);
    transition: transform 140ms ease;
  }

  .tree-caret.is-open {
    transform: rotate(90deg);
  }

  .provider-toggle,
  .project-toggle {
    background: color-mix(in srgb, var(--panel-strong) 64%, transparent);
    color: var(--ink);
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .provider-toggle:hover,
  .project-toggle:hover {
    border-color: var(--line-strong);
    background: var(--surface-hover);
  }

  .provider-toggle {
    background: color-mix(in srgb, var(--panel-strong) 70%, var(--surface-soft));
  }

  .provider-children,
  .project-children {
    border-left: 1px solid color-mix(in srgb, var(--line) 84%, transparent);
  }

  .session-message-user {
    justify-self: end;
    max-width: min(88%, 64rem);
    border-color: color-mix(in srgb, var(--ink) 10%, transparent);
    background: color-mix(in srgb, var(--ink) 7%, var(--panel-strong));
  }

  .session-message-assistant {
    justify-self: start;
    border-color: color-mix(in srgb, var(--success) 24%, var(--line));
    background: color-mix(in srgb, var(--panel-strong) 82%, var(--surface-soft));
  }

  .session-message-auxiliary {
    width: auto;
    max-width: 100%;
    justify-self: stretch;
    background: color-mix(in srgb, var(--panel-strong) 54%, transparent);
    border-style: dashed;
    opacity: 0.86;
  }

  .session-message-user .message-header {
    flex-direction: row-reverse;
  }

  .session-message-user .message-role-badge {
    border-color: color-mix(in srgb, var(--ink) 10%, transparent);
    background: color-mix(in srgb, var(--ink) 5%, transparent);
    color: var(--ink-soft);
  }

  .message-role-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 58%, transparent);
    padding: 0.15rem 0.45rem;
    color: var(--ink);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
  }

  .message-role-badge.is-auxiliary {
    border-color: color-mix(in srgb, var(--line) 58%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 34%, transparent);
    color: var(--muted-strong);
    font-weight: 500;
  }

  .message-text-toggle {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0;
  }

  .message-text-toggle[aria-disabled='true'] {
    cursor: default;
  }

  .message-text {
    max-height: 10rem;
    overflow: hidden;
  }

  .message-text-auxiliary {
    color: var(--muted);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    letter-spacing: -0.01em;
    max-height: 7.5rem;
  }

  .message-image {
    display: block;
    max-width: min(100%, 42rem);
    max-height: 28rem;
    margin: 0.5rem 0;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
    object-fit: contain;
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  }

  .message-text.is-expanded {
    max-height: none;
  }

  .message-expand-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    width: fit-content;
    height: auto;
    min-height: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted-strong);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1;
    box-shadow: none;
    padding: 0.2rem 0.35rem;
    transition:
      background-color 140ms ease,
      color 140ms ease;
  }

  .message-expand-button:hover,
  .message-expand-button:focus-visible {
    background: color-mix(in srgb, var(--surface-hover) 76%, transparent);
    color: var(--ink);
  }

  .message-expand-button span {
    width: 0.8rem;
    height: 0.8rem;
  }

  .session-line-clamp-2 {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  :global(html[data-theme='dark']) .session-card,
  :global(html[data-theme='dark']) .session-message {
    background: color-mix(in srgb, var(--surface-soft) 72%, var(--panel) 28%);
  }

  :global(html[data-theme='dark']) .session-message-user {
    border-color: color-mix(in srgb, var(--ink) 9%, transparent);
    background: color-mix(in srgb, var(--ink) 9%, var(--surface-soft) 38%);
  }

  :global(html[data-theme='dark']) .session-message-assistant {
    background: color-mix(in srgb, var(--surface-soft) 72%, var(--panel) 28%);
  }

  :global(html[data-theme='dark']) .session-message-auxiliary {
    background: color-mix(in srgb, var(--surface-soft) 36%, var(--panel) 64%);
  }

  :global(html[data-theme='dark']) .provider-toggle,
  :global(html[data-theme='dark']) .project-toggle {
    background: color-mix(in srgb, var(--surface-soft) 56%, transparent);
  }

  :global(html[data-theme='dark']) .session-card:hover {
    background: var(--surface-hover);
  }
</style>
