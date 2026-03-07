import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { AccountRateLimitEntry, AccountRateLimits } from '../shared/codex'

interface JsonRpcSuccess<T> {
  id: number
  result: T
}

interface JsonRpcError {
  id: number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

interface RateLimitWindowPayload {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

interface CreditsPayload {
  hasCredits: boolean
  unlimited: boolean
  balance: number | null
}

interface RateLimitSnapshotPayload {
  limitId: string | null
  limitName: string | null
  primary: RateLimitWindowPayload | null
  secondary: RateLimitWindowPayload | null
  credits: CreditsPayload | null
  planType: string | null
}

interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshotPayload
  rateLimitsByLimitId?: Record<string, RateLimitSnapshotPayload>
}

function mapRateLimitEntry(payload: RateLimitSnapshotPayload): AccountRateLimitEntry {
  return {
    limitId: payload.limitId,
    limitName: payload.limitName,
    planType: payload.planType,
    primary: payload.primary,
    secondary: payload.secondary
  }
}

function mapRateLimits(payload: GetAccountRateLimitsResponse): AccountRateLimits {
  const limits = Object.values(payload.rateLimitsByLimitId ?? {}).map(mapRateLimitEntry)

  return {
    limitId: payload.rateLimits.limitId,
    limitName: payload.rateLimits.limitName,
    planType: payload.rateLimits.planType,
    primary: payload.rateLimits.primary,
    secondary: payload.rateLimits.secondary,
    credits: payload.rateLimits.credits,
    limits,
    fetchedAt: new Date().toISOString()
  }
}

export async function readAccountRateLimits(): Promise<AccountRateLimits> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })

    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })
    let settled = false
    let initializeCompleted = false
    const timeout = setTimeout(() => {
      finish(new Error('Timed out while reading Codex rate limits.'))
    }, 15000)

    function cleanup(): void {
      clearTimeout(timeout)
      stdout.close()
      stderr.close()
      if (!child.killed) {
        child.kill('SIGTERM')
      }
    }

    function finish(error?: Error, result?: AccountRateLimits): void {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (error) {
        reject(error)
        return
      }

      resolve(result!)
    }

    function sendRequest(id: number, method: string, params?: unknown): void {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          ...(params === undefined ? {} : { params })
        })}\n`
      )
    }

    stdout.on('line', (line) => {
      if (!line.trim()) {
        return
      }

      try {
        const message = JSON.parse(line) as
          | JsonRpcSuccess<GetAccountRateLimitsResponse>
          | JsonRpcError

        if ('error' in message) {
          finish(new Error(message.error.message))
          return
        }

        if (message.id === 1) {
          initializeCompleted = true
          sendRequest(2, 'account/rateLimits/read')
          return
        }

        if (message.id === 2) {
          finish(undefined, mapRateLimits(message.result))
        }
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error('Failed to parse Codex app-server response.')
        )
      }
    })

    stderr.on('line', (line) => {
      if (!line.trim() || initializeCompleted) {
        return
      }

      finish(new Error(line))
    })

    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(new Error(`Codex app-server exited with code ${code}.`))
      }
    })

    sendRequest(1, 'initialize', {
      clientInfo: {
        name: 'ilovecodex',
        title: 'Ilovecodex',
        version: '1.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    })
  })
}
