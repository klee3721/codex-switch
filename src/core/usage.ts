import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isBlockedAccountMessage } from './account-health'
import { extractAuthTokens, needsRefresh, readAuthFile, refreshTokens, validateChatGptAuth } from './codex-auth'
import type { AuthTokens, UsageApiResponse, UsageApiWindow, UsageSnapshot, UsageWindow } from './types'

const DEFAULT_CHATGPT_BASE = 'https://chatgpt.com/backend-api/'
const CHATGPT_USAGE_PATH = '/wham/usage'
const GENERIC_USAGE_PATH = '/api/codex/usage'
const REQUEST_TIMEOUT_MS = 15_000

export type UsageFetchErrorKind = 'relogin_required' | 'request_failed' | 'network' | 'parse_failed'

export class UsageFetchError extends Error {
  constructor(
    public readonly kind: UsageFetchErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'UsageFetchError'
  }
}

function normalizeBaseUrl(url: string) {
  let trimmed = url.trim()
  if (!trimmed) {
    trimmed = DEFAULT_CHATGPT_BASE
  }
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1)
  }
  if (
    (trimmed.startsWith('https://chatgpt.com') || trimmed.startsWith('https://chat.openai.com')) &&
    !trimmed.includes('/backend-api')
  ) {
    trimmed += '/backend-api'
  }
  return trimmed
}

function parseChatgptBaseUrl(contents: string): string | null {
  const lines = contents.split(/\r?\n/)
  for (const line of lines) {
    const noComment = (line.split('#', 1)[0] ?? '').trim()
    if (!noComment) continue
    const parts = noComment.split('=', 2)
    if (parts.length !== 2) continue
    if ((parts[0] ?? '').trim() !== 'chatgpt_base_url') continue
    let value = (parts[1] ?? '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    value = value.trim()
    if (value) return value
  }
  return null
}

export async function resolveUsageUrl(profileDir: string) {
  const configPath = path.join(profileDir, 'config.toml')
  let base = DEFAULT_CHATGPT_BASE

  try {
    const config = await fs.readFile(configPath, 'utf8')
    const parsed = parseChatgptBaseUrl(config)
    if (parsed) {
      base = parsed
    }
  } catch {
    // Missing config is fine; use default.
  }

  const normalized = normalizeBaseUrl(base)
  const pathName = normalized.includes('/backend-api') ? CHATGPT_USAGE_PATH : GENERIC_USAGE_PATH
  return `${normalized}${pathName}`
}

function clampPercent(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function mapWindow(window: UsageApiWindow | null | undefined): UsageWindow {
  const usedPercent = clampPercent(window?.used_percent)
  return {
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAt: typeof window?.reset_at === 'number' ? window.reset_at : null,
    windowSeconds: typeof window?.limit_window_seconds === 'number' ? window.limit_window_seconds : null,
  }
}

function isWindowEmpty(window: UsageWindow) {
  return (
    window.usedPercent == null &&
    window.remainingPercent == null &&
    window.resetAt == null &&
    window.windowSeconds == null
  )
}

async function fetchUsage(tokens: AuthTokens, usageUrl: string): Promise<UsageApiResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'codex-switch/0.1',
    }
    if (tokens.accountId) {
      headers['ChatGPT-Account-Id'] = tokens.accountId
    }

    const response = await fetch(usageUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      const body = await response.text()
      if (isBlockedAccountMessage(body)) {
        throw new UsageFetchError('request_failed', `Account unavailable: ${body.slice(0, 240)}`)
      }
      throw new UsageFetchError('relogin_required', 'ChatGPT token expired or invalid. Re-login is required.')
    }

    if (!response.ok) {
      const body = await response.text()
      if (isBlockedAccountMessage(body)) {
        throw new UsageFetchError('request_failed', `Account unavailable: ${body.slice(0, 240)}`)
      }
      throw new UsageFetchError('request_failed', `Usage API returned ${response.status}: ${body.slice(0, 240)}`)
    }

    let json: unknown
    try {
      json = (await response.json()) as unknown
    } catch (error) {
      throw new UsageFetchError('parse_failed', `Failed to parse usage JSON: ${(error as Error).message}`)
    }

    if (!json || typeof json !== 'object') {
      throw new UsageFetchError('parse_failed', 'Usage response is not an object.')
    }

    return json as UsageApiResponse
  } catch (error) {
    if (error instanceof UsageFetchError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UsageFetchError('network', 'Usage request timed out.')
    }
    throw new UsageFetchError('network', `Usage request failed: ${(error as Error).message}`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchUsageForProfile(profileDir: string): Promise<UsageSnapshot> {
  const { authPath, json } = await readAuthFile(profileDir)
  let tokens = extractAuthTokens(authPath, json)
  validateChatGptAuth(tokens)

  if (needsRefresh(tokens)) {
    try {
      tokens = await refreshTokens(tokens)
    } catch {
      // Keep using existing access token when refresh fails.
    }
  }

  const usageUrl = await resolveUsageUrl(profileDir)
  const usage = await fetchUsage(tokens, usageUrl)
  const primary = mapWindow(usage.rate_limit?.primary_window)
  let weekly = mapWindow(usage.rate_limit?.secondary_window)

  // Some plans (for example free) only expose a single weekly window in primary_window.
  if (isWindowEmpty(weekly) && (primary.windowSeconds ?? 0) >= 7 * 24 * 60 * 60) {
    weekly = {
      ...primary,
    }
  }

  return {
    source: 'wham_usage',
    planType: typeof usage.plan_type === 'string' ? usage.plan_type : null,
    status: 'ok',
    error: null,
    updatedAt: Date.now(),
    last5Hours: primary,
    weekly,
  }
}

type SessionRateLimitWindow = {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
}

type SessionRateLimits = {
  primary?: SessionRateLimitWindow
  secondary?: SessionRateLimitWindow
  plan_type?: string | null
}

function mapSessionWindow(window: SessionRateLimitWindow | null | undefined): UsageWindow {
  const usedPercent = clampPercent(window?.used_percent)
  const minutes = typeof window?.window_minutes === 'number' ? window.window_minutes : null
  return {
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAt: typeof window?.resets_at === 'number' ? window.resets_at : null,
    windowSeconds: minutes == null ? null : minutes * 60,
  }
}

function toUsageFromSessionRateLimits(rateLimits: SessionRateLimits, timestamp: number): UsageSnapshot {
  return {
    source: 'codex_session_logs',
    planType: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : null,
    status: 'ok',
    error: null,
    updatedAt: timestamp,
    last5Hours: mapSessionWindow(rateLimits.primary),
    weekly: mapSessionWindow(rateLimits.secondary),
  }
}

async function listRecentSessionFiles(limit = 80) {
  const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')
  const result: string[] = []

  const listSortedDesc = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en'))
  }

  try {
    const years = await listSortedDesc(sessionsRoot)
    for (const year of years) {
      const yearPath = path.join(sessionsRoot, year)
      const months = await listSortedDesc(yearPath)
      for (const month of months) {
        const monthPath = path.join(yearPath, month)
        const days = await listSortedDesc(monthPath)
        for (const day of days) {
          const dayPath = path.join(monthPath, day)
          const files = (await fs.readdir(dayPath, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
            .map((entry) => path.join(dayPath, entry.name))
            .sort((a, b) => b.localeCompare(a, 'en'))

          for (const filePath of files) {
            result.push(filePath)
            if (result.length >= limit) {
              return result
            }
          }
        }
      }
    }
  } catch {
    return []
  }

  return result
}

function parseSessionLineForRateLimits(line: string): { rateLimits: SessionRateLimits; timestamp: number } | null {
  if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) return null
  let json: unknown
  try {
    json = JSON.parse(line) as unknown
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null

  const entry = json as Record<string, unknown>
  if (entry.type !== 'event_msg') return null

  const payload = entry.payload as Record<string, unknown> | undefined
  if (!payload || payload.type !== 'token_count') return null

  const rateLimits = payload.rate_limits as Record<string, unknown> | undefined
  if (!rateLimits) return null

  const primary = (rateLimits.primary ?? undefined) as SessionRateLimitWindow | undefined
  const secondary = (rateLimits.secondary ?? undefined) as SessionRateLimitWindow | undefined
  if (!primary && !secondary) return null

  const timestampRaw = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  const timestamp = Number.isNaN(timestampRaw) ? Date.now() : timestampRaw

  return {
    rateLimits: {
      primary,
      secondary,
      plan_type: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : null,
    },
    timestamp,
  }
}

export async function fetchLatestUsageFromCodexSessions(): Promise<UsageSnapshot | null> {
  const files = await listRecentSessionFiles()
  for (const filePath of files) {
    try {
      const contents = await fs.readFile(filePath, 'utf8')
      const lines = contents.split(/\r?\n/)
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]
        if (!line) continue
        const parsed = parseSessionLineForRateLimits(line)
        if (!parsed) continue
        return toUsageFromSessionRateLimits(parsed.rateLimits, parsed.timestamp)
      }
    } catch {
      // Try next file.
    }
  }
  return null
}
