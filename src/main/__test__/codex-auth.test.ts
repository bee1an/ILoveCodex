import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAccountStore, type CodexAuthPayload } from '../codex-auth'
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

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function createAuthPayload(
  accountId: string,
  identity: { email?: string; sub?: string } = {}
): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    tokens: {
      account_id: accountId,
      id_token:
        identity.email || identity.sub
          ? createJwt({
              email: identity.email,
              sub: identity.sub
            })
          : undefined,
      refresh_token: `refresh-${accountId}`
    }
  }
}

describe('CodexAccountStore', () => {
  const createdDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createStore(): Promise<CodexAccountStore> {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
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

  it('migrates wake schedules when refreshed auth changes account identity', async () => {
    const store = await createStore()
    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com' })
    )

    await store.updateAccountWakeSchedule(account.id, {
      enabled: true,
      times: ['09:00'],
      model: 'gpt-5.4',
      prompt: 'ping'
    })

    const refreshed = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com', sub: 'user-a' })
    )
    const snapshot = await store.getSnapshot(false)

    expect(refreshed.id).toBe('user-a:acct-a')
    expect(snapshot.wakeSchedulesByAccountId[refreshed.id]?.times).toEqual(['09:00'])
    expect(snapshot.wakeSchedulesByAccountId[account.id]).toBeUndefined()
  })

  it('rejects legacy safeStorage accounts with a re-import hint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)
    await writeFile(
      join(directory, 'codex-accounts.json'),
      JSON.stringify(
        {
          version: 3,
          activeAccountId: 'legacy',
          accounts: [
            {
              id: 'legacy',
              tagIds: [],
              createdAt: '2026-03-01T00:00:00.000Z',
              updatedAt: '2026-03-01T00:00:00.000Z',
              authPayload: {
                mode: 'safeStorage',
                value: 'encrypted'
              }
            }
          ],
          tags: [],
          settings: {
            usagePollingMinutes: 15,
            statusBarAccountIds: [],
            language: 'zh-CN',
            theme: 'light',
            checkForUpdatesOnStartup: true,
            codexDesktopExecutablePath: ''
          },
          usageByAccountId: {},
          usageErrorByAccountId: {}
        },
        null,
        2
      ),
      'utf8'
    )

    const store = new CodexAccountStore(directory, createPlatform())
    await expect(store.getStoredAuthPayload('legacy')).rejects.toThrow('Re-import it')
  })

  it('serializes concurrent state updates without dropping changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)

    const store = new CodexAccountStore(directory, createPlatform())
    const account = await store.importAuthPayload(createAuthPayload('a'))
    await store.saveAccountUsageError(account.id, 'boom')

    const rateLimits = {
      limitId: null,
      limitName: null,
      planType: 'plus',
      primary: {
        usedPercent: 12,
        windowDurationMins: 300,
        resetsAt: Date.parse('2026-03-25T10:00:00.000Z')
      },
      secondary: null,
      credits: null,
      limits: [],
      fetchedAt: '2026-03-25T08:00:00.000Z'
    }

    await Promise.all([
      store.saveAccountRateLimits(account.id, rateLimits),
      store.clearAccountUsageError(account.id)
    ])

    const snapshot = await store.getSnapshot(false)
    expect(snapshot.usageByAccountId[account.id]).toEqual(rateLimits)
    expect(snapshot.usageErrorByAccountId[account.id]).toBeUndefined()

    const persisted = await readFile(join(directory, 'codex-accounts.json'), 'utf8')
    const backup = await readFile(join(directory, 'codex-accounts.json.bak'), 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({
      usageByAccountId: {
        [account.id]: rateLimits
      }
    })
    expect(JSON.parse(backup)).toMatchObject({
      usageByAccountId: {
        [account.id]: rateLimits
      }
    })
  })
})
