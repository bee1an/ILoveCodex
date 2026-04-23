import type {
  AccountRateLimits,
  AccountSummary,
  CodexInstanceSummary,
  CreditsSnapshot,
  TokenCostSummary
} from '../../../shared/codex'

export interface InstanceConsumptionEntry {
  instanceId: string
  label: string
  sessionTokens: number
  sessionCostUSD: number | null
  last30DaysTokens: number
  last30DaysCostUSD: number | null
  updatedAt: string
  isRunning: boolean
}

export interface AccountUsageEntry {
  accountId: string
  label: string
  sessionUsedPercent: number | null
  weeklyUsedPercent: number | null
  credits: CreditsSnapshot | null
  fetchedAt: string
}

function timestampScore(value?: string): number {
  if (!value) {
    return -1
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

function accountUsageSortValue(rateLimits: AccountRateLimits): number {
  return Math.max(rateLimits.primary?.usedPercent ?? -1, rateLimits.secondary?.usedPercent ?? -1)
}

export function buildInstanceConsumptionEntries(input: {
  tokenCostByInstanceId: Record<string, TokenCostSummary>
  instances: CodexInstanceSummary[]
  runningInstanceIds: string[]
  resolveLabel: (instanceId: string, instance?: CodexInstanceSummary) => string
}): InstanceConsumptionEntry[] {
  const instancesById = new Map(input.instances.map((instance) => [instance.id, instance]))
  const runningIds = new Set(input.runningInstanceIds)

  return Object.entries(input.tokenCostByInstanceId)
    .map(([instanceId, summary]) => {
      const instance = instancesById.get(instanceId)
      return {
        instanceId,
        label: input.resolveLabel(instanceId, instance),
        sessionTokens: summary.sessionTokens,
        sessionCostUSD: summary.sessionCostUSD,
        last30DaysTokens: summary.last30DaysTokens,
        last30DaysCostUSD: summary.last30DaysCostUSD,
        updatedAt: summary.updatedAt,
        isRunning: runningIds.has(instanceId)
      }
    })
    .filter(
      (entry) =>
        entry.last30DaysTokens > 0 || entry.sessionTokens > 0 || entry.last30DaysCostUSD !== null
    )
    .sort((left, right) => {
      if (left.last30DaysTokens !== right.last30DaysTokens) {
        return right.last30DaysTokens - left.last30DaysTokens
      }
      return timestampScore(right.updatedAt) - timestampScore(left.updatedAt)
    })
}

export function buildAccountUsageEntries(input: {
  accounts: AccountSummary[]
  usageByAccountId: Record<string, AccountRateLimits>
  resolveLabel: (account: AccountSummary) => string
}): AccountUsageEntry[] {
  return input.accounts
    .map((account) => {
      const rateLimits = input.usageByAccountId[account.id]
      if (!rateLimits) {
        return null
      }

      const hasUsage =
        rateLimits.primary != null || rateLimits.secondary != null || rateLimits.credits != null
      if (!hasUsage) {
        return null
      }

      return {
        accountId: account.id,
        label: input.resolveLabel(account),
        sessionUsedPercent: rateLimits.primary?.usedPercent ?? null,
        weeklyUsedPercent: rateLimits.secondary?.usedPercent ?? null,
        credits: rateLimits.credits,
        fetchedAt: rateLimits.fetchedAt
      }
    })
    .filter((entry): entry is AccountUsageEntry => Boolean(entry))
    .sort((left, right) => {
      const leftRateLimits = input.usageByAccountId[left.accountId]
      const rightRateLimits = input.usageByAccountId[right.accountId]
      const leftScore = leftRateLimits ? accountUsageSortValue(leftRateLimits) : -1
      const rightScore = rightRateLimits ? accountUsageSortValue(rightRateLimits) : -1
      if (leftScore !== rightScore) {
        return rightScore - leftScore
      }
      return timestampScore(right.fetchedAt) - timestampScore(left.fetchedAt)
    })
}
