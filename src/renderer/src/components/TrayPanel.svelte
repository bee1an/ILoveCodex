<script lang="ts">
  import type { AccountRateLimits, AccountSummary, AppSnapshot } from '../../../shared/codex'
  import {
    isLocalMockAccount,
    remainingPercent,
    supportsWakeSessionQuota,
    supportsWeeklyQuota
  } from '../../../shared/codex'
  import {
    accountEmail,
    planLabel,
    planTagClass,
    progressWidth,
    type LocalizedCopy
  } from './app-view'

  export let brandMark: string
  export let snapshot: AppSnapshot
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let pageError = ''
  export let copy: LocalizedCopy
  export let compactGhostButton: string
  export let pollingOptions: readonly number[]
  export let statusAccounts: AccountSummary[] = []
  export let openMainPanel: () => void | Promise<void>
  export let openCodex: () => void | Promise<void>
  export let toggleStatusAccount: (accountId: string) => void
  export let updatePollingInterval: (minutes: number) => void
</script>

<section
  class="theme-tray-panel grid gap-3 overflow-hidden rounded-[1.05rem] border border-black/[0.08] bg-white p-3.5"
>
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-2.5">
      <img
        src={brandMark}
        alt=""
        class="h-9 w-9 flex-none rounded-[0.95rem] border border-black/[0.05]"
      />
      <div class="min-w-0">
        <p class="text-sm font-medium text-ink">CodexDock</p>
        <p class="text-xs text-faint">{copy.statusBarAccountCount(statusAccounts.length)}</p>
      </div>
    </div>
    <div class="flex flex-none items-center gap-2">
      <button
        class={compactGhostButton}
        on:click={openCodex}
        disabled={isLocalMockAccount(snapshot.currentSession)}
      >
        {copy.openCodex}
      </button>
      <button class={compactGhostButton} on:click={openMainPanel}>{copy.openMainPanel}</button>
    </div>
  </div>

  {#if pageError}
    <div
      class="theme-error-panel rounded-xl border border-danger/18 px-3 py-2.5 text-sm text-danger"
    >
      {pageError}
    </div>
  {/if}

  <div class="grid gap-2">
    {#if statusAccounts.length}
      {#each statusAccounts as account (account.id)}
        <article class="theme-soft-panel grid gap-2 rounded-xl bg-black/[0.035] px-3 py-2.5">
          <div class="flex items-center gap-2">
            <span
              class={`h-2 w-2 flex-none rounded-full ${snapshot.activeAccountId === account.id ? 'bg-success' : 'theme-status-idle bg-black/14'}`}
            ></span>
            <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {accountEmail(account, copy)}
            </p>
            <span
              class={`inline-flex flex-none items-center rounded-full px-2 py-0.75 text-[10px] font-medium ${planTagClass(usageByAccountId[account.id]?.planType)}`}
            >
              {planLabel(usageByAccountId[account.id]?.planType)}
            </span>
          </div>

          <div class="grid gap-1.5">
            {#if !usageByAccountId[account.id] || supportsWakeSessionQuota(usageByAccountId[account.id])}
              <div class="flex items-center gap-2">
                <span class="w-12 text-[10px] font-semibold tracking-[0.08em] text-muted">
                  {copy.sessionQuota}
                </span>
                <div
                  class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                >
                  <div
                    class="theme-progress-fill h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[account.id]?.primary?.usedPercent)}`}
                  ></div>
                </div>
                <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                  {usageByAccountId[account.id]?.primary
                    ? `${remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%`
                    : '--'}
                </span>
              </div>
            {/if}

            {#if !usageByAccountId[account.id] || supportsWeeklyQuota(usageByAccountId[account.id])}
              <div class="flex items-center gap-2">
                <span class="w-12 text-[10px] font-semibold tracking-[0.08em] text-muted">
                  {copy.weeklyQuota}
                </span>
                <div
                  class="theme-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-black/8"
                >
                  <div
                    class="theme-progress-fill h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[account.id]?.secondary?.usedPercent)}`}
                  ></div>
                </div>
                <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                  {usageByAccountId[account.id]?.secondary
                    ? `${remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%`
                    : '--'}
                </span>
              </div>
            {/if}
          </div>
        </article>
      {/each}
    {:else}
      <div class="theme-soft-panel rounded-xl bg-black/[0.03] px-3 py-3 text-sm text-muted-strong">
        {copy.noStatusBarAccounts}
      </div>
    {/if}
  </div>

  <div class="grid gap-2 border-t border-black/6 pt-3">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs text-muted-strong">{copy.statusBarDisplayAccounts}</p>
      <p class="text-xs text-faint">{copy.maxFiveAccounts}</p>
    </div>

    <div class="grid gap-1">
      {#each snapshot.accounts as account (account.id)}
        <button
          class={`theme-menu-choice flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 ${snapshot.settings.statusBarAccountIds.includes(account.id) ? 'theme-menu-choice-active bg-black/[0.05]' : 'bg-transparent hover:bg-black/[0.03]'}`}
          on:click={() => toggleStatusAccount(account.id)}
          disabled={!snapshot.settings.statusBarAccountIds.includes(account.id) &&
            snapshot.settings.statusBarAccountIds.length >= 5}
        >
          <span class="min-w-0 flex-1 truncate text-sm text-muted-strong">
            {accountEmail(account, copy)}
          </span>
          <span class="text-xs text-faint">
            {snapshot.settings.statusBarAccountIds.includes(account.id)
              ? copy.visible
              : copy.hidden}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <div class="flex items-center justify-between gap-3 border-t border-black/6 pt-3">
    <span class="text-xs text-muted-strong">{copy.pollingInterval}</span>
    <select
      class="theme-select h-8 rounded-md border border-black/8 bg-white px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
      value={snapshot.settings.usagePollingMinutes}
      on:change={(event) =>
        updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
    >
      {#each pollingOptions as option (option)}
        <option value={option}>{option} {copy.minutes}</option>
      {/each}
    </select>
  </div>
</section>
