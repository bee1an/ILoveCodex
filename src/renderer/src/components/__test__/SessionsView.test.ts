// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type {
  CodexInstanceSummary,
  CodexSessionDetail,
  CodexSessionProjectsResult,
  CodexSessionsResult,
  CopyCodexSessionToProviderInput,
  CopyCodexSessionToProviderResult,
  CustomProviderSummary,
  ListCodexSessionsInput
} from '../../../../shared/codex'
import { messages } from '../app-view'
import SessionsView from '../SessionsView.svelte'

const copy = messages['zh-CN']

beforeAll(() => {
  if (!Element.prototype.animate) {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({
        cancel: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        finished: Promise.resolve()
      }))
    })
  }

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return (this.textContent ?? '').length > 300 ? 240 : 40
    }
  })
})

const instances: CodexInstanceSummary[] = [
  {
    id: '__default__',
    name: '',
    codexHome: '/Users/bee/.codex',
    extraArgs: '',
    isDefault: true,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    running: false,
    initialized: true
  },
  {
    id: 'provider-1',
    name: 'Provider jaycode',
    codexHome: '/tmp/codex-instance-homes/provider-provider-target',
    extraArgs: '',
    isDefault: false,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    running: false,
    initialized: true
  }
]

const providers: CustomProviderSummary[] = [
  {
    id: 'provider-target',
    name: 'Target Provider',
    baseUrl: 'https://target.example.com',
    model: 'gpt-5.4-mini',
    fastMode: true,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z'
  }
]

const sessionResult: CodexSessionsResult = {
  scannedAt: '2026-04-22T12:00:00.000Z',
  errorsByInstanceId: {},
  sessions: [
    {
      id: 'session-default',
      instanceId: '__default__',
      instanceName: 'Default',
      codexHome: '/Users/bee/.codex',
      filePath: '/Users/bee/.codex/sessions/default.jsonl',
      modelProvider: 'openai',
      projectPath: '/repo/default',
      projectName: 'default',
      gitBranch: 'main',
      sourceLabel: 'vscode',
      originator: 'Codex Desktop',
      createdAt: '2026-04-22T08:00:00.000Z',
      updatedAt: '2026-04-22T09:00:00.000Z',
      status: 'active',
      title: '默认实例任务',
      lastMessage: '默认实例最后一句',
      preview: '默认实例任务'
    },
    {
      id: 'session-provider',
      instanceId: 'provider-1',
      instanceName: 'Provider jaycode',
      codexHome: '/tmp/codex-instance-homes/provider-provider-target',
      filePath: '/tmp/codex-instance-homes/provider-provider-target/sessions/provider.jsonl',
      modelProvider: 'custom',
      projectPath: '/repo/provider',
      projectName: 'provider',
      sourceLabel: 'subagent: guardian',
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T11:00:00.000Z',
      status: 'archived',
      title: 'Provider 任务',
      lastMessage: 'Provider 最后一句',
      preview: 'Provider 任务'
    }
  ]
}

const sessionProjectsResult: CodexSessionProjectsResult = {
  scannedAt: sessionResult.scannedAt,
  errorsByInstanceId: {},
  projects: [
    {
      key: '__default__:openai:/repo/default',
      instanceId: '__default__',
      instanceName: 'Default',
      codexHome: '/Users/bee/.codex',
      modelProvider: 'openai',
      projectPath: '/repo/default',
      projectName: 'default',
      sessionCount: 1,
      activeCount: 1,
      archivedCount: 0,
      latestAt: '2026-04-22T09:00:00.000Z'
    },
    {
      key: 'provider-1:custom:/repo/provider',
      instanceId: 'provider-1',
      instanceName: 'Provider jaycode',
      codexHome: '/tmp/provider',
      modelProvider: 'custom',
      projectPath: '/repo/provider',
      projectName: 'provider',
      sessionCount: 1,
      activeCount: 0,
      archivedCount: 1,
      latestAt: '2026-04-22T11:00:00.000Z'
    }
  ]
}

const sessionDetail: CodexSessionDetail = {
  session: sessionResult.sessions[0]!,
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: '默认实例任务',
      createdAt: '2026-04-22T08:00:00.000Z'
    },
    {
      id: 'm2',
      role: 'assistant',
      text: `助手回复内容\n<image>data:image/png;base64,abc</image>\n${Array.from({ length: 18 }, (_, index) => `这是第 ${index + 1} 行较长的会话详情内容，用来验证消息默认折叠展示。`).join('\n')}`,
      createdAt: '2026-04-22T08:01:00.000Z'
    }
  ]
}

function renderSessionsView(
  overrides: Partial<{
    listCodexSessionProjects: () => Promise<CodexSessionProjectsResult>
    listCodexSessions: (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult>
    readCodexSessionDetail: () => Promise<CodexSessionDetail>
    copyCodexSessionToProvider: (
      input: CopyCodexSessionToProviderInput
    ) => Promise<CopyCodexSessionToProviderResult>
    instances: CodexInstanceSummary[]
    providers: CustomProviderSummary[]
  }> = {}
): ReturnType<typeof render> {
  return render(SessionsView, {
    props: {
      copy,
      language: 'zh-CN',
      instances,
      providers,
      compactGhostButton: 'ghost',
      listCodexSessionProjects: vi.fn().mockResolvedValue(sessionProjectsResult),
      listCodexSessions: mockListSessions(sessionResult),
      readCodexSessionDetail: vi.fn().mockResolvedValue(sessionDetail),
      copyCodexSessionToProvider: vi.fn().mockResolvedValue({
        targetInstanceId: 'provider-target-instance',
        targetInstanceName: 'Provider Target Provider',
        targetCodexHome: '/tmp/target',
        targetFilePath: '/tmp/target/sessions/imported/default.imported.jsonl',
        targetModelProvider: 'custom',
        targetModel: 'gpt-5.4-mini',
        session: sessionResult.sessions[0]!
      }),
      ...overrides
    }
  })
}

function mockListSessions(
  result: CodexSessionsResult
): (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult> {
  return vi.fn(async (input?: ListCodexSessionsInput) => {
    const filtered = result.sessions.filter((session) => {
      if (input?.instanceId && session.instanceId !== input.instanceId) {
        return false
      }
      if (input?.status && session.status !== input.status) {
        return false
      }
      if (input?.modelProvider && session.modelProvider !== input.modelProvider) {
        return false
      }
      if (input?.projectPath !== undefined && (session.projectPath ?? '') !== input.projectPath) {
        return false
      }
      return true
    })
    const offset = input?.offset ?? 0
    const limit = input?.limit

    return {
      ...result,
      sessions: typeof limit === 'number' ? filtered.slice(offset, offset + limit) : filtered
    }
  })
}

async function openDefaultInstance(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: /Default/ })).toBeTruthy())
  await fireEvent.click(screen.getByRole('button', { name: /Default/ }))
}

async function openProviderInstance(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: /Provider jaycode/ })).toBeTruthy())
  await fireEvent.click(screen.getByRole('button', { name: /Provider jaycode/ }))
}

describe('SessionsView', () => {
  it('按 instance 分组展示 session', async () => {
    renderSessionsView()

    expect(screen.queryByText('/repo/default')).toBeNull()
    await openDefaultInstance()
    await openProviderInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    await fireEvent.click(screen.getByText('/repo/provider'))

    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Provider jaycode').length).toBeGreaterThan(0)
    expect(screen.getByText('Provider 任务')).toBeTruthy()
    expect(screen.getByText('Provider 最后一句')).toBeTruthy()
  })

  it('支持筛选 instance、状态和实例内搜索', async () => {
    renderSessionsView()

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: copy.sessionsAllInstances }))
    await fireEvent.click(screen.getByRole('option', { name: 'Provider jaycode' }))
    await openProviderInstance()
    await fireEvent.click(screen.getByRole('button', { name: copy.sessionsStatusAll }))
    await fireEvent.click(screen.getByRole('option', { name: copy.sessionsStatusArchived }))
    await fireEvent.input(screen.getByPlaceholderText(copy.sessionsInstanceSearchPlaceholder), {
      target: { value: 'provider' }
    })

    expect(screen.queryByText('默认实例任务')).toBeNull()
    await waitFor(() => expect(screen.getByText('/repo/provider')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/provider'))
    expect(screen.getByText('Provider 任务')).toBeTruthy()
  })

  it('展示单个 instance 扫描错误且不阻塞其他分组', async () => {
    renderSessionsView({
      listCodexSessions: mockListSessions({
        ...sessionResult,
        errorsByInstanceId: {
          'provider-1': 'ENOTDIR'
        }
      })
    })

    await openDefaultInstance()
    await openProviderInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    await fireEvent.click(screen.getByText('/repo/provider'))

    expect(screen.getByText('ENOTDIR')).toBeTruthy()
    expect(screen.getByText('Provider 任务')).toBeTruthy()
  })

  it('点击 session 后展示详情对话内容', async () => {
    const readCodexSessionDetail = vi.fn().mockResolvedValue(sessionDetail)
    renderSessionsView({ readCodexSessionDetail })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    expect(screen.getByText('默认实例任务')).toBeTruthy()
    await fireEvent.click(screen.getByText('默认实例任务'))

    await waitFor(() => expect(screen.getByText(/助手回复内容/)).toBeTruthy())
    expect(readCodexSessionDetail).toHaveBeenCalledWith({
      instanceId: '__default__',
      filePath: '/Users/bee/.codex/sessions/default.jsonl'
    })
    expect(screen.getByText(copy.sessionsBackToList)).toBeTruthy()
    expect(screen.getByAltText(copy.sessionsImageAlt).getAttribute('src')).toBe(
      'data:image/png;base64,abc'
    )
    await waitFor(() => expect(screen.getAllByText(copy.sessionsExpandMessage)).toHaveLength(1))
    await fireEvent.click(screen.getByText(copy.sessionsExpandMessage))
    expect(screen.getByText(copy.sessionsCollapseMessage)).toBeTruthy()
  })

  it('支持从 tree item 复制 session 到目标 provider', async () => {
    const copyCodexSessionToProvider = vi.fn().mockResolvedValue({
      targetInstanceId: 'provider-target-instance',
      targetInstanceName: 'Provider Target Provider',
      targetCodexHome: '/tmp/target',
      targetFilePath: '/tmp/target/sessions/imported/default.imported.jsonl',
      targetModelProvider: 'custom',
      targetModel: 'gpt-5.4-mini',
      session: sessionResult.sessions[0]!
    })
    const listCodexSessionProjects = vi.fn().mockResolvedValue(sessionProjectsResult)
    renderSessionsView({ copyCodexSessionToProvider, listCodexSessionProjects })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    await waitFor(() => expect(screen.getByText('默认实例任务')).toBeTruthy())

    await fireEvent.click(screen.getByLabelText(copy.sessionsCopySessionLabel('默认实例任务')))
    expect(screen.getAllByText(copy.sessionsCopyToProvider).length).toBeGreaterThan(0)
    await fireEvent.click(screen.getByText(copy.sessionsCopyConfirm))

    await waitFor(() =>
      expect(copyCodexSessionToProvider).toHaveBeenCalledWith({
        sourceInstanceId: '__default__',
        sourceFilePath: '/Users/bee/.codex/sessions/default.jsonl',
        targetInstanceId: 'provider-1',
        targetProviderId: 'provider-target'
      })
    )
    await waitFor(() =>
      expect(
        screen.getByText(copy.sessionsCopySuccess('Provider Target Provider', 'gpt-5.4-mini'))
      ).toBeTruthy()
    )
  })

  it('复制弹框允许导入当前 instance 的其他 provider 且排除同 provider', async () => {
    const defaultProviderSession = {
      ...sessionResult.sessions[0]!,
      id: 'session-default-provider',
      filePath: '/Users/bee/.codex/sessions/default-provider.jsonl',
      modelProvider: 'custom:provider-target',
      modelProviderLabel: 'Target Provider',
      projectPath: '/repo/provider-default',
      projectName: 'provider-default',
      title: '默认 Provider 任务',
      lastMessage: '默认 Provider 最后一句'
    }
    const copyCodexSessionToProvider = vi.fn().mockResolvedValue({
      targetInstanceId: '__default__',
      targetInstanceName: 'Default',
      targetCodexHome: '/Users/bee/.codex',
      targetFilePath: '/Users/bee/.codex/sessions/imported/default.imported.jsonl',
      targetModelProvider: 'custom',
      targetModel: 'gpt-5.4-mini',
      session: defaultProviderSession
    })
    renderSessionsView({
      instances: [
        {
          ...instances[0]!,
          providerIds: ['provider-target']
        }
      ],
      copyCodexSessionToProvider,
      listCodexSessionProjects: vi.fn().mockResolvedValue({
        ...sessionProjectsResult,
        projects: [
          sessionProjectsResult.projects[0]!,
          {
            key: '__default__:custom:provider-target:/repo/provider-default',
            instanceId: '__default__',
            instanceName: 'Default',
            codexHome: '/Users/bee/.codex',
            modelProvider: 'custom:provider-target',
            modelProviderLabel: 'Target Provider',
            projectPath: '/repo/provider-default',
            projectName: 'provider-default',
            sessionCount: 1,
            activeCount: 1,
            archivedCount: 0,
            latestAt: '2026-04-22T10:00:00.000Z'
          }
        ]
      }),
      listCodexSessions: mockListSessions({
        ...sessionResult,
        sessions: [defaultProviderSession]
      })
    })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('Target Provider')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/provider-default'))
    await waitFor(() => expect(screen.getByText('默认 Provider 任务')).toBeTruthy())

    await fireEvent.click(
      screen.getByLabelText(copy.sessionsCopySessionLabel('默认 Provider 任务'))
    )
    await fireEvent.click(screen.getByText(copy.sessionsCopyConfirm))

    await waitFor(() =>
      expect(copyCodexSessionToProvider).toHaveBeenCalledWith({
        sourceInstanceId: '__default__',
        sourceFilePath: '/Users/bee/.codex/sessions/default-provider.jsonl',
        targetInstanceId: '__default__',
        targetModelProvider: 'openai',
        targetModelProviderLabel: undefined,
        targetProviderId: undefined
      })
    )
  })

  it('复制弹框会把 default tree 的 custom 分组作为 provider 来源', async () => {
    const copyCodexSessionToProvider = vi.fn().mockResolvedValue({
      targetInstanceId: '__default__',
      targetInstanceName: 'Default',
      targetCodexHome: '/Users/bee/.codex',
      targetFilePath: '/Users/bee/.codex/sessions/imported/default.imported.jsonl',
      targetModelProvider: 'custom',
      targetModel: 'gpt-5.4-mini',
      session: sessionResult.sessions[0]!
    })
    renderSessionsView({
      copyCodexSessionToProvider,
      listCodexSessionProjects: vi.fn().mockResolvedValue({
        ...sessionProjectsResult,
        projects: [
          sessionProjectsResult.projects[0]!,
          {
            key: '__default__:custom:/repo/custom-default',
            instanceId: '__default__',
            instanceName: 'Default',
            codexHome: '/Users/bee/.codex',
            modelProvider: 'custom',
            projectPath: '/repo/custom-default',
            projectName: 'custom-default',
            sessionCount: 1,
            activeCount: 1,
            archivedCount: 0,
            latestAt: '2026-04-22T10:00:00.000Z'
          }
        ]
      })
    })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('custom')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    await waitFor(() => expect(screen.getByText('默认实例任务')).toBeTruthy())

    await fireEvent.click(screen.getByLabelText(copy.sessionsCopySessionLabel('默认实例任务')))
    await fireEvent.click(screen.getByText(copy.sessionsCopyConfirm))

    await waitFor(() =>
      expect(copyCodexSessionToProvider).toHaveBeenCalledWith({
        sourceInstanceId: '__default__',
        sourceFilePath: '/Users/bee/.codex/sessions/default.jsonl',
        targetInstanceId: '__default__',
        targetModelProvider: 'custom',
        targetModelProviderLabel: undefined,
        targetProviderId: undefined
      })
    )
  })

  it('每个 instance 默认只显示前 10 条并支持展开更多', async () => {
    const manyDefaultSessions = Array.from({ length: 12 }, (_, index) => ({
      ...sessionResult.sessions[0]!,
      id: `session-default-${index + 1}`,
      filePath: `/Users/bee/.codex/sessions/default-${index + 1}.jsonl`,
      title: `默认任务 ${index + 1}`,
      lastMessage: `最后一句 ${index + 1}`,
      updatedAt: `2026-04-22T${String(20 - index).padStart(2, '0')}:00:00.000Z`
    }))

    renderSessionsView({
      listCodexSessionProjects: vi.fn().mockResolvedValue({
        ...sessionProjectsResult,
        projects: [
          {
            ...sessionProjectsResult.projects[0]!,
            sessionCount: 12,
            activeCount: 12,
            latestAt: '2026-04-22T20:00:00.000Z'
          }
        ]
      }),
      listCodexSessions: mockListSessions({
        ...sessionResult,
        sessions: manyDefaultSessions
      })
    })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())
    await fireEvent.click(screen.getByText('/repo/default'))
    expect(screen.getByText('默认任务 1')).toBeTruthy()

    expect(screen.getByText('默认任务 10')).toBeTruthy()
    expect(screen.queryByText('默认任务 11')).toBeNull()

    await fireEvent.click(screen.getByText(copy.sessionsShowMore(2)))

    expect(screen.getByText('默认任务 11')).toBeTruthy()
    expect(screen.getByText('默认任务 12')).toBeTruthy()
  })

  it('按 cwd 作为二级 tree 分组，并支持折叠/展开项目', async () => {
    renderSessionsView({
      listCodexSessionProjects: vi.fn().mockResolvedValue({
        ...sessionProjectsResult,
        projects: [
          sessionProjectsResult.projects[0]!,
          {
            ...sessionProjectsResult.projects[0]!,
            key: '__default__:openai:/repo/other',
            projectPath: '/repo/other',
            projectName: 'other',
            sessionCount: 1,
            activeCount: 1,
            latestAt: '2026-04-22T07:00:00.000Z'
          }
        ]
      }),
      listCodexSessions: mockListSessions({
        ...sessionResult,
        sessions: [
          sessionResult.sessions[0]!,
          {
            ...sessionResult.sessions[0]!,
            id: 'session-other-project',
            filePath: '/Users/bee/.codex/sessions/other.jsonl',
            projectPath: '/repo/other',
            projectName: 'other',
            title: '其他项目任务',
            lastMessage: '其他项目最后一句',
            updatedAt: '2026-04-22T07:00:00.000Z'
          }
        ]
      })
    })

    await openDefaultInstance()
    await waitFor(() => expect(screen.getByText('/repo/default')).toBeTruthy())

    expect(screen.getByText('/repo/default')).toBeTruthy()
    expect(screen.getByText('/repo/other')).toBeTruthy()
    expect(screen.queryByText('默认实例任务')).toBeNull()
    expect(screen.queryByText('其他项目任务')).toBeNull()

    await fireEvent.click(screen.getByText('/repo/other'))

    expect(screen.getByText('其他项目任务')).toBeTruthy()

    await fireEvent.click(screen.getByText('/repo/default'))

    expect(screen.getByText('默认实例任务')).toBeTruthy()

    await fireEvent.click(screen.getByText('/repo/default'))

    expect(screen.queryByText('默认实例任务')).toBeNull()
  })
})
