import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildCliShimContent, installCliShim, resolveCliShimCandidates } from '../cli-shim'

describe('cli shim helpers', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('builds a posix shim with the managed marker', () => {
    expect(
      buildCliShimContent('/Applications/CodexDock.app/Contents/MacOS/CodexDock', 'darwin')
    ).toContain('Managed by CodexDock CLI')
  })

  it('prefers PATH directories for shim installation', () => {
    const home = '/Users/tester'
    const result = resolveCliShimCandidates(
      'darwin',
      {
        PATH: ['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin'].join(':')
      },
      home
    )

    expect(result[0]).toEqual({ dir: '/opt/homebrew/bin', onPath: true })
    expect(result[1]).toEqual({ dir: '/usr/local/bin', onPath: true })
    expect(result.at(-1)).toEqual({ dir: join(home, 'bin'), onPath: false })
  })

  it('installs the shim into a writable PATH directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cdock-shim-'))
    const binDir = join(tempDir, 'bin')
    const appPath = join(tempDir, 'CodexDock')

    const result = await installCliShim({
      appPath,
      isPackaged: true,
      platform: 'linux',
      homeDir: tempDir,
      env: {
        PATH: binDir,
        ILOVECODEX_BIN_DIR: binDir
      }
    })

    expect(result.status).toBe('installed')
    expect(result.onPath).toBe(true)
    expect(result.shimPath).toBe(join(binDir, 'cdock'))
    await expect(readFile(join(binDir, 'cdock'), 'utf8')).resolves.toContain(
      `exec "${appPath}" --cli "$@"`
    )
  })

  it('does not overwrite an unrelated cdock shim on PATH', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cdock-shim-'))
    const binDir = join(tempDir, 'bin')
    const shimPath = join(binDir, 'cdock')
    await mkdir(binDir, { recursive: true })
    await writeFile(shimPath, '#!/bin/sh\necho foreign\n', 'utf8')

    const result = await installCliShim({
      appPath: join(tempDir, 'CodexDock'),
      isPackaged: true,
      platform: 'linux',
      homeDir: tempDir,
      env: {
        PATH: binDir,
        ILOVECODEX_BIN_DIR: binDir
      }
    })

    expect(result).toMatchObject({
      status: 'skipped',
      shimPath,
      onPath: true,
      reason: 'occupied'
    })
    await expect(readFile(shimPath, 'utf8')).resolves.toBe('#!/bin/sh\necho foreign\n')
  })
})
