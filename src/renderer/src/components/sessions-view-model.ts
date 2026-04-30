import type {
  CodexInstanceSummary,
  CodexSessionMessageRole,
  CodexSessionProjectSummary,
  CodexSessionStatus,
  CodexSessionSummary,
  CustomProviderSummary
} from '../../../shared/codex'
import type { LocalizedCopy } from './app-view'

export type MessagePart =
  | {
      type: 'text'
      value: string
    }
  | {
      type: 'image'
      value: string
    }

export type ProviderProjectGroup = {
  key: string
  instanceId: string
  modelProvider: string
  modelProviderLabel?: string
  projects: CodexSessionProjectSummary[]
  sessionCount: number
  projectCount: number
  latestAt: string
}

export type CopyTargetProviderOption = {
  value: string
  label: string
  targetProviderId?: string
  targetModelProvider: string
  targetModelProviderLabel?: string
}

export type SessionStatusFilter = 'all' | CodexSessionStatus

export type SessionProviderContext = {
  projects: CodexSessionProjectSummary[]
  allKnownInstances: CodexInstanceSummary[]
  providers: CustomProviderSummary[]
  statusFilter: SessionStatusFilter
  unknownProviderLabel: string
}

const defaultSessionModel = '5.4'

type SessionRoleCopy = Pick<
  LocalizedCopy,
  | 'sessionsRoleUser'
  | 'sessionsRoleAssistant'
  | 'sessionsRoleSystem'
  | 'sessionsRoleDeveloper'
  | 'sessionsRoleTool'
  | 'sessionsRoleOther'
>

type SessionSourceCopy = Pick<LocalizedCopy, 'sessionsSourceCustom'>

export const customSourceLabel = '__codexdock_custom_source__'

export const shortSessionId = (id: string): string => (id.length > 12 ? id.slice(0, 12) : id)

export function formatSessionDateTime(value: string | undefined, language: 'zh-CN' | 'en'): string {
  if (!value) {
    return '--'
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return value
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(parsed))
}

export const instanceLabel = (instance: CodexInstanceSummary): string =>
  instance.isDefault ? 'Default' : instance.name || instance.id

export function roleLabel(role: CodexSessionMessageRole, copy: SessionRoleCopy): string {
  switch (role) {
    case 'user':
      return copy.sessionsRoleUser
    case 'assistant':
      return copy.sessionsRoleAssistant
    case 'system':
      return copy.sessionsRoleSystem
    case 'developer':
      return copy.sessionsRoleDeveloper
    case 'tool':
      return copy.sessionsRoleTool
    default:
      return copy.sessionsRoleOther
  }
}

export function roleIconClass(role: CodexSessionMessageRole): string {
  switch (role) {
    case 'user':
      return 'i-lucide-user-round'
    case 'assistant':
      return 'i-lucide-bot'
    case 'system':
      return 'i-lucide-settings-2'
    case 'developer':
      return 'i-lucide-code-2'
    case 'tool':
      return 'i-lucide-wrench'
    default:
      return 'i-lucide-message-circle'
  }
}

export const isAuxiliaryRole = (role: CodexSessionMessageRole): boolean =>
  role === 'system' || role === 'developer' || role === 'tool'

export function imageSource(value: string): string {
  const source = value.trim()
  if (!source) {
    return ''
  }

  if (/^(data:image\/|https?:\/\/|file:\/\/|blob:)/iu.test(source)) {
    return source
  }

  if (source.startsWith('/')) {
    return `file://${encodeURI(source)}`
  }

  return ''
}

export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  const imageTagPattern = /<image\b[^>]*>([\s\S]*?)<\/image>/giu
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = imageTagPattern.exec(text))) {
    const before = text.slice(lastIndex, match.index)
    if (before.trim()) {
      parts.push({ type: 'text', value: before })
    }

    const source = imageSource(match[1] ?? '')
    if (source) {
      parts.push({ type: 'image', value: source })
    }

    lastIndex = match.index + match[0].length
  }

  const rest = text.slice(lastIndex).replace(/<image\b[^>]*\/?>/giu, '')
  if (rest.trim()) {
    parts.push({ type: 'text', value: rest })
  }

  return parts
}

export const sourceLabelText = (
  sourceLabel: string | undefined,
  copy: SessionSourceCopy
): string => (sourceLabel === customSourceLabel ? copy.sessionsSourceCustom : sourceLabel || '')

export const sourceText = (session: CodexSessionSummary, copy: SessionSourceCopy): string =>
  [sourceLabelText(session.sourceLabel, copy), session.originator].filter(Boolean).join(' · ') ||
  '--'

export const searchTextForSession = (session: CodexSessionSummary): string =>
  [
    session.title,
    session.lastMessage,
    session.modelProvider,
    session.modelProviderLabel,
    session.projectPath,
    session.projectName,
    session.gitBranch,
    session.id
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export function projectSessionCount(
  project: CodexSessionProjectSummary,
  statusFilter: SessionStatusFilter
): number {
  if (statusFilter === 'active') {
    return project.activeCount
  }
  if (statusFilter === 'archived') {
    return project.archivedCount
  }
  return project.sessionCount
}

export function projectGroupsForInstance(
  instanceId: string,
  currentProjects: CodexSessionProjectSummary[],
  currentSearchByInstanceId: Record<string, string>,
  currentSessionsByProjectKey: Record<string, CodexSessionSummary[]>,
  statusFilter: SessionStatusFilter
): CodexSessionProjectSummary[] {
  const query = (currentSearchByInstanceId[instanceId] ?? '').trim().toLowerCase()

  return currentProjects.filter((project) => {
    if (project.instanceId !== instanceId || projectSessionCount(project, statusFilter) === 0) {
      return false
    }

    if (!query) {
      return true
    }

    const projectText = [
      project.modelProvider,
      project.modelProviderLabel,
      project.projectPath,
      project.projectName
    ]
      .filter(Boolean)
      .join(' ')
    const loadedSessionText = (currentSessionsByProjectKey[project.key] ?? [])
      .map(searchTextForSession)
      .join(' ')

    return `${projectText} ${loadedSessionText}`.toLowerCase().includes(query)
  })
}

export function providerKey(instanceId: string, provider: string): string {
  return `${instanceId}:${provider}`
}

export function customProviderLabel(provider: CustomProviderSummary): string {
  return provider.name?.trim() || provider.baseUrl || provider.id
}

export function providerOptionLabel(provider: CustomProviderSummary): string {
  return `${customProviderLabel(provider)} (${provider.model || defaultSessionModel})`
}

export function normalizedProviderIdentity(value?: string): string {
  return (value ?? '').trim().replace(/\/+$/u, '').toLowerCase()
}

export function providerIdFromModelProvider(modelProvider: string): string {
  return modelProvider.startsWith('custom:') ? modelProvider.slice('custom:'.length) : ''
}

export function providerIdFromIdentity(
  value: string | undefined,
  providers: CustomProviderSummary[]
): string {
  const identity = normalizedProviderIdentity(value)
  if (!identity) {
    return ''
  }

  return (
    providers.find((provider) => {
      return (
        normalizedProviderIdentity(provider.id) === identity ||
        normalizedProviderIdentity(provider.name) === identity ||
        normalizedProviderIdentity(provider.baseUrl) === identity
      )
    })?.id ?? ''
  )
}

export function isProviderInstance(instance: CodexInstanceSummary, providerId: string): boolean {
  return instance.codexHome.replace(/\\/gu, '/').endsWith(`/provider-${providerId}`)
}

function pushProviderId(ids: string[], providerId?: string): void {
  if (providerId && !ids.includes(providerId)) {
    ids.push(providerId)
  }
}

export function knownProviderIds(ids: string[], providers: CustomProviderSummary[]): string[] {
  const knownIds = providers.map((provider) => provider.id)
  return ids.filter((providerId) => knownIds.includes(providerId))
}

export function baseProviderIdsForInstance(
  instanceId: string,
  allKnownInstances: CodexInstanceSummary[],
  providers: CustomProviderSummary[]
): string[] {
  const ids: string[] = []
  const instance = allKnownInstances.find((item) => item.id === instanceId)
  if (instance) {
    for (const providerId of instance.providerIds ?? []) {
      pushProviderId(ids, providerId)
    }

    for (const provider of providers) {
      if (isProviderInstance(instance, provider.id)) {
        pushProviderId(ids, provider.id)
      }
    }
  }

  return knownProviderIds(ids, providers)
}

export function providerIdFromScopedModelProvider(
  instanceId: string,
  modelProvider: string,
  modelProviderLabel: string | undefined,
  context: Pick<SessionProviderContext, 'allKnownInstances' | 'providers'>
): string {
  const directProviderId = providerIdFromModelProvider(modelProvider)
  if (directProviderId) {
    return directProviderId
  }

  const labeledProviderId =
    providerIdFromIdentity(modelProviderLabel, context.providers) ||
    providerIdFromIdentity(modelProvider, context.providers)
  if (labeledProviderId) {
    return labeledProviderId
  }

  if (modelProvider === 'custom') {
    const scopedProviderIds = baseProviderIdsForInstance(
      instanceId,
      context.allKnownInstances,
      context.providers
    )
    if (scopedProviderIds.length === 1) {
      return scopedProviderIds[0] ?? ''
    }
  }

  return ''
}

export function providerIdFromSession(
  session: CodexSessionSummary,
  context: Pick<SessionProviderContext, 'allKnownInstances' | 'providers'>
): string {
  return providerIdFromScopedModelProvider(
    session.instanceId,
    session.modelProvider,
    session.modelProviderLabel,
    context
  )
}

export function providerLabel(
  provider: string,
  label: string | undefined,
  context: Pick<SessionProviderContext, 'providers' | 'unknownProviderLabel'>
): string {
  if (label?.trim()) {
    return label.trim()
  }

  if (provider === 'unknown') {
    return context.unknownProviderLabel
  }

  const customProviderId = providerIdFromModelProvider(provider)
  if (customProviderId) {
    const customProvider = context.providers.find((item) => item.id === customProviderId)
    return customProvider ? customProviderLabel(customProvider) : customProviderId
  }

  return provider
}

export function copyProviderOptionForCustomProvider(
  provider: CustomProviderSummary
): CopyTargetProviderOption {
  return {
    value: `provider:${provider.id}`,
    label: providerOptionLabel(provider),
    targetProviderId: provider.id,
    targetModelProvider: 'custom',
    targetModelProviderLabel: customProviderLabel(provider)
  }
}

export function copyProviderOptionForModelProvider(
  modelProvider: string,
  modelProviderLabel: string | undefined,
  context: Pick<SessionProviderContext, 'providers' | 'unknownProviderLabel'>
): CopyTargetProviderOption {
  const label = providerLabel(modelProvider, modelProviderLabel, context)
  return {
    value: `model:${modelProvider}:${modelProviderLabel ?? ''}`,
    label,
    targetModelProvider: modelProvider,
    targetModelProviderLabel: modelProviderLabel
  }
}

export function copyProviderOptionFromSession(
  session: CodexSessionSummary,
  context: Pick<SessionProviderContext, 'allKnownInstances' | 'providers' | 'unknownProviderLabel'>
): CopyTargetProviderOption {
  const providerId = providerIdFromSession(session, context)
  const provider = providerId ? context.providers.find((item) => item.id === providerId) : undefined
  return provider
    ? copyProviderOptionForCustomProvider(provider)
    : copyProviderOptionForModelProvider(session.modelProvider, session.modelProviderLabel, context)
}

export function copyTargetProviderOptionsForInstance(
  instanceId: string,
  sourceSession: CodexSessionSummary | null | undefined,
  context: SessionProviderContext
): CopyTargetProviderOption[] {
  const options: CopyTargetProviderOption[] = []
  const addOption = (option: CopyTargetProviderOption): void => {
    if (
      option.targetModelProvider === 'unknown' ||
      options.some((item) => item.value === option.value)
    ) {
      return
    }

    options.push(option)
  }

  for (const project of context.projects) {
    if (
      project.instanceId !== instanceId ||
      projectSessionCount(project, context.statusFilter) === 0
    ) {
      continue
    }

    const providerId = project.modelProvider.startsWith('custom')
      ? providerIdFromScopedModelProvider(
          project.instanceId,
          project.modelProvider,
          project.modelProviderLabel,
          context
        )
      : ''
    const provider = providerId
      ? context.providers.find((item) => item.id === providerId)
      : undefined

    addOption(
      provider
        ? copyProviderOptionForCustomProvider(provider)
        : copyProviderOptionForModelProvider(
            project.modelProvider,
            project.modelProviderLabel,
            context
          )
    )
  }

  for (const providerId of baseProviderIdsForInstance(
    instanceId,
    context.allKnownInstances,
    context.providers
  )) {
    const provider = context.providers.find((item) => item.id === providerId)
    if (provider) {
      addOption(copyProviderOptionForCustomProvider(provider))
    }
  }

  if (sourceSession && instanceId === sourceSession.instanceId) {
    const sourceOption = copyProviderOptionFromSession(sourceSession, context)
    return options.filter((option) => option.value !== sourceOption.value)
  }

  return options
}

export function preferredCopyTargetProviderOptions(
  instanceId: string,
  session: CodexSessionSummary,
  context: SessionProviderContext
): CopyTargetProviderOption[] {
  return copyTargetProviderOptionsForInstance(instanceId, session, context)
}

export function defaultCopyInstanceId(
  session: CodexSessionSummary,
  allKnownInstances: CodexInstanceSummary[],
  context: SessionProviderContext
): string {
  return (
    allKnownInstances.find(
      (instance) => copyTargetProviderOptionsForInstance(instance.id, session, context).length
    )?.id ?? ''
  )
}

export function defaultCopyProviderId(
  session: CodexSessionSummary,
  instanceId: string,
  context: SessionProviderContext
): string {
  return preferredCopyTargetProviderOptions(instanceId, session, context)[0]?.value ?? ''
}

export function providerGroupsForProjects(
  currentProjects: CodexSessionProjectSummary[],
  context: SessionProviderContext
): ProviderProjectGroup[] {
  const groups: ProviderProjectGroup[] = []

  for (const project of currentProjects) {
    const resolvedProviderId = providerIdFromScopedModelProvider(
      project.instanceId,
      project.modelProvider,
      project.modelProviderLabel,
      context
    )
    const resolvedProvider = context.providers.find(
      (provider) => provider.id === resolvedProviderId
    )
    const groupModelProvider = resolvedProviderId
      ? `custom:${resolvedProviderId}`
      : project.modelProvider
    const groupModelProviderLabel = resolvedProvider
      ? customProviderLabel(resolvedProvider)
      : project.modelProviderLabel
    const key = providerKey(project.instanceId, groupModelProvider)
    const sessionCount = projectSessionCount(project, context.statusFilter)
    const existing = groups.find((group) => group.key === key)
    if (existing) {
      existing.projects.push(project)
      existing.sessionCount += sessionCount
      existing.projectCount += 1
      if (Date.parse(project.latestAt) > Date.parse(existing.latestAt)) {
        existing.latestAt = project.latestAt
      }
      continue
    }

    groups.push({
      key,
      instanceId: project.instanceId,
      modelProvider: groupModelProvider,
      modelProviderLabel: groupModelProviderLabel,
      projects: [project],
      sessionCount,
      projectCount: 1,
      latestAt: project.latestAt
    })
  }

  return groups.sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt))
}

export function projectTitle(
  project: CodexSessionProjectSummary,
  unknownProjectLabel: string
): string {
  return project.projectName || project.projectPath || unknownProjectLabel
}

export function projectSubtitle(
  project: CodexSessionProjectSummary,
  unknownProjectLabel: string
): string {
  if (!project.projectPath) {
    return unknownProjectLabel
  }
  return project.projectName && project.projectName !== project.projectPath
    ? project.projectPath
    : ''
}

export function isProjectExpanded(
  project: CodexSessionProjectSummary,
  currentExpandedByProjectKey: Record<string, boolean>
): boolean {
  return currentExpandedByProjectKey[project.key] ?? false
}
