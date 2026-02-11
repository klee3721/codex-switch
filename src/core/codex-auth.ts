import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { AuthTokens } from './types'

const REFRESH_ENDPOINT = 'https://auth.openai.com/oauth/token'
const REFRESH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_LOGIN_CONFIG = ['-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"'] as const

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

  const tmpPath = `${tokens.authPath}.tmp`
  await fs.mkdir(path.dirname(tokens.authPath), { recursive: true })
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.rename(tmpPath, tokens.authPath)
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

export async function runCodexChatGptLogin(
  profileDir: string,
  options?: { mode?: CodexLoginMode; stdio?: CodexLoginStdio }
) {
  const mode = options?.mode ?? 'browser'
  const stdio = options?.stdio ?? 'inherit'
  await fs.mkdir(profileDir, { recursive: true })
  const args = ['login', ...CHATGPT_LOGIN_CONFIG]
  if (mode === 'device') {
    args.push('--device-auth')
  }

  const result = spawnSync('codex', args, {
    stdio,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: profileDir,
    },
  })

  if (result.error) {
    throw new Error(`Failed to execute codex login: ${result.error.message}`)
  }
  if ((result.status ?? 1) !== 0) {
    const hint =
      mode === 'browser'
        ? 'Direct browser login failed. If you are on a headless terminal, retry with device auth.'
        : 'Device auth login failed.'
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const details = stderr || stdout
    throw new Error(
      `codex login failed with exit code ${result.status ?? 'unknown'}. ${hint}${details ? ` Details: ${details}` : ''}`
    )
  }
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
