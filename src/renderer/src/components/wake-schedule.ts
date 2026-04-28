import type { AccountWakeSchedule, AppLanguage } from '../../../shared/codex'

export function normalizeWakeScheduleTime(value: string): string {
  const trimmed = value.trim()
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed)
  if (!match) {
    return trimmed
  }

  const hours = Number(match[1])
  if (hours < 0 || hours > 23) {
    return trimmed
  }

  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

export function normalizeWakeScheduleTimes(values: string[]): string[] {
  return [...new Set(values.map(normalizeWakeScheduleTime).filter(Boolean))].sort()
}

export function isValidWakeScheduleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalizeWakeScheduleTime(value))
}

export function wakeScheduleSummary(
  schedule: Pick<AccountWakeSchedule, 'times'> | null | undefined,
  emptyLabel: string
): string {
  if (!schedule?.times.length) {
    return emptyLabel
  }

  return [...schedule.times].sort().join(' · ')
}

function resolveNextWakeScheduleAt(
  schedule: Pick<AccountWakeSchedule, 'enabled' | 'times'> | null | undefined,
  now = new Date()
): Date | null {
  if (!schedule?.enabled || !schedule.times.length) {
    return null
  }

  const times = [...schedule.times].sort()
  const nextToday = times
    .map((value) => {
      const [hours, minutes] = value.split(':').map(Number)
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
    })
    .find((value) => value.getTime() > now.getTime())

  if (nextToday) {
    return nextToday
  }

  const [hours, minutes] = (times[0] ?? '00:00').split(':').map(Number)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, minutes, 0, 0)
}

export function nextWakeScheduleLabel(
  schedule: Pick<AccountWakeSchedule, 'enabled' | 'times'> | null | undefined,
  language: AppLanguage,
  emptyLabel: string,
  now = new Date()
): string {
  const nextAt = resolveNextWakeScheduleAt(schedule, now)
  if (!nextAt) {
    return emptyLabel
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(nextAt)
}

export function formatWakeScheduleLastTriggeredAt(
  lastTriggeredAt: string | undefined,
  language: AppLanguage,
  emptyLabel: string
): string {
  if (!lastTriggeredAt) {
    return emptyLabel
  }

  return new Date(lastTriggeredAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
    hour12: false
  })
}
