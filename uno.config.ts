import extractorSvelte from '@unocss/extractor-svelte'
import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  extractors: [extractorSvelte()],
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
      paper: '#f6f6f3',
      ink: '#111111',
      success: '#1f7a4c',
      warn: '#9a6a14',
      danger: '#b42318'
    },
    fontFamily: {
      ui: '"SF Pro Display","Segoe UI Variable","Avenir Next","PingFang SC","Hiragino Sans GB",sans-serif',
      mono: '"SF Mono","Fira Code",ui-monospace,monospace'
    }
  }
})
