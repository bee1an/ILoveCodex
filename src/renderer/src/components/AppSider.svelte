<script lang="ts">
  import type {
    AccountSummary,
    AppLanguage,
    AppMeta,
    AppTheme,
    LoginMethod
  } from '../../../shared/codex'
  import {
    accountEmail,
    nextTheme,
    themeIconClass,
    themeTitle,
    type LocalizedCopy
  } from './app-view'

  const compactLanguageOptions: Array<{ value: AppLanguage; label: string }> = [
    { value: 'zh-CN', label: '中' },
    { value: 'en', label: 'EN' }
  ]

  export let copy: LocalizedCopy
  export let appMeta: AppMeta
  export let language: AppLanguage
  export let theme: AppTheme
  export let iconToolbarButton: string
  export let loginStarting = false
  export let loginActionBusy = false
  export let refreshingAllUsage = false
  export let showProviderComposer = false
  export let bestAccount: AccountSummary | null = null
  export let activeAccountId: string | undefined
  export let startLogin: (method: LoginMethod) => void
  export let importCurrent: () => void
  export let importAccountsFile: () => void
  export let exportAccountsFile: () => void
  export let refreshAllRateLimits: () => void
  export let activateBestAccount: () => void
  export let toggleProviderComposer: () => void
  export let toggleSettings: () => void
  export let updateLanguage: (language: AppLanguage) => void
  export let updateTheme: (theme: AppTheme) => void
  export let openExternalLink: (url?: string) => void
</script>

<div class="theme-app-sider-rail flex h-fit w-full flex-col gap-2.5">
  <div
    class="theme-sider-group theme-toolbar theme-sider-dock grid gap-0.75 rounded-xl border border-black/6 bg-black/[0.02] p-1"
  >
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={() => startLogin('browser')}
      aria-label={copy.callbackLogin}
      title={copy.callbackLogin}
    >
      <span
        class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
      ></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={() => startLogin('device')}
      aria-label={copy.deviceLogin}
      title={copy.deviceLogin}
    >
      <span class="i-lucide-key-round h-4.5 w-4.5"></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={importCurrent}
      disabled={loginActionBusy}
      aria-label={copy.importCurrent}
      title={copy.importCurrent}
    >
      <span class="i-lucide-plus h-4.5 w-4.5"></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={importAccountsFile}
      disabled={loginActionBusy}
      aria-label={copy.importAccountsFile}
      title={copy.importAccountsFile}
    >
      <span class="i-lucide-file-up h-4.5 w-4.5"></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={exportAccountsFile}
      aria-label={copy.exportAccountsFile}
      title={copy.exportAccountsFile}
    >
      <span class="i-lucide-file-down h-4.5 w-4.5"></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
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
      class={`${iconToolbarButton} theme-sider-tool-button`}
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
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={toggleProviderComposer}
      aria-label={copy.createProvider}
      title={copy.createProvider}
    >
      <span
        class={`${showProviderComposer ? 'i-lucide-panel-top-close' : 'i-lucide-plug-zap'} h-4.5 w-4.5`}
      ></span>
    </button>
    <button
      class={`${iconToolbarButton} theme-sider-tool-button`}
      on:click={toggleSettings}
      aria-label={copy.settings}
      title={copy.settings}
    >
      <span class="i-lucide-settings-2 h-4.5 w-4.5"></span>
    </button>
  </div>

  <div
    class="theme-sider-group theme-sider-utility grid gap-1.5 rounded-xl border border-black/6 bg-black/[0.02] p-1"
  >
    <div class="theme-sider-language relative">
      <span
        class="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-languages"
      ></span>
      <select
        class="theme-select theme-sider-language-select h-8 w-full appearance-none rounded-lg border border-black/8 bg-transparent py-0 pl-6 pr-5 text-[12px] text-ink outline-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
        aria-label={copy.switchLanguage}
        value={language}
        on:change={(event) =>
          updateLanguage((event.currentTarget as HTMLSelectElement).value as AppLanguage)}
      >
        {#each compactLanguageOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <span
        class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-chevron-down"
      ></span>
    </div>

    <div class="grid grid-cols-1 gap-1.5">
      <button
        class={`${iconToolbarButton} theme-sider-utility-button`}
        on:click={() => updateTheme(nextTheme(theme))}
        aria-label={copy.switchTheme(themeTitle(theme, copy))}
        title={copy.switchTheme(themeTitle(theme, copy))}
      >
        <span class={`${themeIconClass(theme)} h-4.5 w-4.5`}></span>
      </button>

      <button
        class={`${iconToolbarButton} theme-sider-utility-button`}
        on:click={() => openExternalLink(appMeta.githubUrl ?? undefined)}
        disabled={!appMeta.githubUrl}
        aria-label="GitHub"
        title={appMeta.githubUrl ? copy.openGithub : copy.githubPending}
      >
        <span class="i-lucide-github h-4.5 w-4.5"></span>
      </button>
    </div>
  </div>
</div>

<style>
  .theme-app-sider-rail {
    filter: drop-shadow(0 8px 20px rgba(15, 23, 42, 0.05));
  }

  .theme-sider-group {
    backdrop-filter: blur(12px);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.38),
      0 1px 2px rgba(15, 23, 42, 0.03);
  }

  .theme-sider-tool-button {
    width: 100%;
    min-height: 2.35rem;
    border-radius: 0.65rem;
    transition: background-color 140ms ease, transform 140ms ease;
  }

  .theme-sider-language-select,
  .theme-sider-utility-button {
    background: rgba(255, 255, 255, 0.78);
  }

  .theme-sider-language-select {
    min-width: 0;
    border-radius: 0.65rem;
  }

  .theme-sider-utility-button {
    width: 100%;
    min-height: 2.15rem;
    border-radius: 0.65rem;
    transition: background-color 140ms ease, transform 140ms ease;
  }

  .theme-sider-tool-button:hover:not(:disabled),
  .theme-sider-utility-button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .theme-sider-tool-button:hover:not(:disabled),
  .theme-sider-language-select:hover,
  .theme-sider-utility-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.94);
  }

  .theme-sider-tool-button:disabled,
  .theme-sider-utility-button:disabled {
    transform: none !important;
  }

  :global(html[data-theme='dark']) .theme-app-sider-rail {
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.22));
  }

  :global(html[data-theme='dark']) .theme-sider-group {
    border-color: var(--line) !important;
    backdrop-filter: blur(16px);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--panel-strong) 92%, transparent),
      color-mix(in srgb, var(--panel) 96%, transparent)
    ) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 1px 3px rgba(0, 0, 0, 0.12) !important;
  }

  :global(html[data-theme='dark']) .theme-sider-dock {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-soft) 78%, var(--panel) 22%),
      color-mix(in srgb, var(--panel-strong) 90%, var(--surface-soft) 10%)
    ) !important;
  }

  :global(html[data-theme='dark']) .theme-sider-language-select,
  :global(html[data-theme='dark']) .theme-sider-utility-button {
    background: color-mix(in srgb, var(--panel-strong) 82%, var(--surface-soft) 18%) !important;
    border-color: var(--line) !important;
  }

  :global(html[data-theme='dark']) .theme-sider-tool-button:hover:not(:disabled),
  :global(html[data-theme='dark']) .theme-sider-language-select:hover,
  :global(html[data-theme='dark']) .theme-sider-utility-button:hover:not(:disabled) {
    background: var(--surface-hover) !important;
  }
</style>
