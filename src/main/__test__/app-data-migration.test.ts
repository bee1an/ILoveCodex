import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { migrateLegacyElectronUserData } from '../app-data-migration'

const createdDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codexdock-app-data-'))
  createdDirectories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('migrateLegacyElectronUserData', () => {
  it('保留 CodexDock 配置，并把旧 Electron 运行时数据迁到默认 userData', async () => {
    const root = await createTempDir()
    const legacyConfigPath = join(root, 'codexdock-config')
    const defaultUserDataPath = join(root, 'electron-user-data')
    await mkdir(join(legacyConfigPath, 'Session Storage'), { recursive: true })
    await mkdir(join(legacyConfigPath, 'GPUCache'), { recursive: true })
    await mkdir(join(legacyConfigPath, 'cost-usage'), { recursive: true })
    await mkdir(join(legacyConfigPath, 'codex-instance-homes'), { recursive: true })
    await writeFile(join(legacyConfigPath, 'codex-accounts.json'), '{}\n', 'utf8')
    await writeFile(join(legacyConfigPath, 'Preferences'), '{"legacy":true}\n', 'utf8')
    await writeFile(join(legacyConfigPath, 'Session Storage', '000003.log'), 'session', 'utf8')
    await writeFile(join(legacyConfigPath, 'GPUCache', 'index'), 'gpu', 'utf8')

    const result = await migrateLegacyElectronUserData({
      legacyConfigPath,
      defaultUserDataPath,
      now: () => new Date('2026-04-28T12:00:00.000Z')
    })

    expect(result.moved.sort()).toEqual(['GPUCache', 'Preferences', 'Session Storage'].sort())
    expect(result.backedUp).toEqual([])
    await expect(readFile(join(legacyConfigPath, 'codex-accounts.json'), 'utf8')).resolves.toBe(
      '{}\n'
    )
    await expect(readFile(join(defaultUserDataPath, 'Preferences'), 'utf8')).resolves.toBe(
      '{"legacy":true}\n'
    )
    await expect(
      readFile(join(defaultUserDataPath, 'Session Storage', '000003.log'), 'utf8')
    ).resolves.toBe('session')
    await expect(readFile(join(defaultUserDataPath, 'GPUCache', 'index'), 'utf8')).resolves.toBe(
      'gpu'
    )
  })

  it('默认 userData 已有同名文件时，把旧运行时数据移入备份目录而不是覆盖', async () => {
    const root = await createTempDir()
    const legacyConfigPath = join(root, 'codexdock-config')
    const defaultUserDataPath = join(root, 'electron-user-data')
    await mkdir(legacyConfigPath, { recursive: true })
    await mkdir(defaultUserDataPath, { recursive: true })
    await writeFile(join(legacyConfigPath, 'Preferences'), '{"legacy":true}\n', 'utf8')
    await writeFile(join(defaultUserDataPath, 'Preferences'), '{"current":true}\n', 'utf8')

    const result = await migrateLegacyElectronUserData({
      legacyConfigPath,
      defaultUserDataPath,
      now: () => new Date('2026-04-28T12:34:56.000Z')
    })

    expect(result.moved).toEqual([])
    expect(result.backedUp).toEqual(['Preferences'])
    await expect(readFile(join(defaultUserDataPath, 'Preferences'), 'utf8')).resolves.toBe(
      '{"current":true}\n'
    )
    await expect(
      readFile(
        join(defaultUserDataPath, 'legacy-codexdock-user-data', '20260428123456', 'Preferences'),
        'utf8'
      )
    ).resolves.toBe('{"legacy":true}\n')
  })

  it('legacy 与默认 userData 是同一路径时跳过，避免误移动配置', async () => {
    const root = await createTempDir()
    const legacyConfigPath = join(root, 'same')
    await mkdir(legacyConfigPath, { recursive: true })

    await expect(
      migrateLegacyElectronUserData({
        legacyConfigPath,
        defaultUserDataPath: legacyConfigPath
      })
    ).resolves.toMatchObject({
      moved: [],
      backedUp: [],
      reason: 'same-path'
    })
  })
})
