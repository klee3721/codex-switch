import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { getPaths } from './store'
import type { Account, SwitchResult } from './types'

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function switchToAccount(account: Account): Promise<SwitchResult> {
  const paths = getPaths()
  const sourceAuth = path.join(account.profileDir, 'auth.json')

  await fs.mkdir(paths.codexHome, { recursive: true })
  await fs.mkdir(paths.backupsDir, { recursive: true })

  await fs.access(sourceAuth)

  let backupPath: string | null = null
  try {
    await fs.access(paths.codexAuthPath)
    backupPath = path.join(paths.backupsDir, `${timestampForFile()}-auth.json`)
    await fs.copyFile(paths.codexAuthPath, backupPath)
  } catch {
    backupPath = null
  }

  await fs.copyFile(sourceAuth, paths.codexAuthPath)

  const statusResult = spawnSync('codex', ['login', 'status'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  return {
    backupPath,
    codexStatusExitCode: statusResult.status ?? 1,
    codexStatusStdout: statusResult.stdout ?? '',
    codexStatusStderr: statusResult.stderr ?? '',
  }
}
