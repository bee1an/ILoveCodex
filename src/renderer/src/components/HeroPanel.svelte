<script lang="ts">
  import type { AccountSummary, AppSettings, LoginEvent, LoginMethod } from '../../../shared/codex'
  import { accountEmail, loginTone, type LocalizedCopy } from './app-view'

  export let brandMark: string
  export let heroClass: string
  export let compactGhostButton: string
  export let iconToolbarButton: string
  export let copy: LocalizedCopy
  export let loginEvent: LoginEvent | null = null
  export let loginStarting = false
  export let showSettings = false
  export let showBrowserLoginDetails = true
  export let showDeviceLoginDetails = true
  export let refreshingAllUsage = false
  export let loginActionBusy: boolean
  export let pollingOptions: readonly number[]
  export let settings: AppSettings
  export let bestAccount: AccountSummary | null = null
  export let activeAccountId: string | undefined
  export let startLogin: (method: LoginMethod) => void
  export let importCurrent: () => void
  export let refreshAllRateLimits: () => void
  export let activateBestAccount: () => void
  export let toggleSettings: () => void
  export let updatePollingInterval: (minutes: number) => void
  export let copyAuthUrl: () => void
  export let copyDeviceCode: () => void
  export let openExternalLink: (url?: string) => void
</script>

<section class={heroClass}>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3.5">
      <img
        src={brandMark}
        alt=""
        class="h-12 w-12 flex-none rounded-[1.15rem] border border-black/[0.05] shadow-[0_16px_36px_rgba(24,24,27,0.1)]"
      />
      <div class="min-w-0">
        <p class="text-[11px] font-medium uppercase tracking-[0.18em] text-faint">Ilovecodex</p>
        {#if loginEvent}
          <p class={`truncate text-sm ${loginTone(loginEvent.phase)}`} aria-live="polite">
            {loginEvent.message}
          </p>
        {/if}
      </div>
    </div>

    <div
      class="theme-toolbar inline-flex min-w-[140px] items-center gap-0.5 rounded-lg bg-black/[0.03] p-1"
    >
      <button
        class={iconToolbarButton}
        on:click={() => startLogin('browser')}
        aria-label={copy.browserLogin}
        title={copy.browserLogin}
      >
        <span
          class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
        ></span>
      </button>
      <button
        class={iconToolbarButton}
        on:click={() => startLogin('device')}
        aria-label={copy.deviceLogin}
        title={copy.deviceLogin}
      >
        <span class="i-lucide-key-round h-4.5 w-4.5"></span>
      </button>
      <button
        class={iconToolbarButton}
        on:click={importCurrent}
        disabled={loginActionBusy}
        aria-label={copy.importCurrent}
        title={copy.importCurrent}
      >
        <span class="i-lucide-plus h-4.5 w-4.5"></span>
      </button>
      <button
        class={iconToolbarButton}
        on:click={refreshAllRateLimits}
        disabled={loginActionBusy || refreshingAllUsage}
        aria-label={copy.refreshAllQuota}
        title={copy.refreshAllQuota}
      >
        <span
          class={`${refreshingAllUsage ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-4.5 w-4.5`}
        ></span>
      </button>
      <button
        class={iconToolbarButton}
        on:click={activateBestAccount}
        disabled={loginActionBusy || !bestAccount || bestAccount.id === activeAccountId}
        aria-label={copy.switchBest}
        title={bestAccount
          ? bestAccount.id === activeAccountId
            ? copy.alreadyBest
            : copy.switchToAccount(accountEmail(bestAccount, copy))
          : copy.noBestAccount}
      >
        <span class="i-lucide-sparkles h-4.5 w-4.5"></span>
      </button>
      <button
        class={iconToolbarButton}
        on:click={toggleSettings}
        aria-label={copy.settings}
        title={copy.settings}
      >
        <span class="i-lucide-settings-2 h-4.5 w-4.5"></span>
      </button>
    </div>
  </div>

  {#if showSettings}
    <div class="mt-3 flex items-center gap-3 border-t border-black/6 pt-3">
      <span class="text-xs text-muted-strong">{copy.pollingInterval}</span>
      <select
        class="theme-select h-8 rounded-md border border-black/8 bg-white px-2 text-sm text-ink outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
        value={settings.usagePollingMinutes}
        on:change={(event) =>
          updatePollingInterval(Number((event.currentTarget as HTMLSelectElement).value))}
      >
        {#each pollingOptions as option (option)}
          <option value={option}>{option} {copy.minutes}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if (showBrowserLoginDetails && loginEvent?.method === 'browser' && (loginEvent?.authUrl || loginEvent?.localCallbackUrl)) || (showDeviceLoginDetails && loginEvent?.method === 'device' && (loginEvent?.verificationUrl || loginEvent?.userCode)) || (loginEvent?.phase === 'error' && loginEvent?.rawOutput)}
    <div class="mt-3 grid gap-2 border-t border-black/6 pt-3">
      {#if showBrowserLoginDetails && loginEvent?.method === 'browser' && loginEvent.authUrl}
        <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
          <p class="text-sm text-muted-strong">{copy.browserLoginLink}</p>
          <code
            class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
          >
            {loginEvent.authUrl}
          </code>
          <div class="flex flex-wrap items-center gap-2">
            <button class={compactGhostButton} on:click={copyAuthUrl}>{copy.copyLink}</button>
            <button
              class={compactGhostButton}
              on:click={() => openExternalLink(loginEvent?.authUrl)}
            >
              {copy.openBrowser}
            </button>
          </div>
        </div>
      {/if}

      {#if showBrowserLoginDetails && loginEvent?.method === 'browser' && loginEvent.localCallbackUrl}
        <p class="text-sm text-muted-strong">{copy.waitingCallback}</p>
      {/if}

      {#if showDeviceLoginDetails && loginEvent?.method === 'device' && loginEvent.verificationUrl}
        <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
          <p class="text-sm text-muted-strong">{copy.deviceLoginLink}</p>
          <code
            class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
          >
            {loginEvent.verificationUrl}
          </code>
          {#if loginEvent.userCode}
            <div class="grid gap-1">
              <p class="text-sm text-muted-strong">{copy.deviceCode}</p>
              <code
                class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm font-semibold tracking-[0.18em] text-black"
              >
                {loginEvent.userCode}
              </code>
            </div>
          {/if}
          <div class="flex flex-wrap items-center gap-2">
            <button class={compactGhostButton} on:click={copyAuthUrl}>{copy.copyLink}</button>
            {#if loginEvent.userCode}
              <button class={compactGhostButton} on:click={copyDeviceCode}>{copy.copyCode}</button>
            {/if}
            <button
              class={compactGhostButton}
              on:click={() => openExternalLink(loginEvent?.verificationUrl)}
            >
              {copy.openBrowser}
            </button>
          </div>
        </div>
      {/if}

      {#if showDeviceLoginDetails && loginEvent?.method === 'device' && loginEvent.userCode}
        <p class="text-sm text-muted-strong">{copy.waitingDeviceCode}</p>
      {/if}

      {#if loginEvent?.phase === 'error' && loginEvent.rawOutput}
        <pre
          class="theme-code-surface m-0 max-h-60 overflow-auto rounded-lg border border-black/8 bg-[#111111] p-4 font-mono text-sm leading-6 text-[#f5f5f5]">{loginEvent.rawOutput}</pre>
      {/if}
    </div>
  {/if}
</section>
