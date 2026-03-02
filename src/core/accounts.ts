import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { extractBlockedAccountMessage, isBlockedAccountMessage, isUnusableAccountUsage } from './account-health'
import { fetchLatestUsageFromCodexSessions, fetchUsageForProfile, UsageFetchError } from './usage'
import {
  type CodexLoginStdio,
  extractAuthTokens,
  extractEmailFromIdToken,
  readAuthFile,
  runCodexChatGptLogin,
  type CodexLoginMode,
  validateChatGptAuth,
} from './codex-auth'
import { switchToAccount } from './switch'
import {
  buildEmptyUsageSnapshot,
  buildDefaultState,
  ensureSwitchDirs,
  getPaths,
  readState,
  resolveAccountByIdentifier,
  writeState,
} from './store'
import type { Account, AppState, AuthTokens, SwitchResult, UsageSnapshot } from './types'

const CURRENT_ACCOUNT_LABEL = 'Current Codex'

export type AddAccountResult = {
  account: Account
  warning: string | null
}

export type AddAccountOptions = {
  loginMode?: CodexLoginMode
  loginStdio?: CodexLoginStdio
}

export type RemoveAccountResult = {
  removed: Account
  activeAccountId: string | null
}

export type UseAccountResult = {
  account: Account
  switchResult: SwitchResult
  warning: string | null
}

export type RefreshResult = {
  updated: Account[]
  state: AppState
}

export type EnsureCurrentLinkResult = {
  linked: boolean
  created: boolean
  account: Account | null
  warning: string | null
}

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'account'
}

function createAccountId(label: string) {
  return `${slugify(label)}-${randomUUID().slice(0, 8)}`
}

function sortAccounts(accounts: Account[]) {
  return [...accounts].sort((a, b) => a.createdAt - b.createdAt)
}

async function saveState(state: AppState) {
  const next: AppState = {
    activeAccountId: state.activeAccountId,
    accounts: sortAccounts(state.accounts),
  }
  await writeState(next)
  return next
}

function ensureUniqueLabel(base: string, accounts: Account[]) {
  const existing = new Set(accounts.map((account) => account.label.trim().toLowerCase()))
  if (!existing.has(base.trim().toLowerCase())) return base

  let index = 2
  while (existing.has(`${base} ${index}`.toLowerCase())) {
    index += 1
  }
  return `${base} ${index}`
}

function computeAuthSignature(tokens: AuthTokens) {
  const email = extractEmailFromIdToken(tokens.idToken)
  const hasStableIdentity = Boolean(tokens.accountId || email)
  const seed = hasStableIdentity
    ? [tokens.authMode ?? '', tokens.accountId ?? '', email ?? ''].join('\n')
    : [tokens.authMode ?? '', tokens.accessToken].join('\n')
  return createHash('sha256').update(seed).digest('hex')
}

function isBlockedAccountError(error: unknown, message: string) {
  if (!(error instanceof UsageFetchError)) return false
  if (error.kind !== 'request_failed') return false
  return isBlockedAccountMessage(message)
}

function buildBlockedUsageSnapshot(message: string): UsageSnapshot {
  return {
    ...buildEmptyUsageSnapshot(),
    status: 'error',
    error: message,
    updatedAt: Date.now(),
  }
}

async function syncCurrentCodexFilesToProfile(profileDir: string) {
  const paths = getPaths()
  const profileAuthPath = path.join(profileDir, 'auth.json')
  const profileConfigPath = path.join(profileDir, 'config.toml')
  const sourceConfigPath = path.join(paths.codexHome, 'config.toml')

  await fs.mkdir(profileDir, { recursive: true })
  await fs.copyFile(paths.codexAuthPath, profileAuthPath)

  try {
    await fs.copyFile(sourceConfigPath, profileConfigPath)
  } catch {
    // Config might not exist; ignore.
  }
}

async function resolveUsageSnapshot(profileDir: string): Promise<{ usage: UsageSnapshot; warning: string | null }> {
  try {
    const usage = await fetchUsageForProfile(profileDir)
    return {
      usage,
      warning: null,
    }
  } catch (error) {
    const message = (error as Error).message
    if (isBlockedAccountError(error, message)) {
      return {
        usage: buildBlockedUsageSnapshot(message),
        warning: message,
      }
    }

    if (error instanceof UsageFetchError && error.kind === 'relogin_required') {
      const usage: UsageSnapshot = {
        ...buildEmptyUsageSnapshot(),
        status: 'relogin_required',
        error: message,
        updatedAt: Date.now(),
      }
      return {
        usage,
        warning: message,
      }
    }

    const fallback = await fetchLatestUsageFromCodexSessions()
    if (fallback) {
      return {
        usage: fallback,
        warning: `Live usage API unavailable, using latest Codex session snapshot (${new Date(
          fallback.updatedAt ?? Date.now()
        ).toLocaleString()}).`,
      }
    }

    const usage: UsageSnapshot = {
      ...buildEmptyUsageSnapshot(),
      status: error instanceof UsageFetchError && error.kind === 'relogin_required' ? 'relogin_required' : 'stale',
      error: message,
      updatedAt: Date.now(),
    }

    return {
      usage,
      warning: message,
    }
  }
}

async function syncStoredAccountMetadata(accounts: Account[]) {
  let changed = false
  const next = await Promise.all(
    accounts.map(async (account) => {
      try {
        const { authPath, json } = await readAuthFile(account.profileDir)
        const tokens = extractAuthTokens(authPath, json)
        const authSignature = computeAuthSignature(tokens)
        const email = extractEmailFromIdToken(tokens.idToken)
        if (account.authSignature === authSignature && account.email === (email ?? account.email ?? null)) {
          return account
        }
        changed = true
        return {
          ...account,
          authSignature,
          email: email ?? account.email ?? null,
        }
      } catch {
        return account
      }
    })
  )

  return { accounts: next, changed }
}

function dedupeAccountsBySignature(accounts: Account[], activeAccountId: string | null) {
  const grouped = new Map<string, Account[]>()
  const passthrough: Account[] = []

  for (const account of accounts) {
    if (!account.authSignature) {
      passthrough.push(account)
      continue
    }

    const bucket = grouped.get(account.authSignature)
    if (bucket) {
      bucket.push(account)
    } else {
      grouped.set(account.authSignature, [account])
    }
  }

  let changed = false
  let nextActiveAccountId = activeAccountId
  const deduped = [...passthrough]

  for (const group of grouped.values()) {
    if (group.length === 1) {
      deduped.push(group[0])
      continue
    }

    changed = true
    const preferred =
      group.find((account) => account.id === activeAccountId) ??
      [...group].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
        return b.createdAt - a.createdAt
      })[0]

    if (activeAccountId && group.some((account) => account.id === activeAccountId)) {
      nextActiveAccountId = preferred.id
    }

    deduped.push(preferred)
  }

  return {
    accounts: deduped,
    activeAccountId: nextActiveAccountId,
    changed,
  }
}

async function fetchCurrentCodexTokens() {
  const paths = getPaths()
  const raw = await fs.readFile(paths.codexAuthPath, 'utf8')
  const json = JSON.parse(raw) as Record<string, unknown>
  const tokens = extractAuthTokens(paths.codexAuthPath, json)
  validateChatGptAuth(tokens)
  return { tokens, json }
}

export async function listState() {
  return readState()
}

export async function ensureCurrentCodexLinked(preferredLabel = CURRENT_ACCOUNT_LABEL): Promise<EnsureCurrentLinkResult> {
  await ensureSwitchDirs()

  let tokens: AuthTokens
  try {
    ;({ tokens } = await fetchCurrentCodexTokens())
  } catch {
    return {
      linked: false,
      created: false,
      account: null,
      warning: 'Current Codex account is not logged in yet.',
    }
  }

  const signature = computeAuthSignature(tokens)
  const email = extractEmailFromIdToken(tokens.idToken)
  const state = await readState()
  const synced = await syncStoredAccountMetadata(state.accounts)
  const deduped = dedupeAccountsBySignature(synced.accounts, state.activeAccountId)
  const workingAccounts = deduped.accounts

  const matched = workingAccounts.find((account) => account.authSignature === signature)

  if (matched) {
    await syncCurrentCodexFilesToProfile(matched.profileDir)

    const usageResult = await resolveUsageSnapshot(matched.profileDir)
    const shouldPromoteLabel = matched.label === CURRENT_ACCOUNT_LABEL || matched.label === matched.email
    const nextMatched: Account = {
      ...matched,
      email: email ?? matched.email ?? null,
      label: email && shouldPromoteLabel ? email : matched.label,
      updatedAt: Date.now(),
      usage: usageResult.usage,
    }

    const nextAccounts = workingAccounts.map((account) => (account.id === nextMatched.id ? nextMatched : account))
    const activeChanged = deduped.activeAccountId !== nextMatched.id
    if (activeChanged || synced.changed || deduped.changed || nextMatched !== matched) {
      await saveState({
        activeAccountId: nextMatched.id,
        accounts: nextAccounts,
      })
    }

    return {
      linked: true,
      created: false,
      account: nextMatched,
      warning: usageResult.warning,
    }
  }

  const preferred = email ?? preferredLabel
  const label = ensureUniqueLabel(preferred, workingAccounts)
  const id = createAccountId(label)
  const profileDir = path.join(getPaths().profilesDir, id)

  await syncCurrentCodexFilesToProfile(profileDir)

  const usageResult = await resolveUsageSnapshot(profileDir)

  const account: Account = {
    id,
    label,
    email,
    profileDir,
    authSignature: signature,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    usage: usageResult.usage,
  }

  await saveState({
    activeAccountId: account.id,
    accounts: [...workingAccounts, account],
  })

  return {
    linked: true,
    created: true,
    account,
    warning: usageResult.warning,
  }
}

export async function addAccount(label: string, options?: AddAccountOptions): Promise<AddAccountResult> {
  const trimmed = label.trim()
  if (!trimmed) {
    throw new Error('Label is required.')
  }

  await ensureSwitchDirs()
  const paths = getPaths()
  const state = await readState()

  const duplicateLabel = state.accounts.find(
    (account) => account.label.trim().toLowerCase() === trimmed.toLowerCase()
  )
  if (duplicateLabel) {
    throw new Error(`An account with label "${trimmed}" already exists.`)
  }

  const loginMode: CodexLoginMode = options?.loginMode ?? 'browser'
  const loginStdio: CodexLoginStdio = options?.loginStdio ?? 'inherit'
  const id = createAccountId(trimmed)
  const profileDir = path.join(paths.profilesDir, id)

  await fs.mkdir(profileDir, { recursive: true })

  try {
    await runCodexChatGptLogin(profileDir, {
      mode: loginMode,
      stdio: loginStdio,
    })

    const { authPath, json } = await readAuthFile(profileDir)
    const tokens = extractAuthTokens(authPath, json)
    validateChatGptAuth(tokens)
    const usageResult = await resolveUsageSnapshot(profileDir)
    const warning = usageResult.warning

    const account: Account = {
      id,
      label: trimmed,
      email: extractEmailFromIdToken(tokens.idToken),
      profileDir,
      authSignature: computeAuthSignature(tokens),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usage: usageResult.usage,
    }

    const next: AppState = {
      activeAccountId: state.activeAccountId ?? id,
      accounts: [...state.accounts, account],
    }

    await saveState(next)
    return { account, warning }
  } catch (error) {
    await fs.rm(profileDir, { recursive: true, force: true })
    throw error
  }
}

export async function removeAccount(identifier: string, purge = false): Promise<RemoveAccountResult> {
  const state = await readState()
  if (state.accounts.length === 0) {
    throw new Error('No accounts to remove.')
  }

  const account = resolveAccountByIdentifier(state, identifier)
  const nextAccounts = state.accounts.filter((entry) => entry.id !== account.id)
  const nextActiveId = state.activeAccountId === account.id ? nextAccounts[0]?.id ?? null : state.activeAccountId

  await saveState({
    activeAccountId: nextActiveId,
    accounts: nextAccounts,
  })

  if (purge) {
    await fs.rm(account.profileDir, { recursive: true, force: true })
  }

  return {
    removed: account,
    activeAccountId: nextActiveId,
  }
}

export async function useAccount(identifier: string): Promise<UseAccountResult> {
  const state = await readState()
  if (state.accounts.length === 0) {
    throw new Error('No accounts available.')
  }

  const account = resolveAccountByIdentifier(state, identifier)
  if (isUnusableAccountUsage(account.usage)) {
    throw new Error(`Account "${account.email ?? account.label}" is deleted/deactivated and cannot be used anymore.`)
  }
  if (account.usage.status === 'relogin_required') {
    throw new Error(`Account "${account.email ?? account.label}" cannot be used until you re-login.`)
  }
  const switchResult = await switchToAccount(account)
  const blockedMessage = extractBlockedAccountMessage(
    [switchResult.codexStatusStderr, switchResult.codexStatusStdout].filter(Boolean).join('\n')
  )
  const usageResult = blockedMessage
    ? {
        usage: buildBlockedUsageSnapshot(blockedMessage),
        warning: blockedMessage,
      }
    : await resolveUsageSnapshot(account.profileDir)

  const nextAccounts = state.accounts.map((entry) =>
    entry.id === account.id
      ? {
          ...entry,
          updatedAt: Date.now(),
          usage: usageResult.usage,
        }
      : entry
  )

  await saveState({
    activeAccountId: account.id,
    accounts: nextAccounts,
  })

  const active = nextAccounts.find((entry) => entry.id === account.id) ?? account
  return {
    account: active,
    switchResult,
    warning: usageResult.warning,
  }
}

export async function refreshUsage(options?: { accountId?: string; all?: boolean }): Promise<RefreshResult> {
  const state = await readState()
  if (state.accounts.length === 0) {
    return { updated: [], state }
  }

  const targets = options?.all
    ? state.accounts
    : [
        options?.accountId
          ? resolveAccountByIdentifier(state, options.accountId)
          : state.accounts.find((entry) => entry.id === state.activeAccountId) ?? state.accounts[0],
      ]

  const targetIds = new Set(targets.map((entry) => entry.id))
  const updatedAccounts: Account[] = []

  const nextAccounts = await Promise.all(
    state.accounts.map(async (account) => {
      if (!targetIds.has(account.id)) return account
      const usageResult = await resolveUsageSnapshot(account.profileDir)
      const next = {
        ...account,
        updatedAt: Date.now(),
        usage: usageResult.usage,
      }
      updatedAccounts.push(next)
      return next
    })
  )

  const nextState = await saveState({
    activeAccountId: state.activeAccountId,
    accounts: nextAccounts,
  })

  return {
    updated: updatedAccounts,
    state: nextState,
  }
}

export function getActiveAccount(state: AppState) {
  if (!state.accounts.length) return null
  return state.accounts.find((account) => account.id === state.activeAccountId) ?? state.accounts[0]
}

export function formatStateSummary(state: AppState) {
  const active = getActiveAccount(state)

  return {
    activeAccountId: active?.id ?? null,
    activeLabel: active?.label ?? null,
    activeEmail: active?.email ?? null,
    totalAccounts: state.accounts.length,
    accounts: state.accounts.map((account) => ({
      id: account.id,
      label: account.label,
      email: account.email,
      profileDir: account.profileDir,
      authSignature: account.authSignature,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      usage: account.usage,
      isActive: account.id === (active?.id ?? null),
    })),
  }
}

export async function ensureStateFile() {
  await ensureSwitchDirs()
  const state = await readState()
  if (!state.accounts) {
    await writeState(buildDefaultState())
  }
}
