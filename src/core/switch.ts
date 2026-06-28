import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveCodexExecutable } from './codex-command'
import { chmodPrivateFile, copyPrivateFile, ensurePrivateDir, getPaths } from './store'
import type { Account, SwitchResult } from './types'

const CODEX_APP_PATH = '/Applications/Codex.app'

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function restartCodexDesktopApp() {
  if (process.platform !== 'darwin') return

  try {
    await fs.access(CODEX_APP_PATH)
  } catch {
    return
  }

  const isRunning = () =>
    (spawnSync('pgrep', ['-f', '/Applications/Codex.app'], {
      stdio: 'ignore',
    }).status ?? 1) === 0

  if (isRunning()) {
    spawnSync('osascript', ['-e', 'tell application "Codex" to quit'], {
      stdio: 'ignore',
    })

    await sleep(900)

    if (isRunning()) {
      spawnSync('pkill', ['-TERM', '-f', '/Applications/Codex.app'], {
        stdio: 'ignore',
      })
      await sleep(600)
    }
  }

  spawnSync('open', ['-a', CODEX_APP_PATH], {
    stdio: 'ignore',
  })
}

export async function switchToAccount(account: Account): Promise<SwitchResult> {
  const paths = getPaths()
  const sourceAuth = path.join(account.profileDir, 'auth.json')

  await ensurePrivateDir(paths.codexHome)
  await ensurePrivateDir(paths.backupsDir)
  await ensurePrivateDir(account.profileDir)
  await chmodPrivateFile(sourceAuth)

  await fs.access(sourceAuth)

  let backupPath: string | null = null
  try {
    await fs.access(paths.codexAuthPath)
    backupPath = path.join(paths.backupsDir, `${timestampForFile()}-auth.json`)
    await copyPrivateFile(paths.codexAuthPath, backupPath)
  } catch {
    backupPath = null
  }

  await copyPrivateFile(sourceAuth, paths.codexAuthPath)
  await restartCodexDesktopApp()

  const statusResult = spawnSync(resolveCodexExecutable(), ['login', 'status'], {
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
