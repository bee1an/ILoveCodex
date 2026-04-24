import { getOpenAiCallbackPortOccupant } from './codex-auth'
import { resolveCodexLaunchCommand } from './codex-launcher'
import type { DoctorReport, HealthCheckResult, ProviderCheckReport } from '../shared/codex'
import {
  accountErrorLabel,
  appendPathSegment,
  customProviderLabel,
  extractProviderErrorDetail,
  makeHealthCheck,
  parseProviderModels,
  reportIsOk,
  type CodexServicesRuntimeContext
} from './codex-services-shared'
import type { CodexServicesInstanceRuntime } from './codex-services-instance-runtime'

export interface CodexServicesDiagnosticsRuntime {
  checkProvider(providerId: string): Promise<ProviderCheckReport>
  runDoctor(): Promise<DoctorReport>
}

export function createCodexServicesDiagnosticsRuntime(
  context: CodexServicesRuntimeContext,
  instanceRuntime: CodexServicesInstanceRuntime
): CodexServicesDiagnosticsRuntime {
  const { store, providerStore, options } = context
  const { getSnapshot, getDesktopExecutablePathOverride, prepareLaunchAuthPayload } =
    instanceRuntime

  async function checkProvider(providerId: string): Promise<ProviderCheckReport> {
    const provider = await providerStore.getResolvedProvider(providerId)
    const modelsUrl = appendPathSegment(provider.summary.baseUrl, 'models')
    const checks: HealthCheckResult[] = []
    const checkedAt = new Date().toISOString()

    let latencyMs: number | null = null
    let httpStatus: number | null = null
    let availableModels: string[] = []

    try {
      const startedAt = Date.now()
      const response = await options.platform.fetch(modelsUrl, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${provider.apiKey}`
        }
      })
      latencyMs = Date.now() - startedAt
      httpStatus = response.status

      const raw = await response.text()
      const errorDetail = extractProviderErrorDetail(raw)

      checks.push(
        makeHealthCheck(
          'connectivity',
          response.status >= 500 ? 'fail' : 'pass',
          response.status >= 500
            ? `Provider responded with HTTP ${response.status}.`
            : `Provider responded in ${latencyMs} ms.`,
          errorDetail
        )
      )

      if (response.status === 401 || response.status === 403) {
        checks.push(
          makeHealthCheck('authentication', 'fail', 'Provider rejected the API key.', errorDetail)
        )
      } else {
        checks.push(
          makeHealthCheck('authentication', 'pass', 'Provider accepted the authentication request.')
        )
      }

      if (response.status === 404) {
        checks.push(
          makeHealthCheck(
            'model',
            'warn',
            'Provider does not expose a /models endpoint; model validation was skipped.'
          )
        )
      } else if (!response.ok) {
        checks.push(
          makeHealthCheck(
            'model',
            'fail',
            `Provider model probe failed with HTTP ${response.status}.`,
            errorDetail
          )
        )
      } else {
        availableModels = parseProviderModels(raw)
        if (!availableModels.length) {
          checks.push(
            makeHealthCheck(
              'model',
              'warn',
              'Provider returned no model list; configured model could not be verified.'
            )
          )
        } else if (availableModels.includes(provider.summary.model)) {
          checks.push(
            makeHealthCheck(
              'model',
              'pass',
              `Configured model "${provider.summary.model}" is available.`
            )
          )
        } else {
          checks.push(
            makeHealthCheck(
              'model',
              'fail',
              `Configured model "${provider.summary.model}" was not found in /models.`,
              availableModels.slice(0, 10).join(', ')
            )
          )
        }
      }
    } catch (error) {
      checks.push(
        makeHealthCheck(
          'connectivity',
          'fail',
          'Provider request failed before receiving an HTTP response.',
          error instanceof Error ? error.message : 'Unknown error'
        )
      )
      checks.push(
        makeHealthCheck('authentication', 'warn', 'Authentication could not be verified.')
      )
      checks.push(makeHealthCheck('model', 'warn', 'Model validation was skipped.'))
    }

    return {
      checkedAt,
      providerId: provider.summary.id,
      providerName: provider.summary.name,
      baseUrl: provider.summary.baseUrl,
      model: provider.summary.model,
      ok: reportIsOk(checks),
      latencyMs,
      httpStatus,
      availableModels,
      checks
    }
  }

  async function runDoctor(): Promise<DoctorReport> {
    const checkedAt = new Date().toISOString()
    const checks: HealthCheckResult[] = []
    const snapshot = await getSnapshot()

    const loginPortOccupant = await getOpenAiCallbackPortOccupant()
    if (loginPortOccupant) {
      checks.push(
        makeHealthCheck(
          'login-port',
          'warn',
          `Login callback port 1455 is occupied by ${loginPortOccupant.command} (${loginPortOccupant.pid}).`
        )
      )
    } else {
      checks.push(makeHealthCheck('login-port', 'pass', 'Login callback port 1455 is available.'))
    }

    try {
      const command = await resolveCodexLaunchCommand({
        preferAppBundle: true,
        requireDesktopExecutable: true,
        desktopExecutablePath: await getDesktopExecutablePathOverride()
      })
      checks.push(
        makeHealthCheck('codex-desktop', 'pass', `Codex desktop executable resolved: ${command}`)
      )
    } catch (error) {
      checks.push(
        makeHealthCheck(
          'codex-desktop',
          'fail',
          'Codex desktop executable could not be resolved.',
          error instanceof Error ? error.message : 'Unknown error'
        )
      )
    }

    if (!snapshot.currentSession) {
      checks.push(
        makeHealthCheck('current-session', 'warn', 'No current global Codex session was detected.')
      )
    } else if (!snapshot.currentSession.storedAccountId) {
      checks.push(
        makeHealthCheck(
          'current-session',
          'warn',
          'Current global Codex session is not imported into CodexDock.'
        )
      )
    } else {
      try {
        await prepareLaunchAuthPayload(snapshot.currentSession.storedAccountId)
        const account = await store.getAccountSummary(snapshot.currentSession.storedAccountId)
        checks.push(
          makeHealthCheck(
            'current-session',
            'pass',
            `Current managed session is ready: ${accountErrorLabel(account)}`
          )
        )
      } catch (error) {
        checks.push(
          makeHealthCheck(
            'current-session',
            'fail',
            'Current managed session could not be prepared for launch.',
            error instanceof Error ? error.message : 'Unknown error'
          )
        )
      }
    }

    const providers = await providerStore.list()
    if (!providers.length) {
      checks.push(makeHealthCheck('providers', 'pass', 'No custom providers are configured.'))
    } else {
      const brokenProviders: string[] = []
      for (const provider of providers) {
        try {
          await providerStore.getResolvedProvider(provider.id)
        } catch (error) {
          brokenProviders.push(
            `${customProviderLabel(provider)}: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }

      checks.push(
        brokenProviders.length
          ? makeHealthCheck(
              'providers',
              'fail',
              `${brokenProviders.length} custom provider(s) need attention.`,
              brokenProviders.join('\n')
            )
          : makeHealthCheck(
              'providers',
              'pass',
              `All ${providers.length} custom provider(s) can be loaded locally.`
            )
      )
    }

    return {
      checkedAt,
      ok: reportIsOk(checks),
      checks
    }
  }

  return {
    checkProvider,
    runDoctor
  }
}
