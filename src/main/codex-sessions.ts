import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type {
  CodexInstanceSummary,
  CodexSessionDetail,
  CodexSessionMessage,
  CodexSessionMessageRole,
  CodexSessionProjectsResult,
  CodexSessionProjectSummary,
  CodexSessionStatus,
  CodexSessionSummary,
  CodexSessionsResult,
  CopyCodexSessionToProviderInput,
  CopyCodexSessionToProviderResult,
  CustomProviderSummary,
  ListCodexSessionProjectsInput,
  ListCodexSessionsInput,
  ReadCodexSessionDetailInput
} from '../shared/codex'

type DirectoryEntry = {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

type SessionIndexEntry = {
  filePath: string
  status: CodexSessionStatus
  metadata: Record<string, unknown>
  updatedAt: string
}

type SessionImportTarget = {
  providerId?: string
  providerName?: string
  modelProvider: string
  model: string
}

const DEFAULT_SESSION_MODEL = '5.4'
const CUSTOM_SOURCE_LABEL = '__codexdock_custom_source__'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function normalizeMessageText(value: string): string {
  let text = value.trim()

  let previous = ''
  while (text && text !== previous) {
    previous = text
    text = text
      .replace(/^<memory_context>[\s\S]*?<\/memory_context>\s*/u, '')
      .replace(/^# AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>\s*/u, '')
      .trim()

    if (text.startsWith('<environment_context')) {
      return ''
    }
  }

  return text
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((item) => {
      if (!isRecord(item)) {
        return ''
      }

      if (typeof item.text === 'string') {
        const text = item.text.trim()
        return text === '<image>' || text === '</image>' || text === '<image></image>'
          ? ''
          : item.text
      }

      const imageUrl =
        typeof item.image_url === 'string'
          ? item.image_url
          : isRecord(item.image_url) && typeof item.image_url.url === 'string'
            ? item.image_url.url
            : ''

      return imageUrl.trim() ? `<image>${imageUrl.trim()}</image>` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function sourceLabel(source: unknown): string | undefined {
  if (typeof source === 'string') {
    return source.trim() || undefined
  }

  if (isRecord(source) && isRecord(source.subagent)) {
    const other = stringValue(source.subagent.other)
    if (other) {
      return `subagent: ${other}`
    }
  }

  return isRecord(source) ? CUSTOM_SOURCE_LABEL : undefined
}

async function readDirectoryEntries(
  dir: string,
  allowMissing: boolean
): Promise<DirectoryEntry[] | null> {
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
  async function walk(dir: string, entries?: DirectoryEntry[]): Promise<void> {
    const currentEntries = entries ?? (await readDirectoryEntries(dir, false))
    if (!currentEntries) {
      return
    }

    await Promise.all(
      currentEntries.map(async (entry) => {
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
  const raw = await fs.readFile(filePath, 'utf8')
  return raw
    .split(/\r?\n/)
    .map(parseJsonLine)
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

async function readSessionMetadata(filePath: string): Promise<Record<string, unknown>> {
  const handle = await fs.open(filePath, 'r')
  try {
    // Codex writes session_meta at the start of JSONL session files; read only the leading chunk
    // during index scans to avoid loading large transcripts before the user opens details.
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)

    for (const line of lines) {
      const parsed = parseJsonLine(line)
      if (parsed?.type === 'session_meta') {
        return isRecord(parsed.payload) ? parsed.payload : {}
      }
    }

    return {}
  } finally {
    await handle.close()
  }
}

function metadataPayload(objects: Record<string, unknown>[]): Record<string, unknown> {
  const meta = objects.find((item) => item.type === 'session_meta')
  return isRecord(meta?.payload) ? meta.payload : {}
}

function messageRole(value: unknown): CodexSessionMessageRole {
  switch (value) {
    case 'user':
    case 'assistant':
    case 'system':
    case 'developer':
    case 'tool':
      return value
    default:
      return 'other'
  }
}

function parseSessionMessages(objects: Record<string, unknown>[]): CodexSessionMessage[] {
  const out: CodexSessionMessage[] = []

  for (const [index, obj] of objects.entries()) {
    if (obj.type !== 'response_item' || !isRecord(obj.payload)) {
      continue
    }

    if (obj.payload.type && obj.payload.type !== 'message') {
      continue
    }

    const text = normalizeMessageText(textFromContent(obj.payload.content))
    if (!text) {
      continue
    }

    out.push({
      id: stringValue(obj.payload.id) ?? `${index}`,
      role: messageRole(obj.payload.role),
      text,
      createdAt: stringValue(obj.timestamp)
    })
  }

  if (out.length) {
    return out
  }

  for (const [index, obj] of objects.entries()) {
    const payload = isRecord(obj.payload) ? obj.payload : {}
    if (
      obj.type === 'event_msg' &&
      payload.type === 'user_message' &&
      typeof payload.message === 'string'
    ) {
      const text = normalizeMessageText(payload.message)
      if (!text) {
        continue
      }

      out.push({
        id: `${index}`,
        role: 'user',
        text,
        createdAt: stringValue(obj.timestamp)
      })
    }
  }

  return out
}

function firstUserPreview(objects: Record<string, unknown>[]): string {
  for (const obj of objects) {
    const payload = isRecord(obj.payload) ? obj.payload : {}

    if (
      obj.type === 'event_msg' &&
      payload.type === 'user_message' &&
      typeof payload.message === 'string'
    ) {
      const text = normalizeMessageText(payload.message)
      if (text) {
        return text
      }
    }

    if (obj.type === 'response_item' && isRecord(obj.payload) && obj.payload.role === 'user') {
      const text = normalizeMessageText(textFromContent(obj.payload.content))
      if (text) {
        return text
      }
    }
  }

  return ''
}

function previewText(value: string): string {
  return value
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/giu, ' [图片] ')
    .replace(/<image\b[^>]*\/?>/giu, ' [图片] ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function titleFromMessages(messages: CodexSessionMessage[], fallback: string): string {
  const text = messages.find((message) => message.role === 'user')?.text ?? fallback
  return previewText(text)
}

function lastMessageFromMessages(messages: CodexSessionMessage[], fallback: string): string {
  return previewText(messages.at(-1)?.text ?? fallback)
}

function fallbackSessionId(filePath: string): string {
  return basename(filePath).replace(/\.jsonl$/i, '')
}

function projectName(projectPath?: string): string | undefined {
  return projectPath ? basename(projectPath) || projectPath : undefined
}

function rawModelProvider(metadata: Record<string, unknown>): string {
  return (
    stringValue(metadata.model_provider) ??
    stringValue(metadata.modelProvider) ??
    stringValue(metadata.provider) ??
    'unknown'
  )
}

function importMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return isRecord(metadata.codexdock_import) ? metadata.codexdock_import : {}
}

function modelProvider(metadata: Record<string, unknown>): string {
  const imported = importMetadata(metadata)
  const targetProviderId = stringValue(imported.targetProviderId)
  if (targetProviderId) {
    return `custom:${targetProviderId}`
  }

  return rawModelProvider(metadata)
}

function modelProviderLabel(metadata: Record<string, unknown>): string | undefined {
  const imported = importMetadata(metadata)
  return stringValue(imported.targetProviderName) ?? stringValue(imported.targetProviderId)
}

async function readSessionFile(
  instance: CodexInstanceSummary,
  filePath: string,
  status: CodexSessionStatus
): Promise<CodexSessionSummary> {
  const [stats, objects] = await Promise.all([fs.stat(filePath), readJsonlObjects(filePath)])
  const metadata = metadataPayload(objects)
  const git = isRecord(metadata.git) ? metadata.git : {}
  const projectPath = stringValue(metadata.cwd)
  const instanceName = instance.isDefault ? 'Default' : instance.name || instance.id
  const preview = firstUserPreview(objects)
  const messages = parseSessionMessages(objects)
  const title = titleFromMessages(messages, preview)
  const lastMessage = lastMessageFromMessages(messages, preview)

  return {
    id:
      stringValue(metadata.session_id) ??
      stringValue(metadata.sessionId) ??
      stringValue(metadata.id) ??
      fallbackSessionId(filePath),
    instanceId: instance.id,
    instanceName,
    codexHome: instance.codexHome,
    filePath,
    modelProvider: modelProvider(metadata),
    modelProviderLabel: modelProviderLabel(metadata),
    projectPath,
    projectName: projectName(projectPath),
    gitBranch: stringValue(git.branch),
    sourceLabel: sourceLabel(metadata.source),
    originator: stringValue(metadata.originator),
    createdAt: stringValue(metadata.timestamp),
    updatedAt: stats.mtime.toISOString(),
    status,
    title,
    lastMessage,
    preview: title
  }
}

async function scanInstanceSessionIndex(
  instance: CodexInstanceSummary
): Promise<SessionIndexEntry[]> {
  const activeFiles = await listJsonlRecursive(join(instance.codexHome, 'sessions'))
  const archivedFiles = await listJsonlFlat(join(instance.codexHome, 'archived_sessions'))

  const files = [
    ...activeFiles.map((filePath) => ({ filePath, status: 'active' as const })),
    ...archivedFiles.map((filePath) => ({ filePath, status: 'archived' as const }))
  ]

  return Promise.all(
    files.map(async (file) => {
      const [stats, metadata] = await Promise.all([
        fs.stat(file.filePath),
        readSessionMetadata(file.filePath)
      ])

      return {
        ...file,
        metadata,
        updatedAt: stats.mtime.toISOString()
      }
    })
  )
}

function matchesIndexInput(entry: SessionIndexEntry, input?: ListCodexSessionsInput): boolean {
  if (!input) {
    return true
  }

  if (input.status && entry.status !== input.status) {
    return false
  }

  const projectPath = stringValue(entry.metadata.cwd) ?? ''
  if (input.modelProvider && modelProvider(entry.metadata) !== input.modelProvider) {
    return false
  }

  if (input.projectPath !== undefined && projectPath !== input.projectPath) {
    return false
  }

  const projectQuery = input.projectQuery?.trim().toLowerCase()
  if (projectQuery) {
    const projectText = [
      modelProvider(entry.metadata),
      modelProviderLabel(entry.metadata),
      projectPath,
      projectName(projectPath)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!projectText.includes(projectQuery)) {
      return false
    }
  }

  return true
}

export async function listCodexSessions(
  instances: CodexInstanceSummary[],
  input?: ListCodexSessionsInput
): Promise<CodexSessionsResult> {
  const sessions: CodexSessionSummary[] = []
  const errorsByInstanceId: Record<string, string> = {}

  await Promise.all(
    instances.map(async (instance) => {
      if (input?.instanceId && instance.id !== input.instanceId) {
        return
      }

      try {
        const index = await scanInstanceSessionIndex(instance)
        const filtered = index
          .filter((entry) => matchesIndexInput(entry, input))
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        const offset = Math.max(0, input?.offset ?? 0)
        const limit = input?.limit && input.limit > 0 ? input.limit : undefined
        const page = limit ? filtered.slice(offset, offset + limit) : filtered.slice(offset)

        sessions.push(
          ...(await Promise.all(
            page.map((entry) => readSessionFile(instance, entry.filePath, entry.status))
          ))
        )
      } catch (error) {
        errorsByInstanceId[instance.id] =
          error instanceof Error ? error.message : 'Failed to scan Codex sessions.'
      }
    })
  )

  return {
    sessions: sessions.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ),
    errorsByInstanceId,
    scannedAt: new Date().toISOString()
  }
}

function projectKey(instanceId: string, provider: string, projectPath?: string): string {
  return `${instanceId}:${provider}:${projectPath || '__unknown_project__'}`
}

function matchesProjectInput(
  project: CodexSessionProjectSummary,
  input?: ListCodexSessionProjectsInput
): boolean {
  if (!input) {
    return true
  }

  if (input.instanceId && project.instanceId !== input.instanceId) {
    return false
  }

  const projectQuery = input.projectQuery?.trim().toLowerCase()
  if (projectQuery) {
    const projectText = [
      project.modelProvider,
      project.modelProviderLabel,
      project.projectPath,
      project.projectName
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!projectText.includes(projectQuery)) {
      return false
    }
  }

  return true
}

export async function listCodexSessionProjects(
  instances: CodexInstanceSummary[],
  input?: ListCodexSessionProjectsInput
): Promise<CodexSessionProjectsResult> {
  const projectsByKey = new Map<string, CodexSessionProjectSummary>()
  const errorsByInstanceId: Record<string, string> = {}

  await Promise.all(
    instances.map(async (instance) => {
      if (input?.instanceId && instance.id !== input.instanceId) {
        return
      }

      try {
        const instanceName = instance.isDefault ? 'Default' : instance.name || instance.id
        const index = await scanInstanceSessionIndex(instance)
        for (const entry of index) {
          const projectPath = stringValue(entry.metadata.cwd)
          const provider = modelProvider(entry.metadata)
          const providerLabel = modelProviderLabel(entry.metadata)
          const key = projectKey(instance.id, provider, projectPath)
          const existing = projectsByKey.get(key)
          if (existing) {
            existing.sessionCount += 1
            existing.activeCount += entry.status === 'active' ? 1 : 0
            existing.archivedCount += entry.status === 'archived' ? 1 : 0
            if (Date.parse(entry.updatedAt) > Date.parse(existing.latestAt)) {
              existing.latestAt = entry.updatedAt
            }
            continue
          }

          projectsByKey.set(key, {
            key,
            instanceId: instance.id,
            instanceName,
            codexHome: instance.codexHome,
            modelProvider: provider,
            modelProviderLabel: providerLabel,
            projectPath,
            projectName: projectName(projectPath),
            sessionCount: 1,
            activeCount: entry.status === 'active' ? 1 : 0,
            archivedCount: entry.status === 'archived' ? 1 : 0,
            latestAt: entry.updatedAt
          })
        }
      } catch (error) {
        errorsByInstanceId[instance.id] =
          error instanceof Error ? error.message : 'Failed to scan Codex session projects.'
      }
    })
  )

  return {
    projects: Array.from(projectsByKey.values())
      .filter((project) => matchesProjectInput(project, input))
      .sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt)),
    errorsByInstanceId,
    scannedAt: new Date().toISOString()
  }
}

function isPathInside(parent: string, child: string): boolean {
  const diff = relative(resolve(parent), resolve(child))
  return Boolean(diff) && !diff.startsWith('..') && !isAbsolute(diff)
}

function statusForFile(instance: CodexInstanceSummary, filePath: string): CodexSessionStatus {
  return isPathInside(join(instance.codexHome, 'archived_sessions'), filePath)
    ? 'archived'
    : 'active'
}

function sessionImportDatePath(value?: string): string {
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date()
  return [
    `${date.getFullYear()}`,
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0')
  ].join('/')
}

async function uniqueImportedSessionPath(
  targetCodexHome: string,
  sourceFilePath: string,
  createdAt?: string
): Promise<string> {
  const targetDir = join(targetCodexHome, 'sessions', 'imported', sessionImportDatePath(createdAt))
  const baseName = basename(sourceFilePath).replace(/\.jsonl$/i, '')
  let index = 0

  await fs.mkdir(targetDir, { recursive: true })

  while (true) {
    const suffix = index === 0 ? '' : `-${index + 1}`
    const candidate = join(targetDir, `${baseName}.imported${suffix}.jsonl`)
    try {
      await fs.access(candidate)
      index += 1
    } catch {
      return candidate
    }
  }
}

function collectSessionModels(objects: Record<string, unknown>[]): string[] {
  const models = new Set<string>()

  for (const obj of objects) {
    const payload = isRecord(obj.payload) ? obj.payload : {}
    const model = stringValue(payload.model)
    if (model) {
      models.add(model)
    }
  }

  return Array.from(models)
}

function firstSessionModel(
  objects: Record<string, unknown>[],
  metadata: Record<string, unknown>
): string {
  return stringValue(metadata.model) ?? collectSessionModels(objects)[0] ?? DEFAULT_SESSION_MODEL
}

function copyTargetFromInput(
  objects: Record<string, unknown>[],
  input: CopyCodexSessionToProviderInput,
  targetProvider?: CustomProviderSummary
): SessionImportTarget {
  if (targetProvider) {
    return {
      providerId: targetProvider.id,
      providerName: targetProvider.name,
      modelProvider: 'custom',
      model: targetProvider.model?.trim() || DEFAULT_SESSION_MODEL
    }
  }

  const targetModelProvider = input.targetModelProvider?.trim()
  if (!targetModelProvider) {
    throw new Error('Target provider not found.')
  }

  const metadata = metadataPayload(objects)
  return {
    providerName: input.targetModelProviderLabel?.trim() || undefined,
    modelProvider: targetModelProvider,
    model: firstSessionModel(objects, metadata)
  }
}

function patchSessionForProviderImport(
  objects: Record<string, unknown>[],
  sourceInstance: CodexInstanceSummary,
  sourceFilePath: string,
  targetInstance: CodexInstanceSummary,
  target: SessionImportTarget
): Record<string, unknown>[] {
  const importedAt = new Date().toISOString()
  const sourceMeta = metadataPayload(objects)
  const importMeta = {
    importedAt,
    sourceInstanceId: sourceInstance.id,
    sourceInstanceName: sourceInstance.isDefault
      ? 'Default'
      : sourceInstance.name || sourceInstance.id,
    sourceCodexHome: sourceInstance.codexHome,
    sourceFilePath,
    sourceModelProvider: rawModelProvider(sourceMeta),
    sourceModels: collectSessionModels(objects),
    targetInstanceId: targetInstance.id,
    targetInstanceName: targetInstance.name || targetInstance.id,
    targetCodexHome: targetInstance.codexHome,
    targetProviderId: target.providerId,
    targetProviderName: target.providerName,
    targetModelProvider: target.modelProvider,
    targetModel: target.model
  }

  return objects.map((obj) => {
    if (!isRecord(obj.payload)) {
      return obj
    }

    if (obj.type === 'session_meta') {
      return {
        ...obj,
        payload: {
          ...obj.payload,
          model_provider: target.modelProvider,
          model: target.model,
          codexdock_import: importMeta
        }
      }
    }

    if (obj.type === 'turn_context') {
      return {
        ...obj,
        payload: {
          ...obj.payload,
          model_provider: target.modelProvider,
          model: target.model
        }
      }
    }

    return obj
  })
}

export async function copyCodexSessionToProvider(
  instances: CodexInstanceSummary[],
  input: CopyCodexSessionToProviderInput,
  targetInstance: CodexInstanceSummary,
  targetProvider?: CustomProviderSummary
): Promise<CopyCodexSessionToProviderResult> {
  const sourceInstance = instances.find((item) => item.id === input.sourceInstanceId)
  if (!sourceInstance) {
    throw new Error('Source instance not found.')
  }

  if (!isPathInside(sourceInstance.codexHome, input.sourceFilePath)) {
    throw new Error('Session file does not belong to the source instance.')
  }

  const objects = await readJsonlObjects(input.sourceFilePath)
  const metadata = metadataPayload(objects)
  const target = copyTargetFromInput(objects, input, targetProvider)
  const targetFilePath = await uniqueImportedSessionPath(
    targetInstance.codexHome,
    input.sourceFilePath,
    stringValue(metadata.timestamp)
  )
  const patchedObjects = patchSessionForProviderImport(
    objects,
    sourceInstance,
    input.sourceFilePath,
    targetInstance,
    target
  )

  await fs.mkdir(dirname(targetFilePath), { recursive: true })
  await fs.writeFile(
    targetFilePath,
    `${patchedObjects.map((obj) => JSON.stringify(obj)).join('\n')}\n`,
    'utf8'
  )

  return {
    targetInstanceId: targetInstance.id,
    targetInstanceName: targetInstance.name || targetInstance.id,
    targetCodexHome: targetInstance.codexHome,
    targetFilePath,
    targetModelProvider: target.modelProvider,
    targetModel: target.model,
    session: await readSessionFile(targetInstance, targetFilePath, 'active')
  }
}

export async function readCodexSessionDetail(
  instances: CodexInstanceSummary[],
  input: ReadCodexSessionDetailInput
): Promise<CodexSessionDetail> {
  const instance = instances.find((item) => item.id === input.instanceId)
  if (!instance) {
    throw new Error('Instance not found.')
  }

  if (!isPathInside(instance.codexHome, input.filePath)) {
    throw new Error('Session file does not belong to the selected instance.')
  }

  const objects = await readJsonlObjects(input.filePath)
  return {
    session: await readSessionFile(
      instance,
      input.filePath,
      statusForFile(instance, input.filePath)
    ),
    messages: parseSessionMessages(objects)
  }
}
