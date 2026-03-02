import type { UsageSnapshot } from './types'

const ACCOUNT_BLOCKING_ERROR_TERMS = [
  'unsupported_country',
  'unsupported region',
  'unsupported account',
  'not supported in your country',
  'country is not supported',
  'country not supported',
  'account_deactivated',
  'account deactivated',
  'deactivated account',
  'account is deactivated',
  'account has been deactivated',
  'account disabled',
  'disabled account',
  'account suspended',
  'suspended account',
  'account inactive',
  'inactive account',
  'account banned',
  'account terminated',
  'account deleted',
  'deleted account',
  'account has been deleted',
  'deleted or deactivated',
  'do not have an account because it has been deleted or deactivated',
  'you do not have an account because it has been deleted or deactivated',
] as const

const DEFAULT_BLOCKED_ACCOUNT_MESSAGE = 'You do not have an account because it has been deleted or deactivated.'

export function isBlockedAccountMessage(message: string | null | undefined) {
  if (!message) return false
  const normalized = message.toLowerCase()
  return ACCOUNT_BLOCKING_ERROR_TERMS.some((term) => normalized.includes(term))
}

export function extractBlockedAccountMessage(message: string | null | undefined) {
  if (!message) return null
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (isBlockedAccountMessage(line)) {
      return line
    }
  }
  return isBlockedAccountMessage(message) ? DEFAULT_BLOCKED_ACCOUNT_MESSAGE : null
}

export function isUnusableAccountUsage(usage: Pick<UsageSnapshot, 'status' | 'error'>) {
  if (usage.status !== 'error') return false
  return isBlockedAccountMessage(usage.error)
}
