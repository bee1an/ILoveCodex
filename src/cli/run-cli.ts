import { promises as fs } from 'node:fs'

import type {
  AppSettings,
  CliAccountListPayload,
  CliResult,
  LoginEvent,
  UpdateCustomProviderInput
} from '../shared/codex'
import { CliError, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './cli-errors'
import {
  ensureSettingsKey,
  parseCostOptions,
  parseFlags,
  parseFileOption,
  parseInstanceOptions,
  parseProviderOptions,
  parseSettingsValue
} from './cli-parsing'
import {
  accountLabel,
  formatSettingsValue,
  instanceLabel,
  printAccountList,
  printDoctorReport,
  printHelp,
  printIfNeeded,
  printInstances,
  printProviderCheck,
  printProviders,
  printSettings,
  printTags,
  printTokenCost,
  printUsage,
  providerLabel,
  sessionLabel,
  tagLabel,
  toCliResult
} from './cli-output'
import {
  DEFAULT_INSTANCE_ID,
  type CliRuntime,
  getSnapshotAccount,
  getSnapshotInstance,
  getSnapshotTag,
  normalizeInstanceId,
  parseJsonMaybe,
  readStdin,
  waitForLoginResult
} from './run-cli-helpers'

async function execute(
  runtime: CliRuntime,
  argv: string[]
): Promise<{ code: number; payload?: CliResult<unknown> }> {
  const { flags, positionals } = parseFlags(argv)
  const silent = flags.quiet || flags.json

  if (flags.help || !positionals.length) {
    printHelp()
    return { code: EXIT_OK }
  }

  const [command, subcommand, ...rest] = positionals

  switch (command) {
    case 'account': {
      switch (subcommand) {
        case 'list': {
          const snapshot = await runtime.services.accounts.list()
          const payload: CliAccountListPayload = {
            accounts: snapshot.accounts,
            activeAccountId: snapshot.activeAccountId,
            currentSession: snapshot.currentSession
          }
          printAccountList(payload, silent)
          return { code: EXIT_OK, payload: toCliResult(payload) }
        }
        case 'import-current': {
          const snapshot = await runtime.services.accounts.importCurrent()
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Imported current Codex account: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'import': {
          const { filePath, positionals } = parseFileOption(rest)
          if (positionals.length) {
            throw new CliError('Usage: ilc account import [--file <path>]', EXIT_USAGE)
          }

          const raw =
            filePath != null
              ? await fs.readFile(filePath, 'utf8')
              : process.stdin.isTTY
                ? (() => {
                    throw new CliError(
                      'Usage: ilc account import [--file <path>] or pipe JSON via stdin',
                      EXIT_USAGE
                    )
                  })()
                : await readStdin()
          const snapshot = await runtime.services.accounts.importFromTemplate(raw)
          printIfNeeded(
            `Imported accounts from ${filePath ?? 'stdin'} (${snapshot.accounts.length} stored)`,
            silent
          )
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'export': {
          const { filePath, positionals } = parseFileOption(rest)
          const raw = await runtime.services.accounts.exportToTemplate(positionals)
          const parsed = parseJsonMaybe(raw)

          if (filePath) {
            await fs.writeFile(filePath, raw, 'utf8')
            printIfNeeded(`Exported accounts to ${filePath}`, silent)
          } else if (flags.json) {
            return { code: EXIT_OK, payload: toCliResult(parsed) }
          } else {
            console.log(raw.trimEnd())
          }

          return { code: EXIT_OK, payload: toCliResult(parsed) }
        }
        case 'activate': {
          const accountId = rest[0]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          const snapshot = await runtime.services.accounts.activate(accountId)
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Activated account: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'best': {
          const snapshot = await runtime.services.accounts.activateBest()
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Best account active: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const accountId = rest[0]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          const snapshot = await runtime.services.accounts.remove(accountId)
          printIfNeeded(`Removed account: ${accountId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        default:
          throw new CliError('Unknown account command', EXIT_USAGE)
      }
    }
    case 'provider': {
      switch (subcommand) {
        case 'list': {
          const providers = await runtime.services.providers.list()
          printProviders(providers, silent)
          return { code: EXIT_OK, payload: toCliResult(providers) }
        }
        case 'create': {
          const { input } = parseProviderOptions(rest)
          if (!input.baseUrl || !input.apiKey) {
            throw new CliError(
              'Usage: ilc provider create --base-url <url> --api-key <key>',
              EXIT_USAGE
            )
          }

          const snapshot = await runtime.services.providers.create({
            name: input.name,
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model ?? '5.4',
            fastMode: input.fastMode
          })
          const created = snapshot.providers[0] ?? null
          printIfNeeded(`Created provider: ${providerLabel(created)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'update': {
          const { input, positionals } = parseProviderOptions(rest)
          const providerId = positionals[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const updateInput: UpdateCustomProviderInput = {}
          if (input.name !== undefined) {
            updateInput.name = input.name
          }
          if (input.baseUrl !== undefined) {
            updateInput.baseUrl = input.baseUrl
          }
          if (input.apiKey !== undefined) {
            updateInput.apiKey = input.apiKey
          }
          if (input.model !== undefined) {
            updateInput.model = input.model
          }
          if (input.fastMode !== undefined) {
            updateInput.fastMode = input.fastMode
          }
          if (!Object.keys(updateInput).length) {
            throw new CliError('No provider changes provided', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.update(providerId, updateInput)
          const updated = snapshot.providers.find((provider) => provider.id === providerId) ?? null
          printIfNeeded(`Updated provider: ${providerLabel(updated)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const providerId = rest[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.remove(providerId)
          printIfNeeded(`Removed provider: ${providerId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'check': {
          const providerId = rest[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const report = await runtime.services.providers.check(providerId)
          printProviderCheck(report, silent)
          return { code: EXIT_OK, payload: toCliResult(report) }
        }
        case 'open': {
          const providerId = rest[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.open(providerId)
          printIfNeeded(`Opened provider in isolated Codex: ${providerId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        default:
          throw new CliError('Unknown provider command', EXIT_USAGE)
      }
    }
    case 'instance': {
      switch (subcommand) {
        case 'list': {
          const instances = await runtime.services.codex.instances.list()
          printInstances(instances, silent)
          return { code: EXIT_OK, payload: toCliResult(instances) }
        }
        case 'create': {
          const { input, positionals } = parseInstanceOptions(rest)
          if (positionals.length) {
            throw new CliError(
              'Usage: ilc instance create --name <name> [--codex-home <path>] [--account <account-id>] [--extra-args <args>]',
              EXIT_USAGE
            )
          }
          if (!input.name?.trim()) {
            throw new CliError('Missing instance name', EXIT_USAGE)
          }

          const instance = await runtime.services.codex.instances.create({
            name: input.name.trim(),
            codexHome: input.codexHome?.trim() || undefined,
            bindAccountId:
              typeof input.bindAccountId === 'string'
                ? input.bindAccountId.trim() || undefined
                : undefined,
            extraArgs: input.extraArgs?.trim() || undefined
          })
          printIfNeeded(`Created instance: ${instanceLabel(instance)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(instance) }
        }
        case 'update': {
          const { input, positionals } = parseInstanceOptions(rest)
          const rawInstanceId = positionals[0]
          if (!rawInstanceId) {
            throw new CliError('Missing instance-id', EXIT_USAGE)
          }
          if (input.codexHome !== undefined || input.workspacePath !== undefined) {
            throw new CliError(
              'instance update does not support --codex-home or --workspace',
              EXIT_USAGE
            )
          }

          const updateInput: {
            name?: string
            bindAccountId?: string | null
            extraArgs?: string
          } = {}
          if (input.name !== undefined) {
            updateInput.name = input.name
          }
          if (input.bindAccountId !== undefined) {
            updateInput.bindAccountId =
              typeof input.bindAccountId === 'string' ? input.bindAccountId.trim() || null : null
          }
          if (input.extraArgs !== undefined) {
            updateInput.extraArgs = input.extraArgs
          }
          if (!Object.keys(updateInput).length) {
            throw new CliError('No instance changes provided', EXIT_USAGE)
          }

          const instance = await runtime.services.codex.instances.update(
            normalizeInstanceId(rawInstanceId),
            updateInput
          )
          printIfNeeded(`Updated instance: ${instanceLabel(instance)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(instance) }
        }
        case 'start': {
          const { input, positionals } = parseInstanceOptions(rest)
          const rawInstanceId = positionals[0]
          if (!rawInstanceId) {
            throw new CliError('Missing instance-id', EXIT_USAGE)
          }
          if (
            input.name !== undefined ||
            input.codexHome !== undefined ||
            input.bindAccountId !== undefined ||
            input.extraArgs !== undefined
          ) {
            throw new CliError('instance start only supports --workspace', EXIT_USAGE)
          }

          const instance = await runtime.services.codex.instances.start(
            normalizeInstanceId(rawInstanceId),
            input.workspacePath
          )
          printIfNeeded(`Started instance: ${instanceLabel(instance)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(instance) }
        }
        case 'stop': {
          const rawInstanceId = rest[0]
          if (!rawInstanceId) {
            throw new CliError('Missing instance-id', EXIT_USAGE)
          }
          if (rest.length > 1) {
            throw new CliError('Usage: ilc instance stop <instance-id|default>', EXIT_USAGE)
          }

          const instance = await runtime.services.codex.instances.stop(
            normalizeInstanceId(rawInstanceId)
          )
          printIfNeeded(`Stopped instance: ${instanceLabel(instance)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(instance) }
        }
        case 'remove': {
          const rawInstanceId = rest[0]
          if (!rawInstanceId) {
            throw new CliError('Missing instance-id', EXIT_USAGE)
          }
          if (rest.length > 1) {
            throw new CliError('Usage: ilc instance remove <instance-id>', EXIT_USAGE)
          }

          const instanceId = normalizeInstanceId(rawInstanceId)
          if (instanceId === DEFAULT_INSTANCE_ID) {
            throw new CliError('Default instance cannot be removed.', EXIT_USAGE)
          }

          const snapshot = await runtime.services.accounts.list()
          const instance = getSnapshotInstance(snapshot, instanceId)
          await runtime.services.codex.instances.remove(instanceId)
          printIfNeeded(`Removed instance: ${instanceLabel(instance)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(null) }
        }
        default:
          throw new CliError('Unknown instance command', EXIT_USAGE)
      }
    }
    case 'session': {
      if (subcommand !== 'current') {
        throw new CliError('Unknown session command', EXIT_USAGE)
      }
      const session = await runtime.services.session.current()
      printIfNeeded(`Current session: ${sessionLabel(session)}`, silent)
      return { code: EXIT_OK, payload: toCliResult(session) }
    }
    case 'tag': {
      switch (subcommand) {
        case 'list': {
          const tags = await runtime.services.tags.getAll()
          printTags(tags, silent)
          return { code: EXIT_OK, payload: toCliResult(tags) }
        }
        case 'create': {
          const name = rest.join(' ').trim()
          if (!name) {
            throw new CliError('Missing tag name', EXIT_USAGE)
          }

          const snapshot = await runtime.services.tags.create(name)
          const createdTag =
            snapshot.tags.find((tag) => tag.name === name) ?? snapshot.tags.at(-1) ?? null
          printIfNeeded(`Created tag: ${tagLabel(createdTag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'rename': {
          const tagId = rest[0]
          const name = rest.slice(1).join(' ').trim()
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }
          if (!name) {
            throw new CliError('Missing tag name', EXIT_USAGE)
          }

          const snapshot = await runtime.services.tags.update(tagId, name)
          const updatedTag = getSnapshotTag(snapshot, tagId)
          printIfNeeded(`Renamed tag: ${tagLabel(updatedTag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const tagId = rest[0]
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.accounts.list()
          const tag = getSnapshotTag(snapshot, tagId)
          const updatedSnapshot = await runtime.services.tags.remove(tagId)
          printIfNeeded(`Removed tag: ${tagLabel(tag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(updatedSnapshot) }
        }
        case 'assign':
        case 'unassign': {
          const accountId = rest[0]
          const tagId = rest[1]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.accounts.list()
          const account = getSnapshotAccount(snapshot, accountId)
          const tag = getSnapshotTag(snapshot, tagId)
          const hasTag = account.tagIds.includes(tagId)
          const nextTagIds =
            subcommand === 'assign'
              ? hasTag
                ? account.tagIds
                : [...account.tagIds, tagId]
              : account.tagIds.filter((id) => id !== tagId)

          if (subcommand === 'assign' && hasTag) {
            printIfNeeded(
              `Tag already assigned: ${tagLabel(tag)} -> ${accountLabel(account)}`,
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(snapshot) }
          }

          if (subcommand === 'unassign' && nextTagIds.length === account.tagIds.length) {
            printIfNeeded(
              `Tag already removed: ${tagLabel(tag)} -> ${accountLabel(account)}`,
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(snapshot) }
          }

          const updatedSnapshot = await runtime.services.accounts.updateTags(accountId, nextTagIds)
          printIfNeeded(
            `${
              subcommand === 'assign' ? 'Assigned' : 'Removed'
            } tag: ${tagLabel(tag)} ${subcommand === 'assign' ? '->' : '<-'} ${accountLabel(account)}`,
            silent
          )
          return { code: EXIT_OK, payload: toCliResult(updatedSnapshot) }
        }
        default:
          throw new CliError('Unknown tag command', EXIT_USAGE)
      }
    }
    case 'usage': {
      if (subcommand !== 'read') {
        throw new CliError('Unknown usage command', EXIT_USAGE)
      }
      const rateLimits = await runtime.services.usage.read(rest[0])
      printUsage(rateLimits, silent)
      return { code: EXIT_OK, payload: toCliResult(rateLimits) }
    }
    case 'cost': {
      if (subcommand !== 'read') {
        throw new CliError('Unknown cost command', EXIT_USAGE)
      }

      const options = parseCostOptions(rest)
      const detail = await runtime.services.cost.read({
        refresh: options.refresh
      })
      printTokenCost(detail, silent)
      return { code: EXIT_OK, payload: toCliResult(detail) }
    }
    case 'login': {
      if (subcommand === 'port') {
        switch (rest[0]) {
          case 'status': {
            const occupant = await runtime.services.login.getPortOccupant()
            printIfNeeded(
              occupant
                ? `1455 occupied by ${occupant.command} (${occupant.pid})`
                : '1455 is available',
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(occupant) }
          }
          case 'kill': {
            const occupant = await runtime.services.login.killPortOccupant()
            printIfNeeded(
              occupant
                ? `Stopped ${occupant.command} (${occupant.pid})`
                : 'No process was listening on 1455',
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(occupant) }
          }
          default:
            throw new CliError('Unknown login port command', EXIT_USAGE)
        }
      }

      if (subcommand !== 'browser' && subcommand !== 'device') {
        throw new CliError('Unknown login command', EXIT_USAGE)
      }

      const initialEvents: LoginEvent[] = []
      const stopBuffering = runtime.subscribeLoginEvents((event) => {
        initialEvents.push(event)
      })
      const attempt = await runtime.services.login.start(subcommand)
      stopBuffering()
      const result = await waitForLoginResult(
        runtime,
        attempt.attemptId,
        flags,
        subcommand,
        initialEvents
      )
      if (!flags.json) {
        printIfNeeded(`Login finished with phase: ${result.phase}`, silent)
      }
      return { code: EXIT_OK, payload: toCliResult(result) }
    }
    case 'codex': {
      if (subcommand === 'show') {
        const snapshot = await runtime.services.codex.show()
        printIfNeeded('Opened Codex', silent)
        return { code: EXIT_OK, payload: toCliResult(snapshot) }
      }
      if (subcommand === 'open') {
        const snapshot = await runtime.services.codex.open(rest[0])
        const active = snapshot.accounts.find((account) => account.id === snapshot.activeAccountId)
        printIfNeeded(`Opened Codex with account: ${accountLabel(active)}`, silent)
        return { code: EXIT_OK, payload: toCliResult(snapshot) }
      }
      if (subcommand === 'open-isolated') {
        const accountId = rest[0]
        if (!accountId) {
          throw new CliError('Missing account-id', EXIT_USAGE)
        }

        const snapshot = await runtime.services.codex.openIsolated(accountId)
        printIfNeeded(`Opened isolated Codex session for account: ${accountId}`, silent)
        return { code: EXIT_OK, payload: toCliResult(snapshot) }
      }
      throw new CliError('Unknown codex command', EXIT_USAGE)
    }
    case 'doctor': {
      if (subcommand) {
        throw new CliError('Unknown doctor command', EXIT_USAGE)
      }

      const report = await runtime.services.doctor.run()
      printDoctorReport(report, silent)
      return { code: EXIT_OK, payload: toCliResult(report) }
    }
    case 'settings': {
      switch (subcommand) {
        case 'get': {
          const settings = await runtime.services.settings.get()
          const key = rest[0]
          if (!key) {
            printSettings(settings, silent)
            return { code: EXIT_OK, payload: toCliResult(settings) }
          }

          const settingKey = ensureSettingsKey(key)
          if (!silent) {
            console.log(formatSettingsValue(settingKey, settings))
          }
          return { code: EXIT_OK, payload: toCliResult(settings[settingKey]) }
        }
        case 'set': {
          const key = rest[0]
          const rawValue = rest[1]
          if (!key || rawValue == null) {
            throw new CliError('Usage: ilc settings set <key> <value>', EXIT_USAGE)
          }

          const settingKey = ensureSettingsKey(key)
          const nextValue = parseSettingsValue(settingKey, rawValue)
          const snapshot = await runtime.services.settings.update({
            [settingKey]: nextValue
          } as Partial<AppSettings>)
          printSettings(snapshot.settings, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot.settings) }
        }
        default:
          throw new CliError('Unknown settings command', EXIT_USAGE)
      }
    }
    default:
      throw new CliError(`Unknown command: ${command}`, EXIT_USAGE)
  }
}

export async function runCli(runtime: CliRuntime, argv: string[]): Promise<number> {
  try {
    const result = await execute(runtime, argv)
    if (result.payload && argv.includes('--json')) {
      console.log(JSON.stringify(result.payload))
    }
    return result.code
  } catch (error) {
    const resolved =
      error instanceof CliError
        ? error
        : new CliError(error instanceof Error ? error.message : 'Command failed', EXIT_FAILURE)

    if (argv.includes('--json')) {
      console.log(
        JSON.stringify({
          ok: false,
          data: null,
          error: {
            code: resolved.code,
            message: resolved.message
          }
        } satisfies CliResult<never>)
      )
    } else {
      console.error(resolved.message)
    }
    return resolved.code
  }
}
