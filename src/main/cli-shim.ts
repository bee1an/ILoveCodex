import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const POSIX_MARKER = '# Managed by CodexDock CLI'
const WINDOWS_MARKER = ':: Managed by CodexDock CLI'

export interface CliShimCandidate {
  dir: string
  onPath: boolean
}

export interface InstallCliShimOptions {
  appPath: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export interface InstallCliShimResult {
  status: 'installed' | 'updated' | 'skipped'
  shimPath?: string
  onPath?: boolean
  reason?: string
}

function trimTrailingSlash(value: string): string {
  if (!value) {
    return value
  }

  return value.replace(/[\\/]+$/, '') || value
}

function splitPathEnv(pathValue: string | undefined, platform: NodeJS.Platform): string[] {
  if (!pathValue) {
    return []
  }

  return pathValue
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => trimTrailingSlash(entry.trim()))
    .filter(Boolean)
}

export function buildCliShimContent(appPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `${WINDOWS_MARKER}\r\n@echo off\r\n"${appPath}" --cli %*\r\n`
  }

  return `${POSIX_MARKER}\n#!/bin/sh\nexec "${appPath}" --cli "$@"\n`
}

function isManagedShim(content: string): boolean {
  return content.includes(POSIX_MARKER) || content.includes(WINDOWS_MARKER)
}

export function resolveCliShimCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): CliShimCandidate[] {
  const pathEntries = splitPathEnv(env['PATH'], platform)
  const pathApi = platform === 'win32' ? win32 : posix
  const seen = new Set<string>()
  const explicitDir = trimTrailingSlash(env['ILOVECODEX_BIN_DIR']?.trim() ?? '')

  const defaults =
    platform === 'win32'
      ? [
          env['LOCALAPPDATA']
            ? pathApi.join(env['LOCALAPPDATA'], 'Microsoft', 'WindowsApps')
            : undefined,
          env['USERPROFILE'] ? pathApi.join(env['USERPROFILE'], 'bin') : undefined
        ]
      : platform === 'darwin'
        ? [
            '/opt/homebrew/bin',
            '/usr/local/bin',
            pathApi.join(homeDir, '.local', 'bin'),
            pathApi.join(homeDir, 'bin')
          ]
        : ['/usr/local/bin', pathApi.join(homeDir, '.local', 'bin'), pathApi.join(homeDir, 'bin')]

  const preferred = [explicitDir, ...defaults]
    .map((value) => trimTrailingSlash(value ?? ''))
    .filter(Boolean)

  const ordered = [
    ...preferred.filter((dir) => pathEntries.includes(dir)),
    ...preferred.filter((dir) => !pathEntries.includes(dir))
  ]

  return ordered.flatMap((dir) => {
    if (seen.has(dir)) {
      return []
    }

    seen.add(dir)
    return [{ dir, onPath: pathEntries.includes(dir) }]
  })
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function installCliShim(
  options: InstallCliShimOptions
): Promise<InstallCliShimResult> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()

  if (!options.isPackaged) {
    return { status: 'skipped', reason: 'not-packaged' }
  }

  const shimName = platform === 'win32' ? 'cdock.cmd' : 'cdock'
  const pathApi = platform === 'win32' ? win32 : posix
  const desiredContent = buildCliShimContent(options.appPath, platform)

  for (const candidate of resolveCliShimCandidates(platform, env, homeDir)) {
    const shimPath = pathApi.join(candidate.dir, shimName)

    try {
      const existing = await readFileIfExists(shimPath)
      if (existing != null) {
        if (existing === desiredContent) {
          return {
            status: 'skipped',
            shimPath,
            onPath: candidate.onPath,
            reason: 'up-to-date'
          }
        }

        if (!isManagedShim(existing)) {
          if (candidate.onPath) {
            return {
              status: 'skipped',
              shimPath,
              onPath: true,
              reason: 'occupied'
            }
          }

          continue
        }
      }

      await fs.mkdir(candidate.dir, { recursive: true })
      await fs.writeFile(shimPath, desiredContent, 'utf8')
      if (platform !== 'win32') {
        await fs.chmod(shimPath, 0o755)
      }

      return {
        status: existing == null ? 'installed' : 'updated',
        shimPath,
        onPath: candidate.onPath
      }
    } catch {
      continue
    }
  }

  return { status: 'skipped', reason: 'no-install-target' }
}
