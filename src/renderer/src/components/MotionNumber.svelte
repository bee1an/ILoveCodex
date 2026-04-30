<script lang="ts">
  export let value: number | string
  export let label = ''
  export let className = ''

  $: valueText = String(value)
  $: sourceLabel = label || valueText
  $: valueIndex = sourceLabel.indexOf(valueText)
  $: prefix = valueIndex >= 0 ? sourceLabel.slice(0, valueIndex) : ''
  $: suffix = valueIndex >= 0 ? sourceLabel.slice(valueIndex + valueText.length) : ''
  $: digits = valueText.split('')
</script>

<span class={`inline-flex items-baseline ${className}`} aria-hidden="true">
  {prefix}
  {#key valueText}
    <span class="t-digit-group is-animating">
      {#each digits as digit, digitIndex (`${valueText}:${digitIndex}`)}
        <span
          class="t-digit"
          data-stagger={digitIndex === digits.length - 2
            ? '1'
            : digitIndex === digits.length - 1
              ? '2'
              : undefined}>{digit}</span
        >
      {/each}
    </span>
  {/key}
  {suffix}
</span>
