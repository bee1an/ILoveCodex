<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import type { TransitionConfig } from 'svelte/transition'

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
  import FloatingSelect from './FloatingSelect.svelte'

  type ThemeTransitionOrigin = {
    x?: number
    y?: number
    target?: HTMLElement | null
  }

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
  export let toolbarIconMovable = true
  export let collapsedToolbarIconDefaultPosition = true
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
  export let updateTheme: (theme: AppTheme, origin?: ThemeTransitionOrigin) => void
  export let openExternalLink: (url?: string) => void

  let toolbarOpen = true
  let collapsedOffset = { x: 0, y: 0 }
  let collapsedDrag: {
    pointerId: number
    startX: number
    startY: number
    startLeft: number
    startTop: number
    startOffsetX: number
    startOffsetY: number
    width: number
    height: number
    moved: boolean
  } | null = null
  let ignoreCollapsedClick = false

  $: toolbarLabel = language === 'zh-CN' ? '工具栏' : 'Toolbar'
  $: collapseLabel = language === 'zh-CN' ? '收起工具栏' : 'Collapse toolbar'
  $: expandLabel = language === 'zh-CN' ? '打开工具栏' : 'Open toolbar'
  $: collapsedDisplayOffset = collapsedOffset

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max)

  const prefersReducedToolbarMotion = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const toolbarRailTransition = (): TransitionConfig => {
    const reduceMotion = prefersReducedToolbarMotion()

    return {
      duration: reduceMotion ? 0 : 180,
      easing: cubicOut,
      css: (t: number, u: number): string => `
        opacity: ${t};
        clip-path: inset(0 ${u * 47}% 0 ${u * 47}% round 0.5rem);
        transform: translateY(${u * 6}px);
        transform-origin: bottom center;
      `
    }
  }

  const collapsedToolbarTransition = (): TransitionConfig => {
    const reduceMotion = prefersReducedToolbarMotion()

    return {
      duration: reduceMotion ? 0 : 150,
      easing: cubicOut,
      css: (t: number, u: number): string => `
        opacity: ${t};
        transform: translate(var(--toolbar-x), calc(var(--toolbar-y) + ${u * 6}px)) scale(${0.92 + t * 0.08});
        transform-origin: bottom center;
      `
    }
  }

  const clampCollapsedOffset = (): void => {
    if (typeof window === 'undefined') {
      return
    }

    const buttonSize = 36
    const margin = 8
    const baseLeft = window.innerWidth / 2 - buttonSize / 2
    const baseTop = window.innerHeight - 16 - buttonSize
    const left = clamp(
      baseLeft + collapsedOffset.x,
      margin,
      window.innerWidth - buttonSize - margin
    )
    const top = clamp(baseTop + collapsedOffset.y, margin, window.innerHeight - buttonSize - margin)
    collapsedOffset = {
      x: left - baseLeft,
      y: top - baseTop
    }
  }

  const handleCollapsedPointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      toolbarOpen ||
      !toolbarIconMovable ||
      !(event.currentTarget instanceof HTMLElement)
    ) {
      return
    }

    event.currentTarget.setPointerCapture?.(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    collapsedDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startOffsetX: collapsedOffset.x,
      startOffsetY: collapsedOffset.y,
      width: rect.width,
      height: rect.height,
      moved: false
    }
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (!collapsedDrag || event.pointerId !== collapsedDrag.pointerId) {
      return
    }

    const dx = event.clientX - collapsedDrag.startX
    const dy = event.clientY - collapsedDrag.startY

    if (Math.hypot(dx, dy) > 3) {
      collapsedDrag.moved = true
      ignoreCollapsedClick = true
    }

    const margin = 8
    const left = clamp(
      collapsedDrag.startLeft + dx,
      margin,
      window.innerWidth - collapsedDrag.width - margin
    )
    const top = clamp(
      collapsedDrag.startTop + dy,
      margin,
      window.innerHeight - collapsedDrag.height - margin
    )

    collapsedOffset = {
      x: collapsedDrag.startOffsetX + left - collapsedDrag.startLeft,
      y: collapsedDrag.startOffsetY + top - collapsedDrag.startTop
    }
  }

  const handlePointerUp = (event: PointerEvent): void => {
    if (!collapsedDrag || event.pointerId !== collapsedDrag.pointerId) {
      return
    }

    collapsedDrag = null
  }

  const handleCollapsedClick = (): void => {
    if (ignoreCollapsedClick) {
      ignoreCollapsedClick = false
      return
    }

    toolbarOpen = true
  }

  const collapseToolbar = (): void => {
    if (collapsedToolbarIconDefaultPosition) {
      collapsedOffset = { x: 0, y: 0 }
    }

    toolbarOpen = false
  }

  const themeOriginFromClick = (event: MouseEvent): ThemeTransitionOrigin => {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null

    if (event.detail > 0) {
      return { x: event.clientX, y: event.clientY, target }
    }

    return { target }
  }
</script>

<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
  on:resize={clampCollapsedOffset}
/>

<div class="theme-app-sider-shell grid place-items-center">
  {#if toolbarOpen}
    <div
      class="theme-app-sider-rail flex max-w-[calc(100vw-2rem)] items-center gap-1.5 rounded-[1rem] border border-black/8 bg-[var(--panel-strong)] p-1"
      transition:toolbarRailTransition
      role="toolbar"
      aria-label={toolbarLabel}
    >
      <button
        class={`${iconToolbarButton} theme-sider-collapse-button`}
        type="button"
        on:click={collapseToolbar}
        aria-label={collapseLabel}
        title={collapseLabel}
      >
        <span class="i-lucide-chevron-down h-4.5 w-4.5"></span>
      </button>

      <div class="theme-sider-divider h-6 w-px bg-black/8" aria-hidden="true"></div>

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
        <span class="i-lucide-monitor-down h-4.5 w-4.5"></span>
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
        <span class="i-lucide-cog h-4.5 w-4.5"></span>
      </button>

      <div class="theme-sider-divider h-6 w-px bg-black/8" aria-hidden="true"></div>

      <div class="theme-sider-language relative w-10">
        <FloatingSelect
          options={compactLanguageOptions}
          value={language}
          ariaLabel={copy.switchLanguage}
          buttonClass="theme-select theme-sider-language-select h-8 w-full appearance-none rounded-lg border border-black/8 bg-transparent px-0 py-0 text-[11px] font-semibold text-ink outline-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
          menuClass="theme-tag-picker-surface z-[999] rounded-[1rem] p-1.5"
          optionClass="theme-menu-choice flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-strong transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16"
          activeOptionClass="theme-menu-choice-active bg-black/[0.05]"
          inactiveOptionClass="bg-transparent hover:bg-black/[0.03]"
          on:change={(event) => updateLanguage(event.detail as AppLanguage)}
        />
      </div>

      <button
        class={`${iconToolbarButton} theme-sider-utility-button`}
        on:click={(event) => updateTheme(nextTheme(theme), themeOriginFromClick(event))}
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
  {:else}
    <button
      class={`${iconToolbarButton} theme-app-sider-collapsed rounded-[1rem] border border-black/8 bg-[var(--panel-strong)] ${toolbarIconMovable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      type="button"
      style={`--toolbar-x: ${collapsedDisplayOffset.x}px; --toolbar-y: ${collapsedDisplayOffset.y}px; transform: translate(var(--toolbar-x), var(--toolbar-y));`}
      transition:collapsedToolbarTransition
      on:pointerdown={handleCollapsedPointerDown}
      on:click={handleCollapsedClick}
      aria-label={expandLabel}
      title={expandLabel}
    >
      <span class="i-lucide-panel-bottom-open h-4.5 w-4.5"></span>
    </button>
  {/if}
</div>

<style>
  .theme-app-sider-shell {
    overflow: visible;
  }

  .theme-app-sider-rail {
    filter: none;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--panel-strong) 90%, var(--paper)) !important;
  }

  .theme-app-sider-rail,
  .theme-app-sider-collapsed {
    grid-area: 1 / 1;
    color: var(--ink);
    box-shadow: var(--elevation-2);
  }

  .theme-sider-group {
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none;
  }

  .theme-sider-tool-button {
    width: 2.25rem;
    flex: none;
    height: 2.25rem;
    border-radius: 0.38rem;
    transition: background-color 140ms ease;
  }

  .theme-sider-language-select,
  .theme-sider-utility-button {
    background: transparent;
  }

  .theme-sider-language-select {
    min-width: 0;
    border-radius: 0.38rem;
  }

  .theme-sider-utility-button {
    width: 2.25rem;
    flex: none;
    height: 2.25rem;
    border-radius: 0.38rem;
    transition: background-color 140ms ease;
  }

  .theme-sider-collapse-button,
  .theme-app-sider-collapsed {
    width: 2.25rem;
    height: 2.25rem;
  }

  .theme-app-sider-collapsed {
    touch-action: none;
    user-select: none;
    border-radius: 0.5rem;
  }

  .theme-app-sider-collapsed:active {
    cursor: grabbing;
  }

  .theme-sider-divider {
    background: var(--line);
  }

  .theme-sider-tool-button:active:not(:disabled),
  .theme-sider-utility-button:active:not(:disabled) {
    background: var(--surface-selected);
  }

  .theme-sider-tool-button:hover:not(:disabled),
  .theme-sider-language-select:hover,
  .theme-sider-utility-button:hover:not(:disabled) {
    border-color: var(--line);
    background: var(--surface-hover);
  }

  .theme-sider-tool-button:disabled,
  .theme-sider-utility-button:disabled {
    opacity: 0.48;
  }

  :global(html[data-theme='dark']) .theme-app-sider-rail {
    filter: none;
    border-color: var(--line) !important;
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--paper)) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(html[data-theme='dark']) .theme-app-sider-collapsed {
    border-color: var(--line) !important;
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--paper)) !important;
    color: var(--ink) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(html[data-theme='dark']) .theme-sider-group {
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  :global(html[data-theme='dark']) .theme-sider-dock {
    background: transparent !important;
  }

  :global(html[data-theme='dark']) .theme-sider-language-select,
  :global(html[data-theme='dark']) .theme-sider-utility-button {
    background: transparent !important;
    border-color: var(--line) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .theme-sider-tool-button:hover:not(:disabled),
  :global(html[data-theme='dark']) .theme-sider-language-select:hover,
  :global(html[data-theme='dark']) .theme-sider-utility-button:hover:not(:disabled) {
    background: var(--surface-hover) !important;
  }
</style>
