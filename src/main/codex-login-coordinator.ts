import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import type { AppSnapshot, LoginAttempt, LoginEvent, LoginMethod } from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { CodexAccountStore } from './codex-account-store'
import {
  type CodexAuthPayload,
  type LoginSession,
  type TokenEndpointPayload,
  OPENAI_CALLBACK_PORT,
  OPENAI_DEVICE_CODE_URL,
  OPENAI_DEVICE_REDIRECT_URI,
  OPENAI_DEVICE_TOKEN_URL,
  OPENAI_DEVICE_VERIFICATION_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_TOKEN_URL,
  base64UrlEncode,
  buildAuthPayloadFromTokenResponse,
  buildAuthorizeUrl,
  createPkceChallenge,
  createPkceVerifier,
  encodeFormComponent,
  getOpenAiCallbackPortOccupant,
  parseTokenEndpointError
} from './codex-auth-shared'

export class CodexLoginCoordinator {
  private currentSession?: LoginSession

  constructor(
    private readonly store: CodexAccountStore,
    private readonly emit: (event: LoginEvent) => void,
    private readonly platform: CodexPlatformAdapter,
    private readonly loadImmediateSnapshot?: () => Promise<AppSnapshot | undefined>,
    private readonly loadHydratedSnapshot?: () => Promise<AppSnapshot | undefined>
  ) {}

  isRunning(): boolean {
    return Boolean(this.currentSession)
  }

  async start(method: LoginMethod): Promise<LoginAttempt> {
    if (this.currentSession) {
      if (this.currentSession.method === method) {
        this.emitCurrentSession(this.currentSession)
        return {
          attemptId: this.currentSession.attemptId,
          method
        }
      }

      await this.cancelAndWait()
    }

    return method === 'device' ? this.startDeviceLogin() : this.startBrowserLogin()
  }

  async cancel(): Promise<void> {
    if (!this.currentSession) {
      return
    }

    const session = this.currentSession
    session.cancelled = true
    session.abortController?.abort()

    if (session.server) {
      await this.closeServer(session.server)
    }

    this.currentSession = undefined
  }

  private emitCurrentSession(session: LoginSession): void {
    const phase =
      session.authUrl || session.redirectUri || session.verificationUrl || session.userCode
        ? 'waiting'
        : 'starting'

    this.emit({
      attemptId: session.attemptId,
      method: session.method,
      phase,
      message:
        phase === 'waiting'
          ? session.method === 'device'
            ? 'Open the verification page and enter the device code.'
            : 'Callback login is waiting for the OpenAI authorization callback.'
          : session.method === 'device'
            ? 'Started device code login.'
            : 'Started callback login.',
      authUrl: session.authUrl,
      localCallbackUrl: session.redirectUri,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      rawOutput: session.rawOutput
    })
  }

  private async resolveImmediateSnapshot(): Promise<AppSnapshot | undefined> {
    if (!this.loadImmediateSnapshot) {
      try {
        return await this.store.getSnapshot(false)
      } catch {
        return undefined
      }
    }

    try {
      return await this.loadImmediateSnapshot()
    } catch {
      return undefined
    }
  }

  private async resolveSnapshot(): Promise<AppSnapshot | undefined> {
    if (!this.loadHydratedSnapshot) {
      return this.resolveImmediateSnapshot()
    }

    try {
      return await this.loadHydratedSnapshot()
    } catch {
      return undefined
    }
  }

  private emitHydratedSuccess(
    event: Omit<LoginEvent, 'snapshot'>,
    immediateSnapshot: AppSnapshot | undefined
  ): void {
    if (!this.loadHydratedSnapshot) {
      return
    }

    void this.resolveSnapshot().then((snapshot) => {
      if (!snapshot || snapshot === immediateSnapshot) {
        return
      }

      this.emit({
        ...event,
        snapshot
      })
    })
  }

  private async startBrowserLogin(): Promise<LoginAttempt> {
    const attemptId = randomUUID()
    const state = base64UrlEncode(randomBytes(24))
    const codeVerifier = createPkceVerifier()
    const codeChallenge = createPkceChallenge(codeVerifier)
    const abortController = new AbortController()
    const server = createServer()
    const session: LoginSession = {
      attemptId,
      method: 'browser',
      server,
      abortController,
      rawOutput: '',
      cancelled: false
    }

    this.currentSession = session
    this.emit({
      attemptId,
      method: 'browser',
      phase: 'starting',
      message: 'Started callback login.'
    })

    const authCompletion = new Promise<void>((resolve, reject) => {
      server.on('request', (request, response) => {
        if (!request.url) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Missing request URL.')
          return
        }

        const callbackUrl = new URL(request.url, 'http://localhost')
        if (callbackUrl.pathname !== '/auth/callback') {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Not found.')
          return
        }

        if (callbackUrl.searchParams.get('state') !== state) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Invalid OAuth state.')
          reject(new Error('Invalid OAuth state returned from OpenAI.'))
          return
        }

        const code = callbackUrl.searchParams.get('code')
        const error = callbackUrl.searchParams.get('error')
        if (error) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          response.end(
            '<h1>Login failed</h1><p>You can close this window and return to CodexDock.</p>'
          )
          reject(new Error(`OpenAI login failed: ${error}`))
          return
        }

        if (!code) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Missing authorization code.')
          reject(new Error('OpenAI did not return an authorization code.'))
          return
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(
          '<h1>Login complete</h1><p>You can close this tab and return to CodexDock.</p>'
        )

        void this.finishBrowserLogin(attemptId, code, codeVerifier, abortController.signal)
          .then(resolve)
          .catch(reject)
      })
    })
    void authCompletion.catch(() => undefined)

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(OPENAI_CALLBACK_PORT, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Failed to start the local OAuth callback server.')
      }

      const localCallbackUrl = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`
      const authUrl = buildAuthorizeUrl(localCallbackUrl, codeChallenge, state)
      session.authUrl = authUrl
      session.redirectUri = localCallbackUrl

      session.rawOutput = `${authUrl}\n${localCallbackUrl}\n`
      this.emit({
        attemptId,
        method: 'browser',
        phase: 'waiting',
        message: 'Callback login is waiting for the OpenAI authorization callback.',
        authUrl,
        localCallbackUrl,
        rawOutput: session.rawOutput
      })
    } catch (error) {
      if (this.currentSession?.attemptId === attemptId) {
        this.currentSession = undefined
      }
      if (server.listening) {
        await this.closeServer(server)
      }
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') {
        const occupant = await getOpenAiCallbackPortOccupant()
        if (occupant) {
          throw new Error(
            `1455 端口已被 ${occupant.command} (${occupant.pid}) 占用，请先结束该进程。`
          )
        }

        throw new Error('1455 端口已被占用，请先释放后再发起回调登录。')
      }
      throw error
    }

    void authCompletion.catch(async (error) => {
      if (this.currentSession?.attemptId !== attemptId) {
        return
      }

      this.currentSession = undefined
      await this.closeServer(server)
      this.emit({
        attemptId,
        method: 'browser',
        phase: session.cancelled ? 'cancelled' : 'error',
        message: session.cancelled
          ? 'Cancelled login flow.'
          : error instanceof Error
            ? error.message
            : 'Callback login failed.',
        rawOutput: session.rawOutput,
        snapshot: await this.resolveImmediateSnapshot()
      })
    })

    return { attemptId, method: 'browser' }
  }

  private async startDeviceLogin(): Promise<LoginAttempt> {
    const attemptId = randomUUID()
    const abortController = new AbortController()
    const session: LoginSession = {
      attemptId,
      method: 'device',
      abortController,
      rawOutput: '',
      cancelled: false
    }

    this.currentSession = session
    this.emit({
      attemptId,
      method: 'device',
      phase: 'starting',
      message: 'Started device code login.'
    })

    try {
      const challenge = await this.requestDeviceCode(abortController.signal)
      if (this.currentSession?.attemptId !== attemptId) {
        return { attemptId, method: 'device' }
      }

      session.verificationUrl = challenge.verificationUrl
      session.userCode = challenge.userCode
      session.rawOutput = `${challenge.verificationUrl}\n${challenge.userCode}\n`

      this.emit({
        attemptId,
        method: 'device',
        phase: 'waiting',
        message: 'Open the verification page and enter the device code.',
        verificationUrl: challenge.verificationUrl,
        userCode: challenge.userCode,
        rawOutput: session.rawOutput
      })

      void this.finishDeviceLogin(attemptId, challenge, abortController.signal).catch(
        async (error) => {
          if (this.currentSession?.attemptId !== attemptId) {
            return
          }

          this.currentSession = undefined
          this.emit({
            attemptId,
            method: 'device',
            phase: session.cancelled ? 'cancelled' : 'error',
            message: session.cancelled
              ? 'Cancelled login flow.'
              : error instanceof Error
                ? error.message
                : 'Device code login failed.',
            verificationUrl: session.verificationUrl,
            userCode: session.userCode,
            rawOutput: session.rawOutput,
            snapshot: await this.resolveImmediateSnapshot()
          })
        }
      )
    } catch (error) {
      if (this.currentSession?.attemptId === attemptId) {
        this.currentSession = undefined
      }
      throw error
    }

    return { attemptId, method: 'device' }
  }

  private async cancelAndWait(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      return
    }

    session.cancelled = true
    session.abortController?.abort()

    if (session.server) {
      await this.closeServer(session.server)
    }

    this.currentSession = undefined
  }

  private async finishBrowserLogin(
    attemptId: string,
    code: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<void> {
    const session = this.currentSession
    if (!session || session.attemptId !== attemptId) {
      return
    }

    const server = session.server
    if (!server || !session.redirectUri) {
      throw new Error('The local OAuth callback server is unavailable.')
    }

    const auth = await this.exchangeBrowserCode(code, codeVerifier, session.redirectUri, signal)
    await this.store.importAuthPayload(auth)

    this.currentSession = undefined
    await this.closeServer(server)
    const successEvent: Omit<LoginEvent, 'snapshot'> = {
      attemptId,
      method: 'browser',
      phase: 'success',
      message: 'Saved the new callback login to the local account vault.',
      rawOutput: session.rawOutput
    }
    const immediateSnapshot = await this.resolveImmediateSnapshot()
    this.emit({
      ...successEvent,
      snapshot: immediateSnapshot
    })
    this.emitHydratedSuccess(successEvent, immediateSnapshot)
  }

  private async exchangeBrowserCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    signal: AbortSignal
  ): Promise<CodexAuthPayload> {
    const body = [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', redirectUri],
      ['client_id', OPENAI_OAUTH_CLIENT_ID],
      ['code_verifier', codeVerifier]
    ]
      .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
      .join('&')

    const response = await this.platform.fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal
    })
    const raw = await response.text()

    if (!response.ok) {
      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI token exchange failed (${response.status}): ${detail}`)
    }

    return buildAuthPayloadFromTokenResponse(JSON.parse(raw) as TokenEndpointPayload)
  }

  private async requestDeviceCode(signal: AbortSignal): Promise<{
    deviceAuthId: string
    userCode: string
    verificationUrl: string
    intervalSeconds: number
  }> {
    const response = await this.platform.fetch(OPENAI_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: OPENAI_OAUTH_CLIENT_ID
      }),
      signal
    })
    const raw = await response.text()

    if (!response.ok) {
      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI device code request failed (${response.status}): ${detail}`)
    }

    const parsed = JSON.parse(raw) as {
      device_auth_id?: string
      user_code?: string
      interval?: number
    }

    if (!parsed.device_auth_id || !parsed.user_code) {
      throw new Error('OpenAI device code response is missing required fields.')
    }

    return {
      deviceAuthId: parsed.device_auth_id,
      userCode: parsed.user_code,
      verificationUrl: OPENAI_DEVICE_VERIFICATION_URL,
      intervalSeconds: Math.max(1, parsed.interval ?? 5)
    }
  }

  private async finishDeviceLogin(
    attemptId: string,
    challenge: {
      deviceAuthId: string
      userCode: string
      verificationUrl: string
      intervalSeconds: number
    },
    signal: AbortSignal
  ): Promise<void> {
    const session = this.currentSession
    if (!session || session.attemptId !== attemptId) {
      return
    }

    const tokenExchange = await this.pollDeviceAuthorization(challenge, signal)
    const auth = await this.exchangeDeviceCode(
      tokenExchange.authorizationCode,
      tokenExchange.codeVerifier,
      signal
    )
    await this.store.importAuthPayload(auth)

    this.currentSession = undefined
    const successEvent: Omit<LoginEvent, 'snapshot'> = {
      attemptId,
      method: 'device',
      phase: 'success',
      message: 'Saved the new device code login to the local account vault.',
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      rawOutput: session.rawOutput
    }
    const immediateSnapshot = await this.resolveImmediateSnapshot()
    this.emit({
      ...successEvent,
      snapshot: immediateSnapshot
    })
    this.emitHydratedSuccess(successEvent, immediateSnapshot)
  }

  private async pollDeviceAuthorization(
    challenge: {
      deviceAuthId: string
      userCode: string
      intervalSeconds: number
    },
    signal: AbortSignal
  ): Promise<{ authorizationCode: string; codeVerifier: string }> {
    while (!signal.aborted) {
      const response = await this.platform.fetch(OPENAI_DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          device_auth_id: challenge.deviceAuthId,
          user_code: challenge.userCode
        }),
        signal
      })
      const raw = await response.text()

      if (response.ok) {
        const parsed = JSON.parse(raw) as {
          authorization_code?: string
          code_verifier?: string
        }

        if (!parsed.authorization_code || !parsed.code_verifier) {
          throw new Error('OpenAI device token response is missing required fields.')
        }

        return {
          authorizationCode: parsed.authorization_code,
          codeVerifier: parsed.code_verifier
        }
      }

      if ([400, 403, 404, 428].includes(response.status)) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, challenge.intervalSeconds * 1000)
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout)
              reject(new Error('Cancelled login flow.'))
            },
            { once: true }
          )
        })
        continue
      }

      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI device token polling failed (${response.status}): ${detail}`)
    }

    throw new Error('Cancelled login flow.')
  }

  private async exchangeDeviceCode(
    code: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<CodexAuthPayload> {
    const body = [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', OPENAI_DEVICE_REDIRECT_URI],
      ['client_id', OPENAI_OAUTH_CLIENT_ID],
      ['code_verifier', codeVerifier]
    ]
      .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
      .join('&')

    const response = await this.platform.fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal
    })
    const raw = await response.text()

    if (!response.ok) {
      const detail = parseTokenEndpointError(raw)
      throw new Error(`OpenAI token exchange failed (${response.status}): ${detail}`)
    }

    return buildAuthPayloadFromTokenResponse(JSON.parse(raw) as TokenEndpointPayload)
  }

  private async closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
