import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [UnoCSS(), svelte()],
    server: {
      port: 18180,
      strictPort: true
    }
  }
})
