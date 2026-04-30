<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  import { cascadeIn, reveal } from './gsap-motion'

  export let ariaLabel = ''
  export let ariaLabelledby = ''
  export let maxWidthClass = 'max-w-xl'
  export let panelClass = ''
  export let closeOnBackdrop = true
  export let closeOnEscape = true

  const dispatch = createEventDispatcher<{ close: void }>()

  function requestClose(): void {
    dispatch('close')
  }
</script>

<div
  class="fixed inset-0 z-[70] flex items-center justify-center bg-black/38 px-4 py-6"
  role="presentation"
  tabindex="-1"
  use:reveal={{ y: 0, scale: 1, blur: 0, duration: 0.18 }}
  on:click={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      requestClose()
    }
  }}
  on:keydown={(event) => {
    if (closeOnEscape && event.key === 'Escape') {
      requestClose()
    }
  }}
>
  <div
    class={`theme-surface w-full ${maxWidthClass} rounded-[1.25rem] border border-black/8 bg-white p-5 shadow-[0_24px_70px_-42px_var(--paper-shadow)] sm:p-6 ${panelClass}`}
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel || undefined}
    aria-labelledby={ariaLabel ? undefined : ariaLabelledby || undefined}
    tabindex="-1"
    use:reveal={{ delay: 0.05 }}
    use:cascadeIn={{ selector: '[data-dialog-motion]' }}
  >
    <slot />
  </div>
</div>
