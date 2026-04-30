<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte'

  export interface SelectOption<T extends string> {
    value: T
    label: string
  }

  export let value: string
  export let options: Array<SelectOption<string>> = []
  export let ariaLabel = 'Select'
  export let iconClass = 'i-lucide-chevron-down'

  const dispatch = createEventDispatcher<{ change: { value: string } }>()

  let open = false
  let renderPanel = false
  let root: HTMLDivElement | null = null
  type DropdownMotionState = 'closed' | 'open' | 'closing'

  let dropdownMotionState: DropdownMotionState = 'closed'
  let closeTimer: number | null = null
  let openFrame: number | null = null

  $: selected = options.find((option) => option.value === value) ?? options[0]

  $: dropdownMotionClass =
    dropdownMotionState === 'open'
      ? 'is-open'
      : dropdownMotionState === 'closing'
        ? 'is-closing'
        : ''

  const dropdownCloseDurationMs = (): number => {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
      ) || 150
    )
  }

  const clearDropdownTimers = (): void => {
    if (closeTimer != null) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    if (openFrame != null) {
      window.cancelAnimationFrame(openFrame)
      openFrame = null
    }
  }

  const openDropdown = (): void => {
    clearDropdownTimers()
    open = true
    renderPanel = true
    dropdownMotionState = 'closed'
    openFrame = window.requestAnimationFrame(() => {
      openFrame = null
      dropdownMotionState = 'open'
    })
  }

  const closeDropdown = (): void => {
    if (!open && !renderPanel) {
      return
    }

    open = false
    if (!renderPanel) {
      dropdownMotionState = 'closed'
      return
    }

    clearDropdownTimers()
    dropdownMotionState = 'closing'
    closeTimer = window.setTimeout(() => {
      closeTimer = null
      renderPanel = false
      dropdownMotionState = 'closed'
    }, dropdownCloseDurationMs())
  }

  const toggle = (): void => {
    if (open) {
      closeDropdown()
      return
    }

    openDropdown()
  }

  const select = (nextValue: string): void => {
    closeDropdown()
    if (nextValue === value) {
      return
    }

    dispatch('change', { value: nextValue })
  }

  const handleWindowPointerDown = (event: MouseEvent): void => {
    if (!open || !root) {
      return
    }

    if (event.target instanceof Node && root.contains(event.target)) {
      return
    }

    closeDropdown()
  }

  const handleWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closeDropdown()
    }
  }

  onDestroy(clearDropdownTimers)
</script>

<svelte:window on:mousedown={handleWindowPointerDown} on:keydown={handleWindowKeydown} />

<div class="relative" bind:this={root}>
  <button
    class={`theme-compact-select-trigger inline-flex h-8 items-center gap-2 rounded-md border-0 bg-transparent px-2.5 text-sm text-ink outline-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 ${open ? 'bg-black/[0.05]' : ''}`}
    aria-label={ariaLabel}
    aria-expanded={open}
    aria-haspopup="listbox"
    type="button"
    on:click={toggle}
  >
    <span class="truncate">{selected?.label ?? value}</span>
    <span class={`theme-compact-select-icon ${iconClass} h-4 w-4 flex-none text-black/44`}></span>
  </button>

  {#if renderPanel}
    <div
      class={`theme-compact-select-panel t-dropdown ${dropdownMotionClass} absolute right-0 top-[calc(100%+0.5rem)] z-30 min-w-[9rem] rounded-xl border border-black/8 bg-white p-1`}
      data-origin="top-right"
      role="listbox"
      aria-label={ariaLabel}
    >
      {#each options as option (option.value)}
        <button
          class={`theme-compact-select-option flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm transition-colors duration-140 ${option.value === value ? 'theme-compact-select-option-active bg-black text-white' : 'theme-compact-select-option-idle text-black/68 hover:bg-black/[0.04] hover:text-black'}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          on:click={() => select(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  :global(html[data-theme='dark'] .theme-compact-select-trigger) {
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-trigger:hover),
  :global(html[data-theme='dark'] .theme-compact-select-trigger:focus-visible) {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-icon) {
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-panel) {
    background: var(--panel-strong) !important;
    border-color: var(--line) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-option-idle) {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-option-idle:hover),
  :global(html[data-theme='dark'] .theme-compact-select-option-idle:focus-visible) {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark'] .theme-compact-select-option-active) {
    background: var(--ink) !important;
    color: var(--paper) !important;
  }
</style>
