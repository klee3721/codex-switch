import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chmodPrivateFile, ensurePrivateDir, writePrivateFile } from './store'
import type { AuthTokens } from './types'

const REFRESH_ENDPOINT = 'https://auth.openai.com/oauth/token'
const REFRESH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_LOGIN_CONFIG = ['-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"'] as const
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const LOGIN_AUTH_POLL_MS = 500
const MAX_LOGIN_OUTPUT_CHARS = 20_000

export type CodexLoginMode = 'browser' | 'device'
export type CodexLoginStdio = 'inherit' | 'pipe'

function parseLastRefresh(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed)
}

export async function readAuthFile(profileDir: string) {
  const authPath = path.join(profileDir, 'auth.json')
  const raw = await fs.readFile(authPath, 'utf8')
  await ensurePrivateDir(profileDir)
  await chmodPrivateFile(authPath)
  const json = JSON.parse(raw) as Record<string, unknown>
  return { authPath, json }
}

export function extractAuthTokens(authPath: string, json: Record<string, unknown>): AuthTokens {
  const apiKey = typeof json.OPENAI_API_KEY === 'string' ? json.OPENAI_API_KEY.trim() : ''
  if (apiKey) {
    return {
      accessToken: apiKey,
      refreshToken: null,
      idToken: null,
      accountId: null,
      authMode: typeof json.auth_mode === 'string' ? json.auth_mode : 'api_key',
      lastRefresh: parseLastRefresh(json.last_refresh),
      authPath,
      raw: json,
    }
  }

  const tokens = (json.tokens ?? {}) as Record<string, unknown>
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null
  const idToken = typeof tokens.id_token === 'string' ? tokens.id_token : null
  const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : null

  if (!accessToken) {
    throw new Error(`No access token found in ${authPath}`)
  }

  return {
    accessToken,
    refreshToken,
    idToken,
    accountId,
    authMode: typeof json.auth_mode === 'string' ? json.auth_mode : null,
    lastRefresh: parseLastRefresh(json.last_refresh),
    authPath,
    raw: json,
  }
}

export function validateChatGptAuth(tokens: AuthTokens) {
  if (!tokens.accessToken) {
    throw new Error('Auth file has no access token.')
  }

  if (tokens.authMode && tokens.authMode !== 'chatgpt' && tokens.authMode !== 'api_key') {
    throw new Error(`Unexpected auth_mode "${tokens.authMode}". Expected chatgpt.`)
  }
}

export async function saveAuthTokens(tokens: AuthTokens) {
  const nextTokens: Record<string, unknown> = {
    ...((tokens.raw.tokens ?? {}) as Record<string, unknown>),
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  }

  if (tokens.idToken) {
    nextTokens.id_token = tokens.idToken
  }
  if (tokens.accountId) {
    nextTokens.account_id = tokens.accountId
  }

  const payload = {
    ...tokens.raw,
    auth_mode: tokens.raw.auth_mode ?? 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: nextTokens,
  }

  await writePrivateFile(tokens.authPath, `${JSON.stringify(payload, null, 2)}\n`)
}

export function needsRefresh(tokens: AuthTokens) {
  if (!tokens.refreshToken) return false
  if (!tokens.lastRefresh) return true
  const ageMs = Date.now() - tokens.lastRefresh.getTime()
  const refreshAfterMs = 8 * 24 * 60 * 60 * 1000
  return ageMs > refreshAfterMs
}

export async function refreshTokens(tokens: AuthTokens): Promise<AuthTokens> {
  if (!tokens.refreshToken) return tokens

  const response = await fetch(REFRESH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: REFRESH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      scope: 'openid profile email',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OAuth refresh failed (${response.status}): ${body}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const next: AuthTokens = {
    ...tokens,
    accessToken: typeof payload.access_token === 'string' ? payload.access_token : tokens.accessToken,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : tokens.refreshToken,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : tokens.idToken,
    lastRefresh: new Date(),
  }

  await saveAuthTokens(next)
  return next
}

async function readValidAuthSnapshot(profileDir: string) {
  const authPath = path.join(profileDir, 'auth.json')

  try {
    const raw = await fs.readFile(authPath, 'utf8')
    const json = JSON.parse(raw) as Record<string, unknown>
    const tokens = extractAuthTokens(authPath, json)
    validateChatGptAuth(tokens)
    return raw
  } catch {
    return null
  }
}

function appendLoginOutput(current: string, chunk: unknown) {
  const next = `${current}${String(chunk)}`
  return next.length > MAX_LOGIN_OUTPUT_CHARS ? next.slice(-MAX_LOGIN_OUTPUT_CHARS) : next
}

function formatLoginFailure(
  mode: CodexLoginMode,
  reason: string,
  stdout: string,
  stderr: string,
  exitCode?: number | null
) {
  const hint =
    mode === 'browser'
      ? 'Direct browser login did not complete. If the browser handoff is stuck, retry with device auth.'
      : 'Device auth login did not complete.'
  const details = (stderr.trim() || stdout.trim()).trim()
  const exitText = exitCode == null ? '' : ` with exit code ${exitCode}`
  return `codex login failed${exitText}. ${reason} ${hint}${details ? ` Details: ${details}` : ''}`
}

export async function runCodexChatGptLogin(
  profileDir: string,
  options?: { mode?: CodexLoginMode; stdio?: CodexLoginStdio; timeoutMs?: number }
) {
  const mode = options?.mode ?? 'browser'
  const stdio = options?.stdio ?? 'inherit'
  const timeoutMs = options?.timeoutMs ?? LOGIN_TIMEOUT_MS
  await ensurePrivateDir(profileDir)
  const initialAuthSnapshot = await readValidAuthSnapshot(profileDir)
  const args = ['login', ...CHATGPT_LOGIN_CONFIG]
  if (mode === 'device') {
    args.push('--device-auth')
  }

  await new Promise<void>((resolve, reject) => {
    const result = spawn('codex', args, {
      stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODEX_HOME: profileDir,
      },
    })

    let settled = false
    let closed = false
    let sentTermination = false
    let stdout = ''
    let stderr = ''
    let isPollingAuth = false
    let failureReason = 'The login command exited before writing valid auth.'
    let authPoll: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null
    let forceKill: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (authPoll) clearInterval(authPoll)
      if (timeout) clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const stopLoginProcess = () => {
      if (closed || sentTermination) return
      sentTermination = true
      result.kill('SIGTERM')
      forceKill = setTimeout(() => {
        if (!closed) {
          result.kill('SIGKILL')
        }
      }, 2_000)
    }

    const hasNewValidAuth = async () => {
      const snapshot = await readValidAuthSnapshot(profileDir)
      return snapshot != null && snapshot !== initialAuthSnapshot
    }

    result.stdout?.setEncoding('utf8')
    result.stderr?.setEncoding('utf8')
    result.stdout?.on('data', (chunk) => {
      stdout = appendLoginOutput(stdout, chunk)
    })
    result.stderr?.on('data', (chunk) => {
      stderr = appendLoginOutput(stderr, chunk)
    })

    result.on('error', (error) => {
      finish(() => reject(new Error(`Failed to execute codex login: ${error.message}`)))
    })

    result.on('close', (code) => {
      closed = true
      void (async () => {
        if (settled) return
        if ((code ?? 1) === 0 || (await hasNewValidAuth())) {
          finish(resolve)
          return
        }

        finish(() =>
          reject(new Error(formatLoginFailure(mode, failureReason, stdout, stderr, code)))
        )
      })()
    })

    authPoll = setInterval(() => {
      if (settled || isPollingAuth) return
      isPollingAuth = true
      void (async () => {
        try {
          if (await hasNewValidAuth()) {
            stopLoginProcess()
          }
        } finally {
          isPollingAuth = false
        }
      })()
    }, LOGIN_AUTH_POLL_MS)

    timeout = setTimeout(() => {
      void (async () => {
        if (settled) return
        if (await hasNewValidAuth()) {
          stopLoginProcess()
          return
        }

        failureReason = 'Timed out waiting for authentication.'
        stopLoginProcess()
      })()
    }, timeoutMs)
  })

  await chmodPrivateFile(path.join(profileDir, 'auth.json'))
}

function decodeBase64Url(input: string) {
  let normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  while (normalized.length % 4 !== 0) {
    normalized += '='
  }
  return Buffer.from(normalized, 'base64').toString('utf8')
}

export function extractEmailFromIdToken(idToken: string | null) {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length < 2) return null

  try {
    const payloadRaw = decodeBase64Url(parts[1] ?? '')
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>
    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : null

    return email && email.includes('@') ? email : null
  } catch {
    return null
  }
}
