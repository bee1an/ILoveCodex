<script lang="ts">
  import type { AccountRateLimits, AccountSummary, AppLanguage } from '../../../shared/codex'
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

  export let panelClass: string
  export let primaryActionButton: string
  export let compactGhostButton: string
  export let iconRowButton: string
  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let openAccountInCodex: (accountId: string) => void
  export let activateAccount: (accountId: string) => void
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let removeAccount: (account: AccountSummary) => void
  export let startLogin: (method: 'browser' | 'device') => void
  export let importCurrent: () => void
</script>

<section class={`${panelClass} flex min-h-0 flex-1 flex-col gap-4 overflow-hidden`}>
  <div class="text-sm text-faint">{copy.accountCount(accounts.length)}</div>

  {#if accounts.length}
    <div class="grid min-h-0 gap-2 overflow-y-auto pr-1">
      {#each accounts as account (account.id)}
        <article
          class={`grid items-center gap-3 rounded-[0.875rem] border px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)_auto] ${accountCardTone(activeAccountId === account.id)}`}
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class={`h-2 w-2 flex-none rounded-full ${activeAccountId === account.id ? 'theme-status-active bg-success ring-3 ring-emerald-500/12' : 'theme-status-idle bg-black/14'}`}
            ></span>
            <p class="truncate text-sm font-medium">{accountEmail(account, copy)}</p>
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
          </div>

          <div class="theme-soft-panel grid gap-1.5 rounded-md bg-black/[0.03] px-2.5 py-2">
            <div class="grid grid-cols-2 gap-2">
              <div class="flex items-center gap-2">
                <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-muted">
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
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span class="w-9 text-right text-[11px] text-faint">…</span>
                {:else if usageByAccountId[account.id]?.primary}
                  <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                    {remainingPercent(usageByAccountId[account.id].primary?.usedPercent)}%
                  </span>
                {:else}
                  <span class="w-9 text-right text-[11px] text-faint">-</span>
                {/if}
              </div>

              <div class="flex items-center gap-2">
                <span class="w-12 text-[10px] font-semibold tracking-[0.04em] text-muted">
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
                {#if usageLoadingByAccountId[account.id] && !usageByAccountId[account.id]}
                  <span class="w-9 text-right text-[11px] text-faint">…</span>
                {:else if usageByAccountId[account.id]?.secondary}
                  <span class="w-9 text-right text-[11px] font-medium text-muted-strong">
                    {remainingPercent(usageByAccountId[account.id].secondary?.usedPercent)}%
                  </span>
                {:else}
                  <span class="w-9 text-right text-[11px] text-faint">-</span>
                {/if}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-[10px] text-faint">
              <div class="truncate">
                {copy.sessionReset} · {formatRelativeReset(
                  usageByAccountId[account.id]?.primary?.resetsAt,
                  language
                )}
              </div>
              <div class="truncate">
                {copy.weeklyReset} · {formatRelativeReset(
                  usageByAccountId[account.id]?.secondary?.resetsAt,
                  language
                )}
              </div>
            </div>
          </div>

          {#if extraLimits(usageByAccountId, account.id).length}
            <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-strong">
              {#each extraLimits(usageByAccountId, account.id) as limit (`${account.id}:${limit.limitId ?? 'extra'}`)}
                <div
                  class="theme-soft-panel inline-flex items-center gap-1.5 rounded-md bg-black/[0.03] px-2 py-1"
                >
                  <span class="font-medium uppercase tracking-[0.08em]">{limitLabel(limit)}</span>
                  {#if limit.primary}
                    <span>h {remainingPercent(limit.primary.usedPercent)}%</span>
                  {/if}
                  {#if limit.secondary}
                    <span>w {remainingPercent(limit.secondary.usedPercent)}%</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <div class="flex items-center justify-end gap-1">
            <button
              class={iconRowButton}
              on:click={() => openAccountInCodex(account.id)}
              disabled={loginActionBusy}
              aria-label={`${copy.openCodex} · ${accountEmail(account, copy)}`}
              title={copy.openCodex}
            >
              <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
            </button>
            <button
              class={iconRowButton}
              on:click={() => activateAccount(account.id)}
              disabled={loginActionBusy || activeAccountId === account.id}
              aria-label={`${copy.switchAccount} · ${accountEmail(account, copy)}`}
              title={copy.switchAccount}
            >
              <span class="i-lucide-repeat-2 h-4 w-4"></span>
            </button>
            <button
              class={iconRowButton}
              on:click={() => refreshAccountUsage(account)}
              disabled={loginActionBusy || usageLoadingByAccountId[account.id]}
              aria-label={`${copy.refreshQuota} · ${accountEmail(account, copy)}`}
              title={copy.refreshQuota}
            >
              <span class="i-lucide-refresh-cw h-4 w-4"></span>
            </button>
            <button
              class={iconRowButton}
              on:click={() => removeAccount(account)}
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
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div class="w-full max-w-xl px-4 py-8 text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <span class="i-lucide-wallet-minimal h-6 w-6 text-black/72"></span>
        </div>

        <div class="mx-auto grid max-w-xl gap-2">
          <h3 class="text-lg font-semibold text-ink sm:text-xl">{copy.emptyStateTitle}</h3>
          <p class="text-sm leading-6 text-muted-strong">{copy.emptyStateDescription}</p>
        </div>

        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            class={primaryActionButton}
            on:click={() => startLogin('browser')}
            disabled={loginActionBusy}
          >
            <span
              class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
            ></span>
            <span>{copy.browserLogin}</span>
          </button>

          <button class={`${compactGhostButton} px-4 py-3`} on:click={() => startLogin('device')}>
            <span class="i-lucide-key-round h-4.5 w-4.5"></span>
            <span>{copy.deviceLogin}</span>
          </button>

          <button
            class={`${compactGhostButton} px-4 py-3`}
            on:click={importCurrent}
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
