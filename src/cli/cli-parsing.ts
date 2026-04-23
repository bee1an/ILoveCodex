import type {
  AppSettings,
  CliSettingsKey,
  CreateCodexInstanceInput,
  CreateCustomProviderInput,
  StatsDisplaySettings,
  UpdateCodexInstanceInput,
  UpdateCustomProviderInput
} from '../shared/codex'
import { normalizeStatsDisplaySettings, statsDisplayKeys } from '../shared/codex'
import { CliError, EXIT_USAGE } from './cli-errors'

export interface CliFlags {
  json: boolean
  quiet: boolean
  openBrowser: boolean
  timeoutSeconds?: number
  help: boolean
}

export interface CostReadOptions {
  refresh: boolean
}

const SETTING_KEYS: CliSettingsKey[] = [
  'usagePollingMinutes',
  'statusBarAccountIds',
  'language',
  'theme',
  'checkForUpdatesOnStartup',
  'showLocalMockData',
  'codexDesktopExecutablePath',
  'statsDisplay'
]

function parseStatsDisplay(rawValue: string): StatsDisplaySettings {
  const normalizedValue = rawValue.trim().toLowerCase()
  if (normalizedValue === 'all') {
    return normalizeStatsDisplaySettings()
  }

  if (normalizedValue === 'none') {
    return normalizeStatsDisplaySettings(
      Object.fromEntries(statsDisplayKeys.map((key) => [key, false])) as Partial<StatsDisplaySettings>
    )
  }

  const keys = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!keys.length) {
    throw new CliError(
      `statsDisplay must be all, none, or a comma-separated subset of ${statsDisplayKeys.join(', ')}`,
      EXIT_USAGE
    )
  }

  const invalidKey = keys.find((key) => !statsDisplayKeys.includes(key as (typeof statsDisplayKeys)[number]))
  if (invalidKey) {
    throw new CliError(
      `statsDisplay contains unknown chart key: ${invalidKey}`,
      EXIT_USAGE
    )
  }

  return normalizeStatsDisplaySettings(
    Object.fromEntries(
      statsDisplayKeys.map((key) => [key, keys.includes(key)])
    ) as Partial<StatsDisplaySettings>
  )
}

export function parseFlags(argv: string[]): { flags: CliFlags; positionals: string[] } {
  const flags: CliFlags = {
    json: false,
    quiet: false,
    openBrowser: true,
    help: false
  }
  const positionals: string[] = []
  let seenCommand = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }

    if (arg === '--json') {
      flags.json = true
      continue
    }

    if (arg === '--quiet') {
      flags.quiet = true
      continue
    }

    if (arg === '--no-open') {
      flags.openBrowser = false
      continue
    }

    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }

    if (arg === '--timeout') {
      const value = argv[index + 1]
      if (!value) {
        throw new CliError('Missing value for --timeout', EXIT_USAGE)
      }
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new CliError('Invalid --timeout value', EXIT_USAGE)
      }
      flags.timeoutSeconds = parsed
      index += 1
      continue
    }

    if (arg.startsWith('--timeout=')) {
      const parsed = Number(arg.slice('--timeout='.length))
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new CliError('Invalid --timeout value', EXIT_USAGE)
      }
      flags.timeoutSeconds = parsed
      continue
    }

    if (arg.startsWith('--')) {
      if (seenCommand) {
        positionals.push(arg)
        continue
      }

      throw new CliError(`Unknown option: ${arg}`, EXIT_USAGE)
    }

    positionals.push(arg)
    seenCommand = true
  }

  return { flags, positionals }
}

export function parseSettingsValue(
  key: CliSettingsKey,
  rawValue: string
): AppSettings[CliSettingsKey] {
  switch (key) {
    case 'usagePollingMinutes': {
      const parsed = Number(rawValue)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError('usagePollingMinutes must be a positive integer', EXIT_USAGE)
      }
      return parsed
    }
    case 'statusBarAccountIds':
      return rawValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 5)
    case 'language':
      if (rawValue !== 'zh-CN' && rawValue !== 'en') {
        throw new CliError('language must be zh-CN or en', EXIT_USAGE)
      }
      return rawValue
    case 'theme':
      if (rawValue !== 'light' && rawValue !== 'dark' && rawValue !== 'system') {
        throw new CliError('theme must be light, dark, or system', EXIT_USAGE)
      }
      return rawValue
    case 'checkForUpdatesOnStartup':
      if (rawValue !== 'true' && rawValue !== 'false') {
        throw new CliError('checkForUpdatesOnStartup must be true or false', EXIT_USAGE)
      }
      return rawValue === 'true'
    case 'showLocalMockData':
      if (rawValue !== 'true' && rawValue !== 'false') {
        throw new CliError('showLocalMockData must be true or false', EXIT_USAGE)
      }
      return rawValue === 'true'
    case 'codexDesktopExecutablePath':
      return rawValue.trim()
    case 'statsDisplay':
      return parseStatsDisplay(rawValue)
  }
}

export function ensureSettingsKey(value: string): CliSettingsKey {
  if (!SETTING_KEYS.includes(value as CliSettingsKey)) {
    throw new CliError(`Unknown settings key: ${value}`, EXIT_USAGE)
  }

  return value as CliSettingsKey
}

export function parseProviderOptions(argv: string[]): {
  input: Partial<CreateCustomProviderInput & UpdateCustomProviderInput>
  positionals: string[]
} {
  const input: Partial<CreateCustomProviderInput & UpdateCustomProviderInput> = {}
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--name') {
      if (!value) {
        throw new CliError('Missing value for --name', EXIT_USAGE)
      }
      input.name = value
      index += 1
      continue
    }

    if (arg === '--base-url') {
      if (!value) {
        throw new CliError('Missing value for --base-url', EXIT_USAGE)
      }
      input.baseUrl = value
      index += 1
      continue
    }

    if (arg === '--api-key') {
      if (!value) {
        throw new CliError('Missing value for --api-key', EXIT_USAGE)
      }
      input.apiKey = value
      index += 1
      continue
    }

    if (arg === '--model') {
      if (!value) {
        throw new CliError('Missing value for --model', EXIT_USAGE)
      }
      input.model = value
      index += 1
      continue
    }

    if (arg === '--fast') {
      if (!value || (value !== 'true' && value !== 'false')) {
        throw new CliError('--fast must be true or false', EXIT_USAGE)
      }
      input.fastMode = value === 'true'
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`Unknown option: ${arg}`, EXIT_USAGE)
    }

    positionals.push(arg)
  }

  return { input, positionals }
}

export function parseFileOption(argv: string[]): {
  filePath?: string
  positionals: string[]
} {
  let filePath: string | undefined
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--file') {
      const value = argv[index + 1]
      if (!value) {
        throw new CliError('Missing value for --file', EXIT_USAGE)
      }
      filePath = value
      index += 1
      continue
    }

    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length)
      if (!filePath) {
        throw new CliError('Missing value for --file', EXIT_USAGE)
      }
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`Unknown option: ${arg}`, EXIT_USAGE)
    }

    positionals.push(arg)
  }

  return { filePath, positionals }
}

export function parseCostOptions(argv: string[]): CostReadOptions {
  const options: CostReadOptions = {
    refresh: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--refresh') {
      options.refresh = true
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`Unknown option: ${arg}`, EXIT_USAGE)
    }

    throw new CliError('Usage: ilc cost read [--refresh] [--json]', EXIT_USAGE)
  }

  return options
}

export function parseInstanceOptions(argv: string[]): {
  input: Partial<
    Omit<CreateCodexInstanceInput, 'bindAccountId'> &
      Omit<UpdateCodexInstanceInput, 'bindAccountId'>
  > & {
    bindAccountId?: string | null
    workspacePath?: string
  }
  positionals: string[]
} {
  const input: Partial<
    Omit<CreateCodexInstanceInput, 'bindAccountId'> &
      Omit<UpdateCodexInstanceInput, 'bindAccountId'>
  > & {
    bindAccountId?: string | null
    workspacePath?: string
  } = {}
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--name') {
      if (!value) {
        throw new CliError('Missing value for --name', EXIT_USAGE)
      }
      input.name = value
      index += 1
      continue
    }

    if (arg === '--codex-home') {
      if (!value) {
        throw new CliError('Missing value for --codex-home', EXIT_USAGE)
      }
      input.codexHome = value
      index += 1
      continue
    }

    if (arg === '--account') {
      if (!value) {
        throw new CliError('Missing value for --account', EXIT_USAGE)
      }
      input.bindAccountId = value === '-' ? null : value
      index += 1
      continue
    }

    if (arg === '--unbind-account') {
      input.bindAccountId = null
      continue
    }

    if (arg === '--extra-args') {
      if (!value) {
        throw new CliError('Missing value for --extra-args', EXIT_USAGE)
      }
      input.extraArgs = value
      index += 1
      continue
    }

    if (arg === '--workspace') {
      if (!value) {
        throw new CliError('Missing value for --workspace', EXIT_USAGE)
      }
      input.workspacePath = value
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new CliError(`Unknown option: ${arg}`, EXIT_USAGE)
    }

    positionals.push(arg)
  }

  return { input, positionals }
}
