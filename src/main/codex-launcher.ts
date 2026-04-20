import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'

import type { CodexAuthPayload } from './codex-auth'
import type { CustomProviderSummary } from '../shared/codex'

const execFile = promisify(execFileCallback)
const macosCodexAppBinary = '/Applications/Codex.app/Contents/MacOS/Codex'
const codexProcessPattern =
  process.platform === 'darwin'
    ? '(/Applications/Codex\\.app/Contents/MacOS/Codex|(^|/)codex( |$))'
    : '(^|/)codex( |$)'
const codexDesktopProcessPattern =
  process.platform === 'darwin'
    ? '(/Applications/Codex\\.app/Contents/MacOS/Codex|(^|/)codex( .*| )app( |$))'
    : '(^|/)codex( .*| )app( |$)'

function parseExtraArgs(raw: string): string[] {
  const tokens = raw.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g) ?? []
  return tokens
    .map((token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return token.slice(1, -1).replace(/\\(["'])/g, '$1')
      }

      return token
    })
    .filter(Boolean)
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

export async function resolveWindowsCodexDesktopExecutable(): Promise<string | null> {
  const powershellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

  try {
    const stdout = await new Promise<string>((resolveStdout, rejectStdout) => {
      execFileCallback(
        powershellPath,
        [
          '-NoProfile',
          '-Command',
          '(Get-AppxPackage *Codex* | Select-Object -ExpandProperty InstallLocation -First 1)'
        ],
        (error, commandStdout) => {
          if (error) {
            rejectStdout(error)
            return
          }

          resolveStdout(commandStdout)
        }
      )
    })
    const installLocation = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    if (installLocation) {
      return join(installLocation, 'app', 'Codex.exe')
    }
  } catch {
    // Fall through to explicit configuration or PATH-based fallback.
  }

  return null
}

async function listCodexProcessIds(): Promise<number[]> {
  return listProcessIds(codexProcessPattern)
}

async function listCodexDesktopProcessIds(): Promise<number[]> {
  return listProcessIds(codexDesktopProcessPattern)
}

async function listProcessIds(pattern: string): Promise<number[]> {
  try {
    const result = (await execFile('pgrep', ['-f', pattern])) as { stdout?: string } | string
    const stdout = typeof result === 'string' ? result : (result.stdout ?? '')
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

export async function resolveAnyCodexDesktopPid(): Promise<number | undefined> {
  return (await listCodexDesktopProcessIds()).find((pid) => isPidRunning(pid))
}

function isPidRunning(pid?: number): boolean {
  if (!pid || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pidTouchesCodexHome(pid: number, codexHome: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('lsof', ['-Fn', '-p', String(pid)])
    const normalizedPath = resolve(codexHome)

    return stdout
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1))
      .some(
        (openedPath) => openedPath === normalizedPath || openedPath.startsWith(`${normalizedPath}/`)
      )
  } catch {
    return false
  }
}

async function resolveRunningCodexPid(
  codexHome: string,
  lastPid?: number
): Promise<number | undefined> {
  if (lastPid && isPidRunning(lastPid) && (await pidTouchesCodexHome(lastPid, codexHome))) {
    return lastPid
  }

  for (const pid of await listCodexProcessIds()) {
    if (await pidTouchesCodexHome(pid, codexHome)) {
      return pid
    }
  }

  return undefined
}

export async function resolveManagedCodexPid(
  codexHome: string,
  lastPid?: number
): Promise<number | undefined> {
  if (lastPid && isPidRunning(lastPid)) {
    return lastPid
  }

  return resolveRunningCodexPid(codexHome, lastPid)
}

export async function stopCodexProcess(pid: number): Promise<void> {
  if (!isPidRunning(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!isPidRunning(pid)) {
      return
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, 200))
  }

  if (isPidRunning(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore a process that exited between checks.
    }
  }
}

function resolveMacosAppBundlePath(value?: string): string | undefined {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }

  const bundleEnd = normalized.indexOf('.app')
  if (bundleEnd < 0) {
    return undefined
  }

  return normalized.slice(0, bundleEnd + '.app'.length)
}

export async function revealCodexDesktop(options?: {
  desktopExecutablePath?: string
}): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }

  try {
    const appBundlePath = resolveMacosAppBundlePath(options?.desktopExecutablePath)
    if (appBundlePath) {
      await execFile('open', [appBundlePath])
    } else {
      await execFile('open', ['-a', 'Codex'])
    }
    return true
  } catch {
    return false
  }
}

export async function resolveCodexLaunchCommand(options?: {
  preferAppBundle?: boolean
  requireDesktopExecutable?: boolean
  desktopExecutablePath?: string
}): Promise<string> {
  const explicitPath = process.env['ILOVECODEX_CODEX_BIN']?.trim()
  if (explicitPath) {
    return explicitPath
  }

  const configuredDesktopPath = options?.desktopExecutablePath?.trim()
  if (configuredDesktopPath) {
    return configuredDesktopPath
  }

  if (
    options?.preferAppBundle &&
    process.platform === 'darwin' &&
    (await pathExists(macosCodexAppBinary))
  ) {
    return macosCodexAppBinary
  }

  if (options?.requireDesktopExecutable) {
    const detectedWindowsExecutable = await resolveWindowsCodexDesktopExecutable()
    if (detectedWindowsExecutable) {
      return detectedWindowsExecutable
    }
  }

  if (options?.requireDesktopExecutable) {
    throw new Error(
      process.platform === 'darwin'
        ? 'Codex app bundle not found. Install Codex.app or set ILOVECODEX_CODEX_BIN.'
        : 'Codex desktop executable not configured. Set ILOVECODEX_CODEX_BIN to the Codex desktop executable path.'
    )
  }

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFile(locator, ['codex'])
    const resolved = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (resolved) {
      return resolved
    }
  } catch {
    // Fall through to bundle fallback.
  }

  if (process.platform === 'darwin' && (await pathExists(macosCodexAppBinary))) {
    return macosCodexAppBinary
  }

  throw new Error(
    'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
  )
}

export async function launchCodexDesktop(options: {
  workspacePath: string
  codexHome: string
  extraArgs: string
  preferAppBundle?: boolean
  requireDesktopExecutable?: boolean
  desktopExecutablePath?: string
}): Promise<number> {
  const launchCommand = await resolveCodexLaunchCommand({
    preferAppBundle: options.preferAppBundle,
    requireDesktopExecutable: options.requireDesktopExecutable,
    desktopExecutablePath: options.desktopExecutablePath
  })
  const args = [...parseExtraArgs(options.extraArgs), 'app', options.workspacePath]

  return await new Promise<number>((resolveLaunch, rejectLaunch) => {
    const child = spawn(launchCommand, args, {
      cwd: options.workspacePath,
      env: {
        ...process.env,
        CODEX_HOME: options.codexHome
      },
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', (error) => {
      rejectLaunch(error)
    })
    child.once('spawn', () => {
      const pid = child.pid
      child.unref()

      if (!pid) {
        rejectLaunch(new Error('Codex process started without a PID.'))
        return
      }

      resolveLaunch(pid)
    })
  }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
      )
    }

    if (error?.code === 'EACCES') {
      throw new Error(`Codex executable is not runnable: ${launchCommand}`)
    }

    throw error
  })
}

export async function writeAuthPayloadToCodexHome(
  codexHome: string,
  authPayload: CodexAuthPayload
): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    join(codexHome, 'auth.json'),
    `${JSON.stringify(authPayload, null, 2)}\n`,
    'utf8'
  )
}

export async function writeProviderApiKeyToCodexHome(
  codexHome: string,
  apiKey: string
): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    join(codexHome, 'auth.json'),
    `${JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2)}\n`,
    'utf8'
  )
}

export async function writeProviderConfigToCodexHome(
  codexHome: string,
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl' | 'model' | 'fastMode'>
): Promise<void> {
  const configPath = join(codexHome, 'config.toml')
  let nextConfig: Record<string, unknown> = {}

  try {
    const raw = await fs.readFile(configPath, 'utf8')
    nextConfig = raw.trim() ? (parseToml(raw) as Record<string, unknown>) : {}
  } catch {
    nextConfig = {}
  }

  const modelProviders =
    nextConfig['model_providers'] && typeof nextConfig['model_providers'] === 'object'
      ? { ...(nextConfig['model_providers'] as Record<string, unknown>) }
      : {}
  modelProviders['custom'] = {
    name: provider.name?.trim() || 'custom',
    wire_api: 'responses',
    requires_openai_auth: true,
    base_url: provider.baseUrl
  }

  const feature =
    nextConfig['feature'] && typeof nextConfig['feature'] === 'object'
      ? { ...(nextConfig['feature'] as Record<string, unknown>) }
      : {}
  feature['fast_mode'] = provider.fastMode

  nextConfig['model'] = provider.model?.trim() || '5.4'
  nextConfig['model_provider'] = 'custom'
  nextConfig['model_providers'] = modelProviders
  nextConfig['feature'] = feature

  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    configPath,
    `${stringifyToml(nextConfig as Parameters<typeof stringifyToml>[0])}\n`,
    'utf8'
  )
}
