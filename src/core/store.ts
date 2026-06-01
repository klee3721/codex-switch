import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState, UsageHealth, UsageSnapshot, UsageWindow } from './types'

const SWITCH_HOME = path.join(os.homedir(), '.codex-switch')
const STATE_PATH = path.join(SWITCH_HOME, 'state.json')
const PROFILES_DIR = path.join(SWITCH_HOME, 'profiles')
const BACKUPS_DIR = path.join(SWITCH_HOME, 'backups')
const CODEX_HOME = path.join(os.homedir(), '.codex')
const CODEX_AUTH_PATH = path.join(CODEX_HOME, 'auth.json')

export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

export function getPaths() {
  return {
    switchHome: SWITCH_HOME,
    statePath: STATE_PATH,
    profilesDir: PROFILES_DIR,
    backupsDir: BACKUPS_DIR,
    codexHome: CODEX_HOME,
    codexAuthPath: CODEX_AUTH_PATH,
  }
}

export async function ensurePrivateDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  await fs.chmod(dirPath, PRIVATE_DIR_MODE)
}

export async function chmodPrivateFile(filePath: string) {
  await fs.chmod(filePath, PRIVATE_FILE_MODE)
}

export async function writePrivateFile(filePath: string, contents: string | Uint8Array) {
  await ensurePrivateDir(path.dirname(filePath))
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(tmpPath, contents, { mode: PRIVATE_FILE_MODE })
  await chmodPrivateFile(tmpPath)
  await fs.rename(tmpPath, filePath)
  await chmodPrivateFile(filePath)
}

export async function copyPrivateFile(sourcePath: string, destinationPath: string) {
  await ensurePrivateDir(path.dirname(destinationPath))
  await fs.copyFile(sourcePath, destinationPath)
  await chmodPrivateFile(destinationPath)
}

export function buildEmptyUsageWindow(): UsageWindow {
  return {
    usedPercent: null,
    remainingPercent: null,
    resetAt: null,
    windowSeconds: null,
  }
}

export function buildEmptyUsageSnapshot(): UsageSnapshot {
  return {
    source: 'wham_usage',
    planType: null,
    status: 'never',
    error: null,
    updatedAt: null,
    last5Hours: buildEmptyUsageWindow(),
    weekly: buildEmptyUsageWindow(),
  }
}

export function buildDefaultState(): AppState {
  return {
    activeAccountId: null,
    accounts: [],
  }
}

export async function ensureSwitchDirs() {
  await ensurePrivateDir(SWITCH_HOME)
  await ensurePrivateDir(PROFILES_DIR)
  await ensurePrivateDir(BACKUPS_DIR)
}

function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function sanitizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return buildDefaultState()
  const candidate = raw as Partial<AppState>
  const accounts = Array.isArray(candidate.accounts)
    ? candidate.accounts
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
          const account = entry as Record<string, unknown>
          const createdAt = typeof account.createdAt === 'number' ? account.createdAt : Date.now()
          const updatedAt = typeof account.updatedAt === 'number' ? account.updatedAt : createdAt
          const usage = account.usage as Record<string, unknown> | undefined

          const status: UsageHealth =
            usage?.status === 'ok' ||
            usage?.status === 'stale' ||
            usage?.status === 'error' ||
            usage?.status === 'relogin_required' ||
            usage?.status === 'never'
              ? usage.status
              : 'never'
          const source: UsageSnapshot['source'] =
            usage?.source === 'codex_session_logs' ? 'codex_session_logs' : 'wham_usage'

          return {
            id: typeof account.id === 'string' ? account.id : `account-${Math.random().toString(36).slice(2, 8)}`,
            label: typeof account.label === 'string' ? account.label : 'Unnamed',
            email: typeof account.email === 'string' ? account.email : null,
            profileDir: typeof account.profileDir === 'string' ? account.profileDir : '',
            authSignature: typeof account.authSignature === 'string' ? account.authSignature : null,
            createdAt,
            updatedAt,
            usage: {
              source,
              planType: typeof usage?.planType === 'string' ? usage.planType : null,
              status,
              error: typeof usage?.error === 'string' ? usage.error : null,
              updatedAt: typeof usage?.updatedAt === 'number' ? usage.updatedAt : null,
              last5Hours: {
                usedPercent: clampPercent(usage?.last5Hours && (usage.last5Hours as Record<string, unknown>).usedPercent),
                remainingPercent: clampPercent(
                  usage?.last5Hours && (usage.last5Hours as Record<string, unknown>).remainingPercent
                ),
                resetAt:
                  usage?.last5Hours && typeof (usage.last5Hours as Record<string, unknown>).resetAt === 'number'
                    ? ((usage.last5Hours as Record<string, unknown>).resetAt as number)
                    : null,
                windowSeconds:
                  usage?.last5Hours && typeof (usage.last5Hours as Record<string, unknown>).windowSeconds === 'number'
                    ? ((usage.last5Hours as Record<string, unknown>).windowSeconds as number)
                    : null,
              },
              weekly: {
                usedPercent: clampPercent(usage?.weekly && (usage.weekly as Record<string, unknown>).usedPercent),
                remainingPercent: clampPercent(usage?.weekly && (usage.weekly as Record<string, unknown>).remainingPercent),
                resetAt:
                  usage?.weekly && typeof (usage.weekly as Record<string, unknown>).resetAt === 'number'
                    ? ((usage.weekly as Record<string, unknown>).resetAt as number)
                    : null,
                windowSeconds:
                  usage?.weekly && typeof (usage.weekly as Record<string, unknown>).windowSeconds === 'number'
                    ? ((usage.weekly as Record<string, unknown>).windowSeconds as number)
                    : null,
              },
            },
          }
        })
        .filter((account) => Boolean(account.profileDir))
    : []

  let activeAccountId = typeof candidate.activeAccountId === 'string' ? candidate.activeAccountId : null
  if (activeAccountId && !accounts.find((account) => account.id === activeAccountId)) {
    activeAccountId = accounts[0]?.id ?? null
  }

  if (!activeAccountId && accounts.length > 0) {
    activeAccountId = accounts[0].id
  }

  return {
    activeAccountId,
    accounts,
  }
}

export async function readState(): Promise<AppState> {
  await ensureSwitchDirs()
  try {
    const contents = await fs.readFile(STATE_PATH, 'utf8')
    try {
      await chmodPrivateFile(STATE_PATH)
    } catch {
      // Older state files should be tightened opportunistically, but a chmod
      // failure should not make the account list disappear.
    }
    const json = JSON.parse(contents) as unknown
    return sanitizeState(json)
  } catch {
    return buildDefaultState()
  }
}

export async function writeState(state: AppState) {
  await ensureSwitchDirs()
  const sanitized = sanitizeState(state)
  await writePrivateFile(STATE_PATH, `${JSON.stringify(sanitized, null, 2)}\n`)
}

export function resolveAccountByIdentifier(state: AppState, identifier: string) {
  const byId = state.accounts.find((account) => account.id === identifier)
  if (byId) return byId

  const normalized = identifier.trim().toLowerCase()
  const byLabel = state.accounts.filter((account) => account.label.trim().toLowerCase() === normalized)
  if (byLabel.length === 1) return byLabel[0]
  if (byLabel.length > 1) {
    throw new Error(`Identifier "${identifier}" matched multiple labels. Use account id instead.`)
  }

  throw new Error(`Account "${identifier}" not found.`)
}
