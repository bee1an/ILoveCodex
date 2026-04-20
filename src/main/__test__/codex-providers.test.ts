import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexProviderStore } from '../codex-providers'
import type { CodexPlatformAdapter, ProtectedPayload } from '../../shared/codex-platform'

function createPlatform(): CodexPlatformAdapter {
  return {
    fetch: vi.fn(),
    protect: (value: string): ProtectedPayload => ({
      mode: 'plain',
      value
    }),
    unprotect: (payload: ProtectedPayload): string => payload.value,
    openExternal: vi.fn()
  }
}

describe('CodexProviderStore', () => {
  const createdDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createStore() {
    const directory = await mkdtemp(join(tmpdir(), 'ilovecodex-provider-store-'))
    createdDirectories.push(directory)
    return {
      directory,
      store: new CodexProviderStore(directory, createPlatform())
    }
  }

  it('persists providers and keeps api keys protected in state', async () => {
    const { directory, store } = await createStore()

    const created = await store.create({
      name: 'Bee',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'secret-key',
      fastMode: true
    })

    expect(created.name).toBe('Bee')
    expect(created.baseUrl).toBe('https://api.bee1an.us.kg/v1')
    expect(created.model).toBe('5.4')

    const raw = JSON.parse(await readFile(join(directory, 'codex-providers.json'), 'utf8')) as {
      providers: Array<{ apiKey: ProtectedPayload }>
    }
    expect(raw.providers[0]?.apiKey).toEqual({
      mode: 'plain',
      value: 'secret-key'
    })

    const resolved = await store.getResolvedProvider(created.id)
    expect(resolved.apiKey).toBe('secret-key')
  })

  it('updates provider fields and keeps name optional', async () => {
    const { store } = await createStore()
    const created = await store.create({
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'secret-key'
    })

    const updated = await store.update(created.id, {
      name: 'Bee 2',
      model: 'gpt-5.4',
      fastMode: false
    })

    expect(updated.name).toBe('Bee 2')
    expect(updated.model).toBe('gpt-5.4')
    expect(updated.fastMode).toBe(false)
  })

  it('reorders providers by ids', async () => {
    const { store } = await createStore()
    const first = await store.create({
      name: 'One',
      baseUrl: 'https://one.example.com/v1',
      apiKey: 'one'
    })
    const second = await store.create({
      name: 'Two',
      baseUrl: 'https://two.example.com/v1',
      apiKey: 'two'
    })

    const reordered = await store.reorder([first.id, second.id])

    expect(reordered.map((provider) => provider.id)).toEqual([first.id, second.id])
    expect((await store.list()).map((provider) => provider.id)).toEqual([first.id, second.id])
  })

  it('rejects legacy safeStorage provider keys with a re-entry hint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ilovecodex-provider-store-'))
    createdDirectories.push(directory)
    await writeFile(
      join(directory, 'codex-providers.json'),
      JSON.stringify(
        {
          version: 1,
          providers: [
            {
              id: 'legacy',
              name: 'Legacy',
              baseUrl: 'https://api.example.com/v1',
              apiKey: {
                mode: 'safeStorage',
                value: 'encrypted'
              },
              model: '5.4',
              fastMode: true,
              createdAt: '2026-03-01T00:00:00.000Z',
              updatedAt: '2026-03-01T00:00:00.000Z'
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    )

    const store = new CodexProviderStore(directory, createPlatform())
    await expect(store.getResolvedProvider('legacy')).rejects.toThrow('save the API key again')
  })
})
