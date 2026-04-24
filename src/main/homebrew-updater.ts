import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_BREW_BINARY_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

export interface HomebrewCaskUpgradeLaunch {
  logFilePath: string
  statusFilePath: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function resolveExecutable(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

async function waitForExitCode(command: string, args: readonly string[]): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const child = spawn(command, [...args], {
      stdio: 'ignore'
    })

    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code))
  })
}

function resolveAppBundlePath(executablePath: string): string {
  return path.resolve(executablePath, '..', '..', '..')
}

export async function isHomebrewCaskInstalled(options?: {
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
}): Promise<boolean> {
  const brewBinary = await resolveExecutable(
    options?.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  if (!brewBinary) {
    return false
  }

  const exitCode = await waitForExitCode(brewBinary, [
    'list',
    '--cask',
    options?.caskToken ?? 'codexdock'
  ])
  return exitCode === 0
}

export async function launchHomebrewCaskUpgrade(options?: {
  appName?: string
  appBundlePath?: string
  appPid?: number
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
  executablePath?: string
  logFilePath?: string
  statusFilePath?: string
}): Promise<HomebrewCaskUpgradeLaunch> {
  const brewBinary = await resolveExecutable(
    options?.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  if (!brewBinary) {
    throw new Error('Homebrew is not installed on this Mac.')
  }

  const caskToken = options?.caskToken?.trim() || 'codexdock'
  const appName = options?.appName?.trim() || 'CodexDock'
  const appBundlePath =
    options?.appBundlePath?.trim() ||
    resolveAppBundlePath(options?.executablePath?.trim() || process.execPath)
  const logFilePath =
    options?.logFilePath?.trim() || path.join(tmpdir(), `${caskToken}-homebrew-update.log`)
  const statusFilePath =
    options?.statusFilePath?.trim() || path.join(tmpdir(), `${caskToken}-homebrew-update.status`)
  const appPid = Number.isInteger(options?.appPid) ? String(options?.appPid) : ''
  const brewUpdateCommand = `${brewBinary} update`
  const brewUpgradeCommand = `${brewBinary} upgrade --cask ${caskToken}`

  const script = [
    `exec >>${shellQuote(logFilePath)} 2>&1`,
    `status_file=${shellQuote(statusFilePath)}`,
    `write_status() { /usr/bin/printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" > "$status_file"; }`,
    `echo "[${new Date().toISOString()}] Starting Homebrew update for ${caskToken}"`,
    `write_status "starting" "" "Starting Homebrew update" ""`,
    `write_status "brew-update" ${shellQuote(brewUpdateCommand)} "Running brew update" ""`,
    `${shellQuote(brewBinary)} update`,
    'update_status=$?',
    'if [ "$update_status" -ne 0 ]; then',
    `  write_status "error" ${shellQuote(brewUpdateCommand)} "brew update failed" "$update_status"`,
    '  echo "[homebrew-updater] brew update exit status: ${update_status}"',
    '  exit "$update_status"',
    'fi',
    `write_status "waiting-for-app-quit" "" "Waiting for ${appName} to close" ""`,
    `app_pid=${shellQuote(appPid)}`,
    'if [ -n "$app_pid" ]; then',
    '  wait_count=0',
    '  while /bin/kill -0 "$app_pid" >/dev/null 2>&1 && [ "$wait_count" -lt 300 ]; do',
    '    /bin/sleep 0.2',
    '    wait_count=$((wait_count + 1))',
    '  done',
    'fi',
    `write_status "brew-upgrade" ${shellQuote(brewUpgradeCommand)} "Running brew upgrade --cask ${caskToken}" ""`,
    `${shellQuote(brewBinary)} upgrade --cask ${shellQuote(caskToken)}`,
    'status=$?',
    'echo "[homebrew-updater] exit status: ${status}"',
    'if [ "$status" -eq 0 ]; then',
    `  write_status "reopening" "" "Reopening ${appName}" ""`,
    `  /usr/bin/open ${shellQuote(appBundlePath)} >/dev/null 2>&1 || /usr/bin/open -a ${shellQuote(appName)} >/dev/null 2>&1 || true`,
    `  write_status "success" "" "Homebrew update completed" "0"`,
    'else',
    `  write_status "error" ${shellQuote(brewUpgradeCommand)} "brew upgrade failed" "$status"`,
    'fi',
    'exit "$status"'
  ].join('\n')

  const child = spawn('/bin/zsh', ['-lc', script], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  return {
    logFilePath,
    statusFilePath
  }
}
