import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAccountStore, type CodexAuthPayload } from './codex-auth'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'

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

function createAuthPayload(accountId: string): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    tokens: {
      account_id: accountId,
      refresh_token: `refresh-${accountId}`
    }
  }
}

describe('CodexAccountStore', () => {
  const createdDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createStore(): Promise<CodexAccountStore> {
    const directory = await mkdtemp(join(tmpdir(), 'ilovecodex-store-'))
    createdDirectories.push(directory)
    return new CodexAccountStore(directory, createPlatform())
  }

  it('persists the reordered account sequence', async () => {
    const store = await createStore()

    await store.importAuthPayload(createAuthPayload('a'))
    await store.importAuthPayload(createAuthPayload('b'))
    await store.importAuthPayload(createAuthPayload('c'))

    await store.reorderAccounts(['b', 'a', 'c'])

    expect((await store.getSnapshot(false)).accounts.map((account) => account.id)).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('rejects reorder payloads that do not include every saved account', async () => {
    const store = await createStore()

    await store.importAuthPayload(createAuthPayload('a'))
    await store.importAuthPayload(createAuthPayload('b'))

    await expect(store.reorderAccounts(['a'])).rejects.toThrow(
      'Account reorder payload does not match saved accounts.'
    )
  })

  it('creates, renames, and deletes tags while syncing account tag bindings', async () => {
    const store = await createStore()
    const account = await store.importAuthPayload(createAuthPayload('a'))
    const tag = await store.createTag('工作')

    await store.updateAccountTags(account.id, [tag.id])
    expect((await store.getSnapshot(false)).accounts[0]?.tagIds).toEqual([tag.id])

    await store.updateTag(tag.id, '重点')
    expect((await store.getSnapshot(false)).tags[0]?.name).toBe('重点')

    await store.deleteTag(tag.id)
    const snapshot = await store.getSnapshot(false)
    expect(snapshot.tags).toEqual([])
    expect(snapshot.accounts[0]?.tagIds).toEqual([])
  })
})
