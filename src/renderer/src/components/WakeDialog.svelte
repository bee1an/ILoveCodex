<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'

  import type {
    AccountWakeSchedule,
    AppLanguage,
    WakeAccountRequestResult
  } from '../../../shared/codex'
  import { defaultWakeModel } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import Checkbox from './Checkbox.svelte'
  import { cascadeIn, reveal } from './gsap-motion'
  import { formatWakeScheduleLastTriggeredAt, nextWakeScheduleLabel } from './wake-schedule'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accountLabelText = ''
  export let compactGhostButton = ''
  export let primaryActionButton = ''
  export let activeTab: 'session' | 'schedule' = 'session'

  export let sessionPrompt = 'ping'
  export let sessionModel = defaultWakeModel
  export let sessionStatus: 'idle' | 'running' | 'success' | 'skipped' | 'error' = 'idle'
  export let sessionLogs: string[] = []
  export let requestResult: WakeAccountRequestResult | null = null
  export let requestError = ''
  export let rawResponseBody = ''
  export let sessionBusy = false

  export let schedule: AccountWakeSchedule | null = null
  export let scheduleEnabled = true
  export let scheduleTimes: string[] = ['09:00']
  export let schedulePrompt = 'ping'
  export let scheduleModel = defaultWakeModel
  export let scheduleError = ''
  export let scheduleSaving = false

  export let onClose: () => void = () => {}
  export let onSubmitSession: () => void | Promise<void> = () => {}
  export let onSaveSchedule: () => void | Promise<void> = () => {}
  export let onDeleteSchedule: () => void | Promise<void> = () => {}

  let logPanel: HTMLPreElement | null = null
  type ModalMotionState = 'closed' | 'open' | 'closing'

  let modalMotionState: ModalMotionState = 'closed'
  let closeTimer: number | null = null
  let openFrame: number | null = null

  $: modalMotionClass =
    modalMotionState === 'open' ? 'is-open' : modalMotionState === 'closing' ? 'is-closing' : ''

  const modalCloseDurationMs = (): number => {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150
    )
  }

  const clearMotionTimers = (): void => {
    if (closeTimer != null) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    if (openFrame != null) {
      window.cancelAnimationFrame(openFrame)
      openFrame = null
    }
  }

  const requestClose = (): void => {
    if (dialogBusy() || modalMotionState === 'closing') {
      return
    }

    clearMotionTimers()
    modalMotionState = 'closing'
    closeTimer = window.setTimeout(() => {
      closeTimer = null
      onClose()
    }, modalCloseDurationMs())
  }

  const statusToneClass = (value: typeof sessionStatus): string => {
    switch (value) {
      case 'running':
        return 'wake-status-running'
      case 'success':
        return 'wake-status-success'
      case 'skipped':
        return 'wake-status-skipped'
      case 'error':
        return 'wake-status-error'
      default:
        return 'theme-version-pill'
    }
  }

  const sessionStatusLabel = (value: typeof sessionStatus): string => {
    switch (value) {
      case 'running':
        return copy.wakeQuotaStatusRunning
      case 'success':
        return copy.wakeQuotaStatusSuccess
      case 'skipped':
        return copy.wakeQuotaStatusSkipped
      case 'error':
        return copy.wakeQuotaStatusError
      default:
        return copy.wakeQuotaStatusIdle
    }
  }

  const scheduleStatusLabel = (status: AccountWakeSchedule['lastStatus'] | undefined): string => {
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

  const responsePreview = (body: string): string => {
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (!firstLine) {
      return copy.wakeQuotaResultEmpty
    }

    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  const addTime = (): void => {
    scheduleTimes = [...scheduleTimes, '']
  }

  const updateTime = (index: number, value: string): void => {
    scheduleTimes = scheduleTimes.map((item, itemIndex) => (itemIndex === index ? value : item))
  }

  const removeTime = (index: number): void => {
    scheduleTimes = scheduleTimes.filter((_, itemIndex) => itemIndex !== index)
    if (!scheduleTimes.length) {
      scheduleTimes = ['']
    }
  }

  const dialogBusy = (): boolean => sessionBusy || scheduleSaving

  $: if (sessionLogs.length && activeTab === 'session') {
    void tick().then(() => {
      logPanel?.scrollTo({ top: logPanel.scrollHeight })
    })
  }

  onMount(() => {
    openFrame = window.requestAnimationFrame(() => {
      openFrame = null
      modalMotionState = 'open'
    })
  })

  onDestroy(clearMotionTimers)
</script>

<div
  class="wake-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
  use:reveal={{ y: 0, scale: 1, blur: 0, duration: 0.18 }}
>
  <div
    class={`theme-surface t-modal ${modalMotionClass} wake-dialog-panel flex w-full max-w-4xl flex-col overflow-hidden rounded-[0.65rem] border border-black/8 bg-white p-4 md:p-5`}
    use:cascadeIn={{
      selector: '[data-wake-motion]'
    }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="wake-dialog-title"
  >
    <div class="grid gap-4">
      <div class="wake-dialog-heading grid gap-1" data-wake-motion>
        <p id="wake-dialog-title" class="text-base font-semibold tracking-[-0.015em] text-ink">
          {copy.wakeDialogTitle}
        </p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">
          {copy.wakeDialogDescription}
        </p>
        <p class="text-[11px] leading-4 text-faint">{accountLabelText}</p>
      </div>

      <div
        class="wake-tab-list inline-flex w-fit items-center gap-1 rounded-[0.45rem] border border-black/5 bg-transparent p-0.5"
        data-wake-motion
      >
        <button
          class={`wake-tab-button inline-flex items-center gap-1.5 rounded-[0.35rem] px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
            activeTab === 'session'
              ? 'bg-[var(--panel-strong)] text-ink'
              : 'bg-transparent text-black/58 hover:bg-[var(--surface-hover)] hover:text-ink'
          }`}
          type="button"
          onclick={() => {
            if (!dialogBusy()) {
              activeTab = 'session'
            }
          }}
          disabled={dialogBusy()}
          aria-pressed={activeTab === 'session'}
        >
          <span class="i-lucide-zap h-3.5 w-3.5"></span>
          <span>{copy.wakeQuota}</span>
        </button>
        <button
          class={`wake-tab-button inline-flex items-center gap-1.5 rounded-[0.35rem] px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
            activeTab === 'schedule'
              ? 'bg-[var(--panel-strong)] text-ink'
              : 'bg-transparent text-black/58 hover:bg-[var(--surface-hover)] hover:text-ink'
          }`}
          type="button"
          onclick={() => {
            if (!dialogBusy()) {
              activeTab = 'schedule'
            }
          }}
          disabled={dialogBusy()}
          aria-pressed={activeTab === 'schedule'}
        >
          <span class="i-lucide-calendar-clock h-3.5 w-3.5"></span>
          <span>{copy.wakeSchedule}</span>
        </button>
      </div>

      {#if activeTab === 'session'}
        <div class="grid gap-4" data-wake-motion use:reveal={{ delay: 0.02 }}>
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <p class="text-sm font-medium text-ink">{copy.wakeQuotaDialogTitle}</p>
              <p class="text-xs text-muted-strong">{copy.wakeQuotaDialogDescription}</p>
            </div>
            <span
              class={`inline-flex items-center rounded-[0.35rem] px-2.5 py-1 text-[11px] font-medium ${statusToneClass(sessionStatus)}`}
            >
              {sessionStatusLabel(sessionStatus)}
            </span>
          </div>

          <div class="grid gap-3 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <div class="grid content-start gap-3">
              <label class="grid gap-1.5">
                <span class="text-xs font-medium text-muted-strong">
                  {copy.wakeQuotaPromptLabel}
                </span>
                <textarea
                  class="theme-select wake-dialog-field min-h-28 rounded-[0.4rem] border border-black/8 bg-transparent px-3.5 py-3 text-sm text-ink outline-none transition hover:bg-[var(--surface-hover)] focus-visible:border-black/20 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-black/5"
                  bind:value={sessionPrompt}
                  placeholder={copy.wakeQuotaPromptPlaceholder}
                  disabled={dialogBusy()}
                ></textarea>
              </label>

              <label class="grid gap-1.5">
                <span class="text-xs font-medium text-muted-strong">
                  {copy.wakeQuotaModelLabel}
                </span>
                <input
                  class="theme-select wake-dialog-field rounded-[0.4rem] border border-black/8 bg-transparent px-3.5 py-3 text-sm text-ink outline-none transition hover:bg-[var(--surface-hover)] focus-visible:border-black/20 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-black/5"
                  type="text"
                  bind:value={sessionModel}
                  placeholder={copy.wakeQuotaModelPlaceholder}
                  disabled={dialogBusy()}
                />
              </label>

              {#if requestError}
                <div
                  class="theme-error-panel rounded-[0.4rem] border border-danger/18 bg-danger/6 px-3 py-2.5 text-sm text-danger"
                >
                  {requestError}
                </div>
              {/if}
            </div>

            <div class="grid min-h-0 gap-3">
              <div class="grid gap-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-medium text-muted-strong">
                    {copy.wakeQuotaLogTitle}
                  </span>
                  {#if requestResult}
                    <span
                      class="theme-version-pill inline-flex items-center rounded-md bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-strong"
                    >
                      {copy.wakeQuotaResultStatus}&nbsp;{requestResult.status}
                    </span>
                  {/if}
                </div>

                <pre
                  bind:this={logPanel}
                  class="theme-code-surface wake-log-panel min-h-48 max-h-72 overflow-auto rounded-[0.4rem] border border-black/8 bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-ink"><code
                    >{sessionLogs.length ? sessionLogs.join('\n') : copy.wakeQuotaLogEmpty}</code
                  ></pre>
              </div>

              {#if requestResult}
                <div class="grid gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-medium text-muted-strong">
                      {copy.wakeQuotaResult}
                    </span>
                    <span class="text-[10px] text-faint">{responsePreview(rawResponseBody)}</span>
                  </div>
                  <pre
                    class="theme-code-surface max-h-56 overflow-auto overscroll-contain rounded-[0.4rem] border border-black/8 bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-ink"><code
                      >{rawResponseBody || copy.wakeQuotaResultEmpty}</code
                    ></pre>
                </div>
              {/if}
            </div>
          </div>

          <div class="flex justify-end gap-2" data-wake-motion>
            <button
              class={compactGhostButton}
              type="button"
              onclick={requestClose}
              disabled={dialogBusy()}
            >
              {copy.cancel}
            </button>
            <button
              class={primaryActionButton}
              type="button"
              onclick={onSubmitSession}
              disabled={dialogBusy()}
            >
              {#if sessionBusy}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {/if}
              <span>{copy.wakeQuotaConfirm}</span>
            </button>
          </div>
        </div>
      {:else}
        <div class="grid gap-4" data-wake-motion use:reveal={{ delay: 0.02 }}>
          <div
            class="wake-section-header flex flex-wrap items-center justify-between gap-3 border-b border-black/6 pb-3"
          >
            <div class="grid gap-1">
              <p class="text-sm font-semibold tracking-[-0.01em] text-ink">
                {copy.wakeScheduleDialogTitle}
              </p>
              <p class="text-xs leading-5 text-muted-strong">
                {copy.wakeScheduleDialogDescription}
              </p>
            </div>
            <label class="inline-flex items-center gap-2 text-xs font-medium text-ink">
              <Checkbox bind:checked={scheduleEnabled} disabled={dialogBusy()} />
              <span>{copy.wakeScheduleEnabled}</span>
            </label>
          </div>

          <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <div class="grid content-start gap-4">
              <div class="grid gap-2.5">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
                    {copy.wakeScheduleTimes}
                  </span>
                  <button
                    class="wake-icon-button"
                    type="button"
                    onclick={addTime}
                    disabled={dialogBusy()}
                    aria-label={copy.wakeScheduleAddTime}
                    title={copy.wakeScheduleAddTime}
                  >
                    <span class="i-lucide-plus h-4 w-4"></span>
                  </button>
                </div>

                <div class="grid gap-1.5">
                  {#each scheduleTimes as timeValue, timeIndex (timeIndex)}
                    <div
                      class="wake-time-row grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2"
                    >
                      <input
                        class="theme-select wake-dialog-field h-9 min-w-0 rounded-[0.4rem] border border-black/8 bg-transparent px-3 text-sm tabular-nums text-ink outline-none transition hover:bg-[var(--surface-hover)] focus-visible:border-black/20 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-black/5"
                        type="text"
                        value={timeValue}
                        placeholder={copy.wakeScheduleTimePlaceholder}
                        disabled={dialogBusy()}
                        oninput={(event) =>
                          updateTime(timeIndex, (event.currentTarget as HTMLInputElement).value)}
                      />
                      <button
                        class="wake-icon-button"
                        type="button"
                        onclick={() => removeTime(timeIndex)}
                        disabled={dialogBusy()}
                        aria-label={copy.wakeScheduleRemoveTime}
                        title={copy.wakeScheduleRemoveTime}
                      >
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                      </button>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.72fr)]">
                <label class="grid gap-1.5">
                  <span class="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
                    {copy.wakeQuotaPromptLabel}
                  </span>
                  <textarea
                    class="theme-select wake-dialog-field min-h-24 rounded-[0.4rem] border border-black/8 bg-transparent px-3 py-2.5 text-sm text-ink outline-none transition hover:bg-[var(--surface-hover)] focus-visible:border-black/20 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-black/5"
                    bind:value={schedulePrompt}
                    placeholder={copy.wakeQuotaPromptPlaceholder}
                    disabled={dialogBusy()}
                  ></textarea>
                </label>
                <label class="grid content-start gap-1.5">
                  <span class="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
                    {copy.wakeQuotaModelLabel}
                  </span>
                  <input
                    class="theme-select wake-dialog-field h-9 rounded-[0.4rem] border border-black/8 bg-transparent px-3 text-sm text-ink outline-none transition hover:bg-[var(--surface-hover)] focus-visible:border-black/20 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-black/5"
                    type="text"
                    bind:value={scheduleModel}
                    placeholder={copy.wakeQuotaModelPlaceholder}
                    disabled={dialogBusy()}
                  />
                </label>
              </div>

              {#if scheduleError}
                <div
                  class="theme-error-panel inline-flex items-center gap-2 rounded-[0.4rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm font-medium text-danger"
                  role="alert"
                >
                  <span class="i-lucide-circle-alert h-4 w-4 flex-none"></span>
                  <span>{scheduleError}</span>
                </div>
              {/if}
            </div>

            <div
              class="wake-schedule-summary grid content-start gap-0 rounded-[0.5rem] border border-black/8 bg-transparent px-3 py-2 text-xs text-muted-strong"
            >
              <div class="wake-summary-row flex items-center justify-between gap-3 py-2">
                <span>{copy.wakeScheduleNextRun}</span>
                <span class="font-medium tabular-nums text-ink">
                  {nextWakeScheduleLabel(schedule, language, copy.wakeScheduleEmpty)}
                </span>
              </div>
              <div class="wake-summary-row flex items-center justify-between gap-3 py-2">
                <span>{copy.wakeScheduleLastRun}</span>
                <span class="font-medium tabular-nums text-ink"
                  >{formatWakeScheduleLastTriggeredAt(
                    schedule?.lastTriggeredAt,
                    language,
                    copy.wakeScheduleEmpty
                  )}</span
                >
              </div>
              <div class="wake-summary-row flex items-center justify-between gap-3 py-2">
                <span>{copy.wakeScheduleLastStatus}</span>
                <span class="font-medium text-ink">{scheduleStatusLabel(schedule?.lastStatus)}</span
                >
              </div>
              {#if schedule?.lastMessage}
                <div class="grid gap-1 border-t border-black/6 pt-2">
                  <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                    {copy.wakeScheduleLastMessage}
                  </span>
                  <pre
                    class="theme-code-surface max-h-36 overflow-auto rounded-[0.35rem] border border-black/8 bg-transparent px-3 py-2 text-[11px] leading-5 text-ink"><code
                      >{schedule.lastMessage}</code
                    ></pre>
                </div>
              {/if}
            </div>
          </div>

          <div class="flex items-center justify-between gap-3" data-wake-motion>
            <button
              class="theme-select wake-compact-button rounded-[0.35rem] border border-black/10 px-2.5 py-1.5 text-xs font-medium"
              type="button"
              onclick={onDeleteSchedule}
              disabled={dialogBusy() || !schedule}
            >
              {copy.wakeScheduleDelete}
            </button>

            <div class="flex justify-end gap-2">
              <button
                class={compactGhostButton}
                type="button"
                onclick={requestClose}
                disabled={dialogBusy()}
              >
                {copy.cancel}
              </button>
              <button
                class={primaryActionButton}
                type="button"
                onclick={onSaveSchedule}
                disabled={dialogBusy()}
              >
                {#if scheduleSaving}
                  <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                {/if}
                <span>{copy.wakeScheduleSave}</span>
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .wake-status-running {
    background: rgb(59 130 246 / 0.1);
    color: rgb(37 99 235);
  }

  .wake-status-success {
    background: rgb(16 185 129 / 0.12);
    color: rgb(5 150 105);
  }

  .wake-status-skipped {
    background: rgb(245 158 11 / 0.14);
    color: rgb(180 83 9);
  }

  .wake-status-error {
    background: rgb(239 68 68 / 0.12);
    color: rgb(220 38 38);
  }

  .wake-log-panel {
    font-family:
      'SFMono-Regular', 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono',
      monospace;
  }

  .wake-dialog-panel.wake-dialog-panel {
    box-shadow: 0 12px 30px -28px rgb(20 20 18 / 0.34) !important;
  }

  .wake-tab-list {
    background: transparent;
  }

  .wake-tab-button[aria-pressed='true'] {
    border: 1px solid var(--line);
    box-shadow: none;
  }

  .wake-dialog-panel :global(.wake-dialog-field),
  .wake-dialog-panel :global(.wake-compact-button),
  .wake-dialog-panel :global(.wake-icon-button),
  .wake-dialog-panel :global(.theme-code-surface) {
    box-shadow: none !important;
  }

  .wake-icon-button.wake-icon-button {
    display: inline-flex !important;
    width: 2.25rem !important;
    height: 2.25rem !important;
    flex: 0 0 2.25rem !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    border: 1px solid var(--line-strong) !important;
    border-radius: 0.35rem !important;
    background: color-mix(in srgb, var(--panel-strong) 82%, var(--paper)) !important;
    color: var(--ink) !important;
    opacity: 1 !important;
    box-shadow: none !important;
  }

  .wake-icon-button.wake-icon-button:hover:not(:disabled) {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  .wake-icon-button.wake-icon-button :global([class*='i-lucide-']) {
    display: inline-block !important;
    background-color: currentColor !important;
    color: inherit !important;
    opacity: 1 !important;
  }

  .wake-dialog-panel :global(.wake-dialog-field) {
    background: transparent !important;
  }

  .wake-dialog-panel :global(.theme-code-surface) {
    background: color-mix(in srgb, var(--panel-strong) 74%, var(--paper)) !important;
    color: var(--ink) !important;
  }

  .wake-summary-row + .wake-summary-row {
    border-top: 1px solid var(--line);
  }

  :global(html[data-theme='dark']) .wake-dialog-backdrop {
    background: color-mix(in srgb, black 48%, transparent) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-panel {
    box-shadow: 0 12px 30px -28px rgb(0 0 0 / 0.76) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-field {
    border-color: var(--line) !important;
    background: transparent !important;
    box-shadow: none !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-field::placeholder {
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark']) .wake-status-running {
    background: rgb(59 130 246 / 0.16) !important;
    color: rgb(147 197 253) !important;
  }

  :global(html[data-theme='dark']) .wake-status-skipped {
    background: rgb(245 158 11 / 0.18) !important;
    color: rgb(253 224 71) !important;
  }

  :global(html[data-theme='dark']) .wake-status-success {
    background: rgb(16 185 129 / 0.16) !important;
    color: rgb(167 243 208) !important;
  }

  :global(html[data-theme='dark']) .wake-status-error {
    background: rgb(239 68 68 / 0.16) !important;
    color: rgb(252 165 165) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button {
    color: var(--ink-soft-strong) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button:hover:not(:disabled) {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button[aria-pressed='true'] {
    border-color: var(--line-strong) !important;
    background: color-mix(in srgb, var(--panel-strong) 88%, var(--paper) 12%) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-panel :global(.theme-code-surface) {
    background: color-mix(in srgb, var(--panel-strong) 78%, var(--paper)) !important;
    box-shadow: none !important;
    color: var(--ink) !important;
  }
</style>
