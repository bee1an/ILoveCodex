import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'

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

import { createCodexServices, resolveWindowsCodexDesktopExecutable } from './codex-services'

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
    last_refresh: '2026-03-11T00:00:00.000Z',
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
          typeof args === 'function'
            ? args
            : typeof options === 'function'
              ? options
              : callback

        if (!resolvedCallback) {
          throw new Error('Missing execFile callback')
        }

        if (file === 'which' || file === 'where.exe') {
          resolvedCallback(null, '/usr/local/bin/codex\n', '')
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
      createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
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
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe('/Applications/Codex.app/Contents/MacOS/Codex')
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
          typeof args === 'function'
            ? args
            : typeof options === 'function'
              ? options
              : callback

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
    await writeFile(join(process.env.HOME ?? '', '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8')
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
    await writeFile(join(process.env.HOME ?? '', '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8')
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
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe('/Applications/Codex.app/Contents/MacOS/Codex')
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
})
