<script lang="ts">
  export let checked = false
  export let disabled = false
  export let value: string | undefined = undefined
  export let ariaLabel: string | undefined = undefined
  export let title: string | undefined = undefined
  export let className = ''
  export let boxClass = ''
  export let onCheckedChange: (checked: boolean, event: Event) => void = () => {}

  const handleChange = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    checked = input.checked
    onCheckedChange(checked, event)
  }
</script>

<span
  class={`theme-checkbox ${checked ? 'theme-checkbox-checked' : ''} ${
    disabled ? 'theme-checkbox-disabled' : ''
  } ${className}`}
>
  <input
    class="theme-checkbox-input"
    type="checkbox"
    {checked}
    {disabled}
    {value}
    aria-label={ariaLabel}
    {title}
    on:change={handleChange}
  />
  <span class={`theme-checkbox-box ${boxClass}`} aria-hidden="true">
    <span class="i-lucide-check theme-checkbox-mark"></span>
  </span>
</span>

<style>
  .theme-checkbox {
    position: relative;
    display: inline-grid;
    width: 1rem;
    height: 1rem;
    flex: none;
    place-items: center;
    color: var(--ink);
    vertical-align: middle;
  }

  .theme-checkbox-input {
    position: absolute;
    inset: -0.25rem;
    z-index: 1;
    margin: 0;
    cursor: pointer;
    opacity: 0;
  }

  .theme-checkbox-box {
    display: inline-grid;
    width: 1rem;
    height: 1rem;
    place-items: center;
    border: 1px solid var(--line-strong, rgba(0, 0, 0, 0.18));
    border-radius: 0.28rem;
    background: var(--panel);
    color: transparent;
    box-shadow: var(--input-shadow);
  }

  .theme-checkbox-mark {
    width: 0.72rem;
    height: 0.72rem;
  }

  .theme-checkbox-checked .theme-checkbox-box {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--paper);
    box-shadow: var(--control-shadow);
  }

  .theme-checkbox:focus-within .theme-checkbox-box {
    outline: 2px solid var(--focus, rgba(0, 0, 0, 0.16));
    outline-offset: 2px;
  }

  .theme-checkbox-disabled {
    opacity: 0.48;
  }

  .theme-checkbox-disabled .theme-checkbox-input {
    cursor: not-allowed;
  }

  :global(html[data-theme='dark']) .theme-checkbox-box {
    border-color: var(--line);
    background: var(--panel-strong);
  }

  :global(html[data-theme='dark']) .theme-checkbox-checked .theme-checkbox-box {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--paper);
  }
</style>
