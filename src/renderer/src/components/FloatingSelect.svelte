<script lang="ts">
  import { fly } from 'svelte/transition'
  import { createEventDispatcher, onMount } from 'svelte'
  import {
    eventTargetsFloatingRoot,
    floatingAnchor,
    portal,
    stopFloatingPointerPropagation
  } from './floating'

  export interface FloatingSelectOption {
    value: string
    label: string
  }

  const dispatch = createEventDispatcher<{
    change: string
  }>()

  export let value = ''
  export let options: FloatingSelectOption[] = []
  export let ariaLabel = ''
  export let disabled = false
  export let buttonClass = ''
  export let menuClass = ''
  export let optionClass = ''
  export let activeOptionClass = ''
  export let inactiveOptionClass = ''
  export let title: string | undefined = undefined

  let triggerNode: HTMLButtonElement | null = null
  let open = false
  let anchorRect: DOMRect | null = null

  $: selectedOption = options.find((option) => option.value === value) ??
    options[0] ?? {
      value: '',
      label: ''
    }

  function refreshAnchorRect(): void {
    anchorRect = triggerNode?.getBoundingClientRect() ?? null
  }

  function openMenu(): void {
    if (disabled) {
      return
    }

    refreshAnchorRect()
    open = true
  }

  function closeMenu(): void {
    open = false
    anchorRect = null
  }

  function toggleMenu(): void {
    if (open) {
      closeMenu()
      return
    }

    openMenu()
  }

  function handleOptionSelect(nextValue: string): void {
    if (nextValue !== value) {
      dispatch('change', nextValue)
    }

    closeMenu()
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu()
    }
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (open && !eventTargetsFloatingRoot(event)) {
        closeMenu()
      }
    }

    const handleScroll = (): void => {
      if (open) {
        closeMenu()
      }
    }

    const handleResize = (): void => {
      if (open) {
        closeMenu()
      }
    }

    const handleKeydown = (event: KeyboardEvent): void => {
      if (open && event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeydown)
    }
  })
</script>

<div class="relative" use:stopFloatingPointerPropagation data-floating-root="">
  <button
    bind:this={triggerNode}
    class={buttonClass}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    {title}
    {disabled}
    onclick={toggleMenu}
    onkeydown={handleTriggerKeydown}
  >
    <span class="block truncate text-center">{selectedOption.label}</span>
  </button>

  {#if open}
    <div
      use:portal
      use:floatingAnchor={{ anchorRect, matchAnchorWidth: true }}
      use:stopFloatingPointerPropagation
      data-floating-root=""
      transition:fly={{ y: -6, duration: 200 }}
      class={menuClass}
      style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
    >
      <div role="listbox" aria-label={ariaLabel} class="grid gap-0.5">
        {#each options as option (option.value)}
          <button
            class={`${optionClass} ${option.value === value ? activeOptionClass : inactiveOptionClass}`}
            type="button"
            role="option"
            aria-selected={option.value === value}
            onclick={() => handleOptionSelect(option.value)}
          >
            <span class="min-w-0 flex-1 truncate">{option.label}</span>
            {#if option.value === value}
              <span class="i-lucide-check h-4 w-4 flex-none text-[var(--ink-faint)]"></span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
