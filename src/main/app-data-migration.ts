import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const codexDockConfigEntries = new Set([
  '.codex',
  'codex-accounts.json',
  'codex-accounts.json.bak',
  'codex-instances.json',
  'codex-providers.json',
  'codex-instance-homes',
  'cost-usage'
])

export interface LegacyElectronUserDataMigrationResult {
  moved: string[]
  backedUp: string[]
  skipped: string[]
  reason?: 'missing-legacy-dir' | 'same-path' | 'nested-default-path'
}

export interface MigrateLegacyElectronUserDataOptions {
  legacyConfigPath: string
  defaultUserDataPath: string
  now?: () => Date
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const parent = resolve(parentPath)
  const child = resolve(childPath)
  const diff = relative(parent, child)
  return Boolean(diff) && !diff.startsWith('..') && !isAbsolute(diff)
}

function migrationBackupDir(defaultUserDataPath: string, now: Date): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  return join(defaultUserDataPath, 'legacy-codexdock-user-data', timestamp)
}

async function resolveAvailablePath(path: string): Promise<string> {
  if (!(await pathExists(path))) {
    return path
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${path}-${index}`
    if (!(await pathExists(candidate))) {
      return candidate
    }
  }

  throw new Error(`No available migration path for ${path}`)
}

async function movePath(source: string, target: string): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true })
  try {
    await fs.rename(source, target)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error
    }
  }

  await fs.cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true
  })
  await fs.rm(source, { recursive: true, force: true })
}

export async function migrateLegacyElectronUserData(
  options: MigrateLegacyElectronUserDataOptions
): Promise<LegacyElectronUserDataMigrationResult> {
  const legacyConfigPath = resolve(options.legacyConfigPath)
  const defaultUserDataPath = resolve(options.defaultUserDataPath)
  const result: LegacyElectronUserDataMigrationResult = {
    moved: [],
    backedUp: [],
    skipped: []
  }

  if (legacyConfigPath === defaultUserDataPath) {
    return { ...result, reason: 'same-path' }
  }

  if (isNestedPath(legacyConfigPath, defaultUserDataPath)) {
    return { ...result, reason: 'nested-default-path' }
  }

  let entries: string[]
  try {
    entries = await fs.readdir(legacyConfigPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...result, reason: 'missing-legacy-dir' }
    }
    throw error
  }

  const backupDir = migrationBackupDir(defaultUserDataPath, options.now?.() ?? new Date())

  for (const entry of entries) {
    if (codexDockConfigEntries.has(entry)) {
      result.skipped.push(entry)
      continue
    }

    const source = join(legacyConfigPath, entry)
    const target = join(defaultUserDataPath, entry)

    if (await pathExists(target)) {
      const backupTarget = await resolveAvailablePath(join(backupDir, entry))
      await movePath(source, backupTarget)
      result.backedUp.push(entry)
      continue
    }

    await movePath(source, target)
    result.moved.push(entry)
  }

  return result
}
