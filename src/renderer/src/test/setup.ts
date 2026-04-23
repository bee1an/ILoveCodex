import { beforeEach, vi } from 'vitest'

if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => []
  })
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({}))
  })
}

beforeEach(async (): Promise<void | (() => Promise<void>)> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const { act, cleanup, setup } = await import('@testing-library/svelte')
  setup()

  return async (): Promise<void> => {
    await act()
    cleanup()
  }
})
