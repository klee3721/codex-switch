import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { ensureSwitchDirs, getPaths, readState } from './store'
import { extractAuthTokens, readAuthFile, validateChatGptAuth } from './codex-auth'
import type { DoctorCheck, DoctorReport } from './types'

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []
  const paths = getPaths()

  const codexVersion = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  checks.push({
    name: 'codex_binary',
    ok: (codexVersion.status ?? 1) === 0,
    details:
      (codexVersion.status ?? 1) === 0
        ? (codexVersion.stdout ?? '').trim() || 'codex is available'
        : (codexVersion.stderr ?? '').trim() || 'codex command failed',
  })

  try {
    await ensureSwitchDirs()
    checks.push({
      name: 'switch_dirs',
      ok: true,
      details: `${paths.switchHome}`,
    })
  } catch (error) {
    checks.push({
      name: 'switch_dirs',
      ok: false,
      details: (error as Error).message,
    })
  }

  try {
    const state = await readState()
    checks.push({
      name: 'state_file',
      ok: true,
      details: `${state.accounts.length} account(s) tracked`,
    })

    for (const account of state.accounts) {
      try {
        await fs.access(account.profileDir)
        const { authPath, json } = await readAuthFile(account.profileDir)
        const tokens = extractAuthTokens(authPath, json)
        validateChatGptAuth(tokens)
        checks.push({
          name: `account:${account.id}`,
          ok: true,
          details: `${account.label} (${tokens.authMode ?? 'unknown'})`,
        })
      } catch (error) {
        checks.push({
          name: `account:${account.id}`,
          ok: false,
          details: `${account.label}: ${(error as Error).message}`,
        })
      }
    }
  } catch (error) {
    checks.push({
      name: 'state_file',
      ok: false,
      details: (error as Error).message,
    })
  }

  return {
    generatedAt: Date.now(),
    checks,
  }
}
