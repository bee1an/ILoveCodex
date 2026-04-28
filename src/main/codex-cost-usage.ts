import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type {
  CodexInstanceSummary,
  TokenCostDailyEntry,
  TokenCostDetail,
  TokenCostModelBreakdown,
  TokenCostReadOptions,
  TokenCostSummary
} from '../shared/codex'

const DEFAULT_CODEX_INSTANCE_ID = '__default__'
const ALL_TOKEN_COST_INSTANCE_ID = '__all__'
const UNKNOWN_TOKEN_COST_MODEL = 'unknown'
const CACHE_VERSION = 1
const DEFAULT_REFRESH_MIN_INTERVAL_MS = 60_000

type PackedUsage = [input: number, cached: number, output: number]
type DayModelUsage = Record<string, PackedUsage>
type UsageDays = Record<string, DayModelUsage>

interface CodexTotals {
  input: number
  cached: number
  output: number
}

interface CodexSessionMetadata {
  sessionId?: string
  forkedFromId?: string
  forkTimestamp?: string
}

interface CodexTimestampedTotals {
  timestamp: string
  dateMs: number | null
  totals: CodexTotals
}

interface CodexParseResult {
  days: UsageDays
  sessionId?: string
  forkedFromId?: string
}

interface TokenCostCacheFile {
  version: number
  codexHome: string
  generatedAt: string
  detail: TokenCostDetail
}

interface TokenCostScanOptions {
  sinceKey?: string
  untilKey?: string
}

interface TokenCostSnapshotPart {
  tokenCostByInstanceId: Record<string, TokenCostSummary>
  tokenCostErrorByInstanceId: Record<string, string>
  runningTokenCostSummary: TokenCostSummary | null
  runningTokenCostInstanceIds: string[]
}

interface CodexPricing {
  inputCostPerToken: number
  outputCostPerToken: number
  cacheReadInputCostPerToken: number | null
}

interface CostRollup {
  total: number
  hasKnown: boolean
  hasUnknown: boolean
}

interface AggregatedModelBreakdownState {
  modelName: string
  totalTokens: number
  cost: CostRollup
}

interface AggregatedDailyEntryState {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: CostRollup
  modelsUsed: Set<string>
  modelBreakdowns: Map<string, AggregatedModelBreakdownState>
}

const CODEX_PRICING: Record<string, CodexPricing> = {
  'gpt-5': {
    inputCostPerToken: 1.25e-6,
    outputCostPerToken: 1e-5,
    cacheReadInputCostPerToken: 1.25e-7
  },
  'gpt-5-codex': {
    inputCostPerToken: 1.25e-6,
    outputCostPerToken: 1e-5,
    cacheReadInputCostPerToken: 1.25e-7
  },
  'gpt-5-mini': {
    inputCostPerToken: 2.5e-7,
    outputCostPerToken: 2e-6,
    cacheReadInputCostPerToken: 2.5e-8
  },
  'gpt-5-nano': {
    inputCostPerToken: 5e-8,
    outputCostPerToken: 4e-7,
    cacheReadInputCostPerToken: 5e-9
  },
  'gpt-5-pro': {
    inputCostPerToken: 1.5e-5,
    outputCostPerToken: 1.2e-4,
    cacheReadInputCostPerToken: null
  },
  'gpt-5.1': {
    inputCostPerToken: 1.25e-6,
    outputCostPerToken: 1e-5,
    cacheReadInputCostPerToken: 1.25e-7
  },
  'gpt-5.1-codex': {
    inputCostPerToken: 1.25e-6,
    outputCostPerToken: 1e-5,
    cacheReadInputCostPerToken: 1.25e-7
  },
  'gpt-5.1-codex-max': {
    inputCostPerToken: 1.25e-6,
    outputCostPerToken: 1e-5,
    cacheReadInputCostPerToken: 1.25e-7
  },
  'gpt-5.1-codex-mini': {
    inputCostPerToken: 2.5e-7,
    outputCostPerToken: 2e-6,
    cacheReadInputCostPerToken: 2.5e-8
  },
  'gpt-5.2': {
    inputCostPerToken: 1.75e-6,
    outputCostPerToken: 1.4e-5,
    cacheReadInputCostPerToken: 1.75e-7
  },
  'gpt-5.2-codex': {
    inputCostPerToken: 1.75e-6,
    outputCostPerToken: 1.4e-5,
    cacheReadInputCostPerToken: 1.75e-7
  },
  'gpt-5.2-pro': {
    inputCostPerToken: 2.1e-5,
    outputCostPerToken: 1.68e-4,
    cacheReadInputCostPerToken: null
  },
  'gpt-5.3-codex': {
    inputCostPerToken: 1.75e-6,
    outputCostPerToken: 1.4e-5,
    cacheReadInputCostPerToken: 1.75e-7
  },
  'gpt-5.3-codex-spark': {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    cacheReadInputCostPerToken: 0
  },
  'gpt-5.4': {
    inputCostPerToken: 2.5e-6,
    outputCostPerToken: 1.5e-5,
    cacheReadInputCostPerToken: 2.5e-7
  },
  'gpt-5.4-mini': {
    inputCostPerToken: 7.5e-7,
    outputCostPerToken: 4.5e-6,
    cacheReadInputCostPerToken: 7.5e-8
  },
  'gpt-5.4-nano': {
    inputCostPerToken: 2e-7,
    outputCostPerToken: 1.25e-6,
    cacheReadInputCostPerToken: 2e-8
  },
  'gpt-5.4-pro': {
    inputCostPerToken: 3e-5,
    outputCostPerToken: 1.8e-4,
    cacheReadInputCostPerToken: null
  },
  'gpt-5.5': {
    inputCostPerToken: 5e-6,
    outputCostPerToken: 3e-5,
    cacheReadInputCostPerToken: 5e-7
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function intValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  }

  return 0
}

function emptySummary(updatedAt = new Date().toISOString()): TokenCostSummary {
  return {
    sessionTokens: 0,
    sessionCostUSD: null,
    last30DaysTokens: 0,
    last30DaysCostUSD: null,
    updatedAt
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function localDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromLocalDayKey(dayKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) {
    return null
  }

  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day))
}

function dayKeysInRange(sinceKey: string, untilKey: string): string[] {
  const since = dateFromLocalDayKey(sinceKey)
  const until = dateFromLocalDayKey(untilKey)
  if (!since || !until || since.getTime() > until.getTime()) {
    return []
  }

  const keys: string[] = []
  for (let cursor = since; cursor.getTime() <= until.getTime(); cursor = addDays(cursor, 1)) {
    keys.push(localDayKey(cursor))
  }
  return keys
}

function dayKeyParts(dayKey: string): [year: string, month: string, day: string] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) {
    return null
  }

  return [match[1]!, match[2]!, match[3]!]
}

function rangeStartMs(dayKey: string): number | null {
  const date = dateFromLocalDayKey(dayKey)
  return date ? date.getTime() : null
}

function rangeEndMs(dayKey: string): number | null {
  const date = dateFromLocalDayKey(dayKey)
  return date ? addDays(date, 1).getTime() : null
}

function dayKeyFromTimestamp(timestamp: string): string | null {
  const parsedMs = Date.parse(timestamp)
  if (Number.isFinite(parsedMs)) {
    return localDayKey(new Date(parsedMs))
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp)
  return match?.[1] ?? null
}

function normalizeCodexModel(raw: string): string {
  let trimmed = raw.trim()
  if (trimmed.startsWith('openai/')) {
    trimmed = trimmed.slice('openai/'.length)
  }

  if (CODEX_PRICING[trimmed]) {
    return trimmed
  }

  const withoutDatedSuffix = trimmed.replace(/-\d{4}-\d{2}-\d{2}$/, '')
  if (withoutDatedSuffix !== trimmed && CODEX_PRICING[withoutDatedSuffix]) {
    return withoutDatedSuffix
  }

  return trimmed
}

function codexCostUSD(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number | null {
  const pricing = CODEX_PRICING[normalizeCodexModel(model)]
  if (!pricing) {
    return null
  }

  const input = Math.max(0, inputTokens)
  const cached = Math.min(Math.max(0, cachedInputTokens), input)
  const nonCached = Math.max(0, input - cached)
  const cachedRate = pricing.cacheReadInputCostPerToken ?? pricing.inputCostPerToken

  return (
    nonCached * pricing.inputCostPerToken +
    cached * cachedRate +
    Math.max(0, outputTokens) * pricing.outputCostPerToken
  )
}

function addPackedUsage(days: UsageDays, dayKey: string, model: string, usage: PackedUsage): void {
  const normalizedModel = normalizeCodexModel(model)
  const dayModels = days[dayKey] ?? {}
  const current = dayModels[normalizedModel] ?? [0, 0, 0]
  dayModels[normalizedModel] = [current[0] + usage[0], current[1] + usage[1], current[2] + usage[2]]
  days[dayKey] = dayModels
}

function mergeUsageDays(target: UsageDays, source: UsageDays): void {
  for (const [dayKey, models] of Object.entries(source)) {
    for (const [model, packed] of Object.entries(models)) {
      addPackedUsage(target, dayKey, model, packed)
    }
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readJsonlObjects(filePath: string): Promise<Record<string, unknown>[]> {
  let raw = ''
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }
    throw error
  }

  const out: Record<string, unknown>[] = []
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseJsonLine(line)
    if (parsed) {
      out.push(parsed)
    }
  }
  return out
}

function parseSessionMetadataFromObject(obj: Record<string, unknown>): CodexSessionMetadata | null {
  if (obj.type !== 'session_meta') {
    return null
  }

  const payload = isRecord(obj.payload) ? obj.payload : {}
  return {
    sessionId:
      stringValue(payload.session_id) ??
      stringValue(payload.sessionId) ??
      stringValue(payload.id) ??
      stringValue(obj.session_id) ??
      stringValue(obj.sessionId) ??
      stringValue(obj.id),
    forkedFromId:
      stringValue(payload.forked_from_id) ??
      stringValue(payload.forkedFromId) ??
      stringValue(payload.parent_session_id) ??
      stringValue(payload.parentSessionId),
    forkTimestamp: stringValue(payload.timestamp) ?? stringValue(obj.timestamp)
  }
}

async function parseSessionMetadata(filePath: string): Promise<CodexSessionMetadata | null> {
  const objects = await readJsonlObjects(filePath)
  for (const obj of objects) {
    const metadata = parseSessionMetadataFromObject(obj)
    if (metadata) {
      return metadata
    }
  }
  return null
}

function extractTokenUsage(value: unknown): CodexTotals | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    input: intValue(value.input_tokens),
    cached: intValue(value.cached_input_tokens ?? value.cache_read_input_tokens),
    output: intValue(value.output_tokens)
  }
}

function addTotals(left: CodexTotals, right: CodexTotals): CodexTotals {
  return {
    input: left.input + right.input,
    cached: left.cached + right.cached,
    output: left.output + right.output
  }
}

function subtractTotals(left: CodexTotals, right: CodexTotals): CodexTotals {
  return {
    input: Math.max(0, left.input - right.input),
    cached: Math.max(0, left.cached - right.cached),
    output: Math.max(0, left.output - right.output)
  }
}

function zeroTotals(): CodexTotals {
  return { input: 0, cached: 0, output: 0 }
}

async function parseCodexTokenSnapshots(filePath: string): Promise<{
  sessionId?: string
  snapshots: CodexTimestampedTotals[]
}> {
  let sessionId: string | undefined
  let previousTotals: CodexTotals | null = null
  const snapshots: CodexTimestampedTotals[] = []

  const objects = await readJsonlObjects(filePath)
  for (const obj of objects) {
    const metadata = parseSessionMetadataFromObject(obj)
    if (metadata) {
      sessionId ??= metadata.sessionId
      continue
    }

    if (obj.type !== 'event_msg') {
      continue
    }

    const payload = isRecord(obj.payload) ? obj.payload : null
    if (!payload || payload.type !== 'token_count') {
      continue
    }

    const info = isRecord(payload.info) ? payload.info : null
    const timestamp = stringValue(obj.timestamp)
    if (!info || !timestamp) {
      continue
    }

    const total = extractTokenUsage(info.total_token_usage)
    const last = extractTokenUsage(info.last_token_usage)
    let nextTotals: CodexTotals | null = null

    if (total) {
      nextTotals = total
    } else if (last) {
      nextTotals = addTotals(previousTotals ?? zeroTotals(), last)
    }

    if (!nextTotals) {
      continue
    }

    previousTotals = nextTotals
    const dateMs = Date.parse(timestamp)
    snapshots.push({
      timestamp,
      dateMs: Number.isFinite(dateMs) ? dateMs : null,
      totals: nextTotals
    })
  }

  return { sessionId, snapshots }
}

function inheritedTotalsAtOrBefore(
  snapshots: CodexTimestampedTotals[],
  cutoffTimestamp: string
): CodexTotals | null {
  const cutoffMs = Date.parse(cutoffTimestamp)
  const cutoffHasDate = Number.isFinite(cutoffMs)
  let inherited: CodexTotals | null = null

  for (const snapshot of snapshots) {
    const isAtOrBefore =
      cutoffHasDate && snapshot.dateMs !== null && Number.isFinite(snapshot.dateMs)
        ? snapshot.dateMs <= cutoffMs
        : snapshot.timestamp <= cutoffTimestamp
    if (isAtOrBefore) {
      inherited = snapshot.totals
    }
  }

  return inherited
}

async function parseCodexFile(
  filePath: string,
  metadata: CodexSessionMetadata | null,
  inheritedTotalsResolver: (
    sessionId: string,
    cutoffTimestamp: string
  ) => Promise<CodexTotals | null>
): Promise<CodexParseResult> {
  let currentModel: string | undefined
  let previousTotals: CodexTotals | null = null
  let sessionId = metadata?.sessionId
  let forkedFromId = metadata?.forkedFromId
  let inheritedTotals: CodexTotals | null = null
  const days: UsageDays = {}

  async function ensureInheritedTotals(cutoffTimestamp = ''): Promise<void> {
    if (inheritedTotals || !forkedFromId) {
      return
    }

    inheritedTotals = await inheritedTotalsResolver(forkedFromId, cutoffTimestamp)
  }

  await ensureInheritedTotals(metadata?.forkTimestamp ?? '')

  const objects = await readJsonlObjects(filePath)
  for (const obj of objects) {
    const metadataFromLine = parseSessionMetadataFromObject(obj)
    if (metadataFromLine) {
      sessionId ??= metadataFromLine.sessionId
      forkedFromId ??= metadataFromLine.forkedFromId
      await ensureInheritedTotals(metadataFromLine.forkTimestamp ?? '')
      continue
    }

    const timestamp = stringValue(obj.timestamp)
    const dayKey = timestamp ? dayKeyFromTimestamp(timestamp) : null

    if (obj.type === 'turn_context') {
      const payload = isRecord(obj.payload) ? obj.payload : null
      const info = payload && isRecord(payload.info) ? payload.info : null
      currentModel = stringValue(payload?.model) ?? stringValue(info?.model) ?? currentModel
      continue
    }

    if (obj.type !== 'event_msg') {
      continue
    }

    const payload = isRecord(obj.payload) ? obj.payload : null
    if (!payload || payload.type !== 'token_count') {
      continue
    }

    const info = isRecord(payload.info) ? payload.info : null
    if (!info) {
      continue
    }

    const model =
      stringValue(info.model) ??
      stringValue(info.model_name) ??
      stringValue(payload.model) ??
      stringValue(obj.model) ??
      currentModel ??
      UNKNOWN_TOKEN_COST_MODEL
    const total = extractTokenUsage(info.total_token_usage)
    const last = extractTokenUsage(info.last_token_usage)
    let delta = zeroTotals()

    if (total) {
      const currentTotals = inheritedTotals ? subtractTotals(total, inheritedTotals) : total
      delta = subtractTotals(currentTotals, previousTotals ?? zeroTotals())
      previousTotals = currentTotals
    } else if (last) {
      const adjustedDelta = {
        input: Math.max(0, last.input),
        cached: Math.max(0, last.cached),
        output: Math.max(0, last.output)
      }

      delta = adjustedDelta
      previousTotals = addTotals(previousTotals ?? zeroTotals(), delta)
    } else {
      continue
    }

    if (!dayKey || (delta.input === 0 && delta.cached === 0 && delta.output === 0)) {
      continue
    }

    addPackedUsage(days, dayKey, model, [
      delta.input,
      Math.min(delta.cached, delta.input),
      delta.output
    ])
  }

  return { days, sessionId, forkedFromId }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function readDirectoryEntries(
  dir: string,
  allowMissing: boolean
): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (allowMissing && isMissingPathError(error)) {
      return null
    }
    throw error
  }
}

async function listJsonlRecursive(root: string): Promise<string[]> {
  const rootEntries = await readDirectoryEntries(root, true)
  if (!rootEntries) {
    return []
  }

  const out: string[] = []
  async function walk(
    dir: string,
    currentEntries?: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  ): Promise<void> {
    const entries = currentEntries ?? (await readDirectoryEntries(dir, true))
    if (!entries) {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
          return
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
          out.push(entryPath)
        }
      })
    )
  }

  await walk(root, rootEntries)
  return out
}

async function listJsonlFlat(root: string): Promise<string[]> {
  const entries = await readDirectoryEntries(root, true)
  if (!entries) {
    return []
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl'))
    .map((entry) => join(root, entry.name))
}

async function listSessionJsonlInRange(
  codexHome: string,
  sinceKey: string,
  untilKey: string
): Promise<string[]> {
  const files: string[] = []
  for (const dayKey of dayKeysInRange(sinceKey, untilKey)) {
    const parts = dayKeyParts(dayKey)
    if (!parts) {
      continue
    }

    files.push(...(await listJsonlRecursive(join(codexHome, 'sessions', ...parts))))
  }
  return files
}

async function filterFilesByModifiedRange(
  files: string[],
  sinceKey: string,
  untilKey: string
): Promise<string[]> {
  const sinceMs = rangeStartMs(sinceKey)
  const untilMs = rangeEndMs(untilKey)
  if (sinceMs == null || untilMs == null) {
    return files
  }

  const filtered: string[] = []
  await Promise.all(
    files.map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath)
        if (stats.mtimeMs >= sinceMs && stats.mtimeMs < untilMs) {
          filtered.push(filePath)
        }
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error
        }
      }
    })
  )
  return filtered
}

async function listCodexLogFiles(
  codexHome: string,
  options: TokenCostScanOptions = {}
): Promise<string[]> {
  const hasRange = Boolean(options.sinceKey && options.untilKey)
  const sessionsRoot = join(codexHome, 'sessions')
  const sessionCandidates = hasRange
    ? [
        ...(await listSessionJsonlInRange(codexHome, options.sinceKey!, options.untilKey!)),
        ...(await filterFilesByModifiedRange(
          await listJsonlRecursive(sessionsRoot),
          options.sinceKey!,
          options.untilKey!
        ))
      ]
    : await listJsonlRecursive(sessionsRoot)
  const sessions = [...new Set(sessionCandidates)].sort((left, right) => left.localeCompare(right))
  const archivedCandidates = await listJsonlFlat(join(codexHome, 'archived_sessions'))
  const archived = (
    hasRange
      ? await filterFilesByModifiedRange(archivedCandidates, options.sinceKey!, options.untilKey!)
      : archivedCandidates
  ).sort((left, right) => left.localeCompare(right))
  return [...new Set([...sessions, ...archived])]
}

async function buildSessionFileMap(codexHome: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const filePath of await listCodexLogFiles(codexHome)) {
    const metadata = await parseSessionMetadata(filePath)
    if (metadata?.sessionId && !out.has(metadata.sessionId)) {
      out.set(metadata.sessionId, filePath)
    }
  }
  return out
}

async function fileIdentity(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    return `${stats.dev}:${stats.ino}`
  } catch {
    return null
  }
}

function sortedModelBreakdowns(breakdowns: TokenCostModelBreakdown[]): TokenCostModelBreakdown[] {
  return breakdowns.sort((left, right) => {
    const leftCost = left.costUSD ?? -1
    const rightCost = right.costUSD ?? -1
    if (leftCost !== rightCost) {
      return rightCost - leftCost
    }

    if (left.totalTokens !== right.totalTokens) {
      return right.totalTokens - left.totalTokens
    }

    return right.modelName.localeCompare(left.modelName)
  })
}

function buildDailyEntries(
  days: UsageDays,
  sinceKey: string,
  untilKey: string
): TokenCostDailyEntry[] {
  const entries: TokenCostDailyEntry[] = []
  const dayKeys = Object.keys(days)
    .filter((dayKey) => dayKey >= sinceKey && dayKey <= untilKey)
    .sort()

  for (const dayKey of dayKeys) {
    const models = days[dayKey] ?? {}
    const modelNames = Object.keys(models).sort()
    let inputTokens = 0
    let outputTokens = 0
    const dayCost = createCostRollup()
    const modelBreakdowns: TokenCostModelBreakdown[] = []

    for (const model of modelNames) {
      const [input, cached, output] = models[model] ?? [0, 0, 0]
      const totalTokens = input + output
      const costUSD = codexCostUSD(model, input, cached, output)
      inputTokens += input
      outputTokens += output
      addCostToRollup(dayCost, costUSD, totalTokens)
      modelBreakdowns.push({ modelName: model, totalTokens, costUSD })
    }

    entries.push({
      date: dayKey,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUSD: finalizeCostRollup(dayCost),
      modelsUsed: modelNames,
      modelBreakdowns: sortedModelBreakdowns(modelBreakdowns)
    })
  }

  return entries
}

function buildSummary(
  daily: TokenCostDailyEntry[],
  todayKey: string,
  updatedAt: string
): TokenCostSummary {
  const today = daily.find((entry) => entry.date === todayKey)
  let last30DaysTokens = 0
  const last30DaysCost = createCostRollup()

  for (const entry of daily) {
    last30DaysTokens += entry.totalTokens
    addCostToRollup(last30DaysCost, entry.costUSD, entry.totalTokens)
  }

  return {
    sessionTokens: today?.totalTokens ?? 0,
    sessionCostUSD: today?.costUSD ?? null,
    last30DaysTokens,
    last30DaysCostUSD: finalizeCostRollup(last30DaysCost),
    updatedAt
  }
}

async function scanCodexTokenCost(
  instanceId: string,
  codexHome: string,
  now = new Date(),
  options: TokenCostScanOptions = {}
): Promise<TokenCostDetail> {
  const todayKey = localDayKey(now)
  const sinceKey = options.sinceKey ?? localDayKey(addDays(now, -29))
  const untilKey = options.untilKey ?? todayKey
  const allDays: UsageDays = {}
  const files = await listCodexLogFiles(codexHome, options)
  const metadataByPath = new Map<string, CodexSessionMetadata | null>()
  const fileBySessionId = new Map<string, string>()
  let allFilesBySessionIdPromise: Promise<Map<string, string>> | null = null

  for (const filePath of files) {
    const metadata = await parseSessionMetadata(filePath)
    metadataByPath.set(filePath, metadata)
    if (metadata?.sessionId && !fileBySessionId.has(metadata.sessionId)) {
      fileBySessionId.set(metadata.sessionId, filePath)
    }
  }

  const snapshotCache = new Map<string, Promise<CodexTimestampedTotals[]>>()
  const inheritedResolver = async (
    sessionId: string,
    cutoffTimestamp: string
  ): Promise<CodexTotals | null> => {
    let parentFile = fileBySessionId.get(sessionId)
    if (!parentFile) {
      allFilesBySessionIdPromise ??= buildSessionFileMap(codexHome)
      parentFile = (await allFilesBySessionIdPromise).get(sessionId)
    }
    if (!parentFile || !cutoffTimestamp) {
      return null
    }

    if (!snapshotCache.has(sessionId)) {
      snapshotCache.set(
        sessionId,
        parseCodexTokenSnapshots(parentFile).then((result) => result.snapshots)
      )
    }

    return inheritedTotalsAtOrBefore(await snapshotCache.get(sessionId)!, cutoffTimestamp)
  }

  const seenSessionIds = new Set<string>()
  const seenFileIds = new Set<string>()

  for (const filePath of files) {
    const identity = await fileIdentity(filePath)
    if (identity && seenFileIds.has(identity)) {
      continue
    }

    const parsed = await parseCodexFile(
      filePath,
      metadataByPath.get(filePath) ?? null,
      inheritedResolver
    )
    if (parsed.sessionId) {
      if (seenSessionIds.has(parsed.sessionId)) {
        continue
      }
      seenSessionIds.add(parsed.sessionId)
    }
    if (identity) {
      seenFileIds.add(identity)
    }

    mergeUsageDays(allDays, parsed.days)
  }

  const updatedAt = now.toISOString()
  const daily = buildDailyEntries(allDays, sinceKey, untilKey)
  return {
    instanceId,
    codexHome,
    source: 'local',
    summary: buildSummary(daily, todayKey, updatedAt),
    daily
  }
}

function costCachePath(
  userDataPath: string,
  codexHome: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalized = codexHomeDedupKey(codexHome, platform)
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return join(userDataPath, 'cost-usage', hash, 'codex-v1.json')
}

async function readCachedDetailFile(
  userDataPath: string,
  codexHome: string,
  platform: NodeJS.Platform = process.platform
): Promise<TokenCostCacheFile | null> {
  const cachePath = costCachePath(userDataPath, codexHome, platform)
  try {
    const raw = await fs.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as TokenCostCacheFile
    if (
      parsed.version !== CACHE_VERSION ||
      codexHomeDedupKey(parsed.codexHome, platform) !== codexHomeDedupKey(codexHome, platform) ||
      !parsed.detail ||
      !parsed.generatedAt
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function isRecentCache(cache: TokenCostCacheFile, maxAgeMs: number, nowMs: number): boolean {
  const generatedAtMs = Date.parse(cache.generatedAt)
  return Number.isFinite(generatedAtMs) && nowMs - generatedAtMs <= maxAgeMs
}

function withInstanceDetailIdentity(
  detail: TokenCostDetail,
  instanceId: string,
  codexHome: string
): TokenCostDetail {
  return {
    ...detail,
    instanceId,
    codexHome
  }
}

function mergeTokenCostDetailRange(options: {
  cachedDetail: TokenCostDetail
  scannedDetail: TokenCostDetail
  replaceSinceKey: string
  replaceUntilKey: string
  instanceId: string
  codexHome: string
  now: Date
}): TokenCostDetail {
  const {
    cachedDetail,
    scannedDetail,
    replaceSinceKey,
    replaceUntilKey,
    instanceId,
    codexHome,
    now
  } = options
  const todayKey = localDayKey(now)
  const windowSinceKey = localDayKey(addDays(now, -29))
  const windowUntilKey = todayKey
  const kept = cachedDetail.daily.filter(
    (entry) =>
      entry.date >= windowSinceKey &&
      entry.date <= windowUntilKey &&
      (entry.date < replaceSinceKey || entry.date > replaceUntilKey)
  )
  const incoming = scannedDetail.daily.filter(
    (entry) => entry.date >= windowSinceKey && entry.date <= windowUntilKey
  )
  const daily = [...kept, ...incoming].sort((left, right) => left.date.localeCompare(right.date))
  const updatedAt = scannedDetail.summary.updatedAt

  return {
    instanceId,
    codexHome,
    source: 'local',
    summary: buildSummary(daily, todayKey, updatedAt),
    daily
  }
}

async function writeCachedDetail(
  userDataPath: string,
  codexHome: string,
  detail: TokenCostDetail,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const cachePath = costCachePath(userDataPath, codexHome, platform)
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const payload: TokenCostCacheFile = {
    version: CACHE_VERSION,
    codexHome,
    generatedAt: detail.summary.updatedAt,
    detail
  }
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function selectAllInstances(instances: CodexInstanceSummary[]): CodexInstanceSummary[] {
  return [...instances]
}

function selectRequestedInstances(
  instances: CodexInstanceSummary[],
  input: TokenCostReadOptions
): CodexInstanceSummary[] {
  if (input.instanceId) {
    return instances.filter((instance) => instance.id === input.instanceId)
  }

  if (input.running) {
    return instances.filter((instance) => instance.running)
  }

  return selectAllInstances(instances)
}

function codexHomeDedupKey(
  codexHome: string,
  platform: NodeJS.Platform = process.platform
): string {
  const resolved = resolve(codexHome)
  return platform === 'darwin' || platform === 'win32' ? resolved.toLowerCase() : resolved
}

function uniqueInstancesByCodexHome(
  instances: CodexInstanceSummary[],
  platform: NodeJS.Platform = process.platform
): Array<{
  instance: CodexInstanceSummary
  duplicates: CodexInstanceSummary[]
}> {
  const byCodexHome = new Map<
    string,
    {
      instance: CodexInstanceSummary
      duplicates: CodexInstanceSummary[]
    }
  >()

  for (const instance of instances) {
    const key = codexHomeDedupKey(instance.codexHome, platform)
    const current = byCodexHome.get(key)
    if (current) {
      current.duplicates.push(instance)
      continue
    }

    byCodexHome.set(key, {
      instance,
      duplicates: [instance]
    })
  }

  return [...byCodexHome.values()]
}

function createCostRollup(): CostRollup {
  return {
    total: 0,
    hasKnown: false,
    hasUnknown: false
  }
}

function addCostToRollup(rollup: CostRollup, costUSD: number | null, totalTokens: number): void {
  if (costUSD === null) {
    if (totalTokens > 0) {
      rollup.hasUnknown = true
    }
    return
  }

  rollup.total += costUSD
  rollup.hasKnown = true
}

function finalizeCostRollup(rollup: CostRollup): number | null {
  if (rollup.hasUnknown) {
    return null
  }

  if (!rollup.hasKnown) {
    return null
  }

  return rollup.total
}

function tokenCostReadWarning(instance: CodexInstanceSummary, error: unknown): string {
  const message = error instanceof Error ? error.message : 'Failed to read token/cost usage.'
  const label = instance.isDefault ? 'default' : instance.id
  return `Failed to read ${label} (${instance.codexHome}): ${message}`
}

function aggregateTokenCostDetails(
  details: TokenCostDetail[],
  instanceId: string,
  codexHome: string,
  now = new Date()
): TokenCostDetail {
  if (!details.length) {
    return {
      instanceId,
      codexHome,
      source: 'local',
      summary: emptySummary(now.toISOString()),
      daily: []
    }
  }

  const days = new Map<string, AggregatedDailyEntryState>()

  for (const detail of details) {
    for (const entry of detail.daily) {
      const current = days.get(entry.date) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: createCostRollup(),
        modelsUsed: new Set<string>(),
        modelBreakdowns: new Map<string, AggregatedModelBreakdownState>()
      }
      current.inputTokens += entry.inputTokens
      current.outputTokens += entry.outputTokens
      current.totalTokens += entry.totalTokens
      addCostToRollup(current.cost, entry.costUSD, entry.totalTokens)
      for (const model of entry.modelsUsed) {
        current.modelsUsed.add(model)
      }
      for (const breakdown of entry.modelBreakdowns) {
        const existing = current.modelBreakdowns.get(breakdown.modelName)
        current.modelBreakdowns.set(breakdown.modelName, {
          modelName: breakdown.modelName,
          totalTokens: (existing?.totalTokens ?? 0) + breakdown.totalTokens,
          cost: (() => {
            const cost = existing?.cost ?? createCostRollup()
            addCostToRollup(cost, breakdown.costUSD, breakdown.totalTokens)
            return cost
          })()
        })
      }
      days.set(entry.date, current)
    }
  }

  const daily = [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entry]) => ({
      date,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.totalTokens,
      costUSD: finalizeCostRollup(entry.cost),
      modelsUsed: [...entry.modelsUsed].sort(),
      modelBreakdowns: sortedModelBreakdowns(
        [...entry.modelBreakdowns.values()].map((breakdown) => ({
          modelName: breakdown.modelName,
          totalTokens: breakdown.totalTokens,
          costUSD: finalizeCostRollup(breakdown.cost)
        }))
      )
    }))

  const todayKey = localDayKey(now)
  const updatedAt =
    details
      .map((detail) => detail.summary.updatedAt)
      .sort()
      .at(-1) ?? now.toISOString()

  return {
    instanceId,
    codexHome,
    source: 'local',
    summary: buildSummary(daily, todayKey, updatedAt),
    daily
  }
}

export class CodexCostUsageService {
  constructor(
    private readonly options: {
      userDataPath: string
      listInstances: () => Promise<CodexInstanceSummary[]>
      platform?: NodeJS.Platform
      refreshMinIntervalMs?: number
      now?: () => Date
    }
  ) {}

  async read(input: TokenCostReadOptions = {}): Promise<TokenCostDetail> {
    const instances = await this.options.listInstances()
    const selected = uniqueInstancesByCodexHome(
      selectRequestedInstances(instances, input),
      this.options.platform
    ).map((entry) => entry.instance)

    if (input.instanceId && selected.length === 0) {
      throw new Error(`Codex instance not found: ${input.instanceId}`)
    }

    const results = await Promise.allSettled(
      selected.map((instance) => this.readInstanceDetail(instance, Boolean(input.refresh)))
    )
    const details = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    const firstError = results.find((result) => result.status === 'rejected')
    const warnings = results.flatMap((result, index) =>
      result.status === 'rejected' ? [tokenCostReadWarning(selected[index]!, result.reason)] : []
    )

    if (selected.length > 0 && details.length === 0 && firstError?.status === 'rejected') {
      throw firstError.reason instanceof Error
        ? firstError.reason
        : new Error('Failed to read token/cost usage.')
    }

    const detail =
      input.instanceId && selected.length === 1 && details.length === 1
        ? withInstanceDetailIdentity(details[0]!, selected[0]!.id, selected[0]!.codexHome)
        : aggregateTokenCostDetails(
            details,
            ALL_TOKEN_COST_INSTANCE_ID,
            details.map((detail) => detail.codexHome).join(','),
            this.now()
          )

    return warnings.length
      ? {
          ...detail,
          warnings
        }
      : detail
  }

  async readSnapshotSummaries(instances: CodexInstanceSummary[]): Promise<TokenCostSnapshotPart> {
    const tokenCostByInstanceId: Record<string, TokenCostSummary> = {}
    const tokenCostErrorByInstanceId: Record<string, string> = {}
    const detailByInstanceId = new Map<string, TokenCostDetail>()
    const uniqueInstances = uniqueInstancesByCodexHome(instances, this.options.platform)

    await Promise.all(
      uniqueInstances.map(async ({ instance, duplicates }) => {
        try {
          const detail = await this.readInstanceDetail(instance, false)
          for (const duplicate of duplicates) {
            tokenCostByInstanceId[duplicate.id] = detail.summary
            detailByInstanceId.set(duplicate.id, detail)
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to read token/cost usage.'
          for (const duplicate of duplicates) {
            tokenCostErrorByInstanceId[duplicate.id] = message
          }
        }
      })
    )

    const allInstances = selectAllInstances(instances)
    const runningDetails = uniqueInstances
      .map(({ instance }) => detailByInstanceId.get(instance.id))
      .filter((detail): detail is TokenCostDetail => Boolean(detail))
    const runningAggregate = runningDetails.length
      ? aggregateTokenCostDetails(
          runningDetails,
          ALL_TOKEN_COST_INSTANCE_ID,
          uniqueInstances.map(({ instance }) => instance.codexHome).join(','),
          this.now()
        )
      : null

    return {
      tokenCostByInstanceId,
      tokenCostErrorByInstanceId,
      runningTokenCostSummary: runningAggregate?.summary ?? null,
      runningTokenCostInstanceIds: allInstances.map((instance) => instance.id)
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private async readInstanceDetail(
    instance: CodexInstanceSummary,
    refresh: boolean
  ): Promise<TokenCostDetail> {
    const now = this.now()
    const todayKey = localDayKey(now)
    const refreshMinIntervalMs =
      this.options.refreshMinIntervalMs ?? DEFAULT_REFRESH_MIN_INTERVAL_MS
    const cached = await readCachedDetailFile(
      this.options.userDataPath,
      instance.codexHome,
      this.options.platform
    )

    if (!refresh && cached && isRecentCache(cached, refreshMinIntervalMs, now.getTime())) {
      return withInstanceDetailIdentity(cached.detail, instance.id, instance.codexHome)
    }

    if (!refresh && cached) {
      const replaceSinceKey = todayKey
      const scannedDetail = await scanCodexTokenCost(instance.id, instance.codexHome, now, {
        sinceKey: replaceSinceKey,
        untilKey: todayKey
      })
      const merged = mergeTokenCostDetailRange({
        cachedDetail: cached.detail,
        scannedDetail,
        replaceSinceKey,
        replaceUntilKey: todayKey,
        instanceId: instance.id,
        codexHome: instance.codexHome,
        now
      })
      await writeCachedDetail(
        this.options.userDataPath,
        instance.codexHome,
        merged,
        this.options.platform
      )
      return merged
    }

    const detail = await scanCodexTokenCost(instance.id, instance.codexHome, now)
    await writeCachedDetail(
      this.options.userDataPath,
      instance.codexHome,
      detail,
      this.options.platform
    )
    return detail
  }
}

export function createCodexCostUsageService(options: {
  userDataPath: string
  listInstances: () => Promise<CodexInstanceSummary[]>
  platform?: NodeJS.Platform
  refreshMinIntervalMs?: number
  now?: () => Date
}): CodexCostUsageService {
  return new CodexCostUsageService(options)
}

export {
  DEFAULT_CODEX_INSTANCE_ID,
  ALL_TOKEN_COST_INSTANCE_ID,
  aggregateTokenCostDetails,
  codexCostUSD,
  normalizeCodexModel,
  scanCodexTokenCost
}
