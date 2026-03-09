<script lang="ts">
  import { createEventDispatcher } from 'svelte'

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
  let root: HTMLDivElement | null = null

  $: selected = options.find((option) => option.value === value) ?? options[0]

  const toggle = (): void => {
    open = !open
  }

  const select = (nextValue: string): void => {
    open = false
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

    open = false
  }

  const handleWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      open = false
    }
  }
</script>

<svelte:window on:mousedown={handleWindowPointerDown} on:keydown={handleWindowKeydown} />

<div class="relative" bind:this={root}>
  <button
    class={`inline-flex h-8 items-center gap-2 rounded-md border-0 bg-transparent px-2.5 text-sm text-ink outline-none transition-colors duration-140 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/16 ${open ? 'bg-black/[0.05]' : ''}`}
    aria-label={ariaLabel}
    aria-expanded={open}
    aria-haspopup="listbox"
    type="button"
    on:click={toggle}
  >
    <span class="truncate">{selected?.label ?? value}</span>
    <span class={`${iconClass} h-4 w-4 flex-none text-black/44`}></span>
  </button>

  {#if open}
    <div
      class="absolute right-0 top-[calc(100%+0.5rem)] z-30 min-w-[9rem] rounded-xl border border-black/8 bg-white p-1 shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
      role="listbox"
      aria-label={ariaLabel}
    >
      {#each options as option (option.value)}
        <button
          class={`flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm transition-colors duration-140 ${option.value === value ? 'bg-black text-white' : 'text-black/68 hover:bg-black/[0.04] hover:text-black'}`}
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
