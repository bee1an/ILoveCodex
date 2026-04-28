import {
  canRunWakeRequest,
  type AccountSummary,
  type AccountWakeSchedule,
  type AppSnapshot,
  type WakeAccountRateLimitsInput,
  type WakeAccountRateLimitsResult
} from '../shared/codex'

export interface WakeSchedulerController {
  start(): void
  stop(): void
  sync(snapshot?: AppSnapshot): void
}

export interface CreateWakeSchedulerControllerOptions {
  getSnapshot(): Promise<AppSnapshot>
  wakeAccount(
    accountId: string,
    input: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRateLimitsResult>
  updateWakeScheduleRuntime(
    accountId: string,
    patch: Partial<AccountWakeSchedule>
  ): Promise<unknown>
  onSnapshotChanged(): Promise<unknown> | unknown
  onWakeError?: (account: AccountSummary, error: unknown) => void
}

interface RetryState {
  retryAt: number
  attempts: number
}

const WAKE_SCHEDULER_RETRY_MS = 5 * 60_000
const WAKE_SCHEDULER_MAX_RETRY_ATTEMPTS = 1

function normalizeTimes(times: string[]): string[] {
  return [
    ...new Set(times.map((value) => value.trim()).filter((value) => /^\d{2}:\d{2}$/.test(value)))
  ].sort()
}

function timeToLocalTimestamp(base: Date, value: string, dayOffset = 0): number {
  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0
  ).getTime()
}

function latestMissedOccurrence(schedule: AccountWakeSchedule, nowMs: number): number | null {
  const times = normalizeTimes(schedule.times)
  if (!times.length) {
    return null
  }

  const base = new Date(nowMs)
  const lastTriggeredAt = schedule.lastTriggeredAt ? Date.parse(schedule.lastTriggeredAt) : -1
  const missed = times
    .map((value) => timeToLocalTimestamp(base, value))
    .filter((timestamp) => timestamp <= nowMs && timestamp > lastTriggeredAt)

  if (!missed.length) {
    return null
  }

  return missed[missed.length - 1] ?? null
}

function nextOccurrence(schedule: AccountWakeSchedule, nowMs: number): number | null {
  const times = normalizeTimes(schedule.times)
  if (!times.length) {
    return null
  }

  const base = new Date(nowMs)
  const nextToday = times
    .map((value) => timeToLocalTimestamp(base, value))
    .find((timestamp) => timestamp > nowMs)

  if (nextToday != null) {
    return nextToday
  }

  return timeToLocalTimestamp(base, times[0] ?? '00:00', 1)
}

function supportsScheduledWake(snapshot: AppSnapshot, accountId: string): boolean {
  const rateLimits = snapshot.usageByAccountId[accountId]
  return Boolean(rateLimits && canRunWakeRequest(rateLimits))
}

export function createWakeSchedulerController(
  options: CreateWakeSchedulerControllerOptions
): WakeSchedulerController {
  let active = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let scheduleToken = 0
  const retryStateByAccountId = new Map<string, RetryState>()

  function clearTimer(): void {
    if (!timer) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  function cleanupRetryState(snapshot: AppSnapshot): void {
    const activeAccountIds = new Set(
      snapshot.accounts
        .filter((account) => {
          const schedule = snapshot.wakeSchedulesByAccountId[account.id]
          return Boolean(
            schedule?.enabled &&
            schedule.times.length &&
            supportsScheduledWake(snapshot, account.id)
          )
        })
        .map((account) => account.id)
    )

    for (const accountId of retryStateByAccountId.keys()) {
      if (!activeAccountIds.has(accountId)) {
        retryStateByAccountId.delete(accountId)
      }
    }
  }

  function accountDueInMs(
    snapshot: AppSnapshot,
    account: AccountSummary,
    now: number
  ): number | null {
    const schedule = snapshot.wakeSchedulesByAccountId[account.id]
    if (
      !schedule?.enabled ||
      !schedule.times.length ||
      !supportsScheduledWake(snapshot, account.id)
    ) {
      return null
    }

    const retryState = retryStateByAccountId.get(account.id)
    if (retryState) {
      return Math.max(0, retryState.retryAt - now)
    }

    const missedOccurrence = latestMissedOccurrence(schedule, now)
    if (missedOccurrence != null) {
      return 0
    }

    const nextAt = nextOccurrence(schedule, now)
    if (nextAt == null) {
      return null
    }

    return Math.max(0, nextAt - now)
  }

  async function schedule(snapshotOverride?: AppSnapshot): Promise<void> {
    if (!active) {
      return
    }

    const token = ++scheduleToken
    const snapshot = snapshotOverride ?? (await options.getSnapshot())
    if (!active || token !== scheduleToken) {
      return
    }

    cleanupRetryState(snapshot)
    clearTimer()

    const nextDelays = snapshot.accounts
      .map((account) => accountDueInMs(snapshot, account, Date.now()))
      .filter((value): value is number => value != null)

    if (!nextDelays.length) {
      return
    }

    const nextDelay = Math.min(...nextDelays)
    timer = setTimeout(() => {
      timer = null
      void poll()
    }, nextDelay)
  }

  async function runScheduledWake(
    account: AccountSummary,
    schedule: AccountWakeSchedule
  ): Promise<void> {
    const triggeredAt = new Date().toISOString()
    await options.updateWakeScheduleRuntime(account.id, {
      lastStatus: 'idle',
      lastMessage: ''
    })

    try {
      const result = await options.wakeAccount(account.id, {
        model: schedule.model,
        prompt: schedule.prompt
      })

      if (!result.requestResult) {
        retryStateByAccountId.delete(account.id)
        await options.updateWakeScheduleRuntime(account.id, {
          lastTriggeredAt: triggeredAt,
          lastStatus: 'skipped',
          lastMessage:
            'Wake skipped because quota is unavailable or another wake request was already running.'
        })
        return
      }

      retryStateByAccountId.delete(account.id)
      await options.updateWakeScheduleRuntime(account.id, {
        lastTriggeredAt: triggeredAt,
        lastStatus: 'success',
        lastSucceededAt: new Date().toISOString(),
        lastMessage: result.requestResult.body?.trim() || `Status ${result.requestResult.status}`
      })
    } catch (error) {
      const currentRetryState = retryStateByAccountId.get(account.id)
      const retryAttempts = (currentRetryState?.attempts ?? 0) + 1
      const shouldRetry = retryAttempts <= WAKE_SCHEDULER_MAX_RETRY_ATTEMPTS

      if (shouldRetry) {
        retryStateByAccountId.set(account.id, {
          retryAt: Date.now() + WAKE_SCHEDULER_RETRY_MS,
          attempts: retryAttempts
        })
      } else {
        retryStateByAccountId.delete(account.id)
      }

      const detail = error instanceof Error ? error.message : String(error)
      await options.updateWakeScheduleRuntime(account.id, {
        ...(shouldRetry ? {} : { lastTriggeredAt: triggeredAt }),
        lastStatus: 'error',
        lastMessage: detail
      })
      options.onWakeError?.(account, error)
    }
  }

  async function poll(): Promise<void> {
    if (!active) {
      return
    }

    if (inFlight) {
      await inFlight
      return
    }

    inFlight = (async () => {
      try {
        const snapshot = await options.getSnapshot()
        cleanupRetryState(snapshot)
        const now = Date.now()
        const dueAccounts = snapshot.accounts
          .map((account) => ({
            account,
            schedule: snapshot.wakeSchedulesByAccountId[account.id],
            dueInMs: accountDueInMs(snapshot, account, now)
          }))
          .filter(
            (
              entry
            ): entry is {
              account: AccountSummary
              schedule: AccountWakeSchedule
              dueInMs: number
            } => Boolean(entry.schedule?.enabled && entry.dueInMs === 0)
          )

        if (!dueAccounts.length) {
          await schedule(snapshot)
          return
        }

        for (const entry of dueAccounts) {
          await runScheduledWake(entry.account, entry.schedule)
        }

        await options.onSnapshotChanged()
      } finally {
        inFlight = null
      }
    })()

    try {
      await inFlight
    } finally {
      if (active && !timer) {
        await schedule()
      }
    }
  }

  return {
    start(): void {
      if (active) {
        return
      }

      active = true
      void poll()
    },
    stop(): void {
      active = false
      scheduleToken += 1
      clearTimer()
    },
    sync(snapshot?: AppSnapshot): void {
      if (!active) {
        return
      }

      void schedule(snapshot)
    }
  }
}
