import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

const rendererComponentTests = [
  'src/renderer/src/components/__test__/AccountsListView.test.ts',
  'src/renderer/src/components/__test__/AccountsPanel.test.ts',
  'src/renderer/src/components/__test__/AccountsProvidersView.test.ts',
  'src/renderer/src/components/__test__/AccountsTagsView.test.ts',
  'src/renderer/src/components/__test__/HeroPanel.test.ts'
]

export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: rendererComponentTests
        }
      },
      {
        extends: true,
        plugins: [svelte(), svelteTesting({ autoCleanup: false })],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: rendererComponentTests,
          setupFiles: ['./src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
