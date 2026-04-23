import type {
  AccountRateLimits,
  AccountTag,
  AccountSummary,
  AppSettings,
  CliAccountListPayload,
  CliResult,
  CodexInstanceSummary,
  CurrentSessionSummary,
  CustomProviderSummary,
  DoctorReport,
  HealthCheckResult,
  ProviderCheckReport,
  TokenCostDetail
} from '../shared/codex'
import { serializeStatsDisplaySettings } from '../shared/codex'

export function printHelp(): void {
  console.log(`ilc

Usage:
  ilc account list [--json]
  ilc account import-current [--json]
  ilc account import [--file <path>] [--json]
  ilc account export [account-id...] [--file <path>] [--json]
  ilc account activate <account-id> [--json]
  ilc account best [--json]
  ilc account remove <account-id> [--json]
  ilc provider list [--json]
  ilc provider create --base-url <url> --api-key <key> [--name <name>] [--model <model>] [--fast <true|false>] [--json]
  ilc provider update <provider-id> [--name <name>] [--base-url <url>] [--api-key <key>] [--model <model>] [--fast <true|false>] [--json]
  ilc provider remove <provider-id> [--json]
  ilc provider check <provider-id> [--json]
  ilc provider open <provider-id> [--json]
  ilc instance list [--json]
  ilc instance create --name <name> [--codex-home <path>] [--account <account-id>] [--extra-args <args>] [--json]
  ilc instance update <instance-id|default> [--name <name>] [--account <account-id|->] [--extra-args <args>] [--unbind-account] [--json]
  ilc instance start <instance-id|default> [--workspace <path>] [--json]
  ilc instance stop <instance-id|default> [--json]
  ilc instance remove <instance-id> [--json]
  ilc tag list [--json]
  ilc tag create <name> [--json]
  ilc tag rename <tag-id> <name> [--json]
  ilc tag remove <tag-id> [--json]
  ilc tag assign <account-id> <tag-id> [--json]
  ilc tag unassign <account-id> <tag-id> [--json]
  ilc session current [--json]
  ilc usage read [account-id] [--json]
  ilc cost read [--refresh] [--json]
  ilc login browser [--json] [--no-open] [--timeout <sec>]
  ilc login device [--json] [--timeout <sec>]
  ilc login port status [--json]
  ilc login port kill [--json]
  ilc codex show [--json]
  ilc codex open [account-id] [--json]
  ilc codex open-isolated <account-id> [--json]
  ilc doctor [--json]
  ilc settings get [key] [--json]
  ilc settings set <key> <value> [--json]

Global options:
  --json        Output { ok, data, error }
  --quiet       Suppress non-error text output
  --no-open     Do not auto-open browser for callback login
  --timeout     Fail waiting commands after N seconds
  --help        Show this help`)
}

export function accountLabel(
  account?: Pick<AccountSummary, 'email' | 'name' | 'accountId' | 'id'> | null
): string {
  if (!account) {
    return 'unknown'
  }

  return account.email ?? account.name ?? account.accountId ?? account.id
}

export function sessionLabel(session: CurrentSessionSummary | null): string {
  if (!session) {
    return 'none'
  }

  return session.email ?? session.name ?? session.accountId ?? 'current'
}

export function tagLabel(tag?: Pick<AccountTag, 'id' | 'name'> | null): string {
  if (!tag) {
    return 'unknown'
  }

  return tag.name || tag.id
}

export function providerLabel(
  provider?: Pick<CustomProviderSummary, 'id' | 'name' | 'baseUrl'> | null
): string {
  if (!provider) {
    return 'unknown'
  }

  return provider.name ?? provider.baseUrl ?? provider.id
}

export function instanceLabel(
  instance?: Pick<CodexInstanceSummary, 'id' | 'name' | 'isDefault'> | null
): string {
  if (!instance) {
    return 'unknown'
  }

  return instance.isDefault ? 'default' : instance.name || instance.id
}

export function printIfNeeded(message: string, quiet: boolean): void {
  if (!quiet) {
    console.log(message)
  }
}

export function toCliResult<T>(data: T): CliResult<T> {
  return {
    ok: true,
    data,
    error: null
  }
}

export function printAccountList(payload: CliAccountListPayload, quiet: boolean): void {
  if (quiet) {
    return
  }

  if (!payload.accounts.length) {
    console.log('No stored accounts')
    console.log(`Current session: ${sessionLabel(payload.currentSession)}`)
    return
  }

  for (const account of payload.accounts) {
    const marker = account.id === payload.activeAccountId ? '*' : ' '
    console.log(`${marker} ${account.id}  ${accountLabel(account)}`)
  }

  console.log(`Current session: ${sessionLabel(payload.currentSession)}`)
}

export function printUsage(rateLimits: AccountRateLimits, quiet: boolean): void {
  if (quiet) {
    return
  }

  const primary = rateLimits.primary
    ? `${Math.max(0, 100 - rateLimits.primary.usedPercent)}%`
    : '--'
  const secondary = rateLimits.secondary
    ? `${Math.max(0, 100 - rateLimits.secondary.usedPercent)}%`
    : '--'

  console.log(`Plan: ${rateLimits.planType ?? 'unknown'}`)
  console.log(`Primary remaining: ${primary}`)
  console.log(`Secondary remaining: ${secondary}`)
  if (rateLimits.credits) {
    console.log(
      `Credits: ${rateLimits.credits.unlimited ? 'unlimited' : (rateLimits.credits.balance ?? '--')}`
    )
  }
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCostUSD(value: number | null): string {
  if (value === null) {
    return '--'
  }

  if (value > 0 && value < 0.0001) {
    return `$${value.toExponential(2)}`
  }

  return `$${value.toFixed(4)}`
}

export function printTokenCost(detail: TokenCostDetail, quiet: boolean): void {
  if (quiet) {
    return
  }

  const label =
    detail.instanceId === '__all__'
      ? 'all instances'
      : detail.instanceId === '__default__'
        ? 'default'
        : detail.instanceId

  console.log('Token/cost usage: local Codex logs')
  console.log(`Scope: ${label}`)
  if (detail.codexHome) {
    console.log(`CODEX_HOME: ${detail.codexHome}`)
  }
  console.log(
    `Today: ${formatTokenCount(detail.summary.sessionTokens)} tokens · ${formatCostUSD(detail.summary.sessionCostUSD)}`
  )
  console.log(
    `Last 30 days: ${formatTokenCount(detail.summary.last30DaysTokens)} tokens · ${formatCostUSD(detail.summary.last30DaysCostUSD)}`
  )
  console.log(`Updated: ${detail.summary.updatedAt}`)
  if (detail.warnings?.length) {
    console.log('Warnings:')
    for (const warning of detail.warnings) {
      console.log(`- ${warning}`)
    }
  }
}

export function printTags(tags: AccountTag[], quiet: boolean): void {
  if (quiet) {
    return
  }

  if (!tags.length) {
    console.log('No tags')
    return
  }

  for (const tag of tags) {
    console.log(`${tag.id}  ${tag.name}`)
  }
}

export function printProviders(providers: CustomProviderSummary[], quiet: boolean): void {
  if (quiet) {
    return
  }

  if (!providers.length) {
    console.log('No custom providers')
    return
  }

  for (const provider of providers) {
    console.log(
      `${provider.id}  ${providerLabel(provider)}  ${provider.model}  ${provider.fastMode ? 'fast' : 'normal'}`
    )
  }
}

export function printInstances(instances: CodexInstanceSummary[], quiet: boolean): void {
  if (quiet) {
    return
  }

  if (!instances.length) {
    console.log('No instances')
    return
  }

  for (const instance of instances) {
    console.log(
      `${instance.isDefault ? 'default' : instance.id}  ${instanceLabel(instance)}  ${
        instance.running ? 'running' : 'stopped'
      }  ${instance.codexHome}`
    )
  }
}

function printHealthChecks(checks: HealthCheckResult[]): void {
  for (const check of checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.summary}`)
    if (check.detail) {
      console.log(`  ${check.detail}`)
    }
  }
}

export function printDoctorReport(report: DoctorReport, quiet: boolean): void {
  if (quiet) {
    return
  }

  console.log(`Doctor: ${report.ok ? 'ok' : 'issues found'}`)
  console.log(`Checked at: ${report.checkedAt}`)
  printHealthChecks(report.checks)
}

export function printProviderCheck(report: ProviderCheckReport, quiet: boolean): void {
  if (quiet) {
    return
  }

  console.log(`Provider: ${report.providerName ?? report.providerId}`)
  console.log(`Base URL: ${report.baseUrl}`)
  console.log(`Model: ${report.model}`)
  console.log(`Result: ${report.ok ? 'ok' : 'issues found'}`)
  if (report.httpStatus != null) {
    console.log(`HTTP status: ${report.httpStatus}`)
  }
  if (report.latencyMs != null) {
    console.log(`Latency: ${report.latencyMs}ms`)
  }
  printHealthChecks(report.checks)
}

export function printSettings(settings: AppSettings, quiet: boolean): void {
  if (quiet) {
    return
  }

  console.log(`usagePollingMinutes=${settings.usagePollingMinutes}`)
  console.log(`statusBarAccountIds=${settings.statusBarAccountIds.join(',')}`)
  console.log(`language=${settings.language}`)
  console.log(`theme=${settings.theme}`)
  console.log(`checkForUpdatesOnStartup=${settings.checkForUpdatesOnStartup}`)
  console.log(`codexDesktopExecutablePath=${settings.codexDesktopExecutablePath}`)
  console.log(`showLocalMockData=${settings.showLocalMockData !== false}`)
  console.log(`statsDisplay=${serializeStatsDisplaySettings(settings.statsDisplay)}`)
}

export function formatSettingsValue(key: keyof AppSettings, settings: AppSettings): string {
  const value = settings[key]

  if (key === 'statusBarAccountIds' && Array.isArray(value)) {
    return value.join(',')
  }

  if (key === 'showLocalMockData') {
    return String(value !== false)
  }

  if (key === 'statsDisplay') {
    return serializeStatsDisplaySettings(settings.statsDisplay)
  }

  return String(value ?? '')
}
