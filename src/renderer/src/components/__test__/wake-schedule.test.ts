import { describe, expect, it } from 'vitest'

import {
  formatWakeScheduleLastTriggeredAt,
  isValidWakeScheduleTime,
  nextWakeScheduleLabel,
  normalizeWakeScheduleTime,
  normalizeWakeScheduleTimes,
  wakeScheduleSummary
} from '../wake-schedule'

describe('wake schedule helpers', () => {
  it('去重并排序时间列表', () => {
    expect(normalizeWakeScheduleTimes(['14:00', '9:00', '09:00', ''])).toEqual(['09:00', '14:00'])
  })

  it('规范化并校验 HH:mm 时间格式', () => {
    expect(normalizeWakeScheduleTime('6:30')).toBe('06:30')
    expect(isValidWakeScheduleTime('09:30')).toBe(true)
    expect(isValidWakeScheduleTime('9:30')).toBe(true)
    expect(isValidWakeScheduleTime('24:01')).toBe(false)
  })

  it('格式化时间摘要和下次触发时间', () => {
    const schedule = {
      enabled: true,
      times: ['09:00', '14:00']
    }

    expect(wakeScheduleSummary(schedule, '未设置')).toBe('09:00 · 14:00')
    expect(
      nextWakeScheduleLabel(schedule, 'zh-CN', '未设置', new Date(2026, 3, 21, 8, 0, 0, 0))
    ).toContain('09:00')
    expect(
      nextWakeScheduleLabel(schedule, 'zh-CN', '未设置', new Date(2026, 3, 21, 20, 0, 0, 0))
    ).not.toBe('未设置')
  })

  it('格式化上次触发时间', () => {
    expect(
      formatWakeScheduleLastTriggeredAt('2026-04-21T01:02:03.000Z', 'en', 'Not set')
    ).toContain('2026')
    expect(formatWakeScheduleLastTriggeredAt(undefined, 'zh-CN', '未设置')).toBe('未设置')
  })
})
