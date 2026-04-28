import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { runCli } from './run-cli'
import { createElectronCodexPlatformAdapter } from '../main/electron-platform'
import { createCodexServices } from '../main/codex-services'
import type { LoginEvent } from '../shared/codex'

const configuredAppConfigPath = join(homedir(), '.config', 'codexdock')

async function main(): Promise<void> {
  await app.whenReady()

  const listeners = new Set<(event: LoginEvent) => void>()
  const services = createCodexServices({
    userDataPath: configuredAppConfigPath,
    defaultWorkspacePath: process.cwd(),
    platform: createElectronCodexPlatformAdapter(),
    emitLoginEvent: (event) => {
      for (const listener of listeners) {
        listener(event)
      }
    }
  })

  const code = await runCli(
    {
      services,
      platform: createElectronCodexPlatformAdapter(),
      subscribeLoginEvents: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    process.argv.slice(2)
  )

  app.exit(code)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'CLI bootstrap failed')
  app.exit(1)
})
