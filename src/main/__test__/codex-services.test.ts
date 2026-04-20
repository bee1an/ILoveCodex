import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexPlatformAdapter, ProtectedPayload } from '../../shared/codex-platform'

const mockedProcessState = vi.hoisted(() => {
  return {
    execFile: vi.fn(),
    spawn: vi.fn(),
    runningPids: new Set<number>(),
    pidHomes: new Map<number, string>(),
    spawnedCommands: [] as string[],
    nextPid: 4000
  }
})

vi.mock('node:child_process', () => ({
  execFile: mockedProcessState.execFile,
  spawn: mockedProcessState.spawn
}))

import { createCodexServices, resolveWindowsCodexDesktopExecutable } from '../codex-services'

function createPlatform(): CodexPlatformAdapter {
  return {
    fetch: vi.fn(),
    protect: (value: string): ProtectedPayload => ({
      mode: 'plain',
      value
    }),
    unprotect: (payload: ProtectedPayload): string => payload.value,
    openExternal: vi.fn(async () => undefined)
  }
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function createAuthPayload(accountId: string, email: string) {
  return {
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: createJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId
        }
      }),
      refresh_token: `refresh-${accountId}`,
      id_token: createJwt({
        email,
        name: email.split('@')[0],
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId
        }
      }),
      account_id: accountId
    }
  }
}

function createRefreshPayload(accountId: string, email: string, refreshToken: string) {
  return {
    access_token: createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId
      }
    }),
    refresh_token: refreshToken,
    id_token: createJwt({
      email,
      name: email.split('@')[0],
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId
      }
    })
  }
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function createUsageResponse(): Response {
  return createJsonResponse({
    user_id: 'user_123',
    account_id: 'acct-a',
    email: 'a@example.com',
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 12,
        limit_window_seconds: 18_000,
        reset_after_seconds: 60,
        reset_at: 1_800_000_000
      },
      secondary_window: {
        used_percent: 34,
        limit_window_seconds: 604_800,
        reset_after_seconds: 600,
        reset_at: 1_800_500_000
      }
    },
    credits: null,
    additional_rate_limits: []
  })
}

describe('createCodexServices', () => {
  const createdDirectories: string[] = []
  let originalHome: string | undefined
  const originalPlatform = process.platform
  let processKillSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockedProcessState.execFile.mockReset()
    mockedProcessState.spawn.mockReset()
    mockedProcessState.runningPids.clear()
    mockedProcessState.pidHomes.clear()
    mockedProcessState.spawnedCommands.splice(0)
    mockedProcessState.nextPid = 4000

    mockedProcessState.execFile.mockImplementation(
      (
        file: string,
        args: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
        options:
          | { cwd?: string; env?: NodeJS.ProcessEnv }
          | ((error: Error | null, stdout: string, stderr: string) => void),
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const resolvedArgs = Array.isArray(args) ? args : []
        const resolvedCallback =
          typeof args === 'function' ? args : typeof options === 'function' ? options : callback

        if (!resolvedCallback) {
          throw new Error('Missing execFile callback')
        }

        if (file === 'which' || file === 'where.exe') {
          resolvedCallback(null, '/usr/local/bin/codex\n', '')
          return
        }

        if (file === 'open') {
          resolvedCallback(null, '', '')
          return
        }

        if (file === 'pgrep') {
          const stdout = [...mockedProcessState.runningPids].join('\n')
          if (stdout) {
            resolvedCallback(null, `${stdout}\n`, '')
            return
          }

          const error = Object.assign(new Error('not found'), { code: 1 })
          resolvedCallback(error, '', '')
          return
        }

        if (file === 'lsof') {
          const pid = Number(resolvedArgs.at(-1))
          const codexHome = mockedProcessState.pidHomes.get(pid)
          if (!codexHome) {
            const error = Object.assign(new Error('not found'), { code: 1 })
            resolvedCallback(error, '', '')
            return
          }

          resolvedCallback(null, `p${pid}\nn${codexHome}/auth.json\n`, '')
          return
        }

        throw new Error(`Unexpected execFile call: ${file}`)
      }
    )

    mockedProcessState.spawn.mockImplementation(
      (command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
        const child = new EventEmitter() as EventEmitter & {
          pid: number
          unref: () => void
          once: EventEmitter['once']
        }
        mockedProcessState.spawnedCommands.push(command)
        const pid = mockedProcessState.nextPid++
        child.pid = pid
        child.unref = vi.fn()

        mockedProcessState.runningPids.add(pid)
        mockedProcessState.pidHomes.set(pid, options?.env?.CODEX_HOME ?? '')

        queueMicrotask(() => {
          child.emit('spawn')
        })

        return child
      }
    )

    processKillSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (!mockedProcessState.runningPids.has(pid)) {
            throw Object.assign(new Error('not running'), { code: 'ESRCH' })
          }
          return true
        }

        mockedProcessState.runningPids.delete(pid)
        mockedProcessState.pidHomes.delete(pid)
        return true
      })
  })

  afterEach(async () => {
    processKillSpy.mockRestore()
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env.HOME = originalHome
    await Promise.all(
      createdDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createEnvironment() {
    const directory = await mkdtemp(join(tmpdir(), 'ilovecodex-services-'))
    createdDirectories.push(directory)

    originalHome = process.env.HOME
    process.env.HOME = join(directory, 'home')

    const workspacePath = join(directory, 'workspace')
    await mkdir(workspacePath, { recursive: true })

    return {
      userDataPath: join(directory, 'user-data'),
      workspacePath,
      globalAuthPath: join(process.env.HOME, '.codex', 'auth.json')
    }
  }

  async function writeGlobalAuth(path: string, payload: Record<string, unknown>): Promise<void> {
    await mkdir(join(process.env.HOME ?? '', '.codex'), { recursive: true })
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  it('opens an isolated account instance without changing the global auth file', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.accounts.activate(accountA!.id)
    await services.codex.openIsolated(accountB!.id, env.workspacePath)

    const globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()
    const isolatedAuthPath = join(isolatedHome!, 'auth.json')
    const instanceAuth = JSON.parse(await readFile(isolatedAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }

    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(instanceAuth.tokens?.account_id).toBe('acct-b')
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe(
      '/Applications/Codex.app/Contents/MacOS/Codex'
    )
  })

  it('shows a running Codex process without launching a duplicate default instance', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()

    await services.codex.openIsolated(snapshot.accounts[0]!.id, env.workspacePath)
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)

    await services.codex.show(env.workspacePath)

    expect(mockedProcessState.spawnedCommands).toHaveLength(1)
  })

  it('opens default Codex without switching to the default bound account', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.accounts.activate(accountA!.id)
    await services.codex.instances.update('__default__', { bindAccountId: accountB!.id })

    await services.codex.show(env.workspacePath)

    let nextSnapshot = await services.getSnapshot()
    let globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    expect(nextSnapshot.activeAccountId).toBe(accountA!.id)
    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)

    processKillSpy.mockClear()
    await services.codex.show(env.workspacePath)

    nextSnapshot = await services.getSnapshot()
    globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    const terminationCalls = processKillSpy.mock.calls.filter(
      ([, signal]) => signal && signal !== 0
    )

    expect(nextSnapshot.activeAccountId).toBe(accountA!.id)
    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)
    expect(terminationCalls).toHaveLength(0)
  })

  it('uses the configured desktop executable path for isolated launches when provided', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.settings.update({
      codexDesktopExecutablePath: 'C:\\Program Files\\Codex\\Codex.exe'
    })
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    await services.codex.openIsolated(snapshot.accounts[0]!.id, env.workspacePath)

    expect(mockedProcessState.spawnedCommands.at(-1)).toBe('C:\\Program Files\\Codex\\Codex.exe')
  })

  it('detects the Windows Store desktop executable from InstallLocation', async () => {
    mockedProcessState.execFile.mockImplementation(
      (
        file: string,
        args: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
        options:
          | { cwd?: string; env?: NodeJS.ProcessEnv }
          | ((error: Error | null, stdout: string, stderr: string) => void),
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const resolvedCallback =
          typeof args === 'function' ? args : typeof options === 'function' ? options : callback

        if (!resolvedCallback) {
          throw new Error('Missing execFile callback')
        }

        if (file.toLowerCase().endsWith('powershell.exe')) {
          resolvedCallback(
            null,
            'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.309.3504.0_x64__2p2nqsdec76g0\r\n',
            ''
          )
          return
        }

        throw new Error(`Unexpected execFile call: ${file}`)
      }
    )

    await expect(resolveWindowsCodexDesktopExecutable()).resolves.toBe(
      'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.309.3504.0_x64__2p2nqsdec76g0/app/Codex.exe'
    )
  })

  it('syncs only config files into isolated instances', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'config.toml'),
      'model = "gpt-5"\n',
      'utf8'
    )
    await writeFile(join(process.env.HOME ?? '', '.codex', 'memory.md'), '# memory\n', 'utf8')
    await writeFile(join(process.env.HOME ?? '', '.codex', 'history.jsonl'), '{}\n', 'utf8')
    await mkdir(join(process.env.HOME ?? '', '.codex', 'worktrees', 'demo'), { recursive: true })
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'worktrees', 'demo', 'note.txt'),
      'demo\n',
      'utf8'
    )

    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()

    await services.codex.openIsolated(snapshot.accounts[0].id, env.workspacePath)

    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()

    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain('gpt-5')
    await expect(readFile(join(isolatedHome!, 'memory.md'), 'utf8')).resolves.toContain('# memory')
    await expect(stat(join(isolatedHome!, 'history.jsonl'))).rejects.toBeTruthy()
    await expect(stat(join(isolatedHome!, 'worktrees'))).rejects.toBeTruthy()
  })

  it('opens a custom provider in an isolated instance with provider auth and config', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'config.toml'),
      'model = "gpt-5"\n',
      'utf8'
    )
    await services.accounts.importCurrent()

    const created = await services.providers.create({
      name: 'Bee',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    await services.providers.open(providerId!, env.workspacePath)

    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()

    await expect(readFile(join(isolatedHome!, 'auth.json'), 'utf8')).resolves.toContain(
      '"OPENAI_API_KEY": "provider-secret"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'model = "gpt-5.4"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'model_provider = "custom"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'base_url = "https://api.bee1an.us.kg/v1"'
    )
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe(
      '/Applications/Codex.app/Contents/MacOS/Codex'
    )
  })

  it('lists default and named instances in service results and snapshots', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    const created = await services.codex.instances.create({
      name: 'Work',
      bindAccountId: 'acct-a',
      extraArgs: '--approval never'
    })

    const instances = await services.codex.instances.list()
    expect(instances.map((instance) => instance.id)).toEqual(['__default__', created.id])
    expect(instances[1]).toMatchObject({
      name: 'Work',
      bindAccountId: 'acct-a',
      extraArgs: '--approval never'
    })

    const snapshot = await services.getSnapshot()
    expect(snapshot.codexInstances.map((instance) => instance.id)).toEqual([
      '__default__',
      created.id
    ])
  })

  it('checks provider health via /models', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }]
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const created = await services.providers.create({
      name: 'Bee',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    const report = await services.providers.check(providerId!)
    expect(platform.fetch).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-secret'
      }
    })
    expect(report.ok).toBe(true)
    expect(report.httpStatus).toBe(200)
    expect(report.availableModels).toEqual(['gpt-5.4', 'gpt-5.4-mini'])
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          status: 'pass'
        })
      ])
    )
  })

  it('runs doctor checks for current session and desktop resolution', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.settings.update({
      codexDesktopExecutablePath: '/usr/local/bin/codex'
    })
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const report = await services.doctor.run()
    expect(report.ok).toBe(true)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex-desktop',
          status: 'pass'
        }),
        expect.objectContaining({
          id: 'current-session',
          status: 'pass'
        })
      ])
    )
  })

  it('restarts only the default instance when codex.open(accountId) is called', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts[0]

    await services.codex.openIsolated(accountA.id, env.workspacePath)
    const isolatedPid = [...mockedProcessState.runningPids].find(
      (pid) => mockedProcessState.pidHomes.get(pid) !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedPid).toBeDefined()

    await services.codex.open(accountA.id, env.workspacePath)
    const defaultPid = [...mockedProcessState.runningPids].find(
      (pid) => mockedProcessState.pidHomes.get(pid) === join(process.env.HOME ?? '', '.codex')
    )
    expect(defaultPid).toBeDefined()

    processKillSpy.mockClear()
    await services.codex.open(accountA.id, env.workspacePath)

    const terminationCalls = processKillSpy.mock.calls
      .filter(([, signal]) => signal && signal !== 0)
      .map(([pid]) => pid)

    expect(terminationCalls).toContain(defaultPid)
    expect(terminationCalls).not.toContain(isolatedPid)
    expect(mockedProcessState.runningPids.has(isolatedPid ?? -1)).toBe(true)
  })

  it('clears stale usage after an expired usage refresh fails', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const baseAuth = createAuthPayload('acct-a', 'a@example.com')
    const { refresh_token: _refreshToken, ...tokensWithoutRefresh } = baseAuth.tokens
    const expiredAuth = {
      ...baseAuth,
      tokens: tokensWithoutRefresh
    }

    await writeGlobalAuth(env.globalAuthPath, expiredAuth)
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]
    const statePath = join(env.userDataPath, 'codex-accounts.json')
    const staleUsage = {
      limitId: 'codex',
      limitName: null,
      planType: 'plus',
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
      credits: null,
      limits: [],
      fetchedAt: '2026-03-19T00:00:00.000Z'
    }

    const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as {
      usageByAccountId: Record<string, unknown>
    }
    persistedState.usageByAccountId = {
      ...persistedState.usageByAccountId,
      [account.id]: staleUsage
    }
    await writeFile(statePath, `${JSON.stringify(persistedState, null, 2)}\n`, 'utf8')
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('unauthorized', {
        status: 401,
        headers: {
          'content-type': 'text/plain'
        }
      })
    )

    await expect(services.usage.read(account.id)).rejects.toThrow('unauthorized')

    const nextSnapshot = await services.getSnapshot()
    expect(nextSnapshot.usageByAccountId[account.id]).toBeUndefined()
  })

  it('exports accounts with the minimal aligned template schema', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const statePath = join(env.userDataPath, 'codex-accounts.json')
    const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as {
      accounts: Array<{ id: string }>
      usageByAccountId: Record<string, unknown>
    }
    const accountId = persistedState.accounts[0]?.id
    expect(accountId).toBeTruthy()
    persistedState.usageByAccountId = {
      ...persistedState.usageByAccountId,
      [accountId!]: {
        limitId: 'codex',
        limitName: null,
        planType: 'plus',
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
        credits: null,
        limits: [],
        fetchedAt: '2026-03-19T00:00:00.000Z'
      }
    }
    await writeFile(statePath, `${JSON.stringify(persistedState, null, 2)}\n`, 'utf8')

    const exported = JSON.parse(await services.accounts.exportToTemplate()) as {
      exported_at: string
      accounts: Array<Record<string, unknown>>
      proxies?: unknown
    }

    expect(typeof exported.exported_at).toBe('string')
    expect(exported.proxies).toEqual([])
    expect(exported.accounts).toHaveLength(1)
    expect(exported.accounts[0]).toEqual({
      name: 'a@example.com',
      notes: '',
      platform: 'openai',
      type: 'oauth',
      credentials: {
        _token_version: 1,
        access_token: expect.any(String),
        refresh_token: 'refresh-acct-a',
        id_token: expect.any(String),
        chatgpt_account_id: 'acct-a',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        email: 'a@example.com',
        expires_at: expect.any(String),
        expires_in: expect.any(Number),
        plan_type: 'plus',
        scope: null,
        token_type: null
      },
      extra: {
        codex_5h_reset_after_seconds: expect.any(Number),
        codex_5h_reset_at: '2027-01-15T08:00:00.000Z',
        codex_5h_used_percent: 12,
        codex_5h_window_minutes: 300,
        codex_7d_reset_after_seconds: expect.any(Number),
        codex_7d_reset_at: '2027-01-21T02:53:20.000Z',
        codex_7d_used_percent: 34,
        codex_7d_window_minutes: 10080,
        codex_primary_over_secondary_percent: -22,
        codex_primary_reset_after_seconds: expect.any(Number),
        codex_primary_reset_at: '2027-01-15T08:00:00.000Z',
        codex_primary_used_percent: 12,
        codex_primary_window_minutes: 300,
        codex_secondary_reset_after_seconds: expect.any(Number),
        codex_secondary_reset_at: '2027-01-21T02:53:20.000Z',
        codex_secondary_used_percent: 34,
        codex_secondary_window_minutes: 10080,
        codex_usage_updated_at: '2026-03-19T00:00:00.000Z',
        email: 'a@example.com',
        privacy_mode: 'training_off'
      },
      concurrency: 10,
      priority: 1,
      rate_multiplier: 1,
      auto_pause_on_expired: false
    })
  })

  it('exports only the selected accounts', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    expect(accountA).toBeTruthy()

    const exported = JSON.parse(await services.accounts.exportToTemplate([accountA!.id])) as {
      accounts: Array<{
        credentials: {
          chatgpt_account_id: string
        }
      }>
    }

    expect(exported.accounts).toHaveLength(1)
    expect(exported.accounts[0]?.credentials.chatgpt_account_id).toBe('acct-a')
  })

  it('imports the reference template schema and rejects missing credentials fields', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      JSON.stringify({
        exported_at: '2026-03-24T08:00:00.000Z',
        proxies: [],
        accounts: [
          {
            name: 'b@example.com',
            notes: '',
            platform: 'openai',
            type: 'oauth',
            credentials: {
              _token_version: 1,
              access_token: createJwt({
                exp: Math.floor(Date.now() / 1000) + 3600,
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-b'
                }
              }),
              refresh_token: 'refresh-acct-b',
              id_token: createJwt({
                email: 'b@example.com',
                name: 'b',
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-b'
                }
              }),
              chatgpt_account_id: 'acct-b',
              client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
              email: 'b@example.com',
              expires_at: '2026-03-24T09:00:00.000Z',
              expires_in: 3600,
              plan_type: 'pro',
              scope: null,
              token_type: null
            },
            extra: {
              codex_5h_reset_after_seconds: 7200,
              codex_5h_reset_at: '2026-03-24T10:00:00.000Z',
              codex_5h_used_percent: 20,
              codex_5h_window_minutes: 300,
              codex_7d_reset_after_seconds: 604800,
              codex_7d_reset_at: '2026-03-31T08:00:00.000Z',
              codex_7d_used_percent: 40,
              codex_7d_window_minutes: 10080,
              codex_primary_over_secondary_percent: -20,
              codex_primary_reset_after_seconds: 7200,
              codex_primary_reset_at: '2026-03-24T10:00:00.000Z',
              codex_primary_used_percent: 20,
              codex_primary_window_minutes: 300,
              codex_secondary_reset_after_seconds: 604800,
              codex_secondary_reset_at: '2026-03-31T08:00:00.000Z',
              codex_secondary_used_percent: 40,
              codex_secondary_window_minutes: 10080,
              codex_usage_updated_at: '2026-03-24T08:00:00.000Z',
              email: 'b@example.com',
              privacy_mode: 'training_off'
            },
            concurrency: 10,
            priority: 1,
            rate_multiplier: 1,
            auto_pause_on_expired: false
          }
        ]
      })
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts[0]?.email).toBe('b@example.com')
    expect(snapshot.usageByAccountId[snapshot.accounts[0]!.id]).toMatchObject({
      planType: 'pro',
      primary: {
        usedPercent: 20,
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 40,
        windowDurationMins: 10080
      }
    })

    await expect(
      services.accounts.importFromTemplate(
        JSON.stringify({
          exported_at: '2026-03-24T08:00:00.000Z',
          proxies: [],
          accounts: [{}]
        })
      )
    ).rejects.toThrow('missing required field: credentials')
  })

  it('removes multiple accounts in one call', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-c', 'c@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const targets = snapshot.accounts
      .filter((account) => ['a@example.com', 'c@example.com'].includes(account.email ?? ''))
      .map((account) => account.id)

    const nextSnapshot = await services.accounts.removeMany(targets)
    expect(nextSnapshot.accounts.map((account) => account.email)).toEqual(['b@example.com'])
  })

  it('refreshes sessions when Codex-style last_refresh is stale', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: '2026-03-11T00:00:00.000Z'
    })
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
    )

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(true)

    expect(platform.fetch).toHaveBeenCalledTimes(1)
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
    await expect(readFile(env.globalAuthPath, 'utf8')).resolves.toContain('refresh-acct-a-2')
  })

  it('uses one guarded refresh for concurrent session refreshes', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: '2026-03-11T00:00:00.000Z'
    })
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
    )

    await expect(
      Promise.all([
        services.accounts.refreshExpiringSession(account.id),
        services.accounts.refreshExpiringSession(account.id)
      ])
    ).resolves.toEqual([true, true])

    expect(platform.fetch).toHaveBeenCalledTimes(1)
  })

  it('syncs a Codex-refreshed global auth file before using the stored refresh token', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: '2026-03-11T00:00:00.000Z'
    })
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]
    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: new Date().toISOString(),
      tokens: {
        ...createAuthPayload('acct-a', 'a@example.com').tokens,
        refresh_token: 'refresh-acct-a-from-codex'
      }
    })

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(false)

    expect(platform.fetch).not.toHaveBeenCalled()
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-from-codex')
  })

  it('refreshes stale auth before reading usage and stores rotated refresh tokens', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: '2026-03-11T00:00:00.000Z'
    })
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
      )
      .mockResolvedValueOnce(createUsageResponse())

    await expect(services.usage.read(account.id)).resolves.toMatchObject({
      planType: 'plus',
      primary: {
        usedPercent: 12
      },
      secondary: {
        usedPercent: 34
      }
    })

    expect(platform.fetch).toHaveBeenCalledTimes(2)
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
  })

  it('refreshes expiring stored sessions and syncs the current auth file', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      auth_mode: 'chatgpt',
      last_refresh: '2026-03-11T00:00:00.000Z',
      tokens: {
        access_token: createJwt({
          exp: Math.floor(Date.now() / 1000) - 60,
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-a'
          }
        }),
        refresh_token: 'refresh-acct-a',
        id_token: createJwt({
          email: 'a@example.com',
          name: 'a',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-a'
          }
        }),
        account_id: 'acct-a'
      }
    })
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: createJwt({
            exp: Math.floor(Date.now() / 1000) + 3600,
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct-a'
            }
          }),
          refresh_token: 'refresh-acct-a-2',
          id_token: createJwt({
            email: 'a@example.com',
            name: 'a',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct-a'
            }
          })
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    )

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(true)

    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
    await expect(readFile(env.globalAuthPath, 'utf8')).resolves.toContain('refresh-acct-a-2')
  })
})
