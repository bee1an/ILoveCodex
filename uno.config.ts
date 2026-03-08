import extractorSvelte from '@unocss/extractor-svelte'
import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  extractors: [extractorSvelte()],
  safelist: [
    'theme-plan-neutral',
    'bg-black/[0.05]',
    'text-black/55',
    'theme-plan-plus',
    'bg-emerald-500/12',
    'text-emerald-700',
    'theme-plan-pro',
    'bg-sky-500/12',
    'text-sky-700',
    'theme-plan-team',
    'bg-amber-500/14',
    'text-amber-700',
    'theme-plan-business',
    'bg-violet-500/14',
    'text-violet-700',
    'theme-plan-enterprise',
    'bg-rose-500/14',
    'text-rose-700',
    'text-success',
    'text-danger',
    'text-ink',
    'theme-account-card',
    'theme-account-card-active',
    'border-black/14',
    'bg-black/[0.02]',
    'border-black/8',
    'bg-white',
    'i-lucide-moon-star',
    'i-lucide-monitor',
    'i-lucide-sun-medium'
  ],
  presets: [
    presetWind3(),
    presetIcons({
      extraProperties: {
        display: 'inline-block',
        'vertical-align': 'middle'
      }
    })
  ],
  theme: {
    colors: {
      paper: 'var(--paper)',
      ink: 'var(--ink)',
      success: 'var(--success)',
      warn: 'var(--warn)',
      danger: 'var(--danger)'
    },
    fontFamily: {
      ui: '"SF Pro Display","Segoe UI Variable","Avenir Next","PingFang SC","Hiragino Sans GB",sans-serif',
      mono: '"SF Mono","Fira Code",ui-monospace,monospace'
    }
  }
})
