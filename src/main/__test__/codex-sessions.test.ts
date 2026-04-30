import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodexInstanceSummary } from '../../shared/codex'
import {
  copyCodexSessionToProvider,
  listCodexSessionProjects,
  listCodexSessions,
  readCodexSessionDetail
} from '../codex-sessions'

const createdDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codexdock-sessions-'))
  createdDirectories.push(dir)
  return dir
}

async function writeJsonl(filePath: string, entries: unknown[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
}

function instance(
  id: string,
  name: string,
  codexHome: string,
  isDefault = false
): CodexInstanceSummary {
  return {
    id,
    name,
    codexHome,
    extraArgs: '',
    isDefault,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    running: false,
    initialized: true
  }
}

function sessionMeta(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    timestamp: payload.timestamp,
    type: 'session_meta',
    payload
  }
}

function userMessage(message: string): Record<string, unknown> {
  return {
    timestamp: '2026-04-22T10:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message
    }
  }
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('Codex session scanner', () => {
  it('按 instance 扫描 session，并提取项目、来源和有效用户预览', async () => {
    const root = await createTempDir()
    const defaultHome = join(root, 'default')
    const providerHome = join(root, 'provider')

    await writeJsonl(join(defaultHome, 'sessions/2026/04/22/default.jsonl'), [
      sessionMeta({
        id: 'session-default',
        timestamp: '2026-04-22T08:00:00.000Z',
        cwd: '/repo/default',
        model_provider: 'openai',
        source: 'vscode',
        originator: 'Codex Desktop',
        git: { branch: 'main' }
      }),
      userMessage('<environment_context>ignored</environment_context>'),
      userMessage('# AGENTS.md instructions\n\n<INSTRUCTIONS>\n只是一段项目指令\n</INSTRUCTIONS>'),
      userMessage('<memory_context>\n旧记忆\n</memory_context>\n\n修复默认实例问题'),
      userMessage('修复默认实例问题')
    ])
    await writeJsonl(join(providerHome, 'sessions/2026/04/22/provider.jsonl'), [
      sessionMeta({
        id: 'session-provider',
        timestamp: '2026-04-22T09:00:00.000Z',
        cwd: '/repo/provider',
        model_provider: 'custom',
        source: { subagent: { other: 'guardian' } },
        originator: 'Codex Desktop'
      }),
      userMessage('检查 provider session')
    ])

    const result = await listCodexSessions([
      instance('__default__', '', defaultHome, true),
      instance('provider-1', 'Provider jaycode', providerHome)
    ])

    expect(result.errorsByInstanceId).toEqual({})
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'session-default',
          instanceId: '__default__',
          instanceName: 'Default',
          modelProvider: 'openai',
          projectPath: '/repo/default',
          projectName: 'default',
          gitBranch: 'main',
          sourceLabel: 'vscode',
          originator: 'Codex Desktop',
          status: 'active',
          title: '修复默认实例问题',
          lastMessage: '修复默认实例问题',
          preview: '修复默认实例问题'
        }),
        expect.objectContaining({
          id: 'session-provider',
          instanceId: 'provider-1',
          instanceName: 'Provider jaycode',
          modelProvider: 'custom',
          projectPath: '/repo/provider',
          sourceLabel: 'subagent: guardian',
          preview: '检查 provider session'
        })
      ])
    )
  })

  it('支持 archived 与项目/状态/instance 过滤', async () => {
    const root = await createTempDir()
    const codexHome = join(root, 'codex')

    await writeJsonl(join(codexHome, 'sessions/2026/04/22/live.jsonl'), [
      sessionMeta({
        id: 'live',
        cwd: '/repo/live',
        model_provider: 'openai',
        timestamp: '2026-04-22T08:00:00.000Z'
      }),
      userMessage('live')
    ])
    await writeJsonl(join(codexHome, 'archived_sessions/archived.jsonl'), [
      sessionMeta({
        id: 'archived',
        cwd: '/repo/archive-target',
        model_provider: 'custom',
        timestamp: '2026-04-21T08:00:00.000Z'
      }),
      userMessage('archived')
    ])

    const result = await listCodexSessions([instance('inst', 'Instance', codexHome)], {
      instanceId: 'inst',
      status: 'archived',
      modelProvider: 'custom',
      projectQuery: 'archive-target'
    })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      id: 'archived',
      status: 'archived',
      projectPath: '/repo/archive-target'
    })
  })

  it('先按 cwd 生成项目树，再按项目懒加载 session', async () => {
    const root = await createTempDir()
    const codexHome = join(root, 'codex')

    await writeJsonl(join(codexHome, 'sessions/2026/04/22/one.jsonl'), [
      sessionMeta({
        id: 'one',
        cwd: '/repo/app',
        model_provider: 'openai',
        timestamp: '2026-04-22T08:00:00.000Z'
      }),
      userMessage('one')
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/two.jsonl'), [
      sessionMeta({
        id: 'two',
        cwd: '/repo/app',
        model_provider: 'openai',
        timestamp: '2026-04-22T09:00:00.000Z'
      }),
      userMessage('two')
    ])
    await writeJsonl(join(codexHome, 'sessions/2026/04/22/other.jsonl'), [
      sessionMeta({
        id: 'other',
        cwd: '/repo/other',
        model_provider: 'custom',
        timestamp: '2026-04-22T10:00:00.000Z'
      }),
      userMessage('other')
    ])

    const targetInstance = instance('inst', 'Instance', codexHome)
    const projects = await listCodexSessionProjects([targetInstance])

    expect(projects.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'inst:openai:/repo/app',
          modelProvider: 'openai',
          projectPath: '/repo/app',
          projectName: 'app',
          sessionCount: 2,
          activeCount: 2
        }),
        expect.objectContaining({
          key: 'inst:custom:/repo/other',
          modelProvider: 'custom',
          projectPath: '/repo/other',
          sessionCount: 1
        })
      ])
    )

    const page = await listCodexSessions([targetInstance], {
      instanceId: 'inst',
      modelProvider: 'openai',
      projectPath: '/repo/app',
      limit: 1
    })

    expect(page.sessions).toHaveLength(1)
    expect(page.sessions[0]).toMatchObject({
      projectPath: '/repo/app'
    })
    expect(['one', 'two']).toContain(page.sessions[0]?.id)
  })

  it('单个 instance 扫描失败时不阻塞其他 instance', async () => {
    const root = await createTempDir()
    const goodHome = join(root, 'good')
    const badHome = join(root, 'bad')

    await writeJsonl(join(goodHome, 'sessions/2026/04/22/good.jsonl'), [
      sessionMeta({ id: 'good', cwd: '/repo/good', timestamp: '2026-04-22T08:00:00.000Z' }),
      userMessage('good')
    ])
    await writeFile(join(badHome, 'sessions'), 'not a directory', 'utf8').catch(async () => {
      await mkdir(badHome, { recursive: true })
      await writeFile(join(badHome, 'sessions'), 'not a directory', 'utf8')
    })

    const result = await listCodexSessions([
      instance('good', 'Good', goodHome),
      instance('bad', 'Bad', badHome)
    ])

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.id).toBe('good')
    expect(result.errorsByInstanceId.bad).toBeTruthy()
  })

  it('读取 session 详情时返回对话消息并校验 instance 归属', async () => {
    const root = await createTempDir()
    const codexHome = join(root, 'codex')
    const filePath = join(codexHome, 'sessions/2026/04/22/detail.jsonl')
    const targetInstance = instance('inst', 'Instance', codexHome)

    await writeJsonl(filePath, [
      sessionMeta({ id: 'detail', cwd: '/repo/detail', timestamp: '2026-04-22T08:00:00.000Z' }),
      {
        timestamp: '2026-04-22T08:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '用户问题' }]
        }
      },
      {
        timestamp: '2026-04-22T08:02:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '助手回答' }]
        }
      }
    ])

    const detail = await readCodexSessionDetail([targetInstance], {
      instanceId: 'inst',
      filePath
    })

    expect(detail.session).toMatchObject({
      id: 'detail',
      title: '用户问题',
      lastMessage: '助手回答'
    })
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'user', text: '用户问题' }),
      expect.objectContaining({ role: 'assistant', text: '助手回答' })
    ])
    await expect(
      readCodexSessionDetail([targetInstance], {
        instanceId: 'inst',
        filePath: join(root, 'outside.jsonl')
      })
    ).rejects.toThrow('does not belong')
  })

  it('读取详情时保留 input_image，并在摘要中弱化为图片占位', async () => {
    const root = await createTempDir()
    const codexHome = join(root, 'codex')
    const filePath = join(codexHome, 'sessions/2026/04/22/image.jsonl')
    const targetInstance = instance('inst', 'Instance', codexHome)

    await writeJsonl(filePath, [
      sessionMeta({ id: 'image', cwd: '/repo/image', timestamp: '2026-04-22T08:00:00.000Z' }),
      {
        timestamp: '2026-04-22T08:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '看一下这张图' },
            { type: 'input_text', text: '<image>' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc' }
          ]
        }
      }
    ])

    const detail = await readCodexSessionDetail([targetInstance], {
      instanceId: 'inst',
      filePath
    })

    expect(detail.session).toMatchObject({
      id: 'image',
      title: '看一下这张图 [图片]',
      lastMessage: '看一下这张图 [图片]'
    })
    expect(detail.messages[0]?.text).toBe('看一下这张图\n<image>data:image/png;base64,abc</image>')
  })

  it('复制 session 到目标 provider 时改写 provider/model 并保留导入来源', async () => {
    const root = await createTempDir()
    const sourceHome = join(root, 'source')
    const targetHome = join(root, 'target')
    const filePath = join(sourceHome, 'sessions/2026/04/22/source.jsonl')
    const sourceInstance = instance('source', 'Source', sourceHome)
    const targetInstance = instance('target', 'Provider Target', targetHome)

    await writeJsonl(filePath, [
      sessionMeta({
        id: 'source-session',
        cwd: '/repo/source',
        model_provider: 'openai',
        timestamp: '2026-04-22T08:00:00.000Z'
      }),
      {
        timestamp: '2026-04-22T08:00:01.000Z',
        type: 'turn_context',
        payload: {
          model: 'gpt-5.4',
          model_provider: 'openai',
          cwd: '/repo/source'
        }
      },
      userMessage('复制这个 session')
    ])

    const result = await copyCodexSessionToProvider(
      [sourceInstance, targetInstance],
      {
        sourceInstanceId: 'source',
        sourceFilePath: filePath,
        targetProviderId: 'target-provider'
      },
      targetInstance,
      {
        id: 'target-provider',
        name: 'Target Provider',
        baseUrl: 'https://target.example.com',
        model: 'gpt-5.4-mini',
        fastMode: true,
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z'
      }
    )

    expect(result).toMatchObject({
      targetInstanceId: 'target',
      targetModelProvider: 'custom',
      targetModel: 'gpt-5.4-mini'
    })
    expect(result.targetFilePath).toContain(join(targetHome, 'sessions', 'imported'))

    const copied = await readCodexSessionDetail([targetInstance], {
      instanceId: 'target',
      filePath: result.targetFilePath
    })
    expect(copied.session).toMatchObject({
      id: 'source-session',
      instanceId: 'target',
      modelProvider: 'custom:target-provider',
      modelProviderLabel: 'Target Provider',
      title: '复制这个 session'
    })

    const raw = await readFile(result.targetFilePath, 'utf8')
    const lines = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const meta = lines.find((line) => line.type === 'session_meta')?.payload as Record<
      string,
      unknown
    >
    const turnContext = lines.find((line) => line.type === 'turn_context')?.payload as Record<
      string,
      unknown
    >
    expect(meta.model_provider).toBe('custom')
    expect(meta.model).toBe('gpt-5.4-mini')
    expect(meta.codexdock_import).toMatchObject({
      sourceInstanceId: 'source',
      sourceModelProvider: 'openai',
      sourceModels: ['gpt-5.4'],
      targetProviderId: 'target-provider',
      targetModelProvider: 'custom',
      targetModel: 'gpt-5.4-mini'
    })
    expect(turnContext).toMatchObject({
      model_provider: 'custom',
      model: 'gpt-5.4-mini'
    })
  })
})
