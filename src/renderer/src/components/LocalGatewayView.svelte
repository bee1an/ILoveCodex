<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { LocalGatewayLogEntry, LocalGatewayStatus } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'

  type StatusFilter = 'all' | 'ok' | 'warn' | 'error'

  export let copy: LocalizedCopy
  export let localGatewayStatus: LocalGatewayStatus
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let startLocalGateway: () => Promise<void>
  export let stopLocalGateway: () => Promise<void>
  export let rotateLocalGatewayKey: () => Promise<void>

  let displayedStatus: LocalGatewayStatus = localGatewayStatus
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let logSearch = ''
  let statusFilter: StatusFilter = 'all'

  const statusFilters: StatusFilter[] = ['all', 'ok', 'warn', 'error']

  const copyText = async (value: string): Promise<void> => {
    if (value) await navigator.clipboard.writeText(value)
  }

  const refreshGatewayStatus = async (): Promise<void> => {
    try {
      displayedStatus = await window.codexApp.getLocalGatewayStatus()
    } catch {
      displayedStatus = localGatewayStatus
    }
  }

  const formatNumber = (value: number): string =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)

  const formatLogTime = (value: string): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--:--:--'
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date)
  }

  const methodClass = (method: string): string => {
    if (method === 'GET') return 'gateway-method-get'
    if (method === 'SYSTEM') return 'gateway-method-system'
    return 'gateway-method-write'
  }

  const statusClass = (status: number): string => {
    if (status >= 500) return 'gateway-status-error'
    if (status >= 400) return 'gateway-status-warn'
    return 'gateway-status-success'
  }

  const latencyClass = (durationMs: number): string => {
    if (durationMs >= 800) return 'gateway-latency-error'
    if (durationMs >= 350) return 'gateway-latency-warn'
    return 'text-ink'
  }

  const statusFilterLabel = (filter: StatusFilter): string => {
    if (filter === 'all') return copy.localGatewayAllStatus
    if (filter === 'ok') return '2xx / 3xx'
    if (filter === 'warn') return '4xx'
    return '5xx'
  }

  const matchesStatusFilter = (log: LocalGatewayLogEntry, filter: StatusFilter): boolean => {
    if (filter === 'all') return true
    if (filter === 'ok') return log.status < 400
    if (filter === 'warn') return log.status >= 400 && log.status < 500
    return log.status >= 500
  }

  const matchesSearch = (log: LocalGatewayLogEntry, query: string): boolean => {
    if (!query) return true
    return [log.method, log.path, log.provider, log.model, String(log.status), log.message]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query))
  }

  const resolvePort = (baseUrl: string): string => {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.port) return parsed.port
      return parsed.protocol === 'https:' ? '443' : '80'
    } catch {
      return '-'
    }
  }

  $: displayedStatus = localGatewayStatus
  $: gatewayKey = localGatewayApiKey || displayedStatus.apiKeyPreview || 'sk-cdock-…'
  $: endpointUrl = `${displayedStatus.baseUrl}/v1`
  $: logs = displayedStatus.logs ?? []
  $: statusText = displayedStatus.running ? copy.localGatewayRunning : copy.localGatewayStopped
  $: healthText = displayedStatus.running
    ? copy.localGatewayHealthReady
    : copy.localGatewayHealthIdle
  $: gatewayPort = resolvePort(displayedStatus.baseUrl)
  $: totalRequests = logs.length
  $: errorCount = logs.filter((log) => log.status >= 400).length
  $: successRate = totalRequests
    ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(
        (totalRequests - errorCount) / totalRequests
      )
    : '—'
  $: avgLatency = totalRequests
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
        Math.round(logs.reduce((total, log) => total + log.durationMs, 0) / totalRequests)
      )} ms`
    : '—'
  $: normalizedLogSearch = logSearch.trim().toLowerCase()
  $: visibleLogs = logs.filter(
    (log) => matchesStatusFilter(log, statusFilter) && matchesSearch(log, normalizedLogSearch)
  )

  onMount(() => {
    void refreshGatewayStatus()
    pollTimer = setInterval(() => void refreshGatewayStatus(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
  })
</script>

<div class="gateway-container flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <div
    class="gateway-toolbar flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5"
  >
    <div class="flex min-w-[18rem] flex-1 items-center gap-3">
      <div
        class="gateway-title-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-network h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="truncate text-[13px] font-semibold text-ink text-balance">
            {copy.localGatewayTitle}
          </h2>
          <div
            class={`gateway-status-pill inline-flex flex-none items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${displayedStatus.running ? 'gateway-status-pill-running' : 'gateway-status-pill-idle'}`}
            aria-live="polite"
          >
            <span class="h-1.5 w-1.5 rounded-full" aria-hidden="true"></span>
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <button
        class="gateway-compact-chip hidden max-w-[18rem] items-center gap-1.5 rounded-[0.35rem] border px-2 py-1.5 text-[10px] text-muted-strong lg:inline-flex"
        type="button"
        onclick={() => void copyText(endpointUrl)}
        aria-label={copy.copyLocalGatewayBaseUrl}
        title={endpointUrl}
      >
        <span class="i-lucide-link h-3.5 w-3.5 flex-none" aria-hidden="true"></span>
        <span class="truncate font-mono tabular-nums" translate="no">{endpointUrl}</span>
      </button>

      <button
        class="gateway-action-button gateway-action-muted"
        type="button"
        onclick={() => void rotateLocalGatewayKey()}
        disabled={localGatewayBusy}
        aria-label={copy.rotateLocalGatewayKey}
      >
        <span class="i-lucide-rotate-cw h-3.5 w-3.5" aria-hidden="true"></span>
        <span>{copy.rotateLocalGatewayKey}</span>
      </button>

      {#if displayedStatus.running}
        <button
          class="gateway-action-button gateway-action-danger"
          type="button"
          onclick={() => void stopLocalGateway()}
          disabled={localGatewayBusy}
          aria-label={copy.stopLocalGateway}
        >
          {#if localGatewayBusy}
            <span
              class="i-lucide-loader-circle gateway-spinner h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            ></span>
          {:else}
            <span class="i-lucide-square h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.stopLocalGateway}</span>
        </button>
      {:else}
        <button
          class="gateway-action-button gateway-action-primary"
          type="button"
          onclick={() => void startLocalGateway()}
          disabled={localGatewayBusy}
          aria-label={copy.startLocalGateway}
        >
          {#if localGatewayBusy}
            <span
              class="i-lucide-loader-circle gateway-spinner h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            ></span>
          {:else}
            <span class="i-lucide-play h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.startLocalGateway}</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="gateway-scroll flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 pb-8">
    <div class="mx-auto flex max-w-[1180px] flex-col gap-4">
      {#if displayedStatus.lastError}
        <div
          class="gateway-error flex items-start gap-2 rounded-[0.45rem] border p-2.5 text-xs text-danger"
          role="alert"
          aria-live="polite"
        >
          <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 flex-none" aria-hidden="true"></span>
          <span class="min-w-0 break-words leading-relaxed">{displayedStatus.lastError}</span>
        </div>
      {/if}

      <section
        class="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]"
        aria-label={copy.localGatewayConfigHint}
      >
        <div class="gateway-panel gateway-config-panel overflow-hidden rounded-[0.45rem] border">
          <div
            class="gateway-config-header flex items-center justify-between gap-3 border-b px-3 py-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="gateway-section-icon flex h-6 w-6 flex-none items-center justify-center rounded-[0.35rem] border"
                aria-hidden="true"
              >
                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
              </span>
              <div class="min-w-0">
                <h3 class="truncate text-[12px] font-semibold leading-4 text-ink">
                  {copy.localGatewayConfigHint}
                </h3>
                <p class="truncate text-[10px] leading-4 text-muted-strong">
                  OpenAI / Claude / Gemini
                </p>
              </div>
            </div>
            <div class="flex flex-none items-center gap-1.5">
              <span
                class="gateway-config-badge inline-flex items-center rounded-[0.28rem] border px-1.5 py-0.5 text-[10px] font-medium text-muted-strong"
              >
                Sub2API
              </span>
              <span
                class="gateway-config-badge inline-flex items-center gap-1 rounded-[0.28rem] border px-1.5 py-0.5 text-[10px] font-mono font-medium tabular-nums text-muted-strong"
              >
                <span class="i-lucide-radio-tower h-3 w-3" aria-hidden="true"></span>
                {gatewayPort}
              </span>
            </div>
          </div>

          <div class="grid gap-2 p-2.5 md:grid-cols-2">
            <div class="gateway-config-field min-w-0 overflow-hidden rounded-[0.35rem] border">
              <div class="gateway-config-value flex min-w-0 items-center gap-2 px-2.5 py-2">
                <span
                  class="gateway-config-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border"
                  aria-hidden="true"
                >
                  <span class="i-lucide-link h-3.5 w-3.5"></span>
                </span>
                <div class="min-w-0 flex-1">
                  <p
                    class="mb-1 truncate text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-faint"
                  >
                    OPENAI_BASE_URL
                  </p>
                  <code
                    class="gateway-config-code min-w-0 truncate font-mono text-[12px] font-semibold text-ink select-all"
                    title={endpointUrl}
                    translate="no"
                  >
                    {endpointUrl}
                  </code>
                </div>
                <button
                  class="gateway-icon-button gateway-config-copy h-6 w-6 flex-none rounded-[0.35rem] border"
                  type="button"
                  onclick={() => void copyText(endpointUrl)}
                  aria-label={copy.copyLocalGatewayBaseUrl}
                  title={copy.copyLocalGatewayBaseUrl}
                >
                  <span class="i-lucide-copy h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
              </div>
            </div>

            <div class="gateway-config-field min-w-0 overflow-hidden rounded-[0.35rem] border">
              <div class="gateway-config-value flex min-w-0 items-center gap-2 px-2.5 py-2">
                <span
                  class="gateway-config-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border"
                  aria-hidden="true"
                >
                  <span class="i-lucide-key-round h-3.5 w-3.5"></span>
                </span>
                <div class="min-w-0 flex-1">
                  <p
                    class="mb-1 truncate text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-faint"
                  >
                    OPENAI_API_KEY
                  </p>
                  <code
                    class="gateway-config-code min-w-0 truncate font-mono text-[12px] font-semibold text-ink select-all"
                    title={gatewayKey}
                    translate="no"
                  >
                    {gatewayKey || copy.localGatewayNoApiKey}
                  </code>
                </div>
                {#if localGatewayApiKey}
                  <button
                    class="gateway-icon-button gateway-config-copy h-6 w-6 flex-none rounded-[0.35rem] border"
                    type="button"
                    onclick={() => void copyText(localGatewayApiKey)}
                    aria-label={copy.copyLocalGatewayApiKey}
                    title={copy.copyLocalGatewayApiKey}
                  >
                    <span class="i-lucide-copy h-3.5 w-3.5" aria-hidden="true"></span>
                  </button>
                {:else}
                  <button
                    class="gateway-icon-button gateway-config-copy h-6 w-6 flex-none rounded-[0.35rem] border"
                    type="button"
                    disabled
                    aria-label={copy.localGatewayNoApiKey}
                    title={copy.localGatewayNoApiKey}
                  >
                    <span class="i-lucide-lock-keyhole h-3.5 w-3.5" aria-hidden="true"></span>
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2">
          <div class="gateway-metric-card rounded-[0.45rem] border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {copy.localGatewayHealth}
              </p>
              <span class="i-lucide-heart-pulse h-3.5 w-3.5 text-muted-strong" aria-hidden="true"
              ></span>
            </div>
            <p class="truncate text-sm font-semibold text-ink">{healthText}</p>
          </div>
          <div class="gateway-metric-card rounded-[0.45rem] border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {copy.localGatewayRequests}
              </p>
              <span class="i-lucide-activity h-3.5 w-3.5 text-muted-strong" aria-hidden="true"
              ></span>
            </div>
            <p
              class="truncate font-mono text-sm font-semibold tabular-nums text-ink"
              translate="no"
            >
              {formatNumber(totalRequests)}
            </p>
          </div>
          <div class="gateway-metric-card rounded-[0.45rem] border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {copy.localGatewaySuccessRate}
              </p>
              <span class="i-lucide-badge-check h-3.5 w-3.5 text-muted-strong" aria-hidden="true"
              ></span>
            </div>
            <p class="truncate font-mono text-sm font-semibold tabular-nums text-ink">
              {successRate}
            </p>
          </div>
          <div class="gateway-metric-card rounded-[0.45rem] border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {copy.localGatewayAvgLatency}
              </p>
              <span class="i-lucide-timer h-3.5 w-3.5 text-muted-strong" aria-hidden="true"></span>
            </div>
            <p class="truncate font-mono text-sm font-semibold tabular-nums text-ink">
              {avgLatency}
            </p>
          </div>
        </div>
      </section>

      <section
        class="gateway-panel rounded-[0.45rem] border"
        aria-labelledby="local-gateway-logs-heading"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-soft px-3 py-2.5"
        >
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <h3 id="local-gateway-logs-heading" class="text-[12px] font-semibold text-ink">
                  {copy.localGatewayLogs}
                </h3>
                <span
                  class="gateway-status-pill inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums text-muted-strong"
                >
                  {formatNumber(visibleLogs.length)} / {formatNumber(totalRequests)}
                </span>
                {#if errorCount}
                  <span
                    class="inline-flex items-center rounded border border-danger/20 bg-danger/10 px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums text-danger"
                  >
                    {formatNumber(errorCount)}
                    {copy.localGatewayErrors}
                  </span>
                {/if}
              </div>
              <p class="mt-0.5 truncate text-[10px] leading-4 text-faint">
                {copy.localGatewayLogsHint}
              </p>
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <div class="relative min-w-[180px] flex-1 sm:flex-none sm:w-56">
              <span
                class="i-lucide-search absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-strong"
                aria-hidden="true"
              ></span>
              <input
                id="local-gateway-log-search"
                class="gateway-input h-7 w-full rounded-[0.35rem] border pl-7 pr-2 text-xs text-ink placeholder-muted-strong outline-none"
                type="search"
                name="local-gateway-log-search"
                autocomplete="off"
                spellcheck={false}
                aria-label={copy.localGatewaySearchLogs}
                placeholder={copy.localGatewaySearchLogs}
                bind:value={logSearch}
              />
            </div>
            <button
              class="gateway-icon-button h-7 w-7 rounded-[0.35rem] border"
              type="button"
              onclick={() => void refreshGatewayStatus()}
              aria-label={copy.localGatewayLogs}
              title={copy.localGatewayLogs}
            >
              <span class="i-lucide-refresh-cw h-3.5 w-3.5" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5 px-3 py-2">
          {#each statusFilters as option (option)}
            <button
              class={`theme-filter-chip gateway-filter-chip rounded-[0.32rem] px-1.5 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
                statusFilter === option
                  ? 'theme-filter-chip-active gateway-filter-chip-active'
                  : 'theme-filter-chip-idle gateway-filter-chip-idle'
              }`}
              type="button"
              aria-pressed={statusFilter === option}
              aria-label={`${copy.localGatewayStatusFilter}: ${statusFilterLabel(option)}`}
              onclick={() => (statusFilter = option)}
            >
              {statusFilterLabel(option)}
            </button>
          {/each}
        </div>

        <div class="gateway-table-container border-t">
          {#if visibleLogs.length}
            <div class="max-h-[400px] overflow-auto">
              <table class="w-full text-left text-xs" aria-label={copy.localGatewayLogs}>
                <thead
                  class="sticky top-0 z-10 gateway-table-head text-[10px] font-medium uppercase tracking-[0.08em] text-faint"
                >
                  <tr>
                    <th class="px-3 py-2 font-normal whitespace-nowrap"
                      >{copy.localGatewayLogTime}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap"
                      >{copy.localGatewayLogMethod}</th
                    >
                    <th class="px-3 py-2 font-normal w-full min-w-[180px] max-w-[280px]"
                      >{copy.localGatewayLogPath}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap"
                      >{copy.localGatewayLogProvider}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap"
                      >{copy.localGatewayLogModel}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                      >{copy.localGatewayLogTokens}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                      >{copy.localGatewayLogLatency}</th
                    >
                    <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                      >{copy.localGatewayLogStatus}</th
                    >
                  </tr>
                </thead>
                <tbody class="divide-y gateway-divide">
                  {#each visibleLogs as log (log.id)}
                    <tr class="gateway-table-row transition-colors duration-140">
                      <td
                        class="px-3 py-1.5 font-mono text-[11px] text-muted-strong whitespace-nowrap tabular-nums"
                        >{formatLogTime(log.timestamp)}</td
                      >
                      <td class="px-3 py-1.5 whitespace-nowrap">
                        <span
                          class={`gateway-method-pill rounded-[0.28rem] border px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none ${methodClass(log.method)}`}
                          >{log.method}</span
                        >
                      </td>
                      <td
                        class="px-3 py-1.5 font-mono text-[11px] text-ink truncate max-w-[280px]"
                        title={log.path}
                        translate="no">{log.path}</td
                      >
                      <td
                        class="px-3 py-1.5 text-muted-strong truncate max-w-[120px]"
                        title={log.provider ?? '—'}>{log.provider ?? '—'}</td
                      >
                      <td
                        class="px-3 py-1.5 font-mono text-[11px] text-ink truncate max-w-[140px]"
                        title={log.model ?? '—'}
                        translate="no">{log.model ?? '—'}</td
                      >
                      <td
                        class="px-3 py-1.5 text-right font-mono text-[11px] text-muted-strong tabular-nums"
                        >{formatNumber(log.tokens ?? 0)}</td
                      >
                      <td class="px-3 py-1.5 text-right whitespace-nowrap">
                        <span
                          class={`font-mono text-[11px] tabular-nums ${latencyClass(log.durationMs)}`}
                          >{formatNumber(log.durationMs)} ms</span
                        >
                      </td>
                      <td class="px-3 py-1.5 text-right whitespace-nowrap">
                        <span
                          class={`gateway-status-code rounded-[0.28rem] border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${statusClass(log.status)}`}
                          >{log.status}</span
                        >
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <div
              class="gateway-empty-state flex flex-col items-center justify-center px-6 py-10 text-center text-muted-strong"
            >
              <span class="i-lucide-inbox mb-2 h-6 w-6 opacity-50" aria-hidden="true"></span>
              <p class="text-[11px] font-medium">
                {totalRequests ? copy.localGatewayNoMatchedLogs : copy.localGatewayNoLogs}
              </p>
              <p class="mt-1 max-w-[18rem] text-[10px] leading-4 text-faint">
                {copy.localGatewayLogsHint}
              </p>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .gateway-container {
    background: transparent;
  }

  .gateway-toolbar {
    border-color: var(--line);
    background: color-mix(in srgb, var(--surface-soft) 88%, var(--panel) 12%);
  }

  .gateway-title-icon,
  .gateway-section-icon,
  .gateway-config-icon,
  .gateway-compact-chip,
  .gateway-config-badge,
  .gateway-config-field,
  .gateway-metric-card {
    border-color: var(--line);
    background: color-mix(in srgb, var(--panel-strong) 82%, var(--surface-soft));
  }

  .gateway-title-icon {
    color: var(--ink-soft-strong);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 58%, transparent) inset;
  }

  .gateway-panel {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  .gateway-config-panel {
    box-shadow: var(--elevation-1);
  }

  .gateway-config-header {
    border-color: var(--line);
    background: color-mix(in srgb, var(--surface-soft) 48%, transparent);
  }

  .gateway-section-icon,
  .gateway-config-icon {
    color: var(--ink-soft-strong);
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  }

  .gateway-config-field {
    box-shadow: var(--input-shadow);
  }

  .gateway-config-value {
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--surface-soft));
    min-height: 3rem;
  }

  .gateway-config-code {
    display: block;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    line-height: 1.2;
  }

  .gateway-config-copy {
    background: var(--surface-soft);
  }

  .gateway-config-copy:disabled {
    opacity: 0.42;
  }

  .gateway-metric-card {
    min-width: 0;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 42%, transparent) inset;
  }

  .gateway-status-pill {
    border-color: var(--line);
    background: var(--surface-soft);
    color: var(--ink-soft-strong);
  }

  .gateway-status-pill-running span:first-child {
    background: var(--success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent);
  }

  .gateway-status-pill-idle span:first-child {
    background: var(--ink-faint);
  }

  .gateway-error {
    border-color: color-mix(in srgb, var(--danger) 30%, var(--line));
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }

  .gateway-divide {
    border-color: var(--line);
  }

  .gateway-action-button,
  .gateway-icon-button,
  .gateway-compact-chip,
  .gateway-filter-chip {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .gateway-compact-chip {
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    background: var(--panel-strong);
    color: var(--ink-soft-strong);
    padding: 0.375rem 0.5rem;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .gateway-compact-chip:hover {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--ink);
  }

  .gateway-action-button {
    display: inline-flex;
    min-width: 5rem;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    padding: 0.375rem 0.625rem;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .gateway-action-button:focus-visible,
  .gateway-icon-button:focus-visible,
  .gateway-compact-chip:focus-visible,
  .gateway-filter-chip:focus-visible,
  .gateway-input:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--ring) 78%, var(--ink) 22%);
    outline-offset: 2px;
  }

  .gateway-action-muted {
    background: var(--panel-strong);
    color: var(--ink);
  }

  .gateway-action-muted:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .gateway-action-primary {
    border-color: transparent;
    background: var(--ink);
    color: var(--paper);
    box-shadow: var(--control-shadow);
  }

  .gateway-action-primary:hover {
    opacity: 0.9;
  }

  .gateway-action-danger {
    border-color: color-mix(in srgb, var(--danger) 18%, var(--line));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .gateway-action-danger:hover {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  .gateway-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--ink-soft);
    background: transparent;
    transition:
      color 140ms ease,
      background-color 140ms ease,
      border-color 140ms ease;
    border-color: var(--line);
  }

  .gateway-icon-button:hover {
    color: var(--ink);
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .gateway-input {
    background: var(--panel-strong);
    border-color: var(--line);
    transition:
      border-color 140ms ease,
      background-color 140ms ease;
  }

  .gateway-input:hover {
    background: var(--surface-soft);
  }

  .gateway-input:focus {
    border-color: color-mix(in srgb, var(--ink) 30%, var(--line));
  }

  .gateway-filter-chip-idle {
    border: 1px solid var(--line);
    background: var(--surface-soft);
    color: var(--ink-soft-strong);
  }

  .gateway-filter-chip-idle:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .gateway-filter-chip-active {
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
  }

  .gateway-table-container {
    border-color: var(--line);
    background: var(--panel-strong);
  }

  .gateway-table-head {
    background: color-mix(in srgb, var(--surface-soft) 86%, var(--panel-strong));
    border-bottom: 1px solid var(--line);
    backdrop-filter: blur(10px);
  }

  .gateway-table-row:hover {
    background: var(--surface-hover);
  }

  .gateway-method-pill,
  .gateway-status-code {
    display: inline-flex;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    border-color: var(--line);
    background: var(--surface-soft);
  }

  .gateway-empty-state {
    background: color-mix(in srgb, var(--surface-soft) 36%, transparent);
  }

  .gateway-method-get {
    border-color: color-mix(in srgb, var(--success) 22%, var(--line));
    background: color-mix(in srgb, var(--success) 8%, transparent);
    color: var(--success);
  }

  .gateway-method-system {
    border-color: var(--line);
    background: color-mix(in srgb, var(--surface-soft) 80%, transparent);
    color: var(--ink-soft-strong);
  }

  .gateway-method-write {
    border-color: color-mix(in srgb, var(--accent) 18%, var(--line));
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--accent-deep);
  }

  .gateway-status-success {
    border-color: color-mix(in srgb, var(--success) 22%, var(--line));
    background: color-mix(in srgb, var(--success) 8%, transparent);
    color: var(--success);
  }

  .gateway-status-warn {
    border-color: color-mix(in srgb, var(--warn) 24%, var(--line));
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    color: var(--warn);
  }

  .gateway-status-error {
    border-color: color-mix(in srgb, var(--danger) 24%, var(--line));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .gateway-latency-warn {
    color: var(--warn);
  }

  .gateway-latency-error {
    color: var(--danger);
  }

  :global(html[data-theme='dark']) .gateway-toolbar {
    border-color: var(--line);
    background: transparent;
  }

  :global(html[data-theme='dark']) .gateway-title-icon,
  :global(html[data-theme='dark']) .gateway-section-icon,
  :global(html[data-theme='dark']) .gateway-config-icon,
  :global(html[data-theme='dark']) .gateway-compact-chip,
  :global(html[data-theme='dark']) .gateway-config-badge,
  :global(html[data-theme='dark']) .gateway-config-field,
  :global(html[data-theme='dark']) .gateway-metric-card,
  :global(html[data-theme='dark']) .gateway-status-pill,
  :global(html[data-theme='dark']) .gateway-action-muted,
  :global(html[data-theme='dark']) .gateway-input,
  :global(html[data-theme='dark']) .gateway-panel,
  :global(html[data-theme='dark']) .gateway-table-container {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  :global(html[data-theme='dark']) .gateway-config-header {
    background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
    border-color: var(--line);
  }

  :global(html[data-theme='dark']) .gateway-config-value {
    background: color-mix(in srgb, var(--surface-soft) 34%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-table-head {
    background: color-mix(in srgb, var(--surface-soft) 60%, transparent);
    border-bottom-color: var(--line);
  }

  :global(html[data-theme='dark']) .gateway-filter-chip-active {
    background: var(--ink) !important;
    border-color: var(--ink) !important;
    color: var(--paper) !important;
  }

  :global(html[data-theme='dark']) .gateway-filter-chip-idle {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .gateway-filter-chip-idle:hover {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .gateway-action-button,
    .gateway-icon-button,
    .gateway-compact-chip,
    .gateway-filter-chip,
    .gateway-input,
    .gateway-table-row {
      transition-duration: 0ms;
    }

    .gateway-spinner {
      animation: none !important;
    }
  }
</style>
